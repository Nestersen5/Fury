const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { installApiKillSwitch, isLocalAxiosRequest, apiKillSwitchError } = require('../../src/net/apiKillSwitch.js');
const { createApiKillSwitchCommandHandler } = require('../../features/api_kill_switch_command.js');

// --- URL locality classification ---

assert.strictEqual(isLocalAxiosRequest({ url: 'http://127.0.0.1:3220/v1/auth/me' }), true, 'loopback IP should be local');
assert.strictEqual(isLocalAxiosRequest({ url: 'http://localhost:3100/health' }), true, 'localhost should be local');
assert.strictEqual(isLocalAxiosRequest({ url: 'http://[::1]:3210/api/cosmetics/search' }), true, 'IPv6 loopback should be local');
assert.strictEqual(isLocalAxiosRequest({ url: 'https://api.hypixel.net/v2/player' }), false, 'Hypixel should be external');
assert.strictEqual(isLocalAxiosRequest({ url: 'https://api.mojang.com/users/profiles/minecraft/Steve' }), false, 'Mojang should be external');
assert.strictEqual(isLocalAxiosRequest({ url: '/v1/auth/me', baseURL: 'http://127.0.0.1:3220' }), true, 'relative URL should resolve against a local baseURL');
assert.strictEqual(isLocalAxiosRequest({ url: '/v2/player', baseURL: 'https://api.hypixel.net' }), false, 'relative URL should resolve against an external baseURL');
assert.strictEqual(isLocalAxiosRequest({ url: 'https://api.hypixel.net/v2/player', baseURL: 'http://127.0.0.1:3220' }), false, 'absolute external URL must win over a local baseURL');
assert.strictEqual(isLocalAxiosRequest({ url: '/relative/without/base' }), false, 'unresolvable target should be treated as external');
assert.strictEqual(isLocalAxiosRequest({ url: 'http://127.0.0.1.evil.com/x' }), false, 'lookalike host should be external');
assert.strictEqual(isLocalAxiosRequest({}), false, 'missing URL should be treated as external');

const blockedError = apiKillSwitchError();
assert.strictEqual(blockedError.apiKillSwitchBlocked, true, 'kill switch error should carry the marker flag');
assert.strictEqual(blockedError.code, 'API_KILL_SWITCH', 'kill switch error should carry a stable code');

// --- In-game command behavior ---

let commandEnabled = false;
let saves = 0;
const commandMessages = [];
const handleApiKillSwitchCommand = createApiKillSwitchCommandHandler({
    getEnabled: () => commandEnabled,
    setEnabled: (enabled) => {
        commandEnabled = enabled;
        saves += 1;
    },
    sendChat: (client, message) => commandMessages.push(message)
});

assert.strictEqual(handleApiKillSwitchCommand({}, ['/apikill', 'on']), true, 'the in-game command should accept on');
assert.strictEqual(commandEnabled, true, 'the in-game command should enable the switch');
assert.strictEqual(saves, 1, 'a changed in-game switch value should be persisted');
assert(commandMessages.at(-1).includes('Enabled'), 'the enable command should confirm the result');
assert.strictEqual(handleApiKillSwitchCommand({}, ['/apikill', 'toggle']), true, 'the in-game command should accept toggle');
assert.strictEqual(commandEnabled, false, 'toggle should invert the live switch value');
assert.strictEqual(saves, 2, 'toggle should persist the changed switch value');
assert.strictEqual(handleApiKillSwitchCommand({}, ['/apikill', 'status']), true, 'the in-game command should show status');
assert(commandMessages.some(message => message.extra?.some(part => part.text === 'ACTIVE')), 'Status should show requests active when the kill switch is off');
commandEnabled = true;
const paused = commandMessages.length;
handleApiKillSwitchCommand({}, ['/apikill', 'status']);
assert(commandMessages.slice(paused).some(message => message.extra?.some(part => part.text === 'PAUSED')));
assert.strictEqual(handleApiKillSwitchCommand({}, ['/apikill', 'invalid']), false, 'invalid in-game commands should return false');
assert(commandMessages.at(-1).includes('Usage'), 'invalid in-game commands should show usage');

// --- Interceptor behavior on a real axios instance ---

