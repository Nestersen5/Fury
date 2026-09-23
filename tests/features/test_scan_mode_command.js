const assert = require('assert');
const {
    createDefaultThreatConfig,
    createScanModeCommandHandler,
    normalizeScanMode
} = require('../../features/scan_mode_command.js');

let scanMode = 'threats';
let threatConfig = createDefaultThreatConfig();
let saved = 0;
const sent = [];

const handler = createScanModeCommandHandler({
    sendChat: (client, message) => sent.push(message),
    getState: () => ({ scanMode, threatConfig }),
    setScanMode: next => {
        scanMode = next;
    },
    updateThreatConfig: patch => {
        threatConfig = { ...threatConfig, ...patch };
    },
    saveScanConfig: () => {
        saved += 1;
    }
});

assert.strictEqual(normalizeScanMode('a'), 'all');
assert.strictEqual(normalizeScanMode('threat'), 'threats');
assert.strictEqual(normalizeScanMode('o'), 'off');
assert.strictEqual(normalizeScanMode('wat', 'fallback'), 'fallback');

handler({}, ['/overlay']);
assert(sent.some(message => String(message).includes('Scan Settings')), 'Status should show scan settings');
assert(sent.some(message => String(message).includes('Min FKDR')), 'Status should include FKDR threshold');

sent.length = 0;
handler({}, ['/overlay', 'all']);
assert.strictEqual(scanMode, 'all');
assert.strictEqual(saved, 1);
assert(sent.some(message => String(message).includes('ALL PLAYERS')), 'All mode should confirm');

sent.length = 0;
handler({}, ['/overlay', 'threat', 'fkdr', '4.5']);
assert.strictEqual(threatConfig.minFkdr, 4.5);
assert.strictEqual(saved, 2);
assert(sent.some(message => String(message).includes('Min FKDR threat level set')));

sent.length = 0;
handler({}, ['/overlay', 'threats', 'stars', '750']);
assert.strictEqual(threatConfig.minStars, 750);

sent.length = 0;
handler({}, ['/overlay', 'threats', 'tag', 'no']);
assert.strictEqual(threatConfig.countTags, true);
assert(sent.some(message => String(message).includes('always count as threats')));

sent.length = 0;
handler({}, ['/overlay', 'threats', 'kdr', '2.7']);
assert.strictEqual(threatConfig.minSkywarsKdr, 2.7);

sent.length = 0;
handler({}, ['/overlay', 'threats', 'wlr', '1.4']);
assert.strictEqual(threatConfig.minSkywarsWlr, 1.4);

sent.length = 0;
handler({}, ['/overlay', 'threats', 'swlevel', '12']);
assert.strictEqual(threatConfig.minSkywarsLevel, 12);

sent.length = 0;
const beforeSaved = saved;
handler({}, ['/overlay', 'threats', 'fkdr', 'nope']);
assert.strictEqual(saved, beforeSaved, 'Invalid threshold should not save');
assert(sent.some(message => String(message).includes('Invalid FKDR value')));

sent.length = 0;
handler({}, ['/overlay', 'off']);
assert.strictEqual(scanMode, 'off');
assert(sent.some(message => String(message).includes('OFF')));

console.log('Scan mode command tests passed.');
