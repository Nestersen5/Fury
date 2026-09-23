'use strict';

const assert = require('assert');
const axios = require('axios');
const { InFlightDeduper } = require('../../src/util/in_flight_deduper.js');
const { createStatsFetch } = require('../../src/stats/fetch.js');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    const originalAxiosGet = axios.get;
    const uuid = '1234567890abcdef1234567890abcdef';
    let mojangCalls = 0;
    let hypixelPlayerCalls = 0;
    let urchinRawCalls = 0;
    const observedPlayerResponses = [];

    try {
        axios.get = async (url) => {
            if (String(url).includes('api.mojang.com/users/profiles/minecraft')) {
                mojangCalls += 1;
                await delay(15);
                return { data: { id: uuid } };
            }
            throw new Error(`Unexpected axios.get call: ${url}`);
        };

        const globalCache = new Map();
        const { getPlayerData } = createStatsFetch({
            globalCache,
            cacheDuration: 5 * 60 * 1000,
            getHypixelKey: () => 'hypixel-key',
            hasHypixelApiKeyConfigured: () => true,
            hypixelApiGet: async (url) => {
                hypixelPlayerCalls += 1;
                assert(String(url).includes(`/v2/player?uuid=${uuid}`));
                await delay(15);
                return {
                    data: {
                        player: {
                            uuid,
                            displayname: 'TestPlayer',
                            achievements: {},
                            stats: {
                                Bedwars: {
                                    favorite_slots: 'Melee,Blocks,Pickaxe,Axe,Utility,Shears,Potions,null,Utility',
                                    slumber: {
                                        minion: { ender_dust: 275 },
                                        quest: { lastCompleted: { gambler_george: 1_700_000_000_000 } }
                                    }
                                }
                            }
                        }
                    }
                };
            },
            getUrchinRaw: async () => {
                urchinRawCalls += 1;
                return { ok: true, tag: 'raw' };
            },
            getSeraphRaw: async () => null,
            getAuroraPingRaw: async () => ({ ok: true, requestStatus: 'ok', ping: 42 }),
            getHypixelStatusRaw: async () => 'offline',
            makePingData: (overrides = {}) => ({ ...overrides }),
            mergeUrchinOverride: (existing, override) => ({ ...(existing || {}), ...(override || {}) }),
            notifyUrchinOutageOnce: () => {},
            classifyPlayerLookupError: (error) => ({
                error: true,
                errorType: 'lookup_failed',
                message: error?.message || 'failed'
            }),
            playerLookupDeduper: new InFlightDeduper(),
            observeHypixelPlayerData: (playerUuid, player) => {
                observedPlayerResponses.push({ playerUuid, player });
                return false;
            }
        });

        const override = { ok: true, tag: 'batch', source: 'urchin-batch' };
        const first = getPlayerData('TestPlayer', { includeErrors: true, urchinOverride: override });
        await delay(1);
        const second = getPlayerData('TestPlayer', { includeErrors: true });
        const [withOverride, plain] = await Promise.all([first, second]);

        assert.strictEqual(mojangCalls, 1, 'Concurrent override/plain lookups should share the Mojang request');
        assert.strictEqual(hypixelPlayerCalls, 1, 'Concurrent override/plain lookups should share the Hypixel player request');
        assert.strictEqual(urchinRawCalls, 0, 'Batch Urchin override should satisfy the shared lookup when available');
        assert.strictEqual(withOverride.data.urchin.tag, 'batch');
        assert.strictEqual(plain.data.player.displayname, 'TestPlayer');
        assert.strictEqual(observedPlayerResponses.length, 1, 'each fresh Player API response should be observed once');
        assert.strictEqual(observedPlayerResponses[0].player.stats.Bedwars.slumber.minion.ender_dust, 275, 'the observer should receive the unmodified Player API response');
        assert.strictEqual(observedPlayerResponses[0].player.stats.Bedwars.slumber.quest.lastCompleted.gambler_george, 1_700_000_000_000, 'the observer should receive the unmodified daily-reward timestamps');
        assert.strictEqual(plain.data.player.stats.Bedwars.slumber.minion.ender_dust, undefined, 'other players’ Ender Dust must not be retained in the shared stats cache');
        assert.strictEqual(plain.data.player.stats.Bedwars.favorite_slots, 'Melee,Blocks,Pickaxe,Axe,Utility,Shears,Potions,null,Utility', 'shared stats cache retains visible hotbar layouts');
        assert.strictEqual(plain.data.player.stats.Bedwars.slumber.quest.lastCompleted, undefined, 'other players’ NPC daily-reward progress must not be retained in the shared stats cache');

        const cached = await getPlayerData('TestPlayer', {
            includeErrors: true,
            urchinOverride: { ok: true, tag: 'cached-batch' }
        });
        assert.strictEqual(cached.fromCache, true);
        assert.strictEqual(cached.data.urchin.tag, 'cached-batch');
        assert.strictEqual(hypixelPlayerCalls, 1, 'Cached override merge should not call Hypixel again');
    } finally {
        axios.get = originalAxiosGet;
    }

    console.log('Stats fetch tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
