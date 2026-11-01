'use strict';

// Player profile fetch pipeline: cache lookup, official identity -> Hypixel
// resolution, parallel Urchin/ping fan-out, optional status, error
// classification, and in-flight deduping. Extracted from proxy.js;
// proxy.js still owns the cache, key store, dedupe instance, and the
// per-service raw fetchers, and injects them via createStatsFetch.

const axios = require('axios');
const { BoundedTtlMap } = require('../util/bounded_ttl_map.js');
const { InFlightDeduper } = require('../util/in_flight_deduper.js');
const { createMojangLookup } = require('./mojangLookup');

const LOOKUP_RETRY_DELAYS_MS = [1000, 3000];
const LOOKUP_FAILURE_COOLDOWN_MS = 30000;
const RATE_LIMIT_FALLBACK_MS = 60000;

function isRetryableLookupError(error) {
    if (error?.apiKillSwitchBlocked || error?.hypixelApiUnavailable) return false;
    if (error?.mojangRetryable) return true;
    const status = Number(error?.response?.status) || 0;
    if (status) return status === 429 || status >= 500;
    return ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ERR_NETWORK'].includes(error?.code)
        || Boolean(error?.isAxiosError && !error?.response && error?.code !== 'ERR_CANCELED');
}

function retryAfterMs(error, now) {
    const headers = error?.response?.headers;
    const value = headers?.get?.('retry-after') ?? headers?.['retry-after'] ?? headers?.['Retry-After'];
    if (value === undefined || value === null) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000) + 350;
    return Math.max(0, Date.parse(value) - now) || 0;
}

function withoutEnderDust(player) {
    let clean = player;
    const stripPrivateSlumberProgress = (slumber) => {
        if (!slumber || typeof slumber !== 'object') return slumber;
        let next = slumber;
        if (slumber.minion && Object.prototype.hasOwnProperty.call(slumber.minion, 'ender_dust')) {
            next = { ...next, minion: { ...slumber.minion } };
            delete next.minion.ender_dust;
        }
        if (slumber.quest?.lastCompleted && typeof slumber.quest.lastCompleted === 'object') {
            next = { ...next, quest: { ...slumber.quest } };
            delete next.quest.lastCompleted;
        }
        return next;
    };

    if (clean?.slumber) clean = { ...clean, slumber: stripPrivateSlumberProgress(clean.slumber) };

    for (const key of ['Bedwars', 'BedWars']) {
        const slumber = clean?.stats?.[key]?.slumber;
        if (!slumber) continue;
        clean = {
            ...clean,
            stats: {
                ...clean.stats,
                [key]: {
                    ...clean.stats[key],
                    slumber: stripPrivateSlumberProgress(slumber)
                }
            }
        };
    }
    return clean;
}

