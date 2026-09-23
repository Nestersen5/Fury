const assert = require('assert');
const {
    API_KEY_TYPES,
    createApiKeyCommandHandler,
    formatUsageCountdown
} = require('../../features/api_key_commands.js');

const sent = [];
const keys = {
    hypixel: 'primary-old',
    urchin: '',
    aurora: '',
    seraph: ''
};
let savedKeys = null;
const changed = [];

const handler = createApiKeyCommandHandler({
    sendChat: (client, message) => sent.push(message),
    getKeys: () => keys,
    saveKeys: next => {
        savedKeys = { ...next };
    },
    loadKeyMeta: () => ({
        hypixelUpdatedAt: '2026-06-24 08:00:00'
    }),
    getHypixelApiUsageSnapshot: () => ({
        headers: { remaining: 299, resetInMs: 120000 },
        currentGameActive: true,
        currentGame: 8,
        currentGameMode: 'BEDWARS',
        lastMinute: 3,
        lastFiveMinutes: 9,
        currentWindow: { count: 9, remaining: 291, resetInMs: 120000 },
        limit: 300,
        queue: { active: 1, queued: 2, concurrency: 20, cooldownInMs: 0 },
        recent429: 0,
        keyPool: [{ label: 'primary', healthy: true, active: 1, requests: 5, failures: 0 }]
    }),
    getUrchinRateLimitSnapshot: () => ({
        limit: 120,
        remaining: 119,
        resetInMs: 60000,
        queuedPlayers: 1,
        requestInFlight: false,
        cachedPlayers: 2,
        cooldownInMs: 0
    }),
    onKeyChanged: (field, previous, next) => changed.push({ field, previous, next })
});

assert.strictEqual(API_KEY_TYPES.hypixel, 'Hypixel');
assert.strictEqual(formatUsageCountdown(65000), '1m 05s');

handler({}, ['/apikey']);
assert(!sent.some(message => String(message).includes('hypixel2')), 'Usage should not mention a second Hypixel key');

sent.length = 0;
handler({}, ['/apikey', 'view']);
assert(sent.some(message => String(message).includes('Hypixel updated:')), 'View should show key metadata');

sent.length = 0;
handler({}, ['/apikey', 'hypixel', 'primary-new']);
assert.strictEqual(keys.hypixel, 'primary-new');
assert.strictEqual(savedKeys.hypixel, 'primary-new');
assert.deepStrictEqual(changed.pop(), { field: 'hypixel', previous: 'primary-old', next: 'primary-new' });
assert(sent.some(message => String(message).includes('Hypixel API key updated.')), 'Update should confirm primary key change');

sent.length = 0;
handler({}, ['/apikey', 'usage']);
assert(sent.some(message => JSON.stringify(message).includes('Hypixel API Usage')), 'Usage should render Hypixel usage');
assert(sent.some(message => String(message).includes('Urchin API Usage')), 'Usage should render Urchin usage');
assert(sent.some(message => String(message).includes('primary')), 'Usage should render primary key health');

console.log('API key command tests passed.');
