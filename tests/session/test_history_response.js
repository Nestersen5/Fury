'use strict';

const assert = require('node:assert/strict');
const { VERSION, SESSION_FIELDS, GAME_FIELDS, compactHistory, HistoryResponses, HistoryResponseClient } = require('../../src/session/historyResponse');
const { buildLauncherSessionHistory } = require('../../src/session/launcherSessionHistory');
const { sessionDeltaFor } = require('../../src/session/sessionStore');
const { buildCalendarStats } = require('../../src/session/calendarStats');
const now = 1800000000000;
const accounts = [{ uuid: 'a'.repeat(32), name: 'Alpha' }, { uuid: 'b'.repeat(32), name: 'Beta' }];
const counts = Object.fromEntries(require('../../src/session/localStats').FIELDS.map(key => [key, { value: 2, available: true }]));
const entries = accounts.flatMap((account, index) => [false, true].map(local => {
    const session = {
        ...account, id: `${index}-${local}`, startedAt: now - 3600000, lastSeen: now - 1000, endedAt: index ? now : 0,
        baseline: { stats: { Bedwars: { wins_bedwars: 1, games_played_bedwars: 2 } } },
        latest: { stats: { Bedwars: { wins_bedwars: 3, games_played_bedwars: 4 } } },
        ...(local ? { trackingSource: 'local', localTracking: { totals: { BEDWARS: counts } } } : {}),
        games: [{ id: `game-${index}-${local}`, mode: 'BEDWARS', at: now - 1000, result: 'win', verificationStatus: local ? 'local' : 'verified',
            opponents: ['Opponent'], events: [{ type: 'kill', at: now - 1001 }], delta: { stats: { Bedwars: { wins_bedwars: 1 } } } }]
    };
    return { session, delta: sessionDeltaFor(session), active: !session.endedAt };
}));

function differential(history) {
    const small = structuredClone(compactHistory(history, { epoch: 'test', generation: 1, accountKey: null })).history;
    assert.deepEqual(Object.keys(small).sort(), ['calendarSessions', 'sessions']);
    assert.deepEqual(small.calendarSessions, history.calendarSessions);
    for (const [index, session] of history.sessions.entries()) {
        const card = small.sessions[index];
        assert.deepEqual(Object.keys(card).sort(), [...SESSION_FIELDS.filter(key => Object.hasOwn(session, key)), 'games'].sort());
        for (const key of SESSION_FIELDS) assert.deepEqual(card[key], session[key]);
        for (const [i, game] of session.games.entries()) {
            assert.deepEqual(Object.keys(card.games[i]).sort(), GAME_FIELDS.filter(key => Object.hasOwn(game, key)).sort());
            for (const key of GAME_FIELDS) assert.deepEqual(card.games[i][key], game[key]);
        }
        for (const mode of ['', 'BEDWARS', 'DUELS']) for (const result of ['', 'win', 'loss', 'pending', 'unverified']) for (const opponent of ['', 'opponent', 'absent']) {
            const filter = source => source.games.filter(game => (!mode || game.mode === mode)
                && (!result || (['pending', 'unverified'].includes(result) ? game.verificationStatus === result : game.result === result))
                && (!opponent || game.opponents.some(name => name.toLowerCase().includes(opponent)))).map(game => game.id);
            assert.deepEqual(filter(card), filter(session));
        }
    }
    for (const kind of ['daily', 'weekly', 'monthly']) {
        const options = { kind, now, timeZone: 'Europe/Warsaw' };
        assert.deepEqual(buildCalendarStats(small.calendarSessions, options), buildCalendarStats(history.calendarSessions, options));
    }
    return history;
}

