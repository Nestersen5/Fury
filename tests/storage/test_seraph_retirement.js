'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-provider-retirement-'));
const previous = process.env.FURY_DATA_DIR;
process.env.FURY_DATA_DIR = directory;
const config = require('../../app_config');
const { filterPresetSettings } = require('../../src/profiles/profileStore');
const { createApiKeyCommandHandler, API_KEY_TYPES } = require('../../features/api_key_commands');
const { createProxyTabCompleter, PROXY_COMMANDS } = require('../../features/command_completion');

(async () => {
    try {
        assert.deepStrictEqual(config.loadKeys(), { hypixel: '', urchin: '', urchinadmin: '', aurora: '' });
        const expected = { hypixel: 'hypixel-fixture', urchin: 'urchin-fixture', urchinadmin: 'admin-fixture', aurora: 'aurora-fixture' };
        const metadata = { hypixelUpdatedAt: '2026-10-01 10:00', hypixelSavedAt: 123456789, hypixelSnoozedUntil: 987654321 };
        for (const label of ['Seraph API key', 'seraph']) {
            fs.writeFileSync(config.paths.keys, [
                'Hypixel API key: hypixel-fixture', 'Urchin API key: urchin-fixture',
                'Urchin admin API key: admin-fixture', 'Aurora API key: aurora-fixture',
                'Hypixel API key updated: 2026-10-01 10:00',
                'Hypixel API key saved at: 123456789', 'Hypixel reminder snoozed until: 987654321',
                `${label}: retired-fixture`
            ].join('\n'));
            assert.deepStrictEqual(config.loadKeyState(), { keys: expected, keyMeta: metadata });
            const migrated = fs.readFileSync(config.paths.keys, 'utf8');
            assert(!/seraph|retired-fixture/i.test(migrated), 'migration removes the retired credential from disk');
            assert.deepStrictEqual(config.loadKeyMeta(), metadata);
            assert.strictEqual(fs.readFileSync(config.paths.keys, 'utf8'), migrated, 'migration is idempotent');
            config.saveAllSettings({ keys: { seraph: 'stale-payload' } });
            assert.deepStrictEqual(config.loadKeys(), expected, 'old settings payloads cannot restore the provider');
            assert.deepStrictEqual(config.loadKeyMeta(), metadata, 'migration and unrelated saves preserve reminder metadata');
            assert(!fs.readFileSync(config.paths.keys, 'utf8').includes('stale-payload'));
        }
        fs.writeFileSync(config.paths.keys, 'hypixel-fixture\nurchin-fixture\naurora-fixture\nretired-fixture\n');
        assert.deepStrictEqual(config.loadKeys(), { ...expected, urchinadmin: '' }, 'positional files retain the original provider slots');
        assert(!fs.readFileSync(config.paths.keys, 'utf8').includes('retired-fixture'));
        assert.deepStrictEqual(config.loadKeyMeta(), config.defaults.keyMeta);

        fs.writeFileSync(config.paths.features, JSON.stringify({ nametagSourcePriority: 'seraph', nametagOthersEnabled: true }));
        assert(!Object.hasOwn(config.loadFeatureSettings(), 'nametagSourcePriority'));
        config.saveFeatureSettings({ nametagSourcePriority: 'seraph' });
        const features = JSON.parse(fs.readFileSync(config.paths.features, 'utf8'));
        assert(!Object.hasOwn(features, 'nametagSourcePriority'));
        assert.strictEqual(features.nametagOthersEnabled, true);
        assert.deepStrictEqual(filterPresetSettings({ nametagSourcePriority: 'seraph', nametagOthersEnabled: true }), { nametagOthersEnabled: true });

        const messages = [];
        const handler = createApiKeyCommandHandler({
            sendChat: (_client, message) => messages.push(message),
            getKeys: () => { throw new Error('Retired command must not access keys'); },
            saveKeys: () => { throw new Error('Retired command must not save'); }
        });
        handler({}, ['/apikey', 'SeRaPh', 'never-echo-this-fixture']);
        assert(messages.length && JSON.stringify(messages).includes('removed'));
        assert(!JSON.stringify(messages).includes('never-echo-this-fixture'));
        assert(!Object.hasOwn(API_KEY_TYPES, 'seraph'));
        assert(!PROXY_COMMANDS.includes('/seraph'));
        const complete = createProxyTabCompleter();
        assert(!complete('/apikey ').includes('seraph'));
        assert(!complete('/nametags ').includes('source'));

        // Exercise the actual Main test handler without starting Electron or allowing HTTP.
        const main = fs.readFileSync(path.join(__dirname, '../../launcher.js'), 'utf8');
        const handlerSource = main.match(/async function testApiKey\(provider, rawKey\) \{[\s\S]*?\n\}/)[0];
        let requests = 0;
        const testApiKey = vm.runInNewContext(`(${handlerSource})`, { axios: { get: () => { requests++; throw new Error('Unexpected request'); } } });
        const result = await testApiKey('seraph', 'retired-fixture');
        assert.strictEqual(result.state, 'unsupported');
        assert.strictEqual(requests, 0);
        for (const file of ['launcher.js', 'proxy.js', 'src/stats/fetch.js', 'src/stats/sources.js']) {
            const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
            assert(!/api\.seraph\.|getSeraphRaw|fetchSeraphFull/.test(source), `${file} must not contain retired fetch paths`);
        }
        console.log('Seraph retirement migration, commands and network regression checks passed.');
    } finally {
        if (previous === undefined) delete process.env.FURY_DATA_DIR; else process.env.FURY_DATA_DIR = previous;
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