async function run() {
    let enabled = false;
    let adapterCalls = 0;
    const client = axios.create({
        adapter: async (config) => {
            adapterCalls += 1;
            return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
        }
    });
    installApiKillSwitch(client, () => enabled);

    // Switch OFF: external requests pass through untouched.
    await client.get('https://api.hypixel.net/v2/player');
    assert.strictEqual(adapterCalls, 1, 'external request should reach the adapter while the switch is off');

    // Switch ON: external requests are rejected before any transport runs.
    enabled = true;
    await assert.rejects(
        () => client.get('https://api.hypixel.net/v2/player'),
        (error) => error.apiKillSwitchBlocked === true && error.code === 'API_KILL_SWITCH',
        'external request should be rejected with the kill switch marker'
    );
    await assert.rejects(
        () => client.post('https://urchin.ws/batch', { names: [] }),
        (error) => error.apiKillSwitchBlocked === true,
        'non-GET external requests should also be rejected'
    );
    assert.strictEqual(adapterCalls, 1, 'blocked requests must never reach the adapter');

    // Switch ON: localhost traffic (subscription/account server, health API) still works.
    await client.get('http://127.0.0.1:3220/v1/auth/me');
    assert.strictEqual(adapterCalls, 2, 'localhost request should reach the adapter while the switch is on');

    // Switch back OFF live (getter re-read per request, no re-install needed).
    enabled = false;
    await client.get('https://api.hypixel.net/v2/player');
    assert.strictEqual(adapterCalls, 3, 'external requests should flow again once the switch is turned off');
}

// --- Static wiring checks (same style as test_api_pacing_static.js) ---

const proxySource = fs.readFileSync(path.join(REPOSITORY_ROOT, 'proxy.js'), 'utf8');
const appConfigSource = fs.readFileSync(path.join(REPOSITORY_ROOT, 'app_config.js'), 'utf8');
const bootstrapConfigSource = fs.readFileSync(path.join(REPOSITORY_ROOT, 'src', 'bootstrap', 'config.js'), 'utf8');
const hypixelClientSource = fs.readFileSync(path.join(REPOSITORY_ROOT, 'features', 'hypixel_api_client.js'), 'utf8');
const launcherSource = fs.readFileSync(path.join(REPOSITORY_ROOT, 'launcher.js'), 'utf8');
const launcherHtmlSource = fs.readFileSync(path.join(REPOSITORY_ROOT, 'launcher.html'), 'utf8');

function expect(pattern, message, source) {
    assert(pattern.test(source), message);
}

expect(/installApiKillSwitch\(axios, \(\) => state\.apiKillSwitchEnabled\)/, 'proxy.js should install the kill switch on the shared axios singleton with a live state getter.', proxySource);
expect(/createApiKillSwitchCommandHandler/, 'proxy.js should wire the in-game API kill-switch command.', proxySource);
expect(/cmd === '\/apikill' \|\| cmd === '\/killapi'/, 'proxy.js should dispatch the in-game API kill-switch command and its alias.', proxySource);
expect(/state\.apiKillSwitchEnabled = Boolean\(enabled\);[\s\S]*saveFeatureConfig\(\);/, 'the in-game API kill-switch command should persist its changed state.', proxySource);
expect(/state\.apiKillSwitchEnabled = features\.apiKillSwitchEnabled;/, 'loadFeatureConfig should apply the kill switch flag to runtime state.', proxySource);
expect(/apiKillSwitchEnabled: state\.apiKillSwitchEnabled,/, 'feature snapshots should report the kill switch state to the launcher.', proxySource);
expect(/apiKillSwitchEnabled: false,/, 'app_config defaults should include the kill switch (off).', appConfigSource);
expect(/apiKillSwitchEnabled: next\.apiKillSwitchEnabled !== undefined/, 'saveFeatureSettings should persist the kill switch flag.', appConfigSource);
expect(/apiKillSwitchEnabled: bool\('apiKillSwitchEnabled', false\)/, 'parseFeatureConfig should parse the kill switch flag.', bootstrapConfigSource);
assert(!hypixelClientSource.includes('shouldFailoverHypixelRequest'), 'The one-key Hypixel client must not retain failover behavior.');
expect(/if \(error\?\.apiKillSwitchBlocked\) \{[\s\S]*shouldLog: false,/, 'Hypixel client should not spam usage diagnostics for kill switch rejections.', hypixelClientSource);
expect(/apiKillSwitchEnabled: settings\?\.features\?\.apiKillSwitchEnabled \?\? before\.features\?\.apiKillSwitchEnabled,/, 'launcher settings:save-features should pass the kill switch flag through.', launcherSource);
expect(/\['API kill switch', 'apiKillSwitchEnabled'\],/, 'launcher settingChanges should label kill switch toggles for the in-game notice.', launcherSource);
expect(/id="api-kill-switch-enabled" type="checkbox"/, 'launcher UI should have the kill switch toggle.', launcherHtmlSource);
expect(/ids\.apiKillSwitchEnabled\.checked = featureOn\('apiKillSwitchEnabled', false\);/, 'launcher UI should hydrate the kill switch toggle from saved settings.', launcherHtmlSource);

run().then(() => {
    console.log('API kill switch tests passed.');
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
