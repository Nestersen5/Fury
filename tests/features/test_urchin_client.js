const assert = require('assert');
const { createUrchinClient } = require('../../features/urchin_client.js');

function makeUrchinData(data = {}) {
    return {
        ok: data.ok !== false,
        tag: data.tag || '',
        rawTags: data.rawTags || [],
        ...data
    };
}

async function run() {
    const tagGets = [];
    const sessionGets = [];
    let urchinKey = 'urchin-key';

    // Coral tag data, keyed by player (returned by GET /v3/player/tags).
    const tagsByPlayer = {
        DemoPlayer_: ['SNIPER', 'PARTY'],
        Nestersen: ['LEGIT']
    };

    const client = createUrchinClient({
        axios: {
            async post(url) {
                throw new Error(`Batch tags must not POST (got ${url})`);
            },
            async get(url, options) {
                if (url.includes('/player/tags')) {
                    tagGets.push({ url, options });
                    return {
                        status: 200,
                        headers: {
                            'x-ratelimit-limit': '120',
                            'x-ratelimit-remaining': '119',
                            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60)
                        },
                        data: { uuid: 'uuid', tags: tagsByPlayer[options.params.player] || [] }
                    };
                }
                sessionGets.push({ url, options });
                return {
                    status: 200,
                    headers: { 'x-ratelimit-remaining': '118', 'x-ratelimit-limit': '120' },
                    data: { success: true, sessions: [{ wins: 3 }] }
                };
            }
        },
        getKey: () => urchinKey,
        getGameState: () => ({ gameActive: true }),
        playerLookupKey: name => String(name || '').toLowerCase(),
        isMinecraftUsername: name => /^[A-Za-z0-9_]{1,16}$/.test(String(name || '')),
        makeUrchinData,
        parseBatchTags: tags => makeUrchinData({ ok: true, tag: tags[0] || '', rawTags: tags }),
        classifyRequestError: () => ({ requestStatus: 'api_error', error: 'Urchin failed.' }),
        notifyOutage() {},
        resolveSessionEndpoint: period => period === 'weekly' ? 'weekly' : 'daily'
    });

    const batch = await client.getUrchinBatchRaw(['DemoPlayer_', 'Nestersen']);
    assert.strictEqual(tagGets.length, 2, 'Each queued name gets its own Coral /player/tags request');
    assert.ok(tagGets[0].url.endsWith('/v3/player/tags'), 'Batch tags use the Coral player/tags endpoint');
    assert.strictEqual(tagGets[0].options.headers['X-API-Key'], 'urchin-key');
    assert.deepStrictEqual(
        tagGets.map(g => g.options.params.player).sort(),
        ['DemoPlayer_', 'Nestersen']
    );
    assert.strictEqual(batch.get('demoplayer_').tag, 'SNIPER');
    assert.strictEqual(batch.get('nestersen').tag, 'LEGIT');

    const cached = await client.getUrchinBatchRaw(['DemoPlayer_']);
    assert.strictEqual(tagGets.length, 2, 'Fresh batch data should be served from cache');
    assert.strictEqual(cached.get('demoplayer_').tag, 'SNIPER');

    const snapshot = client.getUrchinRateLimitSnapshot();
    assert.strictEqual(snapshot.limit, 120);
    assert.strictEqual(snapshot.remaining, 119);
    assert.strictEqual(snapshot.cachedPlayers, 2);

    const session = await client.fetchUrchinSession('DemoPlayer_', 'weekly');
    assert.strictEqual(sessionGets.length, 1, 'Session request should call Urchin once');
    assert.strictEqual(sessionGets[0].url, 'https://api.urchin.gg/v3/player/sessions/weekly');
    assert.strictEqual(sessionGets[0].options.params.key, 'urchin-key');
    assert.deepStrictEqual(session.sessions, [{ wins: 3 }]);

    const cachedSession = await client.fetchUrchinSession('DemoPlayer_', 'weekly');
    assert.strictEqual(sessionGets.length, 1, 'Fresh session data should be cached');
    assert.deepStrictEqual(cachedSession.sessions, [{ wins: 3 }]);

    urchinKey = '';
    const missingKeyClient = createUrchinClient({
        axios: {
            async post() {
                throw new Error('should not call post without a key');
            },
            async get() {
                throw new Error('should not call get without a key');
            }
        },
        getKey: () => '',
        playerLookupKey: name => String(name || '').toLowerCase(),
        makeUrchinData
    });
    const missing = await missingKeyClient.getUrchinBatchRaw(['NoKeyUser']);
    assert.strictEqual(missing.get('nokeyuser').requestStatus, 'missing_key');
    const missingSession = await missingKeyClient.fetchUrchinSession('NoKeyUser', 'daily');
    assert(missingSession.error.includes('Urchin API key not set'));
}

run()
    .then(() => console.log('Urchin client tests passed.'))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
