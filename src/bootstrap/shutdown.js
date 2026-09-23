'use strict';

const VERSION = 1;
const GRACE_MS = 3000;
const FORCE_MS = 1000;
const PHASES = new Set(['renderer', 'authentication', 'quiesce', 'persistence', 'resources']);

function within(promise, deadline, phase) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
        // The owner may already have started; consume a late rejection without
        // extending the common deadline or claiming the work completed.
        Promise.resolve(promise).catch(() => {});
        return Promise.reject(Object.assign(new Error('Shutdown deadline exceeded.'), { code: 'SHUTDOWN_TIMEOUT', phase }));
    }
    let timer;
    return Promise.race([promise, new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Shutdown deadline exceeded.'), { code: 'SHUTDOWN_TIMEOUT', phase })), remaining);
    })]).finally(() => clearTimeout(timer));
}

// One operation and one deadline; owners supply the actual quiesce/drain work.
function createShutdown({ quiesce, drain, close, progress = () => {} }) {
    let state = 'RUNNING', phase = 'quiesce', operation;
    function request({ deadline = Date.now() + GRACE_MS, reason = 'stop' } = {}) {
        if (operation) return operation;
        state = 'QUIESCING';
        operation = (async () => {
            let failure;
            for (const [nextState, nextPhase, action] of [
                ['QUIESCING', 'quiesce', quiesce], ['DRAINING', 'persistence', drain], ['CLOSING', 'resources', close]
            ]) {
                state = nextState; phase = nextPhase;
                try {
                    progress(phase);
                    if (Date.now() >= deadline) throw Object.assign(new Error('Shutdown deadline exceeded.'), { code: 'SHUTDOWN_TIMEOUT' });
                    if (action) await within(Promise.resolve().then(() => action({ deadline, reason })), deadline, phase);
                } catch (error) {
                    failure ||= { phase, code: 'SHUTDOWN_FAILED' };
                    if (error?.code === 'SHUTDOWN_TIMEOUT') {
                        failure = { phase, code: 'SHUTDOWN_TIMEOUT' };
                        break;
                    }
                    // A failed cancellable resource must not prevent the other
                    // owners from preserving their accepted durable work.
                }
            }
            state = failure ? (failure.code === 'SHUTDOWN_TIMEOUT' ? 'FORCED' : 'FAILED') : 'ACKNOWLEDGED';
            return failure ? { clean: false, outcome: state, ...failure } : { clean: true, outcome: state };
        })();
        return operation;
    }
    return { request, get state() { return state; }, get stopping() { return state !== 'RUNNING'; } };
}

function installServiceShutdown(actions, { processObject = process } = {}) {
    const instanceId = processObject.env.FURY_SERVICE_INSTANCE;
    let requestId;
    const send = (message, callback) => {
        try {
            if (processObject.connected && processObject.send) processObject.send({ version: VERSION, instanceId, requestId, ...message }, callback || (() => {}));
            else callback?.();
        } catch { callback?.(new Error('Shutdown IPC disconnected.')); }
    };
    const controller = createShutdown({ ...actions, progress: phase => send({ type: 'shutdown-progress', phase }) });
    let finishing = false;
    async function finish(request) {
        if (finishing) return;
        finishing = true; requestId = request.requestId;
        const result = await controller.request(request);
        if (result.clean) {
            send({ type: 'shutdown-complete', persisted: true, resourcesClosed: true }, error => {
                if (processObject.connected) processObject.disconnect?.();
                processObject.exit(error ? 1 : 0);
            });
        } else {
            send({ type: 'shutdown-failed', ...result });
            // Keep the owned process alive for Main's subtree fallback. Standalone
            // execution also remains bounded; a failed exit is never a clean ack.
            setTimeout(() => processObject.exit(1), Math.max(0, request.deadline + FORCE_MS - Date.now()));
        }
    }
    processObject.on('message', message => {
        if (message?.type !== 'shutdown-request' || message.version !== VERSION || message.instanceId !== instanceId ||
            typeof message.requestId !== 'string' || !message.requestId || !Number.isFinite(message.deadline)) return;
        void finish({ requestId: message.requestId, reason: message.reason, deadline: Math.min(message.deadline, Date.now() + GRACE_MS) });
    });
    for (const signal of ['SIGINT', 'SIGTERM', 'disconnect']) processObject.once(signal, () => {
        if (!finishing) void finish({ reason: signal, deadline: Date.now() + GRACE_MS });
    });
    return controller;
}

module.exports = { VERSION, GRACE_MS, FORCE_MS, PHASES, within, createShutdown, installServiceShutdown };
