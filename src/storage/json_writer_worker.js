'use strict';

const { parentPort } = require('worker_threads');
const { writeFileAtomic } = require('./atomic_file.js');

const fileQueues = new Map();

parentPort.on('message', (message = {}) => {
    if (!message.id || !message.filePath) return;
    const previous = fileQueues.get(message.filePath) || Promise.resolve();
    const next = previous
        .catch(() => {})
        .then(async () => {
            const payload = JSON.stringify(message.value, null, Number(message.space) || 0);
            const publication = await writeFileAtomic(message.filePath, payload, 'utf8', { publication: message.publication === true });
            parentPort.postMessage({ id: message.id, label: message.label || '', error: null, publication });
        })
        .catch((error) => {
            parentPort.postMessage({
                id: message.id,
                label: message.label || '',
                error: error?.message || String(error)
            });
        });
    fileQueues.set(message.filePath, next);
    next.finally(() => {
        if (fileQueues.get(message.filePath) === next) fileQueues.delete(message.filePath);
    });
});
