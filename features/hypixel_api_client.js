'use strict';

const { FastQueue } = require('../src/util/fast_queue.js');

// Default shared cap; /hypixelrate can change it without resetting usage,
// provider cooldowns or queued work.
const HYPIXEL_API_BURST_CONCURRENCY = 2;
const HYPIXEL_API_NON_GAME_CONCURRENCY = 3;
const HYPIXEL_API_NON_GAME_MIN_SPACING_MS = 450;
// Game-priority traffic used to bypass every pacing gate in the queue and was
// throttled only by each caller's own setTimeout ladder (tab stats, overlay,
// scan, nametags). Those ladders can't see each other, so four features each
// pacing at ~175ms summed to ~20 req/s from a single IP — which is what trips
// the Cloudflare edge block (and no amount of key rotation helps, because the
// edge limit is per-IP, not per-key). This is the global floor for game traffic.
const HYPIXEL_API_GAME_MIN_SPACING_MS = 150;
const HYPIXEL_REQUEST_SETTING_LIMITS = Object.freeze({
    hypixelRequestDelayMs: Object.freeze({ min: 0, max: 60000 }),
    hypixelRequestConcurrency: Object.freeze({ min: 1, max: 16 })
});
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

function normalizeHypixelRequestSettings(settings = {}) {
    const integer = (key, fallback) => {
        const value = settings?.[key], bounds = HYPIXEL_REQUEST_SETTING_LIMITS[key];
        if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return fallback;
        const number = Number(value);
        return Number.isSafeInteger(number) && number >= bounds.min && number <= bounds.max ? number : fallback;
    };
    return {
        hypixelRequestDelayMs: integer('hypixelRequestDelayMs', HYPIXEL_API_GAME_MIN_SPACING_MS),
        hypixelRequestConcurrency: integer('hypixelRequestConcurrency', HYPIXEL_API_BURST_CONCURRENCY)
    };
}

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
    const hypixelApiBudgetEvents = new FastQueue({ compactThreshold: 256 });
    const hypixelApiKeyRuntime = new Map();

    let hypixelApiActiveRequests = 0;
    let hypixelApiNonGameActiveRequests = 0;
    let hypixelApiNextNonGameAt = 0;
    let hypixelApiNextGameAt = 0;
    let hypixelApiWindowRequestCount = 0;
    let hypixelApiCooldownUntil = 0;
    let hypixelApiDrainTimer = null;
    let hypixelApiDrainAt = 0;
    let hypixelApiWindowStartedAt = 0;
    let hypixelApiHeaderRemaining = null;
    let hypixelApiAvailableRemaining = null;
    let hypixelApiHeaderLimit = null;
    let hypixelApiHeaderResetAt = 0;
    let hypixelApiLastDiagnosticLogAt = 0;
    let hypixelApiLastDiagnosticKey = '';
    let hypixelApiSuppressedDiagnosticLogs = 0;
    let lastHypixelGameRequestAt = null;
    let requestSettings = {
        hypixelRequestDelayMs: HYPIXEL_API_GAME_MIN_SPACING_MS,
        hypixelRequestConcurrency: HYPIXEL_API_BURST_CONCURRENCY
    };

    function getHypixelRequestSettings() {
        return { ...requestSettings };
    }

    function configureHypixelRequests(patch = {}) {
        const next = normalizeHypixelRequestSettings({ ...requestSettings, ...patch });
        const delayChanged = next.hypixelRequestDelayMs !== requestSettings.hypixelRequestDelayMs;
        if (!delayChanged && next.hypixelRequestConcurrency === requestSettings.hypixelRequestConcurrency) return getHypixelRequestSettings();
        requestSettings = next;
        if (delayChanged && lastHypixelGameRequestAt !== null) {
            hypixelApiNextGameAt = lastHypixelGameRequestAt + hypixelGameSpacingMs();
        }
        // Re-evaluate pending jobs without cancelling active transports or
        // resetting reserved quota, usage, key state or provider cooldowns.
        if (hypixelApiDrainTimer) clearTimeout(hypixelApiDrainTimer);
        hypixelApiDrainTimer = null;
        hypixelApiDrainAt = 0;
        drainHypixelApiQueue();
        return getHypixelRequestSettings();
    }

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
        if (state.cooldownUntil > now) return `${state.lastFailure || 'temporarily unavailable'} (${Math.ceil((state.cooldownUntil - now) / 1000)}s cooldown)`;
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
        const used = hypixelApiWindowRequestCount / (hypixelApiHeaderLimit || HYPIXEL_API_LIMIT_MAX);
        let spacing = requestSettings.hypixelRequestDelayMs;
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
            if (meta.signal?.aborted) return reject(meta.signal.reason || new Error('Hypixel request cancelled.'));
            const priority = hypixelApiQueuePriority(meta);
            const item = { fn, meta: { ...meta, priority }, resolve, reject };
            if (meta.signal) {
                item.onAbort = () => {
                    const index = hypixelApiQueue.findIndex(queued => queued === item);
                    if (index < 0) return;
                    hypixelApiQueue.removeAt(index);
                    meta.signal.removeEventListener('abort', item.onAbort);
                    reject(meta.signal.reason || new Error('Hypixel request cancelled.'));
                };
                meta.signal.addEventListener('abort', item.onAbort, { once: true });
            }
            hypixelApiQueue.push(item);
            drainHypixelApiQueue();
        });
    }

    function scheduleHypixelApiDrain(delay) {
        const dueAt = Date.now() + Math.max(1, delay);
        if (hypixelApiDrainTimer && hypixelApiDrainAt <= dueAt) return;
        if (hypixelApiDrainTimer) clearTimeout(hypixelApiDrainTimer);
        hypixelApiDrainAt = dueAt;
        hypixelApiDrainTimer = setTimeout(() => {
            hypixelApiDrainTimer = null;
            hypixelApiDrainAt = 0;
            drainHypixelApiQueue();
        }, Math.max(1, delay));
        if (typeof hypixelApiDrainTimer?.unref === 'function') hypixelApiDrainTimer.unref();
    }

    function drainHypixelApiQueue() {
        if (!hypixelApiQueue.length) return;
        while (hypixelApiActiveRequests < requestSettings.hypixelRequestConcurrency && hypixelApiQueue.length) {
            const now = Date.now();
            // Reserve a slot before dispatch, including requests still in flight.
            // Keep a rolling fallback even when upstream omits its quota headers.
            const budgetWaitMs = hypixelApiBudgetWaitMs(now);
            if (budgetWaitMs > 0) {
                scheduleHypixelApiDrain(budgetWaitMs);
                return;
            }
            const item = takeNextHypixelApiQueueItem();
            if (!item) return;
            if (item.onAbort) item.meta.signal.removeEventListener('abort', item.onAbort);
            const background = item.meta?.priority !== 'game';
            if (background) {
                hypixelApiNonGameActiveRequests += 1;
                hypixelApiNextNonGameAt = Date.now() + HYPIXEL_API_NON_GAME_MIN_SPACING_MS;
            } else {
                lastHypixelGameRequestAt = Date.now();
                hypixelApiNextGameAt = Date.now() + hypixelGameSpacingMs();
            }
            hypixelApiActiveRequests += 1;
            if (hypixelApiAvailableRemaining !== null) hypixelApiAvailableRemaining -= 1;
            const usageEvent = recordHypixelApiRequest(item.meta);
            hypixelApiBudgetEvents.push(usageEvent);

            Promise.resolve()
                .then(() => item.fn(usageEvent))
                .then(response => {
                    updateHypixelApiUsageEvent(usageEvent, response?.status || 200);
                    if (usageEvent.keySlot === 'primary') noteHypixelRateLimitHeaders(response, response?.status === 429);
                    return response;
                })
                .catch(e => {
                    // A locally rejected job never reached Hypixel. Do not let
                    // missing keys or the kill switch consume the hard budget.
                    if (e?.hypixelApiUnavailable || e?.apiKillSwitchBlocked) {
                        const budgetIndex = hypixelApiBudgetEvents.findIndex(event => event === usageEvent);
                        if (budgetIndex >= 0) hypixelApiBudgetEvents.removeAt(budgetIndex);
                        const usageIndex = hypixelApiUsageEvents.findIndex(event => event === usageEvent);
                        if (usageIndex >= 0) hypixelApiUsageEvents.removeAt(usageIndex);
                        hypixelApiWindowRequestCount = Math.max(0, hypixelApiWindowRequestCount - 1);
                        if (hypixelApiAvailableRemaining !== null) hypixelApiAvailableRemaining += 1;
                    }
                    const status = e?.response?.status || 0;
                    updateHypixelApiUsageEvent(usageEvent, status);
                    if (status === 429 && usageEvent.keySlot === 'primary') noteHypixelRateLimitHeaders(e.response, true);
                    logHypixelApiFailure(e, item.meta, usageEvent);
                    throw e;
                })
                .finally(() => {
                    hypixelApiActiveRequests = Math.max(0, hypixelApiActiveRequests - 1);
                    if (background) hypixelApiNonGameActiveRequests = Math.max(0, hypixelApiNonGameActiveRequests - 1);
                    drainHypixelApiQueue();
                })
                .then(item.resolve, item.reject);
        }
    }

    function hypixelApiBudgetWaitMs(now = Date.now()) {
        while (hypixelApiBudgetEvents.length && hypixelApiBudgetEvents.peek().at <= now - HYPIXEL_API_LIMIT_WINDOW_MS) {
            hypixelApiBudgetEvents.shift();
        }
        if (hypixelApiHeaderResetAt && now >= hypixelApiHeaderResetAt + 350) {
            hypixelApiAvailableRemaining = null;
            hypixelApiHeaderResetAt = 0;
        }
        let waitMs = Math.max(0, hypixelApiCooldownUntil - now);
        const primary = hypixelApiKeyRuntime.get('primary');
        if (primary?.cooldownUntil > now && primary.invalidUntil <= now
            && primary.key === String(getKeys()?.hypixel || '').trim()) {
            waitMs = Math.max(waitMs, primary.cooldownUntil - now);
        }
        if (hypixelApiBudgetEvents.length >= (hypixelApiHeaderLimit || HYPIXEL_API_LIMIT_MAX)) {
            waitMs = Math.max(waitMs, hypixelApiBudgetEvents.peek().at + HYPIXEL_API_LIMIT_WINDOW_MS - now + 350);
        }
        if (hypixelApiAvailableRemaining !== null && hypixelApiAvailableRemaining <= 1) {
            waitMs = Math.max(waitMs, hypixelApiHeaderResetAt + 350 - now);
        }
        return waitMs;
    }

    function hypixelApiGet(url, options = {}) {
        return runHypixelApiRequest(url, options, (requestUrl, requestOptions) => axios.get(requestUrl, requestOptions));
    }

    // The launcher also schedules proxy transports here. Only a grant and a
    // compact outcome cross IPC; player responses stay in their requesting process.
    function runHypixelApiRequest(url, options = {}, transport) {
        const { apiPriority, apiKey, signal, ...axiosOptions } = options || {};
        return queueHypixelApiRequest(async (usageEvent = null) => {
            const validationKey = String(apiKey || '').trim();
            const configured = validationKey ? configuredHypixelApiKeys()[0] : null;
            const entry = validationKey
                ? (validationKey === configured?.key ? configured : { id: 'validation', label: 'validation', key: validationKey })
                : selectHypixelApiKey();
            if (!entry) throw hypixelNoAvailableKeyError();
            if (signal?.aborted) throw signal.reason || new Error('Hypixel request cancelled.');
            const state = hypixelApiKeyState(entry);
            state.active += 1;
            if (usageEvent) usageEvent.keySlot = entry.id;
            try {
                const response = await transport(stripHypixelKeyParam(url), {
                    ...axiosOptions,
                    ...(signal ? { signal } : {}),
                    headers: { ...(axiosOptions.headers || {}), 'API-Key': entry.key }
                });
                if ([401, 403, 429].includes(response?.status) || response?.status >= 500) {
                    noteHypixelApiKeyFailure(entry, { response });
                } else {
                    noteHypixelApiKeySuccess(entry);
                    if (validationKey && [200, 400, 422].includes(response?.status)) {
                        state.invalidUntil = 0;
                        state.cooldownUntil = 0;
                    }
                }
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
            priority: apiPriority,
            signal
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
        const resetDelay = hypixelApiKeyResetDelay(response);

        if (remaining !== null) {
            const reservedRemaining = Math.max(0, remaining - Math.max(0, hypixelApiActiveRequests - 1));
            hypixelApiHeaderRemaining = remaining;
            hypixelApiAvailableRemaining = hypixelApiAvailableRemaining === null
                ? reservedRemaining : Math.min(hypixelApiAvailableRemaining, reservedRemaining);
        }
        if (limit !== null && limit > 0) hypixelApiHeaderLimit = limit;
        if (resetSeconds !== null && resetSeconds > 0) hypixelApiHeaderResetAt = Date.now() + (resetSeconds * 1000);
        else if (hypixelApiAvailableRemaining !== null && hypixelApiAvailableRemaining <= 1 && !hypixelApiHeaderResetAt) {
            hypixelApiHeaderResetAt = Date.now() + resetDelay;
        }

        if (wasLimited || (hypixelApiAvailableRemaining !== null && hypixelApiAvailableRemaining <= 1)) {
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
            limit: hypixelApiHeaderLimit || HYPIXEL_API_LIMIT_MAX,
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
                remaining: Math.max(0, (hypixelApiHeaderLimit || HYPIXEL_API_LIMIT_MAX) - currentWindowCount),
                resetAt,
                resetInMs: Math.max(0, resetAt - now)
            },
            queue: {
                active: hypixelApiActiveRequests,
                backgroundActive: hypixelApiNonGameActiveRequests,
                queued: hypixelApiQueue.length,
                gameQueued: hypixelApiQueue.toArray().filter(item => item?.meta?.priority === 'game').length,
                backgroundQueued: hypixelApiQueue.toArray().filter(item => item?.meta?.priority !== 'game').length,
                concurrency: requestSettings.hypixelRequestConcurrency,
                backgroundConcurrency: HYPIXEL_API_NON_GAME_CONCURRENCY,
                nextBackgroundInMs: Math.max(0, hypixelApiNextNonGameAt - now),
                nextGameInMs: Math.max(0, hypixelApiNextGameAt - now),
                gameSpacingMs: requestSettings.hypixelRequestDelayMs,
                windowRequestCount: hypixelApiWindowRequestCount,
                cooldownInMs: Math.max(0, hypixelApiCooldownUntil - now),
                budgetWaitInMs: hypixelApiBudgetWaitMs(now)
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
        getHypixelRequestSettings,
        configureHypixelRequests,
        configuredHypixelApiKeys,
        getHypixelApiEndpoint,
        getHypixelApiUsageSnapshot,
        hasHypixelApiKeyConfigured,
        healthyHypixelApiKeys,
        hypixelApiGet,
        runHypixelApiRequest,
        hypixelApiQueuePriority,
        hypixelUsageBreakdown,
        readHeaderNumber
    };
}

module.exports = {
    normalizeHypixelRequestSettings,
    HYPIXEL_REQUEST_SETTING_LIMITS,
    HYPIXEL_API_BURST_CONCURRENCY,
    HYPIXEL_API_NON_GAME_CONCURRENCY,
    HYPIXEL_API_NON_GAME_MIN_SPACING_MS,
    HYPIXEL_API_GAME_MIN_SPACING_MS,
    HYPIXEL_API_DIAGNOSTIC_LOG_THROTTLE_MS,
    createHypixelApiClient
};
