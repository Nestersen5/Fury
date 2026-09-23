'use strict';
const assert = require('assert');
const { parseQuickBuy, createQuickBuyPlayerLookup } = require('../../src/menu/quickBuyImport');
const value = 'wool,wood,end_stone,iron_boots,blast-proof_glass,jump_v_potion_(45_seconds),invisibility_potion_(30_seconds),stone_sword,iron_sword,stick_(knockback_i),shears,wooden_axe,wooden_pickaxe,speed_ii_potion_(45_seconds),magic_milk,bridge_egg,ladder,ender_pearl,tnt,golden_apple,fireball';
const player = { stats: { Bedwars: { favourites_2: value } } };
(async () => {
    assert.strictEqual(parseQuickBuy(player)[10].databaseName, 'shears');
    assert.strictEqual(parseQuickBuy({ stats: { Bedwars: { favourites_2: value.replace('wood,', 'null,') } } })[1], null);
    assert.throws(() => parseQuickBuy({}), /not available/);
    assert.throws(() => parseQuickBuy({ stats: { Bedwars: { favourites_2: 'wool' } } }), /21/);
    const cache = new Map([['goatinio2001', { timestamp: 1000, data: { player } }]]);
    let calls = 0, now = 2000;
    const lookup = createQuickBuyPlayerLookup({ globalCache: cache, cacheDuration: 300000, now: () => now,
        getPlayerData: async (name, options) => {
            calls++;
            assert.deepStrictEqual(options, { includeErrors: true, preferCache: true });
            return { data: { player } };
        } });
    assert.strictEqual(await lookup('Goatinio2001'), player);
    assert.strictEqual(calls, 0, 'fresh stats cache avoids any lookup/API requests');
    cache.set('privateplayer', { timestamp: 1000, data: { player: {} } });
    assert.throws(() => parseQuickBuy(cache.get('privateplayer').data.player), /not available/);
    assert.deepStrictEqual(await lookup('PrivatePlayer'), {});
    assert.strictEqual(calls, 0, 'missing visibility field never forces a refresh');
    now = 302000;
    await lookup('Goatinio2001');
    assert.strictEqual(calls, 1, 'expired cache uses the shared stats lookup');
    const failed = createQuickBuyPlayerLookup({ globalCache: new Map(), cacheDuration: 300000,
        getPlayerData: async () => ({ error: true, message: 'API unavailable' }) });
    await assert.rejects(failed('Someone'), /API unavailable/);
    await assert.rejects(lookup('../bad'), /valid Minecraft/);
    console.log('Quick Buy import/cache tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
