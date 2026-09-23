'use strict';

const assert = require('assert');
const {
    createRealSkinTextureResolver,
    normalizeTextureProperties,
    mergeTextureProperties
} = require('../../src/denick/skinTextures.js');
const { createDenickDisplayNames } = require('../../src/denick/displayNames.js');

const REAL_TEXTURE = {
    name: 'textures',
    value: 'real-texture-value',
    signature: 'mojang-signature'
};
const NICK_TEXTURE = {
    name: 'textures',
    value: 'hypixel-nick-texture',
    signature: 'hypixel-profile-signature'
};

async function flushPromises() {
    await new Promise(resolve => setImmediate(resolve));
}

(async () => {
    assert.deepStrictEqual(normalizeTextureProperties([REAL_TEXTURE]), [REAL_TEXTURE]);
    assert.strictEqual(
        normalizeTextureProperties([{ name: 'textures', value: 'unsigned' }]),
        null,
        'unsigned texture data must not be injected into an online-mode profile'
    );
    assert.deepStrictEqual(
        mergeTextureProperties([NICK_TEXTURE, { name: 'other', value: 'keep-me' }], [REAL_TEXTURE]),
        [{ name: 'other', value: 'keep-me' }, REAL_TEXTURE],
        'only the textures property is replaced'
    );

    {
        const calls = [];
        const httpClient = {
            get: async (url, options) => {
                calls.push({ url, options });
                if (url.includes('/users/profiles/minecraft/')) {
                    return { data: { id: '0123456789abcdef0123456789abcdef', name: 'RealDude' } };
                }
                return { data: { properties: [REAL_TEXTURE] } };
            }
        };
        const resolver = createRealSkinTextureResolver({ httpClient, logger: { warn: () => {} } });
        const [first, second] = await Promise.all([
            resolver.resolve('RealDude'),
            resolver.resolve('realdude')
        ]);
        assert.deepStrictEqual(first, [REAL_TEXTURE]);
        assert.deepStrictEqual(second, [REAL_TEXTURE]);
        assert.strictEqual(calls.length, 2, 'concurrent lookups share one Mojang profile request');
        assert(calls[0].url.endsWith('/RealDude'));
        assert(calls[1].url.endsWith('/0123456789abcdef0123456789abcdef?unsigned=false'));
        assert.strictEqual(calls[0].options.timeout, 4000);

        first[0].value = 'mutated-by-caller';
        assert.deepStrictEqual(await resolver.resolve('RealDude'), [REAL_TEXTURE], 'cache results are defensive copies');
        assert.strictEqual(calls.length, 2, 'a successful skin is cached');
    }

    {
        let calls = 0;
        const resolver = createRealSkinTextureResolver({
            httpClient: { get: async () => { calls += 1; throw new Error('offline'); } },
            logger: { warn: () => {} }
        });
        assert.strictEqual(await resolver.resolve('RealDude'), null);
        assert.strictEqual(await resolver.resolve('RealDude'), null);
        assert.strictEqual(calls, 1, 'failed lookups are briefly cached instead of hammering Mojang');
        assert.strictEqual(await resolver.resolve('not a name'), null, 'invalid names never reach the API');
        assert.strictEqual(calls, 1);
    }

    {
        const sent = [];
        let skinEnabled = true;
        const renamer = createDenickDisplayNames({
            isEnabled: () => true,
            resolveRealName: () => 'RealDude',
            isSkinReplacementEnabled: () => skinEnabled,
            resolveSkinProperties: async () => [REAL_TEXTURE],
            resend: (packetName, payload) => sent.push({ packetName, payload }),
            logger: { error: () => {} }
        });
        const original = {
            action: 0,
            data: [{
                uuid: 'entity-uuid-stays-the-same',
                name: 'NickyBoi',
                properties: [NICK_TEXTURE, { name: 'other', value: 'keep-me' }],
                ping: 31
            }]
        };
        const renamed = renamer.rewritePlayerInfo(original, 'add_player');
        assert.strictEqual(renamed.data[0].name, 'RealDude');
        assert.deepStrictEqual(renamed.data[0].properties, original.data[0].properties, 'nick skin stays until lookup resolves');

        await flushPromises();
        const skinRefresh = sent.filter(entry => entry.packetName === 'player_info');
        assert.strictEqual(skinRefresh.length, 2, 'resolved skin refreshes the client profile once');
        assert.deepStrictEqual(skinRefresh[0].payload, {
            action: 'remove_player',
            data: [{ uuid: 'entity-uuid-stays-the-same' }]
        });
        const skinned = skinRefresh[1].payload.data[0];
        assert.strictEqual(skinned.uuid, 'entity-uuid-stays-the-same', 'the Hypixel entity UUID is preserved');
        assert.strictEqual(skinned.name, 'RealDude');
        assert.deepStrictEqual(skinned.properties, [
            { name: 'other', value: 'keep-me' },
            REAL_TEXTURE
        ]);

        skinEnabled = false;
        renamer.refreshSkinReplacement();
        const restored = sent[sent.length - 1].payload.data[0];
        assert.deepStrictEqual(restored.properties, original.data[0].properties, 'turning the toggle off restores the nick skin');
        assert.strictEqual(restored.uuid, 'entity-uuid-stays-the-same');
    }

    {
        const sent = [];
        const renamer = createDenickDisplayNames({
            isEnabled: () => true,
            resolveRealName: () => 'RealDude',
            isSkinReplacementEnabled: () => true,
            resolveSkinProperties: async () => null,
            resend: (packetName, payload) => sent.push({ packetName, payload }),
            logger: { error: () => {} }
        });
        renamer.rewritePlayerInfo({
            action: 0,
            data: [{ uuid: 'u1', name: 'NickyBoi', properties: [NICK_TEXTURE] }]
        }, 'add_player');
        await flushPromises();
        assert.deepStrictEqual(sent, [], 'a failed lookup leaves the Hypixel nick skin untouched');
    }

    console.log('test_denick_skin_textures.js: all assertions passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
