'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const axios = require('axios');
const { createDenickHistory } = require('../../src/denick/history');
const { createDenickIdentityMigration } = require('../../src/denick/identityMigration');
const { createDenickMigrationNotice, migrationNoticeText } = require('../../src/denick/migrationNotice');
const { createStatsFetch } = require('../../src/stats/fetch');
const { createPregameIdentityLookup } = require('../../src/stats/pregameIdentity');
const { createDenickTracker } = require('../../src/net/session/denickTracking');
const { createRealSkinTextureResolver } = require('../../src/denick/skinTextures');
const { getIdentityFromSkin } = require('../../src/denick/skin_denicker');
const { projectDenickHistory } = require('../../src/launcher/denickHistory');
const { InFlightDeduper } = require('../../src/util/in_flight_deduper');
const { getCachedPlayerProfile } = require('../../src/stats/profileCache');
const { fixture: clockFixture } = require('./test_hypixel_api_coordinator');
const A = 'a'.repeat(32), B = 'b'.repeat(32);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-denick-identities-'));
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
let sequence = 0;
function store(rows = [], options = {}) {
    const historyFile = path.join(directory, `${sequence++}.json`);
    fs.writeFileSync(historyFile, JSON.stringify(rows));
    const history = createDenickHistory({ historyFile, requireVerifiedIdentity: true,
        ...options,
        // Keep test publications stable until the final explicit flush/reload.
        writeJsonOffThread(file, value, label, done) {
            fs.writeFileSync(file, JSON.stringify(value)); done();
        } });
    return { history, historyFile };
}
const failure = status => Object.assign(new Error('Synthetic lookup failure'), status
    ? { response: { status } } : { code: 'ECONNABORTED' });

test('notice status follows in-flight checks, pauses, retries, exhaustion and completed or removed findings', async () => {
    const { history } = store([{ realIGN: 'OldName', nicks: ['SavedNick'] }]), { clock } = clockFixture();
    let enabled = true, rejectLookup;
    const migration = createDenickIdentityMigration({ history, now: () => clock.now,
        setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout, canRequest: () => enabled,
        resolveIdentity: () => new Promise((_, reject) => { rejectLookup = reject; }) });
    migration.resume(); await clock.until(100);
    assert.deepEqual(migration.getStatus(), { state: 'updating', pendingCount: 1 });
    enabled = false;
    assert.equal(migration.getStatus().state, 'paused');
    rejectLookup(failure()); await clock.until(200);
    enabled = true; migration.resume();
    assert.equal(migration.getStatus().state, 'retrying');
    await clock.until(60200);
    assert.equal(migration.getStatus().state, 'updating');
    rejectLookup(failure()); await clock.until(60300);
    assert.equal(migration.getStatus().state, 'retrying');
    await clock.until(360300);
    assert.equal(migration.getStatus().state, 'updating', 'the last attempt remains active until it settles');
    rejectLookup(failure()); await clock.until(360400);
    assert.equal(migration.getStatus().state, 'restart');
    history.appendDenickHistory({ nick: 'OtherNick', realIGN: 'OtherPlayer', realUuid: A });
    history.appendDenickHistory({ nick: 'MissingNick', realIGN: 'MissingName' });
    const missing = history.loadDenickHistoryStore().players.find(p => p.realIGN === 'MissingName');
    history.updateIdentity(missing, { identityState: 'missing' });
    assert.equal(migration.getStatus().pendingCount, 1, 'verified and confirmed missing accounts need no notice');
    history.removeDenickMapping('OldName', 'SavedNick');
    assert.deepEqual(migration.getStatus(), { state: 'complete', pendingCount: 0 });
    migration.close(); await history.flush();
});

