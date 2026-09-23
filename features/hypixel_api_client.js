'use strict';

const { FastQueue } = require('../src/util/fast_queue.js');

// Cloudflare edge limits are per-IP, so the goal is to smooth spikes, not
// maximize parallelism. Lookups are enqueued 140-175ms apart and typical API
// latency is 300-500ms, so effective in-flight is ~2-3 and a cap of 5 never
// binds in normal play — it only stops pile-ups when the API is slow, which
// is exactly when bursting harder would extend an edge block.
const HYPIXEL_API_BURST_CONCURRENCY = 5;
const HYPIXEL_API_NON_GAME_CONCURRENCY = 3;
const HYPIXEL_API_NON_GAME_MIN_SPACING_MS = 450;
// Game-priority traffic used to bypass every pacing gate in the queue and was
// throttled only by each caller's own setTimeout ladder (tab stats, overlay,
// scan, nametags). Those ladders can't see each other, so four features each
// pacing at ~175ms summed to ~20 req/s from a single IP — which is what trips
// the Cloudflare edge block (and no amount of key rotation helps, because the
// edge limit is per-IP, not per-key). This is the global floor for game traffic.
const HYPIXEL_API_GAME_MIN_SPACING_MS = 200;
// Cloudflare bot heuristics also flag perfectly uniform cadence, so the floor
// is jittered by +/- this fraction.
const HYPIXEL_API_SPACING_JITTER = 0.15;
const HYPIXEL_API_RATE_LIMIT_COOLDOWN_MS = 2500;
const HYPIXEL_API_KEY_DISABLED_RETRY_MS = 60 * 60 * 1000;
const HYPIXEL_API_IP_BLOCK_COOLDOWN_MS = 60 * 1000;
const HYPIXEL_API_LIMIT_MAX = 300;
const HYPIXEL_API_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const HYPIXEL_API_USAGE_RETENTION_MS = 30 * 60 * 1000;
const HYPIXEL_API_DIAGNOSTIC_LOG_THROTTLE_MS = 1500;

