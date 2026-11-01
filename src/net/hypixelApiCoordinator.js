'use strict';

// Share the existing API client's scheduler over the launcher's private child
// channel. HTTP requests and full player data remain in the requesting process.
const VERSION = 1;
const TYPE = 'hypixel-api';
const HEADERS = ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'retry-after'];
const { normalizeHypixelRequestSettings } = require('../../features/hypixel_api_client');

function responseSummary(response) {
    if (!response) return undefined;
    const headers = {};
    for (const name of HEADERS) {
        const value = response.headers?.get?.(name)
            ?? response.headers?.[name]
            ?? Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];
        if (value !== undefined) headers[name] = String(value).slice(0, 32);
    }
    const summary = { status: Number(response.status) || 0, headers };
    if (summary.status >= 400) {
        const data = response.data;
        if (typeof data === 'string') summary.data = data.slice(0, 1024);
        else if (data && typeof data === 'object') {
            summary.data = {};
            for (const key of ['success', 'cause', 'reason', 'message', 'error']) {
                if (typeof data[key] === 'boolean') summary.data[key] = data[key];
                else if (typeof data[key] === 'string') summary.data[key] = data[key].slice(0, 256);
            }
        }
    }
    return summary;
}

function errorSummary(error) {
    const summary = { message: String(error?.message || 'Hypixel request failed.').slice(0, 512) };
    for (const key of ['code', 'hypixelApiUnavailable', 'hypixelApiErrorType', 'hypixelApiReason', 'apiKillSwitchBlocked']) {
        const value = error?.[key];
        if (typeof value === 'boolean') summary[key] = value;
        else if (typeof value === 'string') summary[key] = value.slice(0, 256);
    }
    if (error?.response) summary.response = responseSummary(error.response);
    return summary;
}

function restoreError(summary) {
    return Object.assign(new Error(summary?.message || 'Hypixel request failed.'), summary);
}

function unavailableError() {
    return Object.assign(new Error('The shared Hypixel request connection is unavailable.'), { code: 'HYPIXEL_COORDINATOR_UNAVAILABLE' });
}

function gameStateSummary(state) {
    return {
        gameActive: Boolean(state?.gameActive),
        gameSessionId: String(state?.gameSessionId || '').slice(0, 80),
        currentGamemode: String(state?.currentGamemode || '').slice(0, 40),
        gameStartTime: Number(state?.gameStartTime) || 0
    };
}

function attachHypixelApiCoordinator(channel, { client, instanceId, onGameState = () => {}, canConfigure = () => true }) {
    const pending = new Map();
    let closed = false;
    const matches = message => message?.type === TYPE && message.version === VERSION && message.instanceId === instanceId;
    const send = message => {
        if (closed || !channel.connected) return;
        try {
            channel.send({ type: TYPE, version: VERSION, instanceId, ...message }, error => { if (error) close(); });
        } catch { close(); }
    };
    function close() {
        if (closed) return;
        closed = true;
        channel.removeListener('message', onMessage);
        channel.removeListener('disconnect', close);
        channel.removeListener('exit', close);
        channel.removeListener('error', close);
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.controller.abort(unavailableError());
            entry.reject?.(unavailableError());
        }
        pending.clear();
        onGameState(null);
    }
    function onMessage(message) {
        if (!matches(message) || closed) return;
        if (message.action === 'configure') {
            const settings = normalizeHypixelRequestSettings(message.settings);
            if (!canConfigure() || !Object.keys(settings).every(key => settings[key] === message.settings?.[key])) return;
            client.configureHypixelRequests(settings);
            send({ action: 'snapshot', snapshot: client.getHypixelApiUsageSnapshot() });
            return;
        }
        if (message.action === 'usage') {
            onGameState(gameStateSummary(message.gameState));
            send({ action: 'snapshot', snapshot: client.getHypixelApiUsageSnapshot() });
            return;
        }
        if (message.action === 'complete') {
            const entry = pending.get(message.id);
            if (!entry?.resolve) return;
            clearTimeout(entry.timer);
            const { resolve, reject } = entry;
            entry.resolve = entry.reject = null;
            if (message.error) reject(restoreError(message.error));
            else resolve(message.response);
            return;
        }
        if (message.action === 'cancel') {
            const entry = pending.get(message.id);
            if (entry) {
                entry.controller.abort(unavailableError());
                entry.reject?.(unavailableError());
            }
            return;
        }
        if (message.action !== 'request' || typeof message.id !== 'string' || pending.has(message.id)) return;
        if (pending.size >= 1024 || typeof message.url !== 'string' || message.url.length > 2048) {
            send({ action: 'settled', id: message.id, error: errorSummary(unavailableError()) });
            return;
        }
        let url;
        try { url = new URL(message.url); } catch {}
        if (!url || url.origin !== 'https://api.hypixel.net' || !['/v2/player', '/v2/guild', '/v2/status'].includes(url.pathname)) {
            send({ action: 'settled', id: message.id, error: errorSummary(unavailableError()) });
            return;
        }
        onGameState(gameStateSummary(message.gameState));
        const entry = { controller: new AbortController(), timer: null, resolve: null, reject: null };
        pending.set(message.id, entry);
        client.runHypixelApiRequest(message.url, {
            apiPriority: message.priority === 'game' ? 'game' : 'background',
            signal: entry.controller.signal
        }, (requestUrl, options) => new Promise((resolve, reject) => {
            entry.resolve = resolve;
            entry.reject = reject;
            entry.timer = setTimeout(() => reject(unavailableError()), Math.min(60000, Math.max(1000, Number(message.timeout) || 30000)) + 1000);
            entry.timer.unref?.();
            send({ action: 'grant', id: message.id, url: requestUrl, apiKey: options.headers['API-Key'] });
        })).then(
            () => finish(),
            error => finish(error)
        );
        function finish(error) {
            clearTimeout(entry.timer);
            pending.delete(message.id);
            send({ action: 'settled', id: message.id, ...(error ? { error: errorSummary(error) } : {}), snapshot: client.getHypixelApiUsageSnapshot() });
        }
    }
    channel.on('message', onMessage);
    channel.once('disconnect', close);
    channel.once('exit', close);
    channel.once('error', close);
    send({ action: 'snapshot', snapshot: client.getHypixelApiUsageSnapshot() });
    return { close };
}

