const assert = require('assert');
const { createHypixelApiClient } = require('../../features/hypixel_api_client.js');

async function run() {
    const calls = [];
    const client = createHypixelApiClient({
        axios: {
            async get(url, options) {
                calls.push({ url, options });
                return { status: 200, headers: { 'RateLimit-Remaining': '299', 'RateLimit-Limit': '300' }, data: { success: true } };
            }
        },
        getKeys: () => ({ hypixel: 'primary-key' }),
        getGameState: () => ({ gameActive: true, gameSessionId: 'game-1', currentGamemode: 'BEDWARS' }),
        logger: { warn() {} }
    });

    assert.strictEqual(client.hasHypixelApiKeyConfigured(), true);
    const response = await client.hypixelApiGet('https://api.hypixel.net/v2/player?key=old&uuid=test', {
        timeout: 50,
        apiPriority: 'game'
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(calls.length, 1, 'A single configured key should make one request.');
    assert.strictEqual(calls[0].options.headers['API-Key'], 'primary-key', 'The key must be sent as the API-Key header.');
    assert.strictEqual(new URL(calls[0].url).searchParams.get('key'), null, 'Legacy ?key= query parameters must be stripped.');
    assert(!('apiPriority' in calls[0].options), 'Internal request priority should not be passed to axios.');

    const snapshot = client.getHypixelApiUsageSnapshot();
    assert.strictEqual(snapshot.currentGameActive, true);
    assert.strictEqual(snapshot.keyPool.length, 1, 'Only one Hypixel key may be active.');
    assert.strictEqual(snapshot.keyPool[0].id, 'primary');
    assert.strictEqual(snapshot.keyPool[0].healthy, true);

    // /lf in a lobby and a manual scan explicitly share game priority. They
    // must consume one cadence, even though the client is not in a game.
    const dispatches = [];
    const pacedClient = createHypixelApiClient({
        axios: { async get(url) {
            dispatches.push({ url, at: Date.now() });
            return { status: 200, headers: {}, data: { success: true } };
        } },
        getKeys: () => ({ hypixel: 'test-key' }),
        getGameState: () => ({ gameActive: false }),
        logger: { warn() {} }
    });
    // Production queue timers are unref'ed; keep the test alive until drained.
    const keepAlive = setInterval(() => {}, 1000);
    try {
        await Promise.all(['scan1', 'lf1', 'scan2', 'lf2'].map(uuid =>
            pacedClient.hypixelApiGet(`https://api.hypixel.net/v2/player?uuid=${uuid}`, { apiPriority: 'game' })
        ));
        assert.strictEqual(dispatches.length, 4);
        for (let i = 1; i < dispatches.length; i++) {
            assert(dispatches[i].at - dispatches[i - 1].at >= 165, 'Scan and LF requests must share the 200ms cadence (with 15% jitter), not burst together.');
        }
        assert.strictEqual(pacedClient.getHypixelApiUsageSnapshot().lastFiveMinutes, 4, 'Both callers count against the same API budget.');
    } finally {
        clearInterval(keepAlive);
    }

    const edgeCalls = [];
    const edgeClient = createHypixelApiClient({
        axios: {
            async get(url, options) {
                edgeCalls.push(options?.headers?.['API-Key']);
                const error = new Error('Request failed with status code 403');
                error.response = {
                    status: 403,
                    headers: {},
                    data: '<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body>Sorry, you have been blocked</body></html>'
                };
                throw error;
            }
        },
        getKeys: () => ({ hypixel: 'edge-primary' }),
        logger: { warn() {} }
    });

    await assert.rejects(
        edgeClient.hypixelApiGet('https://api.hypixel.net/v2/player?uuid=test', { apiPriority: 'background' }),
        /403/,
        'Cloudflare 403 should surface the real error.'
    );
    assert.strictEqual(edgeCalls.length, 1, 'An edge/IP block should make one request.');
    const edgePrimary = edgeClient.getHypixelApiUsageSnapshot().keyPool[0];
    assert.strictEqual(edgePrimary.invalidRetryInMs, 0, 'Cloudflare 403 must not mark the key invalid for an hour.');
    assert(edgePrimary.cooldownInMs > 0 && edgePrimary.cooldownInMs <= 61 * 1000, 'Cloudflare 403 should apply a short IP cooldown.');
}

run()
    .then(() => console.log('Hypixel API client tests passed.'))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
