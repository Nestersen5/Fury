'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');

// Exercise the public commands against a real proxy, with an offline loopback
// Minecraft server and isolated settings. Nothing uses the developer's profile.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const mc = require('minecraft-protocol');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-party-split-toggle-'));
    const [directPort, failoverPort, healthPort, upstreamPort, cosmeticPort, blockedPort] = await unusedPorts(6);
    const featureFile = path.join(directory, 'features_config.json');
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({
        proxyDirectHost: '127.0.0.1', proxyDirectPort: directPort,
        proxyFailoverHost: '127.0.0.1', proxyFailoverPort: failoverPort, healthPort
    }));
    fs.writeFileSync(featureFile, JSON.stringify({
        apiKillSwitchEnabled: true, autoSkinDenickEnabled: false,
        autoStatsDenickEnabled: false, queueTimePartyChatEnabled: true
    }));
    const preload = path.join(directory, 'offline-fixture.js');
    fs.writeFileSync(preload, `const mc = require(${JSON.stringify(require.resolve('minecraft-protocol'))});
const createServer = mc.createServer, createClient = mc.createClient;
mc.createServer = options => createServer({ ...options, host: '127.0.0.1', 'online-mode': false });
mc.createClient = options => createClient({ ...options, host: '127.0.0.1', port: ${upstreamPort}, auth: 'offline' });
// The isolated offline client has no Microsoft account cache.
require(${JSON.stringify(path.join(REPOSITORY_ROOT, 'src/accounts/connectionAuth.js'))}).hasSavedLogin = () => true;
`);
    const env = cleanEnvironment(directory, REPOSITORY_ROOT, cosmeticPort, blockedPort);
    env.FURY_ENABLE_DIAGNOSTICS = '0';
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort, 'online-mode': false, version: '1.8.9', keepAlive: false });
    const receivedCommands = [], messages = [], errors = [];
    let child, player, upstreamClient;
    upstream.on('error', error => errors.push(error.message));
    upstream.on('login', client => {
        upstreamClient = client;
        client.on('error', error => errors.push(error.message));
        client.on('chat', data => receivedCommands.push(data.message));
        client.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1, maxPlayers: 8, levelType: 'default', reducedDebugInfo: false });
        client.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
    });
    async function start(expected) {
        child = startChild(process.execPath, ['--require', preload, path.join(REPOSITORY_ROOT, 'proxy.js')], env, 'Party split proxy fixture');
        await eventually(async () => {
            assertRunning(child);
            const health = await getJson(`http://127.0.0.1:${healthPort}/health`);
            assert(health.ok);
            assert.strictEqual(health.features.partySplitWarningsEnabled, expected);
        }, 'Loading the saved party warning preference');
    }
    async function command(value, expectedText, expectedEnabled) {
        const previous = messages.length;
        player.write('chat', { message: value });
        await eventually(async () => {
            assertRunning(child);
            assert(messages.slice(previous).some(message => message.includes(expectedText)), messages.slice(previous).join('\n'));
            assert.strictEqual((await getJson(`http://127.0.0.1:${healthPort}/health`)).features.partySplitWarningsEnabled, expectedEnabled);
        }, value);
        return messages.slice(previous);
    }
    function disconnect() {
        player?.end(); upstreamClient?.end();
        player?.socket?.destroy(); upstreamClient?.socket?.destroy();
        player = upstreamClient = null;
    }
    try {
        await start(true); // Existing profiles without the new key retain warnings.
        let positioned = false;
        player = mc.createClient({ host: '127.0.0.1', port: directPort, username: 'SplitObserver', auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', error => errors.push(error.message));
        player.on('position', () => { positioned = true; });
        player.on('chat', data => messages.push(data.message));
        await eventually(async () => { assertRunning(child); assert(positioned); }, 'Connecting the Minecraft client');
        await command('/fury', 'launcher', true);
        await command('/help overlay', '/tabstats', true);
        await command('/help stats 2', '/reminder', true);
        for (const input of ['/denick', '/denick help']) {
            const output = await command(input, 'Ghosts bed effect + matching final kills.', true);
            const guide = output.join('\n');
            for (const text of ['Denick usage', 'Stats', 'Cosmetics',
                '/denick finals <number> beds <number>', '/denick beddestroy ghosts',
                'Name: cosmetic, not IGN', 'Combined example']) {
                assert(guide.includes(text), `${input} should explain ${text}`);
            }
            assert(output.length <= 8, 'Denick usage must stay compact');
            assert(!guide.includes('"clickEvent"'), 'Denick help stays read-only');
        }
        await command('/denick status', 'Denick status.', true);
        await command('/chattrigger list', 'Chat triggers', true);
        await command('/apikill status', 'API access', true);
        for (const [input, title] of [
            ['/dodge', 'Auto Dodge'], ['/tabstats', 'Tab Stats'], ['/nametags', 'Name Tags'],
            ['/overlay', 'Scan Overlay'], ['/share', 'Share'], ['/denick', 'Denick'],
            ['/autogambler', 'Auto Gambler'], ['/proxyhealth status', 'Proxy Health'],
            ['/reminder status', 'Reminders'], ['/deck', 'launcher']
        ]) {
            const output = await command(input, title, true);
            assert(!output.some(message => message.includes('"clickEvent"')), `${input} must not render settings controls`);
        }
        await command('/dodge on', 'Auto Dodge', true);
        assert.strictEqual(JSON.parse(fs.readFileSync(featureFile, 'utf8')).autoDodgeEnabled, true, 'Typed setting commands must still work');
        await command('/partycheck off', 'warnings disabled', false);
        const saved = JSON.parse(fs.readFileSync(featureFile, 'utf8'));
        assert.strictEqual(saved.partySplitWarningsEnabled, false);
        assert.strictEqual(saved.queueTimePartyChatEnabled, true, 'Preserve unrelated settings');
        await command('/partycheck status', 'OFF', false);
        for (const input of ['/partycheck', '/partycheck help']) {
            const output = await command(input, 'Dismiss and test require', false);
            assert(output.some(message => message.includes('/partycheck stop')), 'Usage explains how to stop the preview');
            assert(!output.some(message => /clickEvent|hoverEvent/.test(message)), 'Party usage must be entirely static');
        }
        await command('/partycheck on', 'warnings enabled', true);
        assert.strictEqual(JSON.parse(fs.readFileSync(featureFile, 'utf8')).partySplitWarningsEnabled, true);
        await command('/partycheck off', 'warnings disabled', false);
        await command('/partycheck dismiss', 'no active pregame lobby', false);
        assert(!receivedCommands.some(value => value.startsWith('/partycheck')), 'Local commands must not reach the upstream server');
        assert(!receivedCommands.some(value => /^\/(fury|help|chattrigger|apikill)(?: |$)/.test(value)), 'Redesigned controls must stay local');
        disconnect();
        await stopChild(child);
        // A different feature being saved must not reset the permanent mute.
        const update = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(REPOSITORY_ROOT, 'app_config.js'))}).saveFeatureSettings({ queueTimePartyChatEnabled: false })`], { env, cwd: directory, windowsHide: true, encoding: 'utf8' });
        assert.strictEqual(update.status, 0, update.stderr);
        assert.strictEqual(JSON.parse(fs.readFileSync(featureFile, 'utf8')).partySplitWarningsEnabled, false);
        await start(false); // A new process reloads the persisted preference.
        assert.deepStrictEqual(errors, []);
        console.log('Party split toggle integration passed: defaults, commands, unrelated settings, local handling and process restart.');
    } finally {
        disconnect();
        upstream.close();
        await stopChild(child);
        if (child) fs.writeFileSync(path.join(directory, 'proxy.log'), child.output);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