(async () => {
    const histories = accounts.map(account => differential(buildLauncherSessionHistory(entries, { account, accountScoped: true, now })));
    differential(buildLauncherSessionHistory([], { now }));
    differential(buildLauncherSessionHistory(entries, { account: { uuid: 'c'.repeat(32), name: 'Missing' }, accountScoped: true, now }));
    const [history] = histories, broker = new HistoryResponses(), client = new HistoryResponseClient();
    const full = { accountKey: accounts[0].uuid, sessionHistory: history, proxyHealth: { sessionHistory: history, liveGame: { connected: true } } };
    for (const capability of [undefined, 0, 2, '1']) assert.equal(broker.respond(1, null, full, capability), full, 'legacy/future capabilities retain full details');
    const response = broker.respond(1, broker.begin(1), full, VERSION);
    assert.equal(response.proxyHealth.sessionHistory, null);
    assert.equal(full.proxyHealth.sessionHistory, history, 'packing must not mutate the input');
    assert.deepEqual(client.accept(structuredClone(response), client.scope).sessionHistory, response.sessionHistory.history);
    const revision = response.sessionHistory.revision, session = history.sessions[0], game = session.games[0];
    const request = { revision, sessionId: session.id, gameId: game.id };
    assert.deepEqual(broker.detail(1, request).game, game);
    const pending = [];
    const delayed = (channel, payload) => new Promise(resolve => pending.push(() => resolve(broker.detail(1, payload))));
    const closedDetail = client.detail(delayed, session.id, game.id);
    client.closeDetail(); pending.shift()();
    assert.equal((await closedDetail).error, 'STALE_SELECTION');
    const lateDetail = client.detail(delayed, session.id, game.id);
    assert.equal(broker.detail(2, request).error, 'STALE_REVISION');
    assert.equal(broker.detail(1, { ...request, revision: { ...revision, accountKey: accounts[1].uuid } }).error, 'STALE_REVISION');
    assert.equal(broker.detail(1, { ...request, gameId: 'missing' }).error, 'NOT_FOUND');
    const oldTicket = broker.begin(1), newer = broker.respond(1, broker.begin(1), full, VERSION);
    assert.deepEqual(broker.respond(1, oldTicket, full, VERSION), { historyStale: true });
    assert.deepEqual(broker.respond(1, oldTicket, { ...full, sessionHistory: null }, VERSION), { historyStale: true }, 'non-history navigation must not restore an old account');
    assert(client.accept(newer, client.scope));
    pending.shift()();
    assert.equal((await lateDetail).error, 'STALE_SELECTION');
    assert.equal(client.accept(response, client.scope), null);
    assert.equal(broker.detail(1, request).error, 'STALE_REVISION');
    const scope = client.scope;
    client.invalidate(broker.invalidate());
    assert.equal(client.accept(newer, scope), null);
    assert.equal(client.accept(newer, client.scope), null, 'invalidation floor survives local clears');
    let finish;
    const mutation = broker.mutate(() => new Promise(resolve => { finish = resolve; }));
    assert.equal(broker.publish(1, broker.begin(1), accounts[0].uuid, history), null, 'cannot publish during a mutation');
    finish(); await mutation;
    const switched = broker.respond(1, broker.begin(1), { ...full, accountKey: accounts[1].uuid, sessionHistory: histories[1] }, VERSION);
    assert(client.accept(switched, client.scope));
    assert(switched.sessionHistory.history.sessions.every(item => item.uuid === accounts[1].uuid));
    assert.equal(broker.detail(1, request).error, 'STALE_REVISION');
    const deleted = broker.respond(1, broker.begin(1), { ...full, sessionHistory: { ...history, sessions: [] } }, VERSION);
    assert.equal(broker.detail(1, { ...request, revision: deleted.sessionHistory.revision }).error, 'NOT_FOUND');
    for (let i = 0; i < 200; i++) broker.respond(1, broker.begin(1), full, VERSION);
    assert.equal(broker.scopes.size, 1, 'polling does not grow the snapshot cache');
    const inFlight = broker.begin(1);
    broker.release(1);
    assert.equal(broker.scopes.size, 0);
    assert.equal(broker.publish(1, inFlight, null, history), null, 'destroyed renderer cannot recreate its cache');
    await assert.rejects(broker.mutate(() => { throw Error('original error'); }), /original error/);
    assert.equal(broker.mutations, 0);
    await assert.rejects(broker.mutate(() => {}, () => { throw Error('closed renderer'); }), /closed renderer/);
    assert.equal(broker.mutations, 0, 'failed notification must not leave the mutation fence locked');
    assert.throws(() => client.accept({ ...response, sessionHistory: { ...response.sessionHistory, version: 2 } }, client.scope), /Unsupported/);
    assert.equal(client.accept({ ...switched, accountKey: accounts[0].uuid }, client.scope), null);
    assert.equal(client.accept(full, client.scope), full, 'old main process fallback');
    console.log('History response: schema, negotiation, local/API/active/empty accounts, filters, calendar, cards, details, revisions, mutation, deletion and bounded retention passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
