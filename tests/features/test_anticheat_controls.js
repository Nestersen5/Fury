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
assert.equal(defaults.anticheatPartyBroadcastEnabled, true, 'party broadcasts should start on');

config.saveFeatureSettings({
    ...config.loadFeatureSettings(),
    anticheatEnabled: false,
    anticheatScaffoldEnabled: false,
    anticheatAutoblockEnabled: false,
    anticheatStasisEnabled: false,
    anticheatPossibleAlertsEnabled: false,
    anticheatTeamAlertsEnabled: true,
    anticheatPartyBroadcastEnabled: false
});
const saved = loader.parseFeatureConfig();
for (const key of [
    'anticheatEnabled', 'anticheatScaffoldEnabled', 'anticheatAutoblockEnabled',
    'anticheatStasisEnabled'
]) assert.equal(saved[key], false, `${key} should survive a reload`);
assert.equal(saved.anticheatTeamAlertsEnabled, true);
assert.equal(saved.anticheatPartyBroadcastEnabled, false, 'party broadcasts can be disabled and reloaded');
assert.equal(saved.anticheatPossibleAlertsEnabled, true, 'Possible alerts cannot be disabled by legacy settings');

config.saveFeatureSettings({ ...config.loadFeatureSettings(), anticheatAutoblockEnabled: true, anticheatStasisEnabled: true });
const optedIn = loader.parseFeatureConfig();
assert.equal(optedIn.anticheatAutoblockEnabled, false);
assert.equal(optedIn.anticheatStasisEnabled, false);

console.log('AntiCheat defaults and persisted proxy settings passed.');

const root = path.resolve(__dirname, '../..');
const launcher = fs.readFileSync(path.join(root, 'launcher.html'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'proxy.js'), 'utf8');
for (const id of ['anticheat-autoblock-enabled', 'anticheat-stasis-enabled', 'anticheat-possible-alerts-enabled']) {
    assert(!launcher.includes(id), 'Removed control: ' + id);
}
assert(launcher.includes('anticheat-scaffold-enabled'));
assert(launcher.includes('anticheat-team-alerts-enabled'));
assert(launcher.includes('anticheat-party-broadcast-enabled'));
assert(!proxy.includes('createAutoblockDetector') && !proxy.includes('createStasisDetector'));
assert(!proxy.includes('!anticheatPossibleAlertsEnabled'));
