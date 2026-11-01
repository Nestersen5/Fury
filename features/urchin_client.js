'use strict';

const { BoundedTtlMap } = require('../src/util/bounded_ttl_map.js');

const URCHIN_BATCH_SOURCES = 'GAME';
const URCHIN_BATCH_CACHE_DURATION = 5 * 60 * 1000;
const URCHIN_BATCH_STALE_DURATION = 30 * 60 * 1000;
const URCHIN_BATCH_FAILURE_CACHE_DURATION = 3 * 1000;
const URCHIN_BATCH_DEBOUNCE_MS = 40;
const URCHIN_BATCH_NON_GAME_DEBOUNCE_MS = 650;
const URCHIN_BATCH_NON_GAME_MIN_SPACING_MS = 900;
// Client policies, not provider-approved burst allowances. Keep headroom for
// other uses of the key even when Coral omits rate-limit headers.
const URCHIN_REQUEST_CONCURRENCY = 1;
const URCHIN_REQUEST_MIN_SPACING_MS = 200;
const URCHIN_UUID_BATCH_MAX_PLAYERS = 2;
const URCHIN_REQUEST_SETTING_LIMITS = Object.freeze({
    urchinRequestDelayMs: Object.freeze({ min: 0, max: 60000 }),
    urchinRequestConcurrency: Object.freeze({ min: 1, max: 16 })
});
const URCHIN_LOCAL_BUDGET_LIMIT = 300;
const URCHIN_LOCAL_BUDGET_WINDOW_MS = 5 * 60 * 1000;
// Retain the exported background limit; background reads now use one slot.
const URCHIN_BATCH_NON_GAME_MAX_NAMES = 1;
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

