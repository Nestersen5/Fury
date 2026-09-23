'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { writeJson } = require('../../scripts/test_support/publication_writer');
const { publicationStamp } = require('../../src/storage/filePublication');
const { createSessionStore } = require('../../src/session/sessionStore');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-ui-publication-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

test('UI writer acknowledges its exact atomic publication, not just file contents', async t => {
    const file = path.join(fixture(t), 'session_data.json');
    let calls = 0;
    await writeJson(file, { synthetic: true }, 'Fixture', (error, receipt) => {
        calls++;
        assert.ifError(error);
        assert.equal(receipt.version, 1);
        assert.deepEqual(receipt.stamp, publicationStamp(fs.statSync(file, { bigint: true })));
        assert.deepEqual(JSON.parse(fs.readFileSync(file)), { synthetic: true });
    }, { publication: true });
    assert.equal(calls, 1);
});

test('UI writer reports failed publication without a successful receipt', async t => {
    const file = path.join(fixture(t), 'directory.json');
    fs.mkdirSync(file);
    let calls = 0;
    await writeJson(file, {}, 'Fixture', (error, receipt) => {
        calls++;
        assert(error);
        assert.equal(receipt, undefined);
    }, { publication: true });
    assert.equal(calls, 1);
    assert(fs.statSync(file).isDirectory());
});

test('UI SessionStore joins older publication then persists newer accepted mutation', async t => {
    const file = path.join(fixture(t), 'session_data.json');
    fs.writeFileSync(file, JSON.stringify({ version: 4, sessions: [{
        id: 'fixture', uuid: 'a'.repeat(32), name: 'Synthetic', startedAt: 1000, lastSeen: 2000,
        games: [{ id: 'game', at: 2000, mode: 'BEDWARS', result: 'win', verificationStatus: 'pending' }]
    }] }));
    const store = createSessionStore({ sessionFile: file, saveDelayMs: 600000, writeJsonOffThread: writeJson });
    store.updateGame('fixture', 'game', { result: 'loss' });
    const first = store.flush({ strict: true });
    store.updateGame('fixture', 'game', { result: 'win' });
    await store.flush({ strict: true });
    await first;
    store.verifyPersistence();
    assert.equal(JSON.parse(fs.readFileSync(file)).sessions[0].games[0].result, 'win');
});
