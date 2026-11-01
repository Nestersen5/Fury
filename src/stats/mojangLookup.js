'use strict';

const ENDPOINTS = [
    'https://api.mojang.com/users/profiles/minecraft/',
    'https://api.minecraftservices.com/minecraft/profile/lookup/name/'
];
const HEDGE_MS = 1000;
const TIMEOUT_MS = 3000;

// One initial request, at most one overlapping fallback, then one delayed
// recovery attempt. Both official routes share cooldown and recovery ownership.
function createMojangLookup({ request, isRetryable, retryAfterMs, now, setTimeoutImpl, clearTimeoutImpl, onFailure = () => {} }) {
    let cooldownUntil = 0;
    let lastFailureNoticeAt = -Infinity;
    const lastSuccess = [0, 0];
    const cancelled = () => Object.assign(new Error('Stats lookup recovery was cancelled.'), { code: 'STATS_LOOKUP_CANCELLED' });
    function wait(ms, signal, canRetry) {
        if (signal.aborted || !canRetry()) return Promise.reject(cancelled());
        return new Promise((resolve, reject) => {
            const abort = () => { clearTimeoutImpl(timer); reject(cancelled()); };
            const timer = setTimeoutImpl(() => {
                signal.removeEventListener('abort', abort);
                if (signal.aborted || !canRetry()) reject(cancelled());
                else resolve();
            }, ms);
            timer.unref?.();
            signal.addEventListener('abort', abort, { once: true });
        });
    }
    async function ready(signal, canRetry) {
        while (cooldownUntil > now()) await wait(cooldownUntil - now(), signal, canRetry);
        if (signal.aborted || !canRetry()) throw cancelled();
    }
    async function read(index, name, signal, canRetry, onStart = () => {}, failures = []) {
        await ready(signal, canRetry);
        onStart();
        const startedAt = now();
        try {
            const response = await request(ENDPOINTS[index] + encodeURIComponent(name), { timeout: TIMEOUT_MS, signal });
            if (response.status === 204) {
                throw Object.assign(new Error('Player was not found.'), { response: { status: 404 } });
            }
            const uuid = String(response.data?.id || '').replace(/-/g, '').toLowerCase();
            const returnedName = String(response.data?.name || '');
            if (!/^[0-9a-f]{32}$/.test(uuid) || returnedName.toLowerCase() !== name.toLowerCase()) {
                throw Object.assign(new Error('Minecraft profile lookup returned an invalid identity.'), {
                    code: 'MOJANG_INVALID_PROFILE', mojangRetryable: true
                });
            }
            if (signal.aborted || !canRetry()) throw cancelled();
            lastSuccess[index] = now();
            return uuid;
        } catch (error) {
            // These public identity endpoints use no API key. A provider/edge
            // refusal is not evidence of a missing player or a bad Hypixel key.
            if (error?.response?.status === 403) error.mojangRetryable = true;
            if (!signal.aborted) failures.push({ endpoint: index === 0 ? 'primary' : 'fallback',
                status: Number(error?.response?.status) || 0,
                code: /^[A-Z0-9_]{1,40}$/.test(error?.code || '') ? error.code : '',
                elapsedMs: Math.max(0, now() - startedAt) });
            const retryAfter = retryAfterMs(error, now());
            if (error?.response?.status === 429 || (error?.response?.status >= 400 && retryAfter > 0)) {
                cooldownUntil = Math.max(cooldownUntil, now() + (retryAfter || 60000));
            }
            throw error;
        }
    }
    function initial(name, signal, canRetry, failures) {
        return new Promise((resolve, reject) => {
            const active = new Map(), errors = [];
            let settled = false, fallbackStarted = false, hedgeTimer;
            function finish(error, value) {
                if (settled) return;
                settled = true;
                clearTimeoutImpl(hedgeTimer);
                signal.removeEventListener('abort', abort);
                for (const controller of active.values()) controller.abort();
                active.clear();
                if (error) reject(error); else resolve(value);
            }
            const abort = () => finish(cancelled());
            function launch(index) {
                if (settled || (index === 1 && fallbackStarted)) return;
                if (index === 1) { fallbackStarted = true; clearTimeoutImpl(hedgeTimer); }
                const controller = new AbortController();
                active.set(index, controller);
                read(index, name, controller.signal, canRetry, () => {
                    if (index === 0 && !fallbackStarted) {
                        hedgeTimer = setTimeoutImpl(() => launch(1), HEDGE_MS);
                        hedgeTimer.unref?.();
                    }
                }, failures).then(uuid => finish(null, uuid), error => {
                    if (settled) return;
                    active.delete(index);
                    errors.push(error);
                    // A rate limit pauses both routes. Permanent failures are
                    // not repaired by sending another request to the same service.
                    if (error?.response?.status === 429
                        || (!isRetryable(error) && ![204, 404].includes(error?.response?.status))) {
                        finish(error);
                    } else if (isRetryable(error) && !fallbackStarted) {
                        launch(1);
                    } else if (active.size === 0) {
                        // A missing response must not conceal a transport error
                        // from the other route and accidentally confirm a nick.
                        finish(errors.find(isRetryable) || error);
                    }
                });
            }
            if (signal.aborted || !canRetry()) return finish(cancelled());
            signal.addEventListener('abort', abort, { once: true });
            launch(0);
        });
    }
    async function resolve(name, { signal, canRetry }) {
        const failures = [];
        try {
            try { return await initial(name, signal, canRetry, failures); }
            catch (error) {
                if (!isRetryable(error) || signal.aborted || !canRetry()) throw error;
                await wait(Math.max(1000, retryAfterMs(error, now()), cooldownUntil - now()), signal, canRetry);
                const preferred = lastSuccess[1] > lastSuccess[0] ? 1 : 0;
                return await read(preferred, name, signal, canRetry, undefined, failures);
            }
        }
        catch (error) {
            if (!signal.aborted && canRetry() && ![204, 404].includes(error?.response?.status)
                && error?.code !== 'STATS_LOOKUP_CANCELLED' && !error?.apiKillSwitchBlocked
                && now() - lastFailureNoticeAt >= 30000) {
                lastFailureNoticeAt = now();
                try { onFailure({ attempts: failures.slice(0, 3), cooldownInMs: Math.max(0, cooldownUntil - now()) }); }
                catch (_) { /* Diagnostics cannot change lookup results. */ }
            }
            throw error;
        }
    }
    return { resolve, getCooldownUntil: () => cooldownUntil };
}

module.exports = { createMojangLookup };
