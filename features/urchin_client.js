'use strict';

const { BoundedTtlMap } = require('../src/util/bounded_ttl_map.js');

const URCHIN_BATCH_SOURCES = 'GAME';
const URCHIN_BATCH_CACHE_DURATION = 5 * 60 * 1000;
const URCHIN_BATCH_STALE_DURATION = 30 * 60 * 1000;
const URCHIN_BATCH_FAILURE_CACHE_DURATION = 3 * 1000;
const URCHIN_BATCH_DEBOUNCE_MS = 40;
const URCHIN_BATCH_NON_GAME_DEBOUNCE_MS = 650;
const URCHIN_BATCH_NON_GAME_MIN_SPACING_MS = 900;
const URCHIN_BATCH_MAX_NAMES = 40;
const URCHIN_BATCH_NON_GAME_MAX_NAMES = 12;
const URCHIN_RATE_LIMIT_FALLBACK_COOLDOWN_MS = 30 * 1000;
const URCHIN_SESSION_CACHE_DURATION = 30 * 1000;
const URCHIN_BATCH_CACHE_MAX_ENTRIES = 2000;
const URCHIN_SESSION_CACHE_MAX_ENTRIES = 500;

// Coral (the new Urchin API). The legacy urchin.ws host is deprecated and
// shuts down 2026-07-31, so tag lookups now go through Coral's per-player
// /v3/player/tags endpoint (which accepts usernames, no UUID resolution).
const CORAL_API_BASE = 'https://api.urchin.gg/v3';

function defaultPlayerLookupKey(name) {
    return String(name || '').trim().toLowerCase();
}

function getResponseHeader(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === 'function') {
        const value = headers.get(name);
        if (value !== undefined && value !== null) return value;
    }
    const lowerName = String(name || '').toLowerCase();
    const matchedKey = Object.keys(headers).find(key => String(key).toLowerCase() === lowerName);
    return matchedKey ? headers[matchedKey] : null;
}

function waitForMs(delayMs) {
    const delay = Math.max(0, Number(delayMs) || 0);
    return delay > 0 ? new Promise(resolve => setTimeout(resolve, delay)) : Promise.resolve();
}

