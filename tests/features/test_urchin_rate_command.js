'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createUrchinRateCommandHandler } = require('../../features/urchin_rate_command');
const { normalizeUrchinRequestSettings } = require('../../features/urchin_client');

const defaults = { urchinRequestDelayMs: 200, urchinRequestConcurrency: 1 };
let current = { ...defaults }, saved = 0;
const sent = [];
const command = createUrchinRateCommandHandler({
    sendChat: (_, text) => sent.push(text), getSettings: () => ({ ...current }),
    setSettings: next => { current = next; saved++; }
});
const run = text => command({}, text.split(' '));
run('/urchinrate');
assert.equal(saved, 0);
assert(sent[0].includes('200 ms') && sent[0].includes('Concurrent reads: \u00a7f1'));
run('/urchinrate delay 350');
run('/urchinrate concurrency 4');
assert.deepEqual(current, { urchinRequestDelayMs: 350, urchinRequestConcurrency: 4 });
for (const text of ['delay -1', 'delay 60001', 'delay 1.5', 'delay 200ms', 'delay 2e2',
    'delay Infinity', 'delay 0x10', 'concurrency 0', 'concurrency 17', 'concurrency 2.5',
    'status extra', 'reset extra', 'delay', 'delay 250 extra', '__proto__ 1', 'unknown']) {
    const before = saved;
    run('/urchinrate ' + text);
    assert.equal(saved, before, 'Invalid input cannot change saved settings: ' + text);
}
run('/urchinrate delay 0'); run('/urchinrate concurrency 16');
assert.deepEqual(current, { urchinRequestDelayMs: 0, urchinRequestConcurrency: 16 });
run('/urchinrate delay 60000');
run('/urchinrate reset');
assert.deepEqual(current, defaults);
const failed = createUrchinRateCommandHandler({
    sendChat: (_, text) => sent.push(text), getSettings: () => current,
    setSettings: () => { throw Error('Synthetic disk failure'); }
});
failed({}, ['/urchinrate', 'delay', '600']);
assert.deepEqual(current, defaults);
assert(sent.at(-1).includes('Could not save'));
assert.deepEqual(normalizeUrchinRequestSettings({ urchinRequestDelayMs: false, urchinRequestConcurrency: null }), defaults);
assert.deepEqual(normalizeUrchinRequestSettings({ urchinRequestDelayMs: '450', urchinRequestConcurrency: '3' }),
    { urchinRequestDelayMs: 450, urchinRequestConcurrency: 3 });

// Exercise the real settings file in isolated storage, including reload in a
// fresh module and an unrelated partial settings save as the launcher makes.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-urchin-rate-'));
const previousData = process.env.FURY_DATA_DIR;
try {
    process.env.FURY_DATA_DIR = directory;
    const configPath = require.resolve('../../app_config');
    let config = require(configPath);
    assert.equal(config.loadFeatureSettings().urchinRequestDelayMs, 200);
    config.saveFeatureSettings({ urchinRequestDelayMs: 450, urchinRequestConcurrency: 3 });
    config.saveFeatureSettings({ tabStatsEnabled: false });
    delete require.cache[configPath];
    config = require(configPath);
    const reloaded = config.loadFeatureSettings();
    assert.equal(reloaded.urchinRequestDelayMs, 450);
    assert.equal(reloaded.urchinRequestConcurrency, 3);
    assert.equal(reloaded.tabStatsEnabled, false);
    fs.writeFileSync(config.paths.features, JSON.stringify({ urchinRequestDelayMs: -1, urchinRequestConcurrency: 100 }));
    assert.equal(config.loadFeatureSettings().urchinRequestDelayMs, 200);
    assert.equal(config.loadFeatureSettings().urchinRequestConcurrency, 1);
} finally {
    if (previousData === undefined) delete process.env.FURY_DATA_DIR;
    else process.env.FURY_DATA_DIR = previousData;
    assert(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'fury-urchin-rate-')));
    fs.rmSync(directory, { recursive: true, force: true });
}
console.log('Urchin rate command passed: validation, reset, save failures, persistence and unrelated settings saves.');