test('chat reminder dismissal persists, can be restored and does not claim success after a failed save', async () => {
    const file = path.join(directory, 'notice.json'), messages = [];
    let status = { state: 'updating', pendingCount: 1 }, fail = false;
    const options = { file, getStatus: () => status, sendChat: (client, message) => messages.push({ client, message }),
        write: async (file, value) => { if (fail) throw Error('Synthetic disk failure'); await fs.promises.writeFile(file, value); } };
    let notice = createDenickMigrationNotice(options);
    const client = {};
    notice.notify(client);
    assert.equal(messages[0].client, client);
    const parts = messages[0].message.extra;
    assert(parts.some(part => part.text.includes('scan stats')));
    assert.deepEqual(parts.at(-1).clickEvent, { action: 'run_command', value: '/denick notice off' });
    fail = true; await notice.command(client, 'off');
    assert.match(messages.at(-1).message, /Could not save/);
    notice.notify(client); assert.equal(typeof messages.at(-1).message, 'object', 'failed dismissal still allows reminders');
    fail = false; await notice.command(client, 'off');
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), { dismissed: true });
    notice = createDenickMigrationNotice(options);
    let before = messages.length; notice.notify(client); assert.equal(messages.length, before);
    await notice.command(client, 'on');
    notice = createDenickMigrationNotice(options);
    notice.notify(client); assert.equal(typeof messages.at(-1).message, 'object');
    status = { state: 'complete', pendingCount: 0 };
    before = messages.length; notice.notify(client); assert.equal(messages.length, before);
    for (const state of ['paused', 'retrying', 'restart']) {
        status = { state, pendingCount: 1 }; notice.notify(client);
        assert.equal(messages.at(-1).message.extra[1].text, migrationNoticeText(state));
    }
    const saved = fs.readFileSync(file, 'utf8');
    await notice.command(client, 'invalid'); assert.equal(fs.readFileSync(file, 'utf8'), saved);
});

