'use strict';

const assert = require('assert');
const { createTagTracker, trackedCategory, loggedKeysFromLog } = require('../../src/overlay/tagTracker.js');

assert.strictEqual(trackedCategory('Caution'), 'caution');
assert.strictEqual(trackedCategory('Sniper'), 'sniper');
assert.strictEqual(trackedCategory('Legit'), 'legit_sniper');
assert.strictEqual(trackedCategory('Legit Sniper'), 'legit_sniper');
assert.strictEqual(trackedCategory('Replays Needed'), 'replays');
assert.strictEqual(trackedCategory('Blatant'), '', 'cheater tags are not tracked');
assert.strictEqual(trackedCategory('Closet Cheater'), '');

const writes = [];
const tracker = createTagTracker({
    filePath: '/virtual/tag_tracker.log',
    now: () => new Date(2026, 8, 17, 14, 3, 22),
    mkdir: (dir, options, callback) => callback(null),
    readFile: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    appendFile: (file, text, encoding, callback) => { writes.push(text); callback(null); }
});

const data = {
    urchin: {
        rawTags: [
            { text: 'Sniper', tooltip: 'Sniper (Added by ReviewerA 2026-09-01) - queue sniping with a party of 4' },
            { text: 'Blatant', tooltip: 'Blatant (Added by ReviewerB 2026-09-02) - scaffold' }
        ]
    },
    seraph: {
        tagged: true,
        report_type: 'Caution',
        tooltip: 'Caution: replays needed, suspicious reach ( 2 weeks ago by SeraphMod )'
    }
};

(async () => {
    const count = tracker.track({ name: 'DemoPlayer', gameMode: 'BEDWARS', gameSessionId: 1, team: 'RED', data });
    await tracker.flush();
    assert.strictEqual(count, 2, 'Urchin Sniper and Seraph Caution are tracked, Blatant is not');
    const text = writes.join('');
    assert(text.includes('[2026-09-17 14:03:22] URCHIN | Sniper | DemoPlayer'), text);
    assert(text.includes('SERAPH | Caution | DemoPlayer'), text);
    assert(text.includes('Reason: queue sniping with a party of 4'), text);
    assert(text.includes('Reason: replays needed, suspicious reach'), text);
    assert(text.includes('Added by: SeraphMod'), text);
    assert(text.includes('Game: BEDWARS | Team: RED'), text);
    assert(!text.includes('scaffold'), 'untracked tags are not written');

    assert.strictEqual(tracker.track({ name: 'DemoPlayer', gameMode: 'BEDWARS', data }), 0, 'repeat scans do not duplicate entries');
    assert.strictEqual(tracker.track({ name: 'demoplayer', gameMode: 'BEDWARS', team: 'GREEN', data }), 0, 'a later game does not log the same player again');
    assert.strictEqual(tracker.track({ name: 'Clean', data: { urchin: { rawTags: [] }, seraph: null } }), 0);
    const urchinCaution = { urchin: { rawTags: [{ text: 'Caution', tooltip: 'Caution (Added by ReviewerC 2026-09-03) - check replays' }] } };
    assert.strictEqual(tracker.track({ name: 'DemoPlayer', data: urchinCaution }), 1, 'a new source or tag type for a logged player is still recorded');

    // A restart rebuilds the logged set from the existing file.
    const existing = writes.join('') + '[2026-09-17 18:41:32] SERAPH | Legit Sniper | Nick123 (real: ExampleRealName)\n';
    assert(loggedKeysFromLog(existing).has('examplerealname|seraph|legit sniper'));
    const restartedWrites = [];
    const restarted = createTagTracker({
        filePath: '/virtual/tag_tracker.log',
        mkdir: (dir, options, callback) => callback(null),
        readFile: () => existing,
        appendFile: (file, text, encoding, callback) => { restartedWrites.push(text); callback(null); }
    });
    assert.strictEqual(restarted.track({ name: 'DemoPlayer', data }), 0, 'players already in the file are not logged after a restart');
    const legit = { seraph: { tagged: true, report_type: 'Legit Sniper', tooltip: 'Legit Sniper: legitsniping ( 2 weeks ago by clyde )' } };
    assert.strictEqual(restarted.track({ name: 'OtherNick', lookupName: 'ExampleRealName', data: legit }), 0, 'denicked entries match on the real name');
    await restarted.flush();
    assert.strictEqual(restartedWrites.length, 0);

    console.log('Tag tracker tests passed.');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