function createHypixelApiCoordinatorClient({ channel, instanceId, axios, localClient, getGameState }) {
    const pending = new Map();
    let sequence = 0, closed = false, snapshot = null, usagePending = false;
    let sentSettings = null;
    function send(message) {
        if (closed || !channel.connected) throw unavailableError();
        channel.send({ type: TYPE, version: VERSION, instanceId, ...message }, error => { if (error) close(); });
    }
    function close() {
        if (closed) return;
        for (const [id, entry] of pending) {
            try { send({ action: 'cancel', id }); } catch {}
            entry.cleanup?.();
            entry.controller.abort();
            entry.reject(unavailableError());
        }
        closed = true;
        pending.clear();
        channel.removeListener('message', onMessage);
        channel.removeListener('disconnect', close);
    }
    function onMessage(message) {
        if (message?.type !== TYPE || message.version !== VERSION || message.instanceId !== instanceId || closed) return;
        if (message.snapshot) { snapshot = message.snapshot; usagePending = false; }
        const entry = pending.get(message.id);
        if (!entry) return;
        if (message.action === 'settled') {
            pending.delete(message.id);
            entry.cleanup?.();
            if (message.error || entry.error) {
                entry.controller.abort();
                entry.reject(entry.error || restoreError(message.error));
            } else entry.resolve(entry.response);
        } else if (message.action === 'grant' && !entry.started) {
            entry.started = true;
            Promise.resolve().then(() => axios.get(message.url, {
                ...entry.options,
                signal: entry.controller.signal,
                headers: { ...(entry.options.headers || {}), 'API-Key': message.apiKey }
            })).then(response => {
                if (!pending.has(message.id)) return;
                entry.response = response;
                send({ action: 'complete', id: message.id, response: responseSummary(response) });
            }, error => {
                if (!pending.has(message.id)) return;
                entry.error = error;
                send({ action: 'complete', id: message.id, error: errorSummary(error) });
            }).catch(() => close());
        }
    }
    channel.on('message', onMessage);
    channel.once('disconnect', close);
    function hypixelApiGet(url, options = {}) {
        const { apiPriority, signal, ...axiosOptions } = options;
        return new Promise((resolve, reject) => {
            if (closed) return reject(unavailableError());
            if (signal?.aborted) return reject(signal.reason || unavailableError());
            const id = String(++sequence);
            const gameState = gameStateSummary(getGameState());
            const priority = apiPriority || (gameState.gameActive ? 'game' : 'background');
            const entry = { resolve, reject, options: axiosOptions, controller: new AbortController() };
            pending.set(id, entry);
            if (signal) {
                const abort = () => {
                    if (!pending.delete(id)) return;
                    entry.cleanup();
                    entry.controller.abort();
                    try { send({ action: 'cancel', id }); } catch {}
                    reject(signal.reason || unavailableError());
                };
                entry.cleanup = () => signal.removeEventListener('abort', abort);
                signal.addEventListener('abort', abort, { once: true });
            }
            try { send({ action: 'request', id, url, priority, gameState, timeout: options.timeout }); }
            catch (error) { pending.delete(id); entry.cleanup?.(); reject(error); }
        });
    }
    function getHypixelApiUsageSnapshot() {
        if (!closed && !usagePending) {
            usagePending = true;
            try { send({ action: 'usage', gameState: gameStateSummary(getGameState()) }); }
            catch { usagePending = false; }
        }
        return snapshot || localClient.getHypixelApiUsageSnapshot();
    }
    function configureHypixelRequests(patch) {
        const settings = localClient.configureHypixelRequests(patch);
        if (!closed && channel.connected && (!sentSettings
            || Object.keys(settings).some(key => settings[key] !== sentSettings[key]))) {
            try {
                // Private-channel order applies this before any following grant.
                send({ action: 'configure', settings });
                sentSettings = settings;
            } catch { close(); }
        }
        return settings;
    }
    return { ...localClient, hypixelApiGet, getHypixelApiUsageSnapshot, configureHypixelRequests, close };
}

module.exports = { attachHypixelApiCoordinator, createHypixelApiCoordinatorClient, responseSummary };