function createUrchinClient(options = {}) {
    const axios = options.axios;
    if (!axios || typeof axios.get !== 'function' || typeof axios.post !== 'function') {
        throw new Error('createUrchinClient requires an axios-like client with get() and post().');
    }

    const getKey = typeof options.getKey === 'function' ? options.getKey : () => '';
    const getGameState = typeof options.getGameState === 'function' ? options.getGameState : () => null;
    const playerLookupKey = typeof options.playerLookupKey === 'function' ? options.playerLookupKey : defaultPlayerLookupKey;
    const isMinecraftUsername = typeof options.isMinecraftUsername === 'function'
        ? options.isMinecraftUsername
        : (name) => /^[A-Za-z0-9_]{1,16}$/.test(String(name || ''));
    const makeUrchinData = typeof options.makeUrchinData === 'function'
        ? options.makeUrchinData
        : (data = {}) => data;
    const parseBatchTags = typeof options.parseBatchTags === 'function'
        ? options.parseBatchTags
        : (() => makeUrchinData({ ok: true, rawTags: [] }));
    const findBatchTagsForName = typeof options.findBatchTagsForName === 'function'
        ? options.findBatchTagsForName
        : (() => []);
    const classifyRequestError = typeof options.classifyRequestError === 'function'
        ? options.classifyRequestError
        : ((error) => ({
            ok: false,
            requestStatus: error?.response?.status === 429 ? 'rate_limited' : 'failed',
            error: 'Urchin API request failed.'
        }));
    const notifyOutage = typeof options.notifyOutage === 'function' ? options.notifyOutage : () => {};
    const stripAnsi = typeof options.stripAnsi === 'function'
        ? options.stripAnsi
        : (text) => String(text || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    const resolveSessionEndpoint = typeof options.resolveSessionEndpoint === 'function'
        ? options.resolveSessionEndpoint
        : (() => 'daily');

    const urchinBatchTagCache = new BoundedTtlMap({
        ttlMs: URCHIN_BATCH_STALE_DURATION,
        maxEntries: URCHIN_BATCH_CACHE_MAX_ENTRIES
    });
    const urchinBatchLookupQueue = new Map();
    const urchinSessionCache = new BoundedTtlMap({
        ttlMs: URCHIN_SESSION_CACHE_DURATION,
        maxEntries: URCHIN_SESSION_CACHE_MAX_ENTRIES
    });
    const urchinSessionRequests = new Map();

    let urchinBatchRequestInFlight = false;
    let urchinBatchDrainTimer = null;
    let urchinRateLimitRemaining = null;
    let urchinRateLimitLimit = null;
    let urchinRateLimitResetAt = 0;
    let urchinRateLimitCooldownUntil = 0;
    let urchinNextNonGameBatchAt = 0;
    let urchinNonGamePaceTail = Promise.resolve();

    function parseUrchinResetAt(headers, status = 0) {
        const now = Date.now();
        const retryAfter = getResponseHeader(headers, 'retry-after');
        if (retryAfter !== null && retryAfter !== undefined) {
            const seconds = Number(retryAfter);
            if (Number.isFinite(seconds)) return now + Math.max(0, seconds) * 1000;
            const retryDate = Date.parse(String(retryAfter));
            if (Number.isFinite(retryDate)) return retryDate;
        }

        const rawReset = Number(getResponseHeader(headers, 'x-ratelimit-reset'));
        if (Number.isFinite(rawReset) && rawReset > 0) {
            if (rawReset > 1e12) return rawReset;
            if (rawReset > Math.floor(now / 1000) - 86400) return rawReset * 1000;
            return now + rawReset * 1000;
        }

        return status === 429 ? now + URCHIN_RATE_LIMIT_FALLBACK_COOLDOWN_MS : 0;
    }

    function noteUrchinRateLimitHeaders(headers, status = 0) {
        const rawLimit = getResponseHeader(headers, 'x-ratelimit-limit');
        const rawRemaining = getResponseHeader(headers, 'x-ratelimit-remaining');
        const limit = rawLimit === null || rawLimit === undefined ? NaN : Number(rawLimit);
        const remaining = rawRemaining === null || rawRemaining === undefined ? NaN : Number(rawRemaining);
        const resetAt = parseUrchinResetAt(headers, status);

        if (Number.isFinite(limit) && limit >= 0) urchinRateLimitLimit = limit;
        if (Number.isFinite(remaining) && remaining >= 0) urchinRateLimitRemaining = remaining;
        if (resetAt > 0) urchinRateLimitResetAt = resetAt;

        if (status === 429 || urchinRateLimitRemaining === 0) {
            urchinRateLimitCooldownUntil = Math.max(
                urchinRateLimitCooldownUntil,
                resetAt > Date.now() ? resetAt + 250 : Date.now() + URCHIN_RATE_LIMIT_FALLBACK_COOLDOWN_MS
            );
        }
    }

    function refreshUrchinRateLimitWindow() {
        if (urchinRateLimitResetAt > 0 && Date.now() >= urchinRateLimitResetAt + 250) {
            urchinRateLimitRemaining = null;
            urchinRateLimitResetAt = 0;
            urchinRateLimitCooldownUntil = 0;
        }
    }

    function cachedUrchinBatchData(name, options = {}) {
        const key = playerLookupKey(name);
        const cached = urchinBatchTagCache.get(key);
        if (!cached) return null;

        const age = Date.now() - cached.timestamp;
        const freshFor = cached.data?.ok === true
            ? URCHIN_BATCH_CACHE_DURATION
            : URCHIN_BATCH_FAILURE_CACHE_DURATION;
        if (age <= freshFor) return cached.data;
        if (options.allowStale && cached.data?.ok === true && age <= URCHIN_BATCH_STALE_DURATION) {
            return {
                ...cached.data,
                stale: true
            };
        }
        if (age > URCHIN_BATCH_STALE_DURATION) urchinBatchTagCache.delete(key);
        return null;
    }

    function cacheUrchinBatchData(name, data) {
        if (!isMinecraftUsername(name) || !data) return;
        urchinBatchTagCache.set(playerLookupKey(name), {
            data,
            timestamp: Date.now()
        });
    }

    function makeUrchinRateLimitedData(name = '') {
        const retryAfterMs = Math.max(0, urchinRateLimitCooldownUntil - Date.now());
        return makeUrchinData({
            ok: false,
            requestStatus: 'rate_limited',
            error: 'Urchin API is rate limited.',
            player: name,
            retryAfterMs,
            rateLimit: {
                limit: urchinRateLimitLimit,
                remaining: urchinRateLimitRemaining,
                resetAt: urchinRateLimitResetAt || null
            }
        });
    }

    function resolveUrchinBatchQueueItem(item, data) {
        (item?.resolvers || []).forEach(resolve => resolve(data));
    }

    function resolveQueuedUrchinLookupsDuringCooldown() {
        for (const [queueKey, item] of urchinBatchLookupQueue.entries()) {
            const stale = cachedUrchinBatchData(item.name, { allowStale: true });
            resolveUrchinBatchQueueItem(item, stale || makeUrchinRateLimitedData(item.name));
            urchinBatchLookupQueue.delete(queueKey);
        }
    }

    function isUrchinBatchGameActive() {
        return Boolean(getGameState()?.gameActive);
    }

    function paceUrchinNonGameRequest() {
        if (isUrchinBatchGameActive()) return Promise.resolve();
        const next = urchinNonGamePaceTail.then(async () => {
            const waitMs = Math.max(0, urchinNextNonGameBatchAt - Date.now());
            if (waitMs > 0) await waitForMs(waitMs);
            urchinNextNonGameBatchAt = Date.now() + URCHIN_BATCH_NON_GAME_MIN_SPACING_MS;
        });
        urchinNonGamePaceTail = next.catch(() => {});
        return next;
    }

    function urchinBatchPriority(options = {}) {
        if (options.priority === 'game' || options.priority === 'background') return options.priority;
        return isUrchinBatchGameActive() ? 'game' : 'background';
    }

    function nextUrchinBatchDelay(baseDelay = URCHIN_BATCH_DEBOUNCE_MS) {
        const hasGameQueued = Array.from(urchinBatchLookupQueue.values()).some(item => item.priority === 'game');
        if (hasGameQueued) return Math.max(0, baseDelay);
        const spacing = Math.max(0, urchinNextNonGameBatchAt - Date.now());
        return Math.max(URCHIN_BATCH_NON_GAME_DEBOUNCE_MS, spacing, baseDelay);
    }

    function scheduleUrchinBatchDrain(delay = URCHIN_BATCH_DEBOUNCE_MS) {
        if (urchinBatchDrainTimer || urchinBatchRequestInFlight || urchinBatchLookupQueue.size === 0) return;
        const nextDelay = nextUrchinBatchDelay(delay);
        urchinBatchDrainTimer = setTimeout(() => {
            urchinBatchDrainTimer = null;
            drainUrchinBatchQueue().catch(() => {});
        }, Math.max(0, nextDelay));
    }

    function enqueueUrchinBatchLookup(name, sources = URCHIN_BATCH_SOURCES, options = {}) {
        const normalizedName = String(name || '').trim();
        const cached = cachedUrchinBatchData(normalizedName);
        if (cached) return Promise.resolve(cached);

        refreshUrchinRateLimitWindow();
        if (urchinRateLimitCooldownUntil > Date.now()) {
            return Promise.resolve(
                cachedUrchinBatchData(normalizedName, { allowStale: true })
                || makeUrchinRateLimitedData(normalizedName)
            );
        }

        const normalizedSources = String(sources || URCHIN_BATCH_SOURCES);
        const priority = urchinBatchPriority(options);
        const queueKey = `${normalizedSources}:${playerLookupKey(normalizedName)}`;
        return new Promise(resolve => {
            const existing = urchinBatchLookupQueue.get(queueKey);
            if (existing) {
                existing.resolvers.push(resolve);
                if (priority === 'game') existing.priority = 'game';
            } else {
                urchinBatchLookupQueue.set(queueKey, {
                    name: normalizedName,
                    sources: normalizedSources,
                    priority,
                    resolvers: [resolve]
                });
            }
            scheduleUrchinBatchDrain();
        });
    }

    // Fetch one player's active tags from Coral. Never throws: returns
    // { ok:true, tags, headers, status } or { ok:false, error, status, headers }.
    async function fetchCoralPlayerTags(name, urchinKey) {
        try {
            const res = await axios.get(`${CORAL_API_BASE}/player/tags`, {
                timeout: 10000,
                params: { player: name },
                headers: { 'X-API-Key': urchinKey }
            });
            return {
                ok: true,
                tags: Array.isArray(res.data?.tags) ? res.data.tags : [],
                headers: res.headers,
                status: res.status
            };
        } catch (error) {
            return { ok: false, error, status: error?.response?.status || 0, headers: error?.response?.headers };
        }
    }

    async function drainUrchinBatchQueue() {
        if (urchinBatchRequestInFlight || urchinBatchLookupQueue.size === 0) return;
        refreshUrchinRateLimitWindow();

        if (urchinRateLimitCooldownUntil > Date.now()) {
            resolveQueuedUrchinLookupsDuringCooldown();
            return;
        }

        const urchinKey = String(getKey() || '').trim();
        if (!urchinKey) {
            for (const [queueKey, item] of urchinBatchLookupQueue.entries()) {
                const data = makeUrchinData({
                    ok: false,
                    requestStatus: 'missing_key',
                    error: 'Urchin API key is not set.'
                });
                cacheUrchinBatchData(item.name, data);
                resolveUrchinBatchQueueItem(item, data);
                urchinBatchLookupQueue.delete(queueKey);
            }
            return;
        }

        const gameItem = Array.from(urchinBatchLookupQueue.values()).find(item => item.priority === 'game');
        const firstItem = gameItem || urchinBatchLookupQueue.values().next().value;
        const sources = firstItem?.sources || URCHIN_BATCH_SOURCES;
        const priority = firstItem?.priority || 'background';
        if (priority !== 'game' && urchinNextNonGameBatchAt > Date.now()) {
            scheduleUrchinBatchDrain(urchinNextNonGameBatchAt - Date.now());
            return;
        }
        const available = Number.isFinite(urchinRateLimitRemaining)
            ? Math.max(0, urchinRateLimitRemaining)
            : URCHIN_BATCH_MAX_NAMES;
        if (available === 0) {
            urchinRateLimitCooldownUntil = Math.max(
                urchinRateLimitCooldownUntil,
                urchinRateLimitResetAt > Date.now()
                    ? urchinRateLimitResetAt + 250
                    : Date.now() + URCHIN_RATE_LIMIT_FALLBACK_COOLDOWN_MS
            );
            resolveQueuedUrchinLookupsDuringCooldown();
            return;
        }

        const batchEntries = Array.from(urchinBatchLookupQueue.entries())
            .filter(([, item]) => item.sources === sources && item.priority === priority)
            .slice(0, Math.min(priority === 'game' ? URCHIN_BATCH_MAX_NAMES : URCHIN_BATCH_NON_GAME_MAX_NAMES, available));
        batchEntries.forEach(([queueKey]) => urchinBatchLookupQueue.delete(queueKey));
        const names = batchEntries.map(([, item]) => item.name);
        urchinBatchRequestInFlight = true;
        if (priority !== 'game') urchinNextNonGameBatchAt = Date.now() + URCHIN_BATCH_NON_GAME_MIN_SPACING_MS;

        try {
            // Coral has no batch-by-username endpoint, so fan out one
            // /v3/player/tags request per queued name (still bounded by the
            // rate-limit `available` slice above). Each resolves or fails
            // independently instead of the whole batch sinking together.
            const results = await Promise.all(batchEntries.map(async ([, item]) => ({
                item,
                result: await fetchCoralPlayerTags(item.name, urchinKey)
            })));

            let sawRateLimit = false;
            for (const { result } of results) {
                if (result.headers) noteUrchinRateLimitHeaders(result.headers, result.status || 0);
                if (result.status === 429) sawRateLimit = true;
            }

            let outageClassified = null;
            for (const { item, result } of results) {
                if (result.ok) {
                    const data = parseBatchTags(result.tags);
                    data.rateLimit = {
                        limit: urchinRateLimitLimit,
                        remaining: urchinRateLimitRemaining,
                        resetAt: urchinRateLimitResetAt || null
                    };
                    cacheUrchinBatchData(item.name, data);
                    resolveUrchinBatchQueueItem(item, data);
                } else {
                    const classified = classifyRequestError(result.error);
                    if (!outageClassified) outageClassified = classified;
                    const stale = cachedUrchinBatchData(item.name, { allowStale: true });
                    const data = stale || makeUrchinData({
                        ok: false,
                        ...classified,
                        retryAfterMs: Math.max(0, urchinRateLimitCooldownUntil - Date.now())
                    });
                    if (!stale && classified.requestStatus !== 'rate_limited') {
                        cacheUrchinBatchData(item.name, data);
                    }
                    resolveUrchinBatchQueueItem(item, data);
                }
            }

            if (outageClassified) notifyOutage(outageClassified);
            if (sawRateLimit) resolveQueuedUrchinLookupsDuringCooldown();
        } finally {
            urchinBatchRequestInFlight = false;
            if (urchinBatchLookupQueue.size > 0) scheduleUrchinBatchDrain(0);
        }
    }

    function resetUrchinLookupState() {
        if (urchinBatchDrainTimer) clearTimeout(urchinBatchDrainTimer);
        urchinBatchDrainTimer = null;
        for (const [, item] of urchinBatchLookupQueue.entries()) {
            resolveUrchinBatchQueueItem(item, makeUrchinData({
                ok: false,
                requestStatus: 'reset',
                error: 'Urchin API configuration changed.'
            }));
        }
        urchinBatchLookupQueue.clear();
        urchinBatchTagCache.clear();
        urchinSessionCache.clear();
        urchinSessionRequests.clear();
        urchinRateLimitRemaining = null;
        urchinRateLimitLimit = null;
        urchinRateLimitResetAt = 0;
        urchinRateLimitCooldownUntil = 0;
    }

    function getUrchinRateLimitSnapshot() {
        refreshUrchinRateLimitWindow();
        return {
            limit: urchinRateLimitLimit,
            remaining: urchinRateLimitRemaining,
            resetInMs: urchinRateLimitResetAt > 0 ? Math.max(0, urchinRateLimitResetAt - Date.now()) : null,
            cooldownInMs: Math.max(0, urchinRateLimitCooldownUntil - Date.now()),
            queuedPlayers: urchinBatchLookupQueue.size,
            gameQueuedPlayers: Array.from(urchinBatchLookupQueue.values()).filter(item => item.priority === 'game').length,
            backgroundQueuedPlayers: Array.from(urchinBatchLookupQueue.values()).filter(item => item.priority !== 'game').length,
            nextBackgroundBatchInMs: Math.max(0, urchinNextNonGameBatchAt - Date.now()),
            requestInFlight: urchinBatchRequestInFlight,
            cachedPlayers: urchinBatchTagCache.size
        };
    }

    async function getUrchinBatchRaw(names, sources = URCHIN_BATCH_SOURCES) {
        const uniqueNames = Array.from(new Set((names || [])
            .map(name => String(name || '').trim())
            .filter(isMinecraftUsername)));
        const results = new Map();
        const resolved = await Promise.all(uniqueNames.map(async name => [
            playerLookupKey(name),
            await enqueueUrchinBatchLookup(name, sources)
        ]));
        resolved.forEach(([key, data]) => results.set(key, data));
        return results;
    }

    async function getUrchinRaw(name) {
        const batch = await getUrchinBatchRaw([name]);
        return batch.get(playerLookupKey(name)) || makeUrchinData({
            ok: false,
            requestStatus: 'failed',
            error: 'Urchin API request failed.'
        });
    }

    async function fetchUrchinFull(name) {
        const data = await getUrchinRaw(name);
        if (data?.ok === false) {
            return {
                error: data.error || 'Urchin API request failed.',
                requestStatus: data.requestStatus,
                retryAfterMs: data.retryAfterMs || 0
            };
        }
        const tags = Array.isArray(data?.rawTags) ? data.rawTags.slice() : [];
        tags.ok = true;
        tags.requestStatus = data?.requestStatus || 'ok';
        tags.stale = Boolean(data?.stale);
        return tags;
    }

    async function fetchUrchinSession(player, period) {
        const urchinKey = String(getKey() || '').trim();
        if (!urchinKey) return { error: 'Urchin API key not set. Use /apikey urchin <key>.' };
        const endpoint = resolveSessionEndpoint(period) || 'daily';
        const requestKey = `${playerLookupKey(player)}:${endpoint}`;
        const cached = urchinSessionCache.get(requestKey);
        if (cached && Date.now() - cached.timestamp <= URCHIN_SESSION_CACHE_DURATION) return cached.data;
        if (urchinSessionRequests.has(requestKey)) return urchinSessionRequests.get(requestKey);

        refreshUrchinRateLimitWindow();
        if (urchinRateLimitCooldownUntil > Date.now()) {
            const seconds = Math.max(1, Math.ceil((urchinRateLimitCooldownUntil - Date.now()) / 1000));
            return { error: `Urchin API is cooling down after a rate limit. Try again in ${seconds}s.` };
        }

        const request = (async () => {
            try {
                await paceUrchinNonGameRequest();
                const url = `https://api.urchin.gg/v3/player/sessions/${endpoint}`;
                const res = await axios.get(url, {
                    timeout: 10000,
                    params: {
                        player,
                        key: urchinKey,
                        api_key: urchinKey
                    },
                    headers: {
                        'X-API-Key': urchinKey
                    }
                });
                noteUrchinRateLimitHeaders(res.headers, res.status);
                const data = res.data?.success === false
                    ? { error: res.data?.message || res.data?.error || 'Urchin session request failed.' }
                    : res.data;
                urchinSessionCache.set(requestKey, { data, timestamp: Date.now() });
                return data;
            } catch (e) {
                const status = e.response?.status;
                noteUrchinRateLimitHeaders(e.response?.headers, status || 0);
                const body = e.response?.data;
                const bodyMessage = typeof body === 'string'
                    ? body.slice(0, 140)
                    : (body?.message || body?.error || body?.detail || body?.reason || '');
                const suffix = bodyMessage ? ` §8(${stripAnsi(String(bodyMessage))})` : '';
                if (status === 401) return { error: `Urchin session API key is invalid.${suffix}` };
                if (status === 403) return { error: `Urchin rejected this key or session access.${suffix}` };
                if (status === 404) return { error: `Player/session not found.${suffix}` };
                if (status === 429) {
                    const seconds = Math.max(1, Math.ceil((urchinRateLimitCooldownUntil - Date.now()) / 1000));
                    return { error: `Urchin session rate limit hit. Try again in ${seconds}s.${suffix}` };
                }
                if (e.code === 'ECONNABORTED') return { error: 'Urchin session request timed out.' };
                return { error: `Urchin session request failed${status ? ` (${status})` : ''}.${suffix}` };
            } finally {
                urchinSessionRequests.delete(requestKey);
            }
        })();

        urchinSessionRequests.set(requestKey, request);
        return request;
    }

    return {
        fetchUrchinFull,
        fetchUrchinSession,
        getUrchinBatchRaw,
        getUrchinRateLimitSnapshot,
        getUrchinRaw,
        resetUrchinLookupState,
        cachedUrchinBatchData
    };
}

module.exports = {
    URCHIN_BATCH_DEBOUNCE_MS,
    URCHIN_BATCH_NON_GAME_DEBOUNCE_MS,
    URCHIN_BATCH_NON_GAME_MIN_SPACING_MS,
    URCHIN_BATCH_NON_GAME_MAX_NAMES,
    createUrchinClient,
    getResponseHeader
};
