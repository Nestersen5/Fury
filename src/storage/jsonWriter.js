'use strict';

// Off-thread JSON writer. Lazily spawns a single worker_threads worker that
// serializes writes per filePath via writeFileAtomic. The worker is held as
// a singleton inside the closure — must remain single-instance because
// multiple callers debounce-save to the same paths.

const { Worker } = require('worker_threads');

function createJsonWriter({ workerPath, logger = console } = {}) {
    if (!workerPath) throw new Error('createJsonWriter requires workerPath');

    let worker = null;
    let sequence = 0;
    const callbacks = new Map();
    let sealed = false;
    let failure = null;
    let draining = null;
    let closing = false;
    const waiters = new Set();

    function settled() {
        if (callbacks.size) return;
        for (const resolve of waiters) resolve();
        waiters.clear();
    }
    function fail(error) {
        failure ||= new Error('JSON persistence did not complete.');
        for (const { callback } of callbacks.values()) { try { callback?.(error); } catch {} }
        callbacks.clear();
        settled();
    }

    function ensureWorker() {
        if (worker) return worker;
        const next = new Worker(workerPath);
        next.unref();
        next.on('message', (message = {}) => {
            const pending = callbacks.get(message.id);
            if (pending) {
                callbacks.delete(message.id);
                if (message.error) failure ||= new Error('JSON persistence did not complete.');
                try { pending.callback?.(message.error || null, message.error ? undefined : message.publication); }
                catch { failure ||= new Error('JSON persistence acknowledgement failed.'); }
                settled();
            }
            if (message.error) {
                logger.error(`[${message.label || 'Storage'}] Background save failed: ${message.error}`);
            }
        });
        next.on('error', (error) => {
            logger.error('[Storage] JSON writer worker failed:', error.message);
            fail(error.message);
        });
        next.on('exit', (code) => {
            if (!closing) fail(`Writer exited with code ${code}`);
            if (worker === next) worker = null;
        });
        worker = next;
        return next;
    }

    function writeJsonOffThread(filePath, value, label = 'Storage', callback = null, { publication = false } = {}) {
        if (sealed) throw new Error('JSON writer is shutting down.');
        const id = ++sequence;
        callbacks.set(id, { callback: typeof callback === 'function' ? callback : null });
        try { ensureWorker().postMessage({
            id,
            filePath,
            value,
            label,
            publication
        }); } catch (error) { fail(error.message); throw error; }
        return id;
    }

    function drain() {
        if (draining) return draining;
        sealed = true;
        worker?.ref();
        draining = (async () => {
            if (callbacks.size) await new Promise(resolve => waiters.add(resolve));
            if (failure) throw failure;
        })();
        return draining;
    }
    async function close() {
        await drain();
        if (failure) throw failure;
        closing = true;
        if (worker) await worker.terminate();
    }
    return { writeJsonOffThread, ensureJsonWriterWorker: ensureWorker, drain, close };
}

module.exports = { createJsonWriter };