function createHypixelApiClient(options = {}) {
    const axios = options.axios;
    if (!axios || typeof axios.get !== 'function') {
        throw new Error('createHypixelApiClient requires an axios-like client with get().');
    }

    const getKeys = typeof options.getKeys === 'function' ? options.getKeys : () => ({});
    const getGameState = typeof options.getGameState === 'function' ? options.getGameState : () => null;
    const logger = options.logger || console;

    const hypixelApiQueue = new FastQueue({ compactThreshold: 128 });
    const hypixelApiUsageEvents = new FastQueue({ compactThreshold: 256 });
    const hypixelApiKeyRuntime = new Map();

    let hypixelApiActiveRequests = 0;
    let hypixelApiNonGameActiveRequests = 0;
    let hypixelApiNextNonGameAt = 0;
    let hypixelApiNextGameAt = 0;
    let hypixelApiWindowRequestCount = 0;
    let hypixelApiCooldownUntil = 0;
    let hypixelApiDrainTimer = null;
    let hypixelApiWindowStartedAt = 0;
    let hypixelApiHeaderRemaining = null;
    let hypixelApiHeaderLimit = null;
    let hypixelApiHeaderResetAt = 0;
    let hypixelApiLastDiagnosticLogAt = 0;
    let hypixelApiLastDiagnosticKey = '';
    let hypixelApiSuppressedDiagnosticLogs = 0;

    function getCurrentHypixelUsageGameState() {
        return getGameState() || null;
    }

    function isHypixelApiGameActive() {
        return Boolean(getCurrentHypixelUsageGameState()?.gameActive);
    }

    function configuredHypixelApiKeys() {
        const keys = getKeys() || {};
        const primary = String(keys.hypixel || '').trim();
        return primary ? [{ id: 'primary', label: 'primary', key: primary }] : [];
    }

    function hasHypixelApiKeyConfigured() {
        return configuredHypixelApiKeys().length > 0;
    }

    function hypixelApiKeyState(entry) {
        let state = hypixelApiKeyRuntime.get(entry.id);
        if (!state || state.key !== entry.key) {
            state = {
                id: entry.id,
                label: entry.label,
                key: entry.key,
                active: 0,
                cooldownUntil: 0,
                invalidUntil: 0,
                lastFailure: '',
                lastFailureAt: 0,
                lastSuccessAt: 0,
                requests: 0,
                failures: 0
            };
            hypixelApiKeyRuntime.set(entry.id, state);
        }
        return state;
    }

    function hypixelApiKeyAvailable(entry, now = Date.now()) {
        const state = hypixelApiKeyState(entry);
        return state.invalidUntil <= now && state.cooldownUntil <= now;
    }

    function hypixelApiKeyReason(entry, now = Date.now()) {
        const state = hypixelApiKeyState(entry);
        if (state.invalidUntil > now) return `invalid/expired (${Math.ceil((state.invalidUntil - now) / 1000)}s retry)`;
        if (state.cooldownUntil > now) return `rate limited (${Math.ceil((state.cooldownUntil - now) / 1000)}s cooldown)`;
        return state.lastFailure || 'healthy';
    }

    function healthyHypixelApiKeys() {
        const now = Date.now();
        return configuredHypixelApiKeys().filter(entry => hypixelApiKeyAvailable(entry, now));
    }

    function selectHypixelApiKey() {
        return healthyHypixelApiKeys()[0] || null;
    }

    function hypixelNoAvailableKeyError() {
        const entries = configuredHypixelApiKeys();
        const error = new Error('The Hypixel API key is unavailable.');
        error.hypixelApiUnavailable = true;
        error.hypixelApiErrorType = entries.length ? 'hypixel_key_unavailable' : 'hypixel_key_failed';
        error.hypixelApiReason = entries.length
            ? hypixelApiKeyReason(entries[0])
            : 'No Hypixel API key is configured.';
        return error;
    }

    function readHeaderNumber(headers = {}, name) {
        const value = headers[name] ?? headers[name.toLowerCase()];
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function hypixelApiKeyResetDelay(response, fallback = HYPIXEL_API_RATE_LIMIT_COOLDOWN_MS) {
        const headers = response?.headers || {};
        const resetSeconds = readHeaderNumber(headers, 'RateLimit-Reset')
            ?? readHeaderNumber(headers, 'Retry-After');
        return resetSeconds !== null && resetSeconds > 0
            ? (resetSeconds * 1000) + 350
            : fallback;
    }

    function noteHypixelApiKeySuccess(entry) {
        const state = hypixelApiKeyState(entry);
        state.lastSuccessAt = Date.now();
        state.lastFailure = '';
        state.requests += 1;
    }

    // A genuine Hypixel key rejection answers with JSON ({ success:false, cause:"Invalid API key" }).
    // Cloudflare / the edge answers IP-level rate limits and WAF blocks with an HTML body (no JSON
    // cause) on 403/429/503/1015. Those are tied to our IP, not the key — so they must NOT be treated
    // as a dead key (which self-imposes the 1h lockout) and must NOT fail over to the reserve key
    // (same IP, so it just doubles traffic into the block and extends it).
    function hypixelEdgeBlock(error) {
        const status = Number(error?.response?.status || 0) || 0;
        if (status !== 403 && status !== 429 && status !== 503 && status !== 1015) return false;
        const data = error?.response?.data;
        if (data && typeof data === 'object' && (data.cause || data.success === false)) {
            return false; // structured Hypixel response -> a real app-level/key error, not the edge
        }
        const text = hypixelApiFailureBodyText(data).toLowerCase();
        if (!text) return true; // empty / non-JSON body on these statuses is almost always the edge
        return /cloudflare|error code: 1015|attention required|just a moment|been blocked|<!doctype html|<html/.test(text);
    }

    function noteHypixelApiKeyFailure(entry, error) {
        const state = hypixelApiKeyState(entry);
        const status = Number(error?.response?.status || 0) || 0;
        const now = Date.now();
        state.failures += 1;
        state.lastFailureAt = now;
        if (hypixelEdgeBlock(error)) {
            // IP-level block shared by every key: cool this key briefly AND back the whole pipeline
            // off (honoring Retry-After) instead of marking the key dead for an hour.
            const delay = hypixelApiKeyResetDelay(error.response, HYPIXEL_API_IP_BLOCK_COOLDOWN_MS);
            state.cooldownUntil = Math.max(state.cooldownUntil, now + delay);
            hypixelApiCooldownUntil = Math.max(hypixelApiCooldownUntil, now + delay);
            state.lastFailure = `HTTP ${status} edge/IP block (Cloudflare) ${Math.round(delay / 1000)}s`;
            return;
        }
        if (status === 401 || status === 403) {
            state.invalidUntil = Math.max(state.invalidUntil, now + HYPIXEL_API_KEY_DISABLED_RETRY_MS);
            state.lastFailure = `HTTP ${status} key rejected`;
        } else if (status === 429) {
            state.cooldownUntil = Math.max(state.cooldownUntil, now + hypixelApiKeyResetDelay(error.response));
            state.lastFailure = 'HTTP 429 rate limited';
        } else if (status >= 500) {
            state.cooldownUntil = Math.max(state.cooldownUntil, now + 5000);
            state.lastFailure = `HTTP ${status} server error`;
        } else if (!status) {
            state.lastFailure = error?.code || error?.message || 'network failure';
        } else {
            state.lastFailure = `HTTP ${status}`;
        }
    }

    // Hypixel deprecated the ?key= query parameter; the key must now be sent
    // as the API-Key header against the /v2 endpoints. Strip any legacy key
    // param the callers may still carry so it never leaks in the URL/logs.
    function stripHypixelKeyParam(url) {
        try {
            const parsed = new URL(url);
            parsed.searchParams.delete('key');
            return parsed.toString();
        } catch (error) {
            return url;
        }
    }

    function hypixelApiQueuePriority(meta = {}) {
        if (meta.priority === 'game' || meta.priority === 'background') return meta.priority;
        return isHypixelApiGameActive() ? 'game' : 'background';
    }

    // Spacing for the next game-priority request. Starts at the floor and
    // stretches as the 5-minute budget (300 requests) drains, so a long game or
    // heavy lobby-hopping backs itself off before the edge does it for us.
    function hypixelGameSpacingMs() {
        const used = hypixelApiWindowRequestCount / HYPIXEL_API_LIMIT_MAX;
        let spacing = HYPIXEL_API_GAME_MIN_SPACING_MS;
        if (used >= 0.9) spacing *= 4;
        else if (used >= 0.75) spacing *= 2.5;
        else if (used >= 0.5) spacing *= 1.5;
        const jitter = 1 + ((Math.random() * 2) - 1) * HYPIXEL_API_SPACING_JITTER;
        return Math.round(spacing * jitter);
    }

    function takeNextHypixelApiQueueItem() {
        const gameIndex = hypixelApiQueue.findIndex(item => item?.meta?.priority === 'game');
        if (gameIndex >= 0) {
            // Global floor: the queue is the single throttle for game traffic.
            // Callers still ladder their own dispatches, but those ladders are
            // per-feature and cannot account for other features running at the
            // same time, so the real limit has to be enforced here.
            const gameWaitMs = hypixelApiNextGameAt - Date.now();
            if (gameWaitMs > 0) {
                scheduleHypixelApiDrain(gameWaitMs);
                return null;
            }
            return hypixelApiQueue.removeAt(gameIndex);
        }

        if (hypixelApiNonGameActiveRequests >= HYPIXEL_API_NON_GAME_CONCURRENCY) return null;
        const waitMs = hypixelApiNextNonGameAt - Date.now();
        if (waitMs > 0) {
            scheduleHypixelApiDrain(waitMs);
            return null;
        }
        return hypixelApiQueue.shift();
    }

    function queueHypixelApiRequest(fn, meta = {}) {
        return new Promise((resolve, reject) => {
            const priority = hypixelApiQueuePriority(meta);
            hypixelApiQueue.push({ fn, meta: { ...meta, priority }, resolve, reject });
            drainHypixelApiQueue();
        });
    }

    function scheduleHypixelApiDrain(delay) {
        if (hypixelApiDrainTimer) return;
        hypixelApiDrainTimer = setTimeout(() => {
            hypixelApiDrainTimer = null;
            drainHypixelApiQueue();
        }, Math.max(1, delay));
        if (typeof hypixelApiDrainTimer?.unref === 'function') hypixelApiDrainTimer.unref();
    }

    function drainHypixelApiQueue() {
        const cooldownMs = hypixelApiCooldownUntil - Date.now();
        if (cooldownMs > 0) {
            scheduleHypixelApiDrain(cooldownMs);
            return;
        }

        while (hypixelApiActiveRequests < HYPIXEL_API_BURST_CONCURRENCY && hypixelApiQueue.length) {
            const item = takeNextHypixelApiQueueItem();
            if (!item) return;
            const background = item.meta?.priority !== 'game';
            if (background) {
                hypixelApiNonGameActiveRequests += 1;
                hypixelApiNextNonGameAt = Date.now() + HYPIXEL_API_NON_GAME_MIN_SPACING_MS;
            } else {
                hypixelApiNextGameAt = Date.now() + hypixelGameSpacingMs();
            }
            hypixelApiActiveRequests += 1;
            const usageEvent = recordHypixelApiRequest(item.meta);

            Promise.resolve()
                .then(() => item.fn(usageEvent))
                .then(response => {
                    updateHypixelApiUsageEvent(usageEvent, response?.status || 200);
                    noteHypixelRateLimitHeaders(response);
                    item.resolve(response);
                })
                .catch(e => {
                    const status = e?.response?.status || 0;
                    updateHypixelApiUsageEvent(usageEvent, status);
                    if (status === 429) noteHypixelRateLimitHeaders(e.response, true);
                    logHypixelApiFailure(e, item.meta, usageEvent);
                    item.reject(e);
                })
                .finally(() => {
                    hypixelApiActiveRequests = Math.max(0, hypixelApiActiveRequests - 1);
                    if (background) hypixelApiNonGameActiveRequests = Math.max(0, hypixelApiNonGameActiveRequests - 1);
                    drainHypixelApiQueue();
                });
        }
    }

    function hypixelApiGet(url, options = {}) {
        const { apiPriority, ...axiosOptions } = options || {};
        return queueHypixelApiRequest(async (usageEvent = null) => {
            const entry = selectHypixelApiKey();
            if (!entry) throw hypixelNoAvailableKeyError();
            const state = hypixelApiKeyState(entry);
            state.active += 1;
            if (usageEvent) usageEvent.keySlot = entry.id;
            try {
                const response = await axios.get(stripHypixelKeyParam(url), {
                    ...axiosOptions,
                    headers: { ...(axiosOptions.headers || {}), 'API-Key': entry.key }
                });
                noteHypixelApiKeySuccess(entry);
                return response;
            } catch (error) {
                noteHypixelApiKeyFailure(entry, error);
                throw error;
            } finally {
                state.active = Math.max(0, state.active - 1);
            }
        }, {
            endpoint: getHypixelApiEndpoint(url),
            url,
            priority: apiPriority
        });
    }

    function hypixelApiFailureBodyText(body) {
        if (body === undefined || body === null) return '';
        if (typeof body === 'string') return body;
        if (typeof body === 'object') {
            return [body.cause, body.reason, body.message, body.error]
                .filter(Boolean)
                .join(' ') || JSON.stringify(body);
        }
        return String(body);
    }

    function classifyHypixelApiTransportFailure(error) {
        if (error?.apiKillSwitchBlocked) {
            // Deliberate local block, not an API problem — skip the multi-line
            // usage diagnostics that would otherwise spam the log per request.
            return {
                shouldLog: false,
                key: 'api_kill_switch',
                reason: 'Blocked by API kill switch.'
            };
        }
        if (error?.hypixelApiUnavailable) {
            return {
                shouldLog: true,
                key: error.hypixelApiErrorType || 'hypixel_unavailable',
                reason: error.hypixelApiReason || 'No healthy Hypixel API key is available.'
            };
        }
        const status = Number(error?.response?.status || 0) || 0;
        const bodyText = hypixelApiFailureBodyText(error?.response?.data).trim();
        const code = String(error?.code || '').trim();
        const message = String(error?.message || '').trim();

        if (status === 429) {
            const retryAfter = readHeaderNumber(error?.response?.headers || {}, 'Retry-After');
            const retryText = retryAfter !== null ? ` retry_after=${retryAfter}s` : '';
            return {
                shouldLog: true,
                key: `429:${bodyText || 'rate_limited'}`,
                reason: `HTTP 429 from Hypixel (rate limited).${retryText}${bodyText ? ` Body: ${bodyText}` : ''}`
            };
        }
        if (status === 401 || status === 403) {
            return {
                shouldLog: true,
                key: `${status}:${bodyText || 'auth_failed'}`,
                reason: `HTTP ${status} from Hypixel (API key rejected or forbidden).${bodyText ? ` Body: ${bodyText}` : ''}`
            };
        }
        if (status >= 500) {
            return {
                shouldLog: true,
                key: `${status}:${bodyText || 'server_error'}`,
                reason: `HTTP ${status} from Hypixel (server unavailable/error).${bodyText ? ` Body: ${bodyText}` : ''}`
            };
        }
        if (!status) {
            const reason = code === 'ECONNABORTED'
                ? 'request timed out'
                : (code || 'network/no response');
            return {
                shouldLog: true,
                key: `network:${code || message || 'unknown'}`,
                reason: `No HTTP response from Hypixel (${reason}).${message ? ` ${message}` : ''}`
            };
        }
        return {
            shouldLog: false,
            key: `${status}:${bodyText || 'http_error'}`,
            reason: `HTTP ${status} from Hypixel.${bodyText ? ` Body: ${bodyText}` : ''}`
        };
    }

    function hypixelUsageBreakdown(windowMs) {
        const now = Date.now();
        const cutoff = now - windowMs;
        const statusCounts = {};
        const endpointCounts = {};
        const keyCounts = {};
        let total = 0;
        let failures = 0;
        let game = 0;
        let background = 0;

        for (const event of hypixelApiUsageEvents) {
            if (!event || event.at < cutoff) continue;
            total += 1;
            if (event.gameActive || event.priority === 'game') game += 1;
            else background += 1;
            const statusKey = event.status ? String(event.status) : 'pending_or_network';
            statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1;
            if (!event.status || event.status >= 400) failures += 1;
            const endpoint = event.endpoint || 'unknown';
            endpointCounts[endpoint] = (endpointCounts[endpoint] || 0) + 1;
            const keySlot = event.keySlot || 'unassigned';
            keyCounts[keySlot] = (keyCounts[keySlot] || 0) + 1;
        }

        const topEndpoints = Object.entries(endpointCounts)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 8)
            .map(([endpoint, count]) => `${endpoint}=${count}`);
        const statuses = Object.entries(statusCounts)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([status, count]) => `${status}=${count}`);
        const keys = Object.entries(keyCounts)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([key, count]) => `${key}=${count}`);

        return {
            total,
            failures,
            game,
            background,
            statuses: statuses.join(', ') || 'none',
            keys: keys.join(', ') || 'none',
            topEndpoints: topEndpoints.join(', ') || 'none'
        };
    }

    function logHypixelApiFailure(error, meta = {}, usageEvent = null) {
        const failure = classifyHypixelApiTransportFailure(error);
        if (!failure.shouldLog) return;

        const now = Date.now();
        const diagnosticKey = `${meta.endpoint || 'unknown'}|${failure.key}`;
        if (diagnosticKey === hypixelApiLastDiagnosticKey
            && now - hypixelApiLastDiagnosticLogAt < HYPIXEL_API_DIAGNOSTIC_LOG_THROTTLE_MS) {
            hypixelApiSuppressedDiagnosticLogs += 1;
            return;
        }

        const suppressedText = hypixelApiSuppressedDiagnosticLogs
            ? ` (suppressed ${hypixelApiSuppressedDiagnosticLogs} repeated diagnostic log(s))`
            : '';
        hypixelApiSuppressedDiagnosticLogs = 0;
        hypixelApiLastDiagnosticLogAt = now;
        hypixelApiLastDiagnosticKey = diagnosticKey;

        const usage = getHypixelApiUsageSnapshot();
        const last10s = hypixelUsageBreakdown(10 * 1000);
        const last30s = hypixelUsageBreakdown(30 * 1000);
        const last1m = hypixelUsageBreakdown(60 * 1000);
        const last5m = hypixelUsageBreakdown(HYPIXEL_API_LIMIT_WINDOW_MS);
        const last30m = hypixelUsageBreakdown(HYPIXEL_API_USAGE_RETENTION_MS);
        const status = Number(error?.response?.status || 0) || 0;
        const code = String(error?.code || '').trim() || 'none';
        const requestAge = usageEvent?.at ? `${Date.now() - usageEvent.at}ms` : 'unknown';

        logger.warn?.(`[HypixelAPI] Request failure${suppressedText}`);
        logger.warn?.(`[HypixelAPI] Reason: ${failure.reason}`);
        logger.warn?.(`[HypixelAPI] Request: endpoint=${meta.endpoint || 'unknown'} priority=${meta.priority || 'auto'} key=${usageEvent?.keySlot || 'primary'} status=${status || 'no_response'} code=${code} age=${requestAge}`);
        logger.warn?.(`[HypixelAPI] Recent totals: 10s=${last10s.total} 30s=${last30s.total} 1m=${last1m.total} 5m=${last5m.total} 30m=${last30m.total}`);
        logger.warn?.(`[HypixelAPI] Recent failures: 10s=${last10s.failures} 30s=${last30s.failures} 1m=${last1m.failures} 5m=${last5m.failures} 30m=${last30m.failures}`);
        logger.warn?.(`[HypixelAPI] 5m statuses: ${last5m.statuses}`);
        logger.warn?.(`[HypixelAPI] 5m key activity: ${last5m.keys}`);
        logger.warn?.(`[HypixelAPI] 5m endpoints: ${last5m.topEndpoints}`);
        logger.warn?.(`[HypixelAPI] 5m split: game=${last5m.game} background=${last5m.background}`);
        logger.warn?.(`[HypixelAPI] Local window: ${usage.currentWindow.count}/${usage.limit} remaining=${usage.currentWindow.remaining} resetInMs=${usage.currentWindow.resetInMs}`);
        logger.warn?.(`[HypixelAPI] Headers: limit=${usage.headers.limit ?? 'unknown'} remaining=${usage.headers.remaining ?? 'unknown'} resetInMs=${usage.headers.resetInMs ?? 'unknown'} recent429=${usage.recent429}`);
        logger.warn?.(`[HypixelAPI] Queue: active=${usage.queue.active} queued=${usage.queue.queued} gameQueued=${usage.queue.gameQueued} backgroundQueued=${usage.queue.backgroundQueued} backgroundActive=${usage.queue.backgroundActive} cooldownInMs=${usage.queue.cooldownInMs} nextBackgroundInMs=${usage.queue.nextBackgroundInMs}`);
    }

    function noteHypixelRateLimitHeaders(response, wasLimited = false) {
        const headers = response?.headers || {};
        const remaining = readHeaderNumber(headers, 'RateLimit-Remaining');
        const limit = readHeaderNumber(headers, 'RateLimit-Limit');
        const resetSeconds = readHeaderNumber(headers, 'RateLimit-Reset');
        const resetDelay = resetSeconds !== null && resetSeconds > 0
            ? (resetSeconds * 1000) + 350
            : HYPIXEL_API_RATE_LIMIT_COOLDOWN_MS;

        if (remaining !== null) hypixelApiHeaderRemaining = remaining;
        if (limit !== null) hypixelApiHeaderLimit = limit;
        if (resetSeconds !== null && resetSeconds > 0) hypixelApiHeaderResetAt = Date.now() + (resetSeconds * 1000);

        if (wasLimited || (remaining !== null && remaining <= 1)) {
            hypixelApiCooldownUntil = Math.max(hypixelApiCooldownUntil, Date.now() + resetDelay);
        }
    }

    function getHypixelApiEndpoint(url) {
        try {
            return new URL(url).pathname || 'unknown';
        } catch (e) {
            return 'unknown';
        }
    }

    function ensureHypixelApiWindow(now = Date.now()) {
        if (!hypixelApiWindowStartedAt || now - hypixelApiWindowStartedAt >= HYPIXEL_API_LIMIT_WINDOW_MS) {
            hypixelApiWindowStartedAt = now;
            hypixelApiWindowRequestCount = 0;
        }
    }

    function pruneHypixelApiUsage(now = Date.now()) {
        const cutoff = now - HYPIXEL_API_USAGE_RETENTION_MS;
        while (hypixelApiUsageEvents.length && hypixelApiUsageEvents.peek().at < cutoff) {
            hypixelApiUsageEvents.shift();
        }
    }

    function recordHypixelApiRequest(meta = {}) {
        const now = Date.now();
        ensureHypixelApiWindow(now);
        hypixelApiWindowRequestCount += 1;
        pruneHypixelApiUsage(now);

        const game = getCurrentHypixelUsageGameState();
        const event = {
            at: now,
            endpoint: meta.endpoint || 'unknown',
            priority: meta.priority || 'auto',
            keySlot: 'primary',
            status: 0,
            gameActive: Boolean(game?.gameActive),
            gameSessionId: game?.gameActive ? (game.gameSessionId || '') : '',
            gameMode: game?.gameActive ? (game.currentGamemode || '') : ''
        };
        hypixelApiUsageEvents.push(event);
        return event;
    }

    function updateHypixelApiUsageEvent(event, status) {
        if (!event) return;
        event.status = Number(status || 0) || 0;
    }

    function getHypixelApiUsageSnapshot() {
        const now = Date.now();
        ensureHypixelApiWindow(now);
        pruneHypixelApiUsage(now);

        const game = getCurrentHypixelUsageGameState();
        let lastMinute = 0;
        let lastFiveMinutes = 0;
        let currentWindowCount = 0;
        let currentGame = 0;
        let recent429 = 0;
        for (const event of hypixelApiUsageEvents) {
            const age = now - event.at;
            if (age <= 60 * 1000) lastMinute += 1;
            if (age <= HYPIXEL_API_LIMIT_WINDOW_MS) {
                lastFiveMinutes += 1;
                if (event.status === 429) recent429 += 1;
            }
            if (event.at >= hypixelApiWindowStartedAt) currentWindowCount += 1;
            if (game?.gameActive) {
                const belongsToGame = game.gameSessionId
                    ? event.gameSessionId === game.gameSessionId
                    : event.gameActive && event.at >= (game.gameStartTime || 0);
                if (belongsToGame) currentGame += 1;
            }
        }

        const resetAt = hypixelApiWindowStartedAt + HYPIXEL_API_LIMIT_WINDOW_MS;
        return {
            limit: HYPIXEL_API_LIMIT_MAX,
            keyPool: configuredHypixelApiKeys().map(entry => {
                const state = hypixelApiKeyState(entry);
                const now = Date.now();
                return {
                    id: entry.id,
                    label: entry.label,
                    active: state.active,
                    requests: state.requests,
                    failures: state.failures,
                    healthy: hypixelApiKeyAvailable(entry, now),
                    reason: hypixelApiKeyReason(entry, now),
                    cooldownInMs: Math.max(0, state.cooldownUntil - now),
                    invalidRetryInMs: Math.max(0, state.invalidUntil - now)
                };
            }),
            windowMs: HYPIXEL_API_LIMIT_WINDOW_MS,
            lastMinute,
            lastFiveMinutes,
            currentGame,
            currentGameActive: Boolean(game?.gameActive),
            currentGameMode: game?.currentGamemode || null,
            currentWindow: {
                count: currentWindowCount,
                remaining: Math.max(0, HYPIXEL_API_LIMIT_MAX - currentWindowCount),
                resetAt,
                resetInMs: Math.max(0, resetAt - now)
            },
            queue: {
                active: hypixelApiActiveRequests,
                backgroundActive: hypixelApiNonGameActiveRequests,
                queued: hypixelApiQueue.length,
                gameQueued: hypixelApiQueue.toArray().filter(item => item?.meta?.priority === 'game').length,
                backgroundQueued: hypixelApiQueue.toArray().filter(item => item?.meta?.priority !== 'game').length,
                concurrency: HYPIXEL_API_BURST_CONCURRENCY,
                backgroundConcurrency: HYPIXEL_API_NON_GAME_CONCURRENCY,
                nextBackgroundInMs: Math.max(0, hypixelApiNextNonGameAt - now),
                nextGameInMs: Math.max(0, hypixelApiNextGameAt - now),
                gameSpacingMs: HYPIXEL_API_GAME_MIN_SPACING_MS,
                windowRequestCount: hypixelApiWindowRequestCount,
                cooldownInMs: Math.max(0, hypixelApiCooldownUntil - now)
            },
            headers: {
                limit: hypixelApiHeaderLimit,
                remaining: hypixelApiHeaderRemaining,
                resetAt: hypixelApiHeaderResetAt || null,
                resetInMs: hypixelApiHeaderResetAt ? Math.max(0, hypixelApiHeaderResetAt - now) : null
            },
            recent429
        };
    }

    return {
        configuredHypixelApiKeys,
        getHypixelApiEndpoint,
        getHypixelApiUsageSnapshot,
        hasHypixelApiKeyConfigured,
        healthyHypixelApiKeys,
        hypixelApiGet,
        hypixelApiQueuePriority,
        hypixelUsageBreakdown,
        readHeaderNumber
    };
}

module.exports = {
    HYPIXEL_API_BURST_CONCURRENCY,
    HYPIXEL_API_NON_GAME_CONCURRENCY,
    HYPIXEL_API_NON_GAME_MIN_SPACING_MS,
    HYPIXEL_API_GAME_MIN_SPACING_MS,
    HYPIXEL_API_DIAGNOSTIC_LOG_THROTTLE_MS,
    createHypixelApiClient
};
