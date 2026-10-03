'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.FURY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-anticheat-config-'));
const config = require('../../app_config.js');
const { createConfigLoader } = require('../../src/bootstrap/config.js');
const loader = createConfigLoader({
    ...config,
    clampDodgeDelay: value => value,
    chatTriggerManager: { load() {} },
    state: { threatConfig: {} }
});

const defaults = loader.parseFeatureConfig();
for (const key of [
    'anticheatEnabled', 'anticheatScaffoldEnabled', 'anticheatPossibleAlertsEnabled'
]) assert.equal(defaults[key], true, `${key} should start on`);
for (const key of ['anticheatAutoblockEnabled', 'anticheatStasisEnabled']) {
    assert.equal(defaults[key], false, `${key} should start off`);
}
assert.equal(defaults.anticheatTeamAlertsEnabled, false, 'teammate alerts should start off');

config.saveFeatureSettings({
    ...config.loadFeatureSettings(),
    anticheatEnabled: false,
    anticheatScaffoldEnabled: false,
    anticheatAutoblockEnabled: false,
    anticheatStasisEnabled: false,
    anticheatPossibleAlertsEnabled: false,
    anticheatTeamAlertsEnabled: true
});
const saved = loader.parseFeatureConfig();
for (const key of [
    'anticheatEnabled', 'anticheatScaffoldEnabled', 'anticheatAutoblockEnabled',
    'anticheatStasisEnabled', 'anticheatPossibleAlertsEnabled'
]) assert.equal(saved[key], false, `${key} should survive a reload`);
assert.equal(saved.anticheatTeamAlertsEnabled, true);

config.saveFeatureSettings({ ...config.loadFeatureSettings(), anticheatAutoblockEnabled: true, anticheatStasisEnabled: true });
const optedIn = loader.parseFeatureConfig();
assert.equal(optedIn.anticheatAutoblockEnabled, true);
assert.equal(optedIn.anticheatStasisEnabled, true);

console.log('AntiCheat defaults and persisted proxy settings passed.');
