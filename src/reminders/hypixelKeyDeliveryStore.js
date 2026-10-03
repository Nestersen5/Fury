'use strict';

const fs = require('fs');
const { createHash } = require('crypto');
const { writeFileAtomic } = require('../storage/atomic_file');

// Only the proxy writes this small record. Launcher snoozes live with the key's
// metadata; notification bookkeeping never rewrites credentials or features.
function createHypixelKeyDeliveryStore(file, { track = work => work, logger = console } = {}) {
    let record = {};
    try { record = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
    let chain = Promise.resolve();
    const identity = (key, expiresAt) => createHash('sha256').update(`${String(key || '').trim()}:${expiresAt}`).digest('hex');
    return {
        get(key, expiresAt) { return record.identity === identity(key, expiresAt) ? record : {}; },
        set(key, expiresAt, delivery) {
            record = { identity: identity(key, expiresAt), phase: delivery.phase, lastAt: delivery.lastAt };
            const contents = JSON.stringify(record);
            chain = chain.then(() => writeFileAtomic(file, contents)).catch(() => {
                logger.warn?.('[Hypixel key reminder] Could not save notification cooldown.');
            });
            track(chain);
        },
        flush() { return chain; }
    };
}

module.exports = { createHypixelKeyDeliveryStore };