function normalizeUrchinRequestSettings(settings = {}) {
    const integer = (key, fallback) => {
        const value = settings?.[key], bounds = URCHIN_REQUEST_SETTING_LIMITS[key];
        if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return fallback;
        const number = Number(value);
        return Number.isSafeInteger(number) && number >= bounds.min && number <= bounds.max ? number : fallback;
    };
    return {
        urchinRequestDelayMs: integer('urchinRequestDelayMs', URCHIN_REQUEST_MIN_SPACING_MS),
        urchinRequestConcurrency: integer('urchinRequestConcurrency', URCHIN_REQUEST_CONCURRENCY)
    };
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
    const urchinLookupsInFlight = new Map();
    const urchinSessionCache = new BoundedTtlMap({
        ttlMs: URCHIN_SESSION_CACHE_DURATION,
        maxEntries: URCHIN_SESSION_CACHE_MAX_ENTRIES
    });
    const urchinSessionRequests = new Map();

    const activeUrchinRequests = new Set();
    const localBudgets = new BoundedTtlMap({ ttlMs: URCHIN_LOCAL_BUDGET_WINDOW_MS, maxEntries: 8 });
    let urchinLookupGeneration = 0;
    let urchinBatchDrainTimer = null;
    let urchinBatchDrainAt = 0;
    let urchinRateLimitRemaining = null;
    let urchinRateLimitLimit = null;
    let urchinRateLimitResetAt = 0;
    let urchinRateLimitCooldownUntil = 0;
    let urchinNextNonGameBatchAt = 0;
    let urchinNextRequestAt = 0;
    let lastUrchinRequestAt = null;
    let requestSettings = {
        urchinRequestDelayMs: URCHIN_REQUEST_MIN_SPACING_MS,
        urchinRequestConcurrency: URCHIN_REQUEST_CONCURRENCY
    };

    function getUrchinRequestSettings() {
        return { ...requestSettings };
    }

    function configureUrchinRequests(patch = {}) {
        const next = normalizeUrchinRequestSettings({ ...requestSettings, ...patch });
        if (next.urchinRequestDelayMs === requestSettings.urchinRequestDelayMs
            && next.urchinRequestConcurrency === requestSettings.urchinRequestConcurrency) return getUrchinRequestSettings();
        requestSettings = next;
        if (lastUrchinRequestAt !== null) urchinNextRequestAt = lastUrchinRequestAt + next.urchinRequestDelayMs;
        // Re-evaluate the existing queue without resetting reads, caches,
        // reserved allowance or cooldowns. Active reads keep their ownership.
        if (urchinBatchDrainTimer) clearTimeout(urchinBatchDrainTimer);
        urchinBatchDrainTimer = null;
        urchinBatchDrainAt = 0;
        scheduleUrchinBatchDrain(0);
        return getUrchinRequestSettings();
    }

    function localBudget(key = String(getKey() || '').trim()) {
        let budget = localBudgets.get(key);
        if (!budget) {
            budget = { starts: [], limit: URCHIN_LOCAL_BUDGET_LIMIT, cooldownUntil: 0, timestamp: Date.now() };
            localBudgets.set(key, budget);
        }
        const cutoff = Date.now() - URCHIN_LOCAL_BUDGET_WINDOW_MS;
        while (budget.starts.length && budget.starts[0] <= cutoff) budget.starts.shift();
        return budget;
    }

    function localBudgetWaitMs(budget = localBudget()) {
        return budget.starts.length >= budget.limit
            ? Math.max(1, budget.starts[budget.starts.length - budget.limit] + URCHIN_LOCAL_BUDGET_WINDOW_MS - Date.now()) : 0;
    }

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

        const budget = localBudget();
        if (Number.isFinite(limit) && limit >= 1) {
            urchinRateLimitLimit = limit;
            budget.limit = Math.min(URCHIN_LOCAL_BUDGET_LIMIT, Math.floor(limit));
        }
        if (Number.isFinite(remaining) && remaining >= 0) {
            // Reserve other active reads and reject older, more generous
            // replies. A new server window is opened by refresh below.
            const available = Math.max(0, Math.floor(remaining) - Math.max(0, activeUrchinRequests.size - 1));
            urchinRateLimitRemaining = urchinRateLimitRemaining === null
                ? available : Math.min(urchinRateLimitRemaining, available);
        }
        if (resetAt > 0) urchinRateLimitResetAt = resetAt;

        if (status === 429 || urchinRateLimitRemaining === 0
            || (status >= 400 && getResponseHeader(headers, 'retry-after') !== null && resetAt > Date.now())) {
            urchinRateLimitCooldownUntil = Math.max(
                urchinRateLimitCooldownUntil,
                resetAt > Date.now() ? resetAt + 250 : Date.now() + URCHIN_RATE_LIMIT_FALLBACK_COOLDOWN_MS
            );
            budget.cooldownUntil = Math.max(budget.cooldownUntil, urchinRateLimitCooldownUntil);
            budget.timestamp = Math.max(Date.now(), budget.cooldownUntil);
        }
    }

    function refreshUrchinRateLimitWindow() {
        if (urchinRateLimitResetAt > 0 && Date.now() >= urchinRateLimitResetAt + 250) {
            urchinRateLimitRemaining = null;
            urchinRateLimitResetAt = 0;
            if (urchinRateLimitCooldownUntil <= Date.now()) urchinRateLimitCooldownUntil = 0;
        }
        urchinRateLimitCooldownUntil = Math.max(urchinRateLimitCooldownUntil, localBudget().cooldownUntil);
    }

    function cachedUrchinBatchData(name, options = {}) {
        const key = playerLookupKey(name);
        const cached = urchinBatchTagCache.get(key);
        if (!cached) return null;
        if (options.uuid && cached.uuid !== options.uuid) return null;

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

    function cacheUrchinBatchData(name, data, uuid = '') {
        if (!isMinecraftUsername(name) || !data) return;
        urchinBatchTagCache.set(playerLookupKey(name), {
            data,
            uuid,
            timestamp: Date.now()
        });
    }

    function makeUrchinRateLimitedData(name = '') {
        const retryAfterMs = Math.max(0, urchinRateLimitCooldownUntil - Date.now(), localBudgetWaitMs());
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
            if (item.kind === 'session') {
                const seconds = Math.max(1, Math.ceil(Math.max(urchinRateLimitCooldownUntil - Date.now(), localBudgetWaitMs()) / 1000));
                resolveUrchinBatchQueueItem(item, { error: `Urchin API is cooling down after a rate limit. Try again in ${seconds}s.` });
                urchinBatchLookupQueue.delete(queueKey);
                continue;
            }
            const stale = cachedUrchinBatchData(item.name, { allowStale: true, uuid: item.uuid });
            resolveUrchinBatchQueueItem(item, stale || makeUrchinRateLimitedData(item.name));
            urchinBatchLookupQueue.delete(queueKey);
        }
    }

    function isUrchinBatchGameActive() {
        return Boolean(getGameState()?.gameActive);
    }

    function urchinBatchPriority(options = {}) {
        if (options.priority === 'game' || options.priority === 'background') return options.priority;
        return isUrchinBatchGameActive() ? 'game' : 'background';
    }

    function nextUrchinBatchDelay(baseDelay = URCHIN_BATCH_DEBOUNCE_MS) {
        const hasGameQueued = Array.from(urchinBatchLookupQueue.values()).some(item => item.priority === 'game');
        const requestSpacing = Math.max(0, urchinNextRequestAt - Date.now());
        if (hasGameQueued) return Math.max(0, baseDelay, requestSpacing);
        const spacing = Math.max(0, urchinNextNonGameBatchAt - Date.now());
        return Math.max(URCHIN_BATCH_NON_GAME_DEBOUNCE_MS, spacing, baseDelay, requestSpacing);
    }

    function scheduleUrchinBatchDrain(delay = URCHIN_BATCH_DEBOUNCE_MS) {
        if (activeUrchinRequests.size >= requestSettings.urchinRequestConcurrency || urchinBatchLookupQueue.size === 0) return;
        const nextDelay = nextUrchinBatchDelay(delay);
        const dueAt = Date.now() + nextDelay;
        if (urchinBatchDrainTimer && urchinBatchDrainAt <= dueAt) return;
        if (urchinBatchDrainTimer) clearTimeout(urchinBatchDrainTimer);
        urchinBatchDrainAt = dueAt;
        urchinBatchDrainTimer = setTimeout(() => {
            urchinBatchDrainTimer = null;
            urchinBatchDrainAt = 0;
            drainUrchinBatchQueue().catch(() => {});
        }, Math.max(0, nextDelay));
    }

    function enqueueUrchinBatchLookup(name, sources = URCHIN_BATCH_SOURCES, options = {}) {
        const normalizedName = String(name || '').trim();
        const cached = cachedUrchinBatchData(normalizedName, { uuid: options.uuid });
        if (cached) return Promise.resolve(cached);

        refreshUrchinRateLimitWindow();
        if (urchinRateLimitCooldownUntil > Date.now() || localBudgetWaitMs() > 0) {
            return Promise.resolve(
                cachedUrchinBatchData(normalizedName, { allowStale: true, uuid: options.uuid })
                || makeUrchinRateLimitedData(normalizedName)
            );
        }

        const normalizedSources = String(sources || URCHIN_BATCH_SOURCES);
        const priority = urchinBatchPriority(options);
        const queueKey = `${normalizedSources}:${playerLookupKey(normalizedName)}:${options.uuid || ''}`;
        return new Promise(resolve => {
            const existing = urchinBatchLookupQueue.get(queueKey) || urchinLookupsInFlight.get(queueKey);
            if (existing) {
                existing.resolvers.push(resolve);
                if (priority === 'game') existing.priority = 'game';
            } else {
                urchinBatchLookupQueue.set(queueKey, {
                    name: normalizedName,
                    uuid: options.uuid || '',
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
    async function fetchCoralPlayerTags(name, urchinKey, signal) {
        try {
            const res = await axios.get(`${CORAL_API_BASE}/player/tags`, {
                timeout: 10000,
                signal,
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

    async function fetchCoralUuidTags(items, urchinKey, signal) {
        try {
            const res = await axios.post(`${CORAL_API_BASE}/players`, {
                uuids: [...new Set(items.map(item => item.uuid))]
            }, { timeout: 10000, signal, headers: { 'X-API-Key': urchinKey } });
            const players = new Map();
            if (res.data?.players && typeof res.data.players === 'object' && !Array.isArray(res.data.players)) {
                for (const [uuid, tags] of Object.entries(res.data.players)) {
                    players.set(uuid.replace(/-/g, '').toLowerCase(), tags);
                }
            }
            return { ok: true, players, headers: res.headers, status: res.status };
        } catch (error) {
            return { ok: false, error, status: error?.response?.status || 0, headers: error?.response?.headers };
        }
    }

    function settleTagResult(item, result) {
        const stale = () => cachedUrchinBatchData(item.name, { allowStale: true, uuid: item.uuid });
        try {
            if (result.ok) {
                const tags = item.uuid ? result.players.get(item.uuid) : result.tags;
                if (!Array.isArray(tags)) throw new Error('Missing player tags in Urchin batch response.');
                const data = parseBatchTags(tags);
                data.rateLimit = { limit: urchinRateLimitLimit, remaining: urchinRateLimitRemaining,
                    resetAt: urchinRateLimitResetAt || null };
                cacheUrchinBatchData(item.name, data, item.uuid);
                resolveUrchinBatchQueueItem(item, data);
            } else {
                const classified = classifyRequestError(result.error);
                notifyOutage(classified);
                const cached = stale();
                const data = cached || makeUrchinData({ ok: false, ...classified,
                    retryAfterMs: Math.max(0, urchinRateLimitCooldownUntil - Date.now()) });
                if (!cached && classified.requestStatus !== 'rate_limited') cacheUrchinBatchData(item.name, data, item.uuid);
                resolveUrchinBatchQueueItem(item, data);
            }
        } catch (error) {
            const data = stale() || makeUrchinData({ ok: false, requestStatus: 'failed', error: 'Urchin tag response could not be read.' });
            if (!data.stale) cacheUrchinBatchData(item.name, data, item.uuid);
            resolveUrchinBatchQueueItem(item, data);
        }
    }

    async function drainUrchinBatchQueue() {
        if (activeUrchinRequests.size >= requestSettings.urchinRequestConcurrency || urchinBatchLookupQueue.size === 0) return;
        refreshUrchinRateLimitWindow();

        if (urchinRateLimitCooldownUntil > Date.now() || localBudgetWaitMs() > 0) {
            resolveQueuedUrchinLookupsDuringCooldown();
            return;
        }

        const urchinKey = String(getKey() || '').trim();
        if (!urchinKey) {
            for (const [queueKey, item] of urchinBatchLookupQueue.entries()) {
                const data = item.kind === 'session' ? { error: 'Urchin API key not set. Use /apikey urchin <key>.' } : makeUrchinData({
                    ok: false,
                    requestStatus: 'missing_key',
                    error: 'Urchin API key is not set.'
                });
                if (item.kind !== 'session') cacheUrchinBatchData(item.name, data, item.uuid);
                resolveUrchinBatchQueueItem(item, data);
                urchinBatchLookupQueue.delete(queueKey);
            }
            return;
        }

        const gameItem = Array.from(urchinBatchLookupQueue.values()).find(item => item.priority === 'game');
        const firstItem = gameItem || urchinBatchLookupQueue.values().next().value;
        const sources = firstItem?.sources || URCHIN_BATCH_SOURCES;
        const priority = firstItem?.priority || 'background';
        if (priority !== 'game' && Array.from(activeUrchinRequests).filter(item => item.priority !== 'game').length >= URCHIN_BATCH_NON_GAME_MAX_NAMES) return;
        if (priority !== 'game' && urchinNextNonGameBatchAt > Date.now()) {
            scheduleUrchinBatchDrain(urchinNextNonGameBatchAt - Date.now());
            return;
        }
        const available = urchinRateLimitRemaining;
        if (available === 0) {
            urchinRateLimitCooldownUntil = Math.max(
                urchinRateLimitCooldownUntil,
                urchinRateLimitResetAt > Date.now()
                    ? urchinRateLimitResetAt + 250
                    : Date.now() + URCHIN_RATE_LIMIT_FALLBACK_COOLDOWN_MS
            );
            const budget = localBudget();
            budget.cooldownUntil = Math.max(budget.cooldownUntil, urchinRateLimitCooldownUntil);
            budget.timestamp = Math.max(Date.now(), budget.cooldownUntil);
            resolveQueuedUrchinLookupsDuringCooldown();
            return;
        }

        const waitMs = Math.max(0, urchinNextRequestAt - Date.now());
        if (waitMs > 0) { scheduleUrchinBatchDrain(waitMs); return; }
        const entries = Array.from(urchinBatchLookupQueue.entries()).filter(([, queued]) =>
            queued.sources === sources && queued.priority === priority
            && (firstItem.uuid ? Boolean(queued.uuid) && queued.kind !== 'session' : queued === firstItem))
            .slice(0, firstItem.uuid ? URCHIN_UUID_BATCH_MAX_PLAYERS : 1);
        const item = entries[0][1];
        for (const [queueKey, queued] of entries) {
            urchinBatchLookupQueue.delete(queueKey);
            urchinLookupsInFlight.set(queueKey, queued);
        }
        const generation = urchinLookupGeneration;
        const controller = new AbortController();
        const active = { controller, priority };
        activeUrchinRequests.add(active);
        const budget = localBudget(urchinKey);
        budget.starts.push(Date.now());
        budget.timestamp = Math.max(Date.now(), budget.cooldownUntil);
        if (urchinRateLimitRemaining !== null) urchinRateLimitRemaining = Math.max(0, urchinRateLimitRemaining - 1);
        if (urchinRateLimitRemaining === 0) {
            // Persist the final reserved slot before the read replies, so a
            // same-key reset cannot restore allowance that is already spent.
            urchinRateLimitCooldownUntil = Math.max(urchinRateLimitCooldownUntil,
                urchinRateLimitResetAt > Date.now()
                    ? urchinRateLimitResetAt + 250 : Date.now() + URCHIN_RATE_LIMIT_FALLBACK_COOLDOWN_MS);
            budget.cooldownUntil = Math.max(budget.cooldownUntil, urchinRateLimitCooldownUntil);
            budget.timestamp = Math.max(Date.now(), budget.cooldownUntil);
        }
        lastUrchinRequestAt = Date.now();
        urchinNextRequestAt = lastUrchinRequestAt + requestSettings.urchinRequestDelayMs;
        if (priority !== 'game') urchinNextNonGameBatchAt = Date.now() + URCHIN_BATCH_NON_GAME_MIN_SPACING_MS;
        scheduleUrchinBatchDrain(0);

        try {
            if (item.kind === 'session') {
                const data = await requestUrchinSession(item.name, item.endpoint, urchinKey, controller.signal, generation);
                if (generation === urchinLookupGeneration) resolveUrchinBatchQueueItem(item, data);
                return;
            }
            const result = item.uuid
                ? await fetchCoralUuidTags(entries.map(([, queued]) => queued), urchinKey, controller.signal)
                : await fetchCoralPlayerTags(item.name, urchinKey, controller.signal);
            if (generation !== urchinLookupGeneration) return;
            refreshUrchinRateLimitWindow();
            noteUrchinRateLimitHeaders(result.headers, result.status || 0);
            for (const [, queued] of entries) settleTagResult(queued, result);
        } catch (error) {
            if (generation === urchinLookupGeneration) {
                for (const [, queued] of entries) {
                    const data = queued.kind === 'session' ? { error: 'Urchin session response could not be read.' }
                        : makeUrchinData({ ok: false, requestStatus: 'failed', error: 'Urchin tag response could not be read.' });
                    if (queued.kind !== 'session') cacheUrchinBatchData(queued.name, data, queued.uuid);
                    resolveUrchinBatchQueueItem(queued, data);
                }
            }
        } finally {
            activeUrchinRequests.delete(active);
            for (const [queueKey, queued] of entries) {
                if (urchinLookupsInFlight.get(queueKey) === queued) urchinLookupsInFlight.delete(queueKey);
            }
            if (urchinRateLimitCooldownUntil > Date.now() || localBudgetWaitMs() > 0) resolveQueuedUrchinLookupsDuringCooldown();
            if (urchinBatchLookupQueue.size > 0) scheduleUrchinBatchDrain(0);
        }
    }

    function resetUrchinLookupState() {
        urchinLookupGeneration++;
        if (urchinBatchDrainTimer) clearTimeout(urchinBatchDrainTimer);
        urchinBatchDrainTimer = null;
        urchinBatchDrainAt = 0;
        for (const active of activeUrchinRequests) active.controller.abort();
        for (const item of [...urchinBatchLookupQueue.values(), ...urchinLookupsInFlight.values()]) {
            resolveUrchinBatchQueueItem(item, item.kind === 'session' ? {
                error: 'Urchin API configuration changed.', requestStatus: 'reset'
            } : makeUrchinData({
                ok: false,
                requestStatus: 'reset',
                error: 'Urchin API configuration changed.'
            }));
        }
        urchinBatchLookupQueue.clear();
        urchinLookupsInFlight.clear();
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
        const queuedTags = Array.from(urchinBatchLookupQueue.values()).filter(item => item.kind !== 'session');
        const budget = localBudget();
        return {
            limit: urchinRateLimitLimit,
            remaining: urchinRateLimitRemaining,
            resetInMs: urchinRateLimitResetAt > 0 ? Math.max(0, urchinRateLimitResetAt - Date.now()) : null,
            cooldownInMs: Math.max(0, urchinRateLimitCooldownUntil - Date.now()),
            queuedPlayers: queuedTags.length,
            gameQueuedPlayers: queuedTags.filter(item => item.priority === 'game').length,
            backgroundQueuedPlayers: queuedTags.filter(item => item.priority !== 'game').length,
            nextBackgroundBatchInMs: Math.max(0, urchinNextNonGameBatchAt - Date.now()),
            requestInFlight: activeUrchinRequests.size > 0,
            cachedPlayers: urchinBatchTagCache.size,
            activeRequests: activeUrchinRequests.size,
            concurrency: requestSettings.urchinRequestConcurrency,
            minSpacingMs: requestSettings.urchinRequestDelayMs,
            maxPlayersPerBatch: URCHIN_UUID_BATCH_MAX_PLAYERS,
            queuedRequests: urchinBatchLookupQueue.size,
            localBudget: { limit: budget.limit, remaining: Math.max(0, budget.limit - budget.starts.length),
                windowMs: URCHIN_LOCAL_BUDGET_WINDOW_MS, retryAfterMs: localBudgetWaitMs() }
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

    async function getUrchinRaw(name, uuid = '', options = {}) {
        if (uuid) {
            const normalized = String(uuid).replace(/-/g, '').toLowerCase();
            if (!isMinecraftUsername(name) || !/^[0-9a-f]{32}$/.test(normalized)) {
                return makeUrchinData({ ok: false, requestStatus: 'failed', error: 'A valid player name and UUID are required.' });
            }
            return enqueueUrchinBatchLookup(name, URCHIN_BATCH_SOURCES, { ...options, uuid: normalized });
        }
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
        if (urchinRateLimitCooldownUntil > Date.now() || localBudgetWaitMs() > 0) {
            const seconds = Math.max(1, Math.ceil(Math.max(urchinRateLimitCooldownUntil - Date.now(), localBudgetWaitMs()) / 1000));
            return { error: `Urchin API is cooling down after a rate limit. Try again in ${seconds}s.` };
        }

        const request = new Promise(resolve => {
            urchinBatchLookupQueue.set(`SESSION:${requestKey}`, {
                kind: 'session', name: player, endpoint, sources: 'SESSION',
                priority: 'background', resolvers: [resolve]
            });
            scheduleUrchinBatchDrain();
        });
        urchinSessionRequests.set(requestKey, request);
        try { return await request; }
        finally {
            if (urchinSessionRequests.get(requestKey) === request) urchinSessionRequests.delete(requestKey);
        }
    }

    async function requestUrchinSession(player, endpoint, urchinKey, signal, generation) {
        try {
            const url = `https://api.urchin.gg/v3/player/sessions/${endpoint}`;
            const res = await axios.get(url, {
                timeout: 10000,
                signal,
                params: {
                    player,
                    key: urchinKey,
                    api_key: urchinKey
                },
                headers: {
                    'X-API-Key': urchinKey
                }
            });
            if (generation !== urchinLookupGeneration) return { error: 'Urchin API configuration changed.', requestStatus: 'reset' };
            refreshUrchinRateLimitWindow();
            noteUrchinRateLimitHeaders(res.headers, res.status);
            const data = res.data?.success === false
                ? { error: res.data?.message || res.data?.error || 'Urchin session request failed.' }
                : res.data;
            urchinSessionCache.set(`${playerLookupKey(player)}:${endpoint}`, { data, timestamp: Date.now() });
            return data;
        } catch (e) {
            if (generation !== urchinLookupGeneration) return { error: 'Urchin API configuration changed.', requestStatus: 'reset' };
            const status = e.response?.status;
            refreshUrchinRateLimitWindow();
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
        }
    }

    return {
        getUrchinRequestSettings,
        configureUrchinRequests,
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
    URCHIN_REQUEST_CONCURRENCY,
    URCHIN_REQUEST_MIN_SPACING_MS,
    URCHIN_UUID_BATCH_MAX_PLAYERS,
    URCHIN_REQUEST_SETTING_LIMITS,
    normalizeUrchinRequestSettings,
    URCHIN_LOCAL_BUDGET_LIMIT,
    URCHIN_LOCAL_BUDGET_WINDOW_MS,
    createUrchinClient,
    getResponseHeader
};