function createStatsFetch({
    globalCache,
    cacheDuration,
    getHypixelKey,
    hasHypixelApiKeyConfigured,
    hypixelApiGet,
    getUrchinRaw,
    getAuroraPingRaw,
    getHypixelStatusRaw,
    makePingData,
    mergeUrchinOverride,
    notifyUrchinOutageOnce,
    classifyPlayerLookupError,
    playerLookupDeduper,
    observeHypixelPlayerData = () => {},
    captureRetryGuard = () => () => true,
    getRetrySignal = () => null,
    now = Date.now,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout
} = {}) {
    const required = {
        globalCache, cacheDuration, getHypixelKey,
        hasHypixelApiKeyConfigured, hypixelApiGet, getUrchinRaw,
        getAuroraPingRaw, getHypixelStatusRaw, makePingData, mergeUrchinOverride,
        notifyUrchinOutageOnce, classifyPlayerLookupError, playerLookupDeduper
    };
    for (const [name, value] of Object.entries(required)) {
        if (value === undefined || value === null) {
            throw new Error(`createStatsFetch requires ${name}`);
        }
    }

    const pendingUrchinOverrides = new Map();
    // Preview listeners live only as long as the shared lookup. Full consumers
    // and the global cache still receive completed tag/ping data exclusively.
    const pendingProfiles = new Map();
    function notifyPrimary(listener, profile) {
        try { listener(profile); } catch (error) { console.error('[Stats] Primary display failed:', error?.message || error); }
    }
    function subscribePrimary(entry, listener) {
        if (typeof listener !== 'function') return () => {};
        if (entry.primary) notifyPrimary(listener, entry.primary);
        else entry.listeners.add(listener);
        return () => entry.listeners.delete(listener);
    }
    function observePendingPlayerProfile(name, listener) {
        if (typeof listener !== 'function') return () => {};
        const entry = [...pendingProfiles.values()].find(item => item.name === name.toLowerCase()
            && item.key === getHypixelKey() && !item.signal.aborted && item.isCurrent());
        return entry ? subscribePrimary(entry, listener) : () => {};
    }
    // Only official name-verified mappings are reusable. Live tab UUIDs can belong to
    // nicknames, so they must not bypass the existing identity checks.
    const uuidCache = new BoundedTtlMap({ ttlMs: cacheDuration, maxEntries: 1000, now });
    const recentFailures = new BoundedTtlMap({ ttlMs: Infinity, maxEntries: 1000, now });
    const statusDeduper = new InFlightDeduper();
    const scopeIds = new WeakMap();
    let nextScopeId = 0;
    let retryController = new AbortController();
    const mojangLookup = createMojangLookup({ request: (url, options) => axios.get(url, options),
        isRetryable: isRetryableLookupError, retryAfterMs, now, setTimeoutImpl, clearTimeoutImpl,
        onFailure: details => console.warn('[Stats] Minecraft identity lookup failed:', JSON.stringify(details)) });

    function cancelledError() {
        return Object.assign(new Error('Stats lookup recovery was cancelled.'), { code: 'STATS_LOOKUP_CANCELLED' });
    }

    function wait(ms, signal, canRetry) {
        if (signal.aborted || !canRetry()) return Promise.reject(cancelledError());
        return new Promise((resolve, reject) => {
            const abort = () => { clearTimeoutImpl(timer); reject(cancelledError()); };
            const timer = setTimeoutImpl(() => {
                signal.removeEventListener('abort', abort);
                if (signal.aborted || !canRetry()) reject(cancelledError());
                else resolve();
            }, ms);
            timer.unref?.();
            signal.addEventListener('abort', abort, { once: true });
        });
    }

    async function withRecovery(provider, request, signal, canRetry, recoverySignal = signal) {
        let delay = 0;
        for (let attempt = 0; ; attempt++) {
            if (signal.aborted || (attempt > 0 && recoverySignal.aborted)) throw cancelledError();
            const waitMs = delay;
            if (waitMs > 0) await wait(waitMs, recoverySignal, canRetry);
            if (attempt > 0 && !canRetry()) throw cancelledError();
            try { return await request(attempt, attempt > 0 ? recoverySignal : undefined); }
            catch (error) {
                const rateLimited = error?.response?.status === 429;
                const reset = Number(error?.response?.headers?.['ratelimit-reset'] ?? error?.response?.headers?.['RateLimit-Reset']);
                const resetWait = retryAfterMs(error, now())
                    || (rateLimited && provider === 'hypixel' && reset >= 0 ? reset * 1000 + 350 : 0)
                    || (rateLimited ? RATE_LIMIT_FALLBACK_MS : 0);
                if (!isRetryableLookupError(error) || attempt >= LOOKUP_RETRY_DELAYS_MS.length) throw error;
                delay = Math.max(LOOKUP_RETRY_DELAYS_MS[attempt], resetWait);
            }
        }
    }

    async function resolvePlayerUuid(name, signal, canRetry, recoverySignal) {
        const cached = uuidCache.get(name.toLowerCase());
        if (cached) return cached.uuid;
        const uuid = await mojangLookup.resolve(name, { signal: recoverySignal, canRetry });
        uuidCache.set(name.toLowerCase(), { uuid, timestamp: now() });
        return uuid;
    }

    async function includePlayerStatus(profile, includeStatus) {
        if (includeStatus && profile?.data?.player?.uuid
            && (!profile.data.status || profile.data.status === '§7Not checked')) {
            const uuid = profile.data.player.uuid;
            profile.data.status = await statusDeduper.run(uuid, () => getHypixelStatusRaw(uuid));
        }
        return profile;
    }

    function cancelPendingRetries() {
        retryController.abort();
        retryController = new AbortController();
        recentFailures.clear();
    }

    async function getPlayerData(name, options = {}) {
        const includeErrors = Boolean(options.includeErrors);
        const forceRefresh = Boolean(options.forceRefresh);
        const includeStatus = Boolean(options.includeStatus);
        const preferCache = options.preferCache !== undefined ? Boolean(options.preferCache) : true;
        const urchinOverride = options.urchinOverride || null;
        const lowerName = name.toLowerCase();
        const cached = globalCache.get(lowerName);
        if (preferCache && !forceRefresh && cached && (now() - cached.timestamp < cacheDuration)) {
            if (urchinOverride) {
                cached.data.urchin = mergeUrchinOverride(cached.data.urchin, urchinOverride);
            }
            if (!cached.data.ping || cached.data.ping.requestStatus === 'not_checked') {
                if (typeof options.onPrimaryProfile === 'function') notifyPrimary(options.onPrimaryProfile,
                    { data: cached.data, fromCache: true, supplementalPending: true });
                const uuid = cached.data.player?.uuid;
                cached.data.ping = uuid ? await getAuroraPingRaw(uuid) : makePingData({
                    ok: false,
                    requestStatus: 'missing_uuid',
                    error: 'Missing player UUID.'
                });
            }
            notifyUrchinOutageOnce(cached.data?.urchin);
            return includePlayerStatus({ data: cached.data, fromCache: true }, includeStatus);
        }

        if (!hasHypixelApiKeyConfigured()) {
            return includeErrors
                ? { error: true, errorType: 'hypixel_key_failed', message: 'Hypixel API key is missing.' }
                : null;
        }

        const keyAtStart = getHypixelKey();
        const lookupSignal = retryController.signal;
        const scopeSignal = getRetrySignal();
        if (scopeSignal && !scopeIds.has(scopeSignal)) scopeIds.set(scopeSignal, ++nextScopeId);
        const dedupeKey = `${lowerName}|${keyAtStart}|${scopeSignal ? scopeIds.get(scopeSignal) : 0}`;
        let progress = pendingProfiles.get(dedupeKey);
        if (!progress) {
            progress = { name: lowerName, key: keyAtStart, signal: lookupSignal,
                isCurrent: captureRetryGuard(), primary: null, listeners: new Set() };
            pendingProfiles.set(dedupeKey, progress);
        }
        const unsubscribe = subscribePrimary(progress, options.onPrimaryProfile);
        if (urchinOverride) pendingUrchinOverrides.set(dedupeKey, urchinOverride);

        const executeLookup = async () => {
            const failure = recentFailures.get(dedupeKey);
            if (failure && failure.until <= now()) recentFailures.delete(dedupeKey);
            else if (failure && preferCache && !forceRefresh) {
                pendingUrchinOverrides.delete(dedupeKey);
                return failure.result;
            }
            const signal = lookupSignal;
            const recoverySignal = AbortSignal.any(scopeSignal ? [signal, scopeSignal] : [signal]);
            const contextIsCurrent = captureRetryGuard();
            const canRetry = () => contextIsCurrent() && getHypixelKey() === keyAtStart;
            let provider = 'mojang';
            try {
                const uuid = await resolvePlayerUuid(name, signal, canRetry, recoverySignal);
                if (!uuid) {
                    const miss = { error: true, errorType: 'player_not_found', message: 'Player was not found.' };
                    return miss;
                }

                provider = 'hypixel';
                const activeUrchinOverride = pendingUrchinOverrides.get(dedupeKey) || null;
                let details = null, readyUrchin = activeUrchinOverride, readyPing = null;
                const detailsPromise = Promise.all([
                    (activeUrchinOverride ? Promise.resolve(activeUrchinOverride) : getUrchinRaw(name, uuid, { priority: options.apiPriority }))
                        .then(value => { readyUrchin = value; return value; }),
                    getAuroraPingRaw(uuid).then(value => { readyPing = value; return value; })
                ]).then(value => { details = value; return value; });
                // Handle a secondary rejection immediately, even while the
                // primary request is retrying; awaiting below still throws it.
                detailsPromise.catch(() => {});
                const hRes = await withRecovery('hypixel', (attempt, retrySignal) => hypixelApiGet(`https://api.hypixel.net/v2/player?uuid=${uuid}`, {
                    timeout: 5000,
                    apiPriority: options.apiPriority,
                    ...(retrySignal ? { signal: retrySignal } : {})
                }), signal, canRetry, recoverySignal);

                if (!hRes.data.player) {
                    const miss = { error: true, errorType: 'hypixel_player_missing', message: 'Player has no Hypixel profile data.' };
                    return miss;
                }

                // The host returns true only for the local account. We retain
                // its private Slumber readings in the reminders, but strip
                // other players' minion and quest progress before caching.
                let isOwnPlayer = false;
                try {
                    isOwnPlayer = Boolean(observeHypixelPlayerData(uuid, hRes.data.player));
                } catch (error) {
                    // A reminder observer must never affect a stats lookup.
                }

                const player = isOwnPlayer ? hRes.data.player : withoutEnderDust(hRes.data.player);
                if (!details && !signal.aborted && progress.isCurrent() && getHypixelKey() === keyAtStart) {
                    progress.primary = { data: { player,
                        urchin: readyUrchin || { ok: false, requestStatus: 'pending', error: 'Player tags are still being checked.' },
                        ping: readyPing || makePingData({ ok: false, requestStatus: 'not_checked' }), status: '§7Not checked'
                    }, fromCache: false, supplementalPending: true };
                    for (const listener of progress.listeners) notifyPrimary(listener, progress.primary);
                    progress.listeners.clear();
                }
                const [urchin, ping] = await detailsPromise;
                const data = {
                    player,
                    urchin,
                    status: '§7Not checked',
                    ping
                };
                recentFailures.delete(dedupeKey);
                if (!signal.aborted && !scopeSignal?.aborted && getHypixelKey() === keyAtStart) {
                    globalCache.set(lowerName, { data, timestamp: now() });
                }
                return { data, fromCache: false };
            } catch (e) {
                const classified = classifyPlayerLookupError(e, provider);
                if (isRetryableLookupError(e) && !recoverySignal.aborted && canRetry()) {
                    recentFailures.set(dedupeKey, {
                        result: classified,
                        until: Math.max(now() + LOOKUP_FAILURE_COOLDOWN_MS,
                            provider === 'mojang' ? mojangLookup.getCooldownUntil() : 0, now() + retryAfterMs(e, now()))
                    });
                }
                return classified;
            } finally {
                pendingUrchinOverrides.delete(dedupeKey);
            }
        };

        let profile;
        try {
            profile = await playerLookupDeduper.run(dedupeKey, async () => {
                try { return await executeLookup(); }
                finally { if (pendingProfiles.get(dedupeKey) === progress) pendingProfiles.delete(dedupeKey); }
            });
        } finally { unsubscribe(); }
        if (urchinOverride && profile?.data) {
            const data = {
                ...profile.data,
                urchin: mergeUrchinOverride(profile.data.urchin, urchinOverride)
            };
            if (!lookupSignal.aborted && !scopeSignal?.aborted && getHypixelKey() === keyAtStart) {
                globalCache.set(lowerName, { data, timestamp: now() });
            }
            return includePlayerStatus({ ...profile, data }, includeStatus);
        }
        if (profile?.error) return includeErrors ? profile : null;
        return includePlayerStatus(profile, includeStatus);
    }

    return { getPlayerData, cancelPendingRetries, observePendingPlayerProfile };
}

module.exports = { createStatsFetch };
