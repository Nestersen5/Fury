'use strict';
const assert = require('assert');
const { dependencyStatus } = require('../../src/launcher/renderer/launcher_windows_usability');
const { diagnosticsEnabled } = require('../../src/bootstrap/diagnostics');

assert.strictEqual(dependencyStatus({}), 'Proxy stopped');
const running = { services: { proxy: { running: true } }, settings: { keys: {} } };
assert.strictEqual(dependencyStatus(running), 'Waiting for Minecraft');
assert.strictEqual(dependencyStatus(running, { aurora: true }), 'Needs Aurora');
running.settings.keys.aurora = 'configured-test-key';
assert.strictEqual(dependencyStatus(running, { aurora: true }), 'Waiting for Minecraft');
running.proxyHealth = { connectedAccount: 'Test', features: {} };
assert.strictEqual(dependencyStatus(running), '');
running.proxyHealth.connectedAccount = null;
assert.strictEqual(dependencyStatus(running), 'Waiting for Minecraft');
for (const env of [{}, { FURY_ENABLE_DIAGNOSTICS: '0' }, { FURY_ENABLE_DIAGNOSTICS: 'true' }]) {
    assert.strictEqual(diagnosticsEnabled(env), false);
}
assert.strictEqual(diagnosticsEnabled({ FURY_ENABLE_DIAGNOSTICS: '1' }), true);
console.log('Launcher dependency and diagnostics checks passed.');