test('migration status uses an opt-in health projection without sending saved accounts', async () => {
    const { once } = require('node:events');
    const { createHealthServer } = require('../../src/health/httpServer');
    let calls = 0;
    const server = createHealthServer({ state: {}, proxyStartTime: 0, globalCache: new Map(),
        chatTriggerManager: { getTriggers: () => [] }, getActiveUser: () => null, getKeys: () => ({}),
        getServerConfigs: () => [], getLastScanSummary: () => null, getFeatures: () => ({}),
        proxyHealthSnapshot: () => ({}), getHypixelApiUsageSnapshot: () => ({}), getUrchinRateLimitSnapshot: () => ({}),
        hasHypixelApiKeyConfigured: () => false, logger: { log() {}, error() {} },
        getDenickMigrationStatus: () => { calls++; return { state: 'retrying', pendingCount: 4 }; }
    }).start(0);
    await once(server, 'listening');
    try {
        const url = `http://127.0.0.1:${server.address().port}/health`;
        assert(!Object.hasOwn(await (await fetch(url)).json(), 'denickMigration')); assert.equal(calls, 0);
        const response = await (await fetch(`${url}?includeDenicks=1`)).json();
        assert.deepEqual(response.denickMigration, { state: 'retrying', pendingCount: 4 }); assert.equal(calls, 1);
        assert.equal(response.sessionHistory, null);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('350 legacy accounts migrate once, with shared nicknames, bounded pacing and no daily refresh', async () => {
    const rows = Array.from({ length: 350 }, (_, i) => ({ realIGN: `Player${i}`, nicks: [`Nick${i}`, `Alias${i}`] }));
    const { history, historyFile } = store(rows), { clock } = clockFixture(), calls = [];
    const migration = createDenickIdentityMigration({ history, now: () => clock.now,
        setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout,
        resolveIdentity: async name => {
            calls.push(clock.now);
            return { realIGN: name, realUuid: (Number(name.slice(6)) + 1).toString(16).padStart(32, '0') };
        } });
    assert.equal(history.findKnownDenickByNick('Nick0'), null, 'legacy names are not authoritative before migration');
    migration.resume();
    await clock.until(1000);
    assert.equal(calls.length, 1);
    await clock.until(710000);
    assert.equal(calls.length, 350, 'one lookup per real account, not per saved nick');
    assert(calls.slice(1).every((at, i) => at - calls[i] >= 2000));
    assert.equal(history.findKnownDenickByNick('Alias349').realUuid.length, 32);
    await clock.until(3 * 86400000);
    migration.resume(); await clock.until(3 * 86400000 + 10000);
    assert.equal(calls.length, 350, 'verified accounts never get scheduled refreshes');
    migration.close(); await history.flush({ strict: true });
    const reloaded = store(JSON.parse(fs.readFileSync(historyFile))).history;
    assert.equal(reloaded.findKnownDenickByNick('Nick0').realUuid.length, 32);
    const next = createDenickIdentityMigration({ history: reloaded, resolveIdentity: async () => { throw Error('Must not run'); } });
    next.resume(); next.close();
});

test('failed lookups retain durable pending findings, retry twice and recover on restart', async () => {
    const { history, historyFile } = store(), { clock } = clockFixture();
    let count = 0;
    const migration = createDenickIdentityMigration({ history, now: () => clock.now,
        setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout,
        resolveIdentity: async () => { count++; throw failure(); } });
    migration.resume();
    history.appendDenickHistory({ nick: 'FreshNick', realIGN: 'RealPlayer', method: 'manual' });
    assert.equal(history.loadDenickHistoryStore().players.length, 1, 'saving is synchronous and independent of Mojang');
    await clock.until(900000);
    assert.equal(count, 3);
    assert.equal(history.findKnownDenickByNick('FreshNick'), null);
    await history.flush({ strict: true }); migration.close();
    const saved = JSON.parse(fs.readFileSync(historyFile));
    assert.equal(saved[0].identityState, 'pending');
    assert.deepEqual(saved[0].nicks, ['FreshNick']);
    const reloaded = store(saved).history;
    const next = createDenickIdentityMigration({ history: reloaded, now: () => clock.now,
        setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout,
        resolveIdentity: async name => ({ realIGN: name, realUuid: A }) });
    next.resume(); await clock.until(910000); next.close();
    assert.equal(reloaded.findKnownDenickByNick('FreshNick').realUuid, A);
    await reloaded.flush();
});

test('encountered teammates jump ahead of the legacy backlog without bypassing pacing or retry waits', async () => {
    const rows = Array.from({ length: 350 }, (_, i) => ({ realIGN: `Player${i}`, nicks: [`Nick${i}`] }));
    const { history } = store(rows), { clock } = clockFixture(), calls = [];
    const migration = createDenickIdentityMigration({ history, now: () => clock.now,
        setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout,
        resolveIdentity: async name => { calls.push({ name, at: clock.now });
            return { realIGN: name, realUuid: (Number(name.slice(6)) + 1).toString(16).padStart(32, '0') }; } });
    migration.resume(); await clock.until(100);
    for (let i = 0; i < 100; i++) migration.request('Nick349');
    await clock.until(2100);
    assert.deepEqual(calls.map(call => call.name), ['Player0', 'Player349']);
    assert(calls[1].at - calls[0].at >= 2000);
    assert.equal(history.findKnownDenickByNick('Nick349').realName, 'Player349');
    await clock.until(4100);
    assert.equal(calls[2].name, 'Player1', 'the background migration resumes without repeated urgent lookups');
    migration.close(); await history.flush();
});

test('pending saved nicknames remain recognizable after rejoin without exposing the unverified real account', async () => {
    const { history, historyFile } = store();
    history.appendDenickHistory({ nick: 'TeammateNick', realIGN: 'RealTeammate', method: 'party_variation' });
    await history.flush();
    const reloaded = store(JSON.parse(fs.readFileSync(historyFile))).history;
    assert.equal(reloaded.findKnownDenickByNick('TeammateNick'), null);
    assert.equal(reloaded.findPendingDenickByNick('TeammateNick').realName, 'RealTeammate');
    const lookup = createPregameIdentityLookup({ getKnownDenick: reloaded.findKnownDenickByNick,
        getPendingDenick: reloaded.findPendingDenickByNick, isDetectedNick: () => false,
        lookupNick: () => { throw Error('A saved pending nick must not borrow a real account with the same name'); },
        makeFallback: (_, flags) => ({ data: flags }) });
    const result = await lookup('TeammateNick');
    assert(result.data.isNicked);
    assert.equal(result.pregameRealName, undefined);
});

test('encounter priority brings forward a waiting queue but never skips a failed account retry delay', async () => {
    const { clock } = clockFixture(), calls = [];
    const { history } = store([{ realIGN: 'WaitingPlayer', nicks: ['WaitingNick'], identityState: 'pending', identityRetryAt: clock.now + 60000 }]);
    const migration = createDenickIdentityMigration({ history, now: () => clock.now,
        setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout,
        resolveIdentity: async name => { calls.push(name); throw failure(429); } });
    migration.resume(); migration.request('WaitingNick');
    await clock.until(30000); assert.equal(calls.length, 0);
    history.appendDenickHistory({ nick: 'CurrentNick', realIGN: 'CurrentPlayer', method: 'party_variation' });
    await clock.until(30100); assert.deepEqual(calls, ['CurrentPlayer']);
    for (let i = 0; i < 100; i++) migration.request('CurrentNick');
    await clock.until(59000); assert.equal(calls.length, 1);
    await clock.until(60100); assert.deepEqual(calls, ['CurrentPlayer', 'WaitingPlayer']);
    migration.close(); await history.flush();
});

test('fresh saved matches reuse verified cached UUIDs and normal stats promote pending teammates immediately', async () => {
    const { history } = store([], { getVerifiedAccountUuid: name => name === 'CachedFriend' ? A : null });
    history.appendDenickHistory({ nick: 'CachedNick', realIGN: 'CachedFriend', method: 'party_variation' });
    assert.equal(history.findKnownDenickByNick('CachedNick').realUuid, A);
    history.appendDenickHistory({ nick: 'PendingNick', realIGN: 'PendingFriend', method: 'party_variation' });
    history.observeAccountProfile(B, { uuid: A, displayname: 'PendingFriend' });
    assert.equal(history.findKnownDenickByNick('PendingNick'), null);
    history.observeAccountProfile(B, { uuid: B, displayname: 'PendingFriend' });
    assert.equal(history.findKnownDenickByNick('PendingNick').realUuid, B);
    await history.flush();
});

test('only definite missing names retire old mappings; errors and malformed identities do not', async () => {
    for (const error of [failure(404), failure(429), failure(403), failure(503), failure(), null]) {
        const { history } = store([{ realIGN: 'OldName', nicks: ['SavedNick'] }]), { clock } = clockFixture();
        const migration = createDenickIdentityMigration({ history, now: () => clock.now,
            setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout,
            resolveIdentity: async () => { if (error) throw error; return { realUuid: A, realIGN: 'OtherOwner' }; } });
        migration.resume(); await clock.until(100);
        assert.equal(history.loadDenickHistoryStore().players[0].identityState, error?.response?.status === 404 ? 'missing' : 'pending');
        assert.equal(history.loadDenickHistoryStore().players[0].realUuid, undefined);
        assert.equal(projectDenickHistory(history.loadDenickHistoryStore().players).totalPlayers, error?.response?.status === 404 ? 0 : 1);
        migration.close(); await history.flush();
    }
});

test('removals, corrections, shutdown and paused APIs cannot resurrect stale migration work', async () => {
    const { history } = store([{ realIGN: 'OldName', nicks: ['SavedNick'] }]), { clock } = clockFixture();
    let resolve, enabled = false, calls = 0;
    const migration = createDenickIdentityMigration({ history, now: () => clock.now,
        setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout, canRequest: () => enabled,
        resolveIdentity: () => { calls++; return new Promise(done => { resolve = done; }); } });
    migration.resume(); await clock.until(10000); assert.equal(calls, 0);
    enabled = true; migration.resume(); await clock.until(10100); assert.equal(calls, 1);
    history.removeDenickMapping('OldName', 'SavedNick');
    history.appendDenickHistory({ nick: 'SavedNick', realIGN: 'CorrectPlayer', realUuid: B, method: 'manual' });
    resolve({ realIGN: 'OldName', realUuid: A }); await clock.until(11000);
    assert.equal(history.findKnownDenickByNick('SavedNick').realUuid, B);
    assert.equal(history.loadDenickHistoryStore().byUuid.has(A), false);
    history.appendDenickHistory({ nick: 'AnotherNick', realIGN: 'AnotherPlayer', method: 'manual' });
    await clock.until(14000);
    migration.close(); resolve({ realIGN: 'AnotherPlayer', realUuid: A }); await clock.until(20000);
    assert.equal(history.findKnownDenickByNick('AnotherNick'), null);
    await history.flush();
});

test('renames retain UUID ownership, update all nicknames and survive launcher edits and reloads', async () => {
    const { history, historyFile } = store();
    history.appendDenickHistory({ nick: 'SavedNick', realIGN: 'OldName', realUuid: A, method: 'manual' });
    history.appendDenickHistory({ nick: 'SecondNick', realIGN: 'OldName', realUuid: A, method: 'skin' });
    const changes = []; history.subscribe(change => changes.push(change));
    history.observeAccountProfile(A, { uuid: B, displayname: 'WrongPlayer' });
    assert.equal(history.findKnownDenickByNick('SavedNick').realName, 'OldName');
    history.observeAccountProfile(A, { uuid: A, displayname: 'NewName' });
    assert.equal(changes.length, 2);
    for (const nick of ['SavedNick', 'SecondNick']) {
        assert.equal(history.findKnownDenickByNick(nick).realName, 'NewName');
        assert.equal(history.findKnownDenickByNick(nick).realUuid, A);
    }
    history.appendDenickHistory({ nick: 'OtherNick', realIGN: 'OldName', realUuid: B, method: 'skin' });
    assert.equal(history.findKnownDenickByNick('OtherNick').realUuid, B, 'the old IGN can belong to a different account');
    assert(history.removeDenickMapping('NewName', 'SavedNick').removed);
    await history.flush();
    const raw = JSON.parse(fs.readFileSync(historyFile)), projected = projectDenickHistory(raw);
    assert.equal(projected.players.find(row => row.realUuid === A).realIGN, 'NewName');
    const reloaded = store(raw).history;
    assert.equal(reloaded.findKnownDenickByNick('SecondNick').realUuid, A);
    assert.equal(reloaded.findKnownDenickByNick('SavedNick'), null);
});

test('legacy rows resolving to one UUID merge their nicknames and explicit ownership', async () => {
    const { history } = store([{ realIGN: 'OldName', nicks: ['OldNick'], methods: ['manual'],
        manualNicks: { oldnick: '2026-01-01' } }]);
    history.appendDenickHistory({ nick: 'NewNick', realIGN: 'CurrentName', realUuid: A, method: 'skin' });
    const pending = history.loadDenickHistoryStore().byReal.get('oldname');
    assert(history.updateIdentity(pending, { realUuid: A, realIGN: 'OldName' }));
    assert.equal(history.loadDenickHistoryStore().players.length, 1);
    assert.equal(history.findKnownDenickByNick('OldNick').realName, 'CurrentName');
    assert.equal(history.findKnownDenickByNick('OldNick').source, 'manual');
    assert.equal(history.findKnownDenickByNick('NewNick').realUuid, A);
    await history.flush();
});

test('a saved UUID bypasses Mojang and never borrows another owner of the old IGN', async () => {
    const original = axios.get, calls = [], cache = new Map();
    axios.get = async url => { calls.push('mojang'); return { data: { id: B, name: 'OldName' } }; };
    try {
        const { history } = store([{ realIGN: 'OldName', realUuid: A, nicks: ['SavedNick'] }]);
        const stats = createStatsFetch({ globalCache: cache, cacheDuration: 300000,
            getHypixelKey: () => 'fixture', hasHypixelApiKeyConfigured: () => true,
            hypixelApiGet: async url => { const uuid = new URL(url).searchParams.get('uuid'); calls.push(uuid);
                return { data: { player: { uuid, displayname: uuid === A ? 'NewName' : 'OldName', stats: {} } } }; },
            getUrchinRaw: async () => ({}), getAuroraPingRaw: async () => ({}), getHypixelStatusRaw: async () => '',
            makePingData: value => value, mergeUrchinOverride: (a, b) => ({ ...a, ...b }), notifyUrchinOutageOnce() {},
            classifyPlayerLookupError: e => ({ error: true, message: e.message }), playerLookupDeduper: new InFlightDeduper(),
            observeHypixelPlayerData: history.observeAccountProfile });
        const lookup = createPregameIdentityLookup({ lookupNick: async () => { throw Error('Must use saved identity'); },
            lookupReal: (name, known) => stats.getPlayerData(name, { realUuid: known.realUuid }),
            getKnownDenick: history.findKnownDenickByNick, makeFallback: () => ({ data: { isNicked: true } }) });
        const result = await lookup('SavedNick');
        assert.equal(result.data.player.uuid, A);
        assert.equal(result.pregameRealName, 'NewName');
        assert.deepEqual(calls, [A], 'rename updates use the existing stats reply, not another identity request');
        await stats.getPlayerData('NewName', { realUuid: A });
        assert.deepEqual(calls, [A], 'UUID cache survives the name change');
        const ordinary = await stats.getPlayerData('OldName');
        assert.equal(ordinary.data.player.uuid, B, 'ordinary name lookups still resolve the current owner');
        assert.deepEqual(calls, [A, 'mojang', B]);
        const remembered = await stats.resolveSavedIdentity('OldName', { signal: new AbortController().signal });
        assert.equal(remembered.realUuid, B);
        assert.deepEqual(calls, [A, 'mojang', B], 'Migration reuses an already verified name lookup without another request');
        cache.clear(); await stats.getPlayerData('NewName', { realUuid: A });
        assert.equal(calls.at(-1), A, 'normal cache invalidation also clears UUID profiles');
        await history.flush();
    } finally { axios.get = original; }
});

test('cached profiles and live tracker carry the saved UUID independently of tab UUIDs', () => {
    const tracker = createDenickTracker({ isValidPlayerName: () => true, nickKey: name => name.toLowerCase(),
        findKnownDenickByNick: () => ({ realName: 'RealPlayer', realUuid: A }),
        getDenickChatAnnouncementsEnabled: () => false });
    assert(tracker.applyKnownDenickFromHistory('SavedNick'));
    assert.equal(tracker.getAutoDenickResult('SavedNick').realUuid, A);
    tracker.applySavedMappingChange('SavedNick', { realName: 'NewName', realUuid: A });
    assert.equal(tracker.getAutoDenickResult('SavedNick').realUuid, A);
    tracker.rememberKnownDenickInSession('SavedNick', 'NewName', 'manual');
    assert.equal(tracker.getAutoDenickResult('SavedNick').realUuid, A, 'reapplying the same manual match retains its UUID');
    tracker.rememberKnownDenickInSession('SavedNick', 'DifferentPlayer', 'manual');
    assert.equal(tracker.getAutoDenickResult('SavedNick').realUuid, null, 'a correction cannot inherit another account UUID');
});

test('display caches reject the unrelated owner of a reused IGN', () => {
    const other = { data: { player: { uuid: B } } }, correct = { data: { player: { uuid: A } } };
    const cache = new Map([['oldname', other]]);
    assert.equal(getCachedPlayerProfile(cache, 'OldName', A), null);
    cache.set(`uuid:${A}`, correct);
    assert.equal(getCachedPlayerProfile(cache, 'OldName', A), correct);
    assert.equal(getCachedPlayerProfile(cache, 'OldName'), other);
});

test('pregame work discards a removed mapping or follows a correction while stats are in flight', async () => {
    for (const corrected of [false, true]) {
        let known = { realName: 'OldName', realUuid: A }, resolve;
        const lookup = createPregameIdentityLookup({ getKnownDenick: () => known,
            lookupReal: (name, identity) => identity.realUuid === A ? new Promise(done => { resolve = done; })
                : Promise.resolve({ data: { player: { uuid: B, displayname: 'CorrectPlayer' } } }),
            makeFallback: (_, flags) => ({ data: flags }) });
        const request = lookup('SavedNick');
        known = corrected ? { realName: 'CorrectPlayer', realUuid: B } : null;
        resolve({ data: { player: { uuid: A, displayname: 'OldName' } } });
        const result = await request;
        if (corrected) assert.equal(result.data.player.uuid, B);
        else { assert(result.data.isNicked); assert.equal(result.pregameKnownDenick, undefined); }
    }
});

test('skin identity preserves the owner UUID and skin replacement uses it directly', async () => {
    const texture = { profileName: 'OldName', profileId: A, textures: { SKIN: { url: 'https://textures.minecraft.net/texture/synthetic' } } };
    assert.deepEqual(getIdentityFromSkin([{ name: 'textures', value: Buffer.from(JSON.stringify(texture)).toString('base64') }]),
        { realName: 'OldName', realUuid: A });
    const calls = [];
    const resolver = createRealSkinTextureResolver({ httpClient: { get: async url => {
        calls.push(url); return { data: { properties: [{ name: 'textures', value: 'signed-texture', signature: 'signature' }] } };
    } } });
    assert((await resolver.resolve('OldName', A)).length);
    assert.equal(calls.length, 1);
    assert(calls[0].includes(`/profile/${A}`));
    await resolver.resolve('NewName', A); assert.equal(calls.length, 1);
});
