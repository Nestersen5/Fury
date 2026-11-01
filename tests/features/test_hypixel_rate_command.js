'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHypixelRateCommandHandler } = require('../../features/hypixel_rate_command');
const { normalizeHypixelRequestSettings } = require('../../features/hypixel_api_client');
const defaults = { hypixelRequestDelayMs: 150, hypixelRequestConcurrency: 2 };
let current = { ...defaults }, saves = 0;
const messages = [];
const command = createHypixelRateCommandHandler({ sendChat: (_, text) => messages.push(text),
    getSettings: () => ({ ...current }), setSettings: next => { current = next; saves++; } });
const run = text => command({}, text.split(' '));
run('/hypixelrate');
assert.equal(saves, 0);
assert(messages.some(s => s.includes('Game request delay:') && s.includes('150 ms')));
run('/hypixelrate delay 350'); run('/hypixelrate concurrency 3');
assert.deepEqual(current, { hypixelRequestDelayMs: 350, hypixelRequestConcurrency: 3 });
for (const tail of ['delay -1', 'delay 60001', 'delay 2e2', 'delay 3.5', 'delay 200ms',
    'concurrency 0', 'concurrency 17', 'concurrency NaN', 'concurrency 2.5', 'delay',
    'delay 250 extra', 'reset extra', 'status extra', '__proto__ 1']) {
    const before = saves; run('/hypixelrate ' + tail); assert.equal(saves, before, tail);
}
run('/hypixelrate delay 0'); run('/hypixelrate concurrency 16');
assert.deepEqual(current, { hypixelRequestDelayMs: 0, hypixelRequestConcurrency: 16 });
run('/hypixelrate delay 60000'); run('/hypixelrate reset');
assert.deepEqual(current, defaults);
createHypixelRateCommandHandler({ sendChat: (_, text) => messages.push(text),
    getSettings: () => current, setSettings: () => { throw Error('Synthetic save failure'); }
})({}, ['/hypixelrate', 'delay', '500']);
assert(messages.at(-1).includes('Could not save'));
assert.deepEqual(current, defaults);
assert.deepEqual(normalizeHypixelRequestSettings({ hypixelRequestDelayMs: false, hypixelRequestConcurrency: null }), defaults);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-hypixel-rate-'));
const prior = process.env.FURY_DATA_DIR;
try {
    process.env.FURY_DATA_DIR = directory;
    const file = require.resolve('../../app_config');
    let config = require(file);
    config.saveFeatureSettings({ hypixelRequestDelayMs: 400, hypixelRequestConcurrency: 3,
        urchinRequestDelayMs: 450, urchinRequestConcurrency: 2 });
    config.saveFeatureSettings({ tabStatsEnabled: false });
    delete require.cache[file]; config = require(file);
    let saved = config.loadFeatureSettings();
    assert.equal(saved.hypixelRequestDelayMs, 400); assert.equal(saved.hypixelRequestConcurrency, 3);
    assert.equal(saved.urchinRequestDelayMs, 450); assert.equal(saved.urchinRequestConcurrency, 2);
    assert.equal(saved.tabStatsEnabled, false);
    fs.writeFileSync(config.paths.features, JSON.stringify({ hypixelRequestDelayMs: -1, hypixelRequestConcurrency: 99 }));
    saved = config.loadFeatureSettings();
    assert.equal(saved.hypixelRequestDelayMs, 150); assert.equal(saved.hypixelRequestConcurrency, 2);
} finally {
    if (prior === undefined) delete process.env.FURY_DATA_DIR; else process.env.FURY_DATA_DIR = prior;
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert(path.basename(target).startsWith('fury-hypixel-rate-'));
    fs.rmSync(target, { recursive: true, force: true });
}
console.log('Hypixel rate command passed: validation, reset, save failure and independent provider persistence.');
