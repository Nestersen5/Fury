const assert = require('assert');
const os = require('os');
const path = require('path');

const {
    captureSessionSnapshot,
    diffSessionSnapshots,
    snapshotRegressed,
    deltaIsEmpty,
    activeGamesInDelta,
    hasGameplayMovement,
    numericLeaves
} = require('../../src/session/sessionSnapshot.js');
const { createSessionStore } = require('../../src/session/sessionStore.js');
const { createSessionTracker, deriveResult, gameForMode } = require('../../src/session/sessionTracker.js');
const { createStatsCollector } = require('../../src/stats/collect.js');

// --- shared fixtures -------------------------------------------------------

const UUID_A = 'aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa';
const UUID_B = 'bbbbbbbbbbbb4bbbbbbbbbbbbbbbbbbb';

function tempFile(name) {
    return path.join(os.tmpdir(), `nester_test_${name}_${process.pid}.json`);
}

// A player blob with the handful of keys the collectors read, plus junk that
// must be dropped by the snapshot.
function makePlayer({
    uuid = UUID_A,
    wins = 100,
    losses = 50,
    finals = 400,
    finalDeaths = 200,
    beds = 120,
    bedsLost = 60,
    kills = 900,
    deaths = 700,
    games = 150,
    experience = 500000,
    stars = 100,
    swWins = 20,
    swLosses = 10,
    networkExp = 1000000
} = {}) {
    return {
        player: {
            uuid,
            displayname: 'Tester',
            networkExp,
            karma: 5000,
            achievements: { bedwars_level: stars, skywars_you_re_a_star: 12 },
            stats: {
                Bedwars: {
                    wins_bedwars: wins,
                    losses_bedwars: losses,
                    final_kills_bedwars: finals,
                    final_deaths_bedwars: finalDeaths,
                    beds_broken_bedwars: beds,
                    beds_lost_bedwars: bedsLost,
                    kills_bedwars: kills,
                    deaths_bedwars: deaths,
                    games_played_bedwars: games,
                    winstreak: 5,
                    Experience: experience,
                    // Non-numeric junk the snapshot must discard.
                    practice: { records: { bridging: 1 } },
                    packages: ['a', 'b']
                },
                SkyWars: {
                    wins: swWins,
                    losses: swLosses,
                    kills: 60,
                    deaths: 40,
                    games: 30,
                    assists: 5,
                    wins_mini: 0,
                    losses_mini: 0,
                    kills_mini: 0,
                    deaths_mini: 0,
                    games_mini: 0,
                    assists_mini: 0,
                    time_played: 3600
                },
                Duels: {
                    wins: 10,
                    losses: 5,
                    kills: 40,
                    deaths: 25,
                    rounds_played: 15
                }
            }
        }
    };
}

// Real collectors, wired exactly like proxy.js does, so the delta-vs-ratio
// assertions below exercise the production maths rather than a stand-in.
function makeCollectors() {
    const safeStatNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
    const statValue = (stats = {}, key) => safeStatNumber(stats[key]);
    return createStatsCollector({
        statValue,
        sumStatValues: (stats = {}, keys = []) => keys.reduce((sum, key) => sum + statValue(stats, key), 0),
        ratioValue: (num, den) => num / Math.max(den, 1),
        safeStatNumber,
        bwKey: (mode, stat) => (mode.prefix ? `${mode.prefix}_${stat}_bedwars` : `${stat}_bedwars`),
        getSkyWarsLevelFromXp: () => 0,
        getSkyWarsLevelDelta: () => 0,
        getTopSkyWarsKit: () => null,
        BEDWARS_MODE_DEFS: [{ id: 'overall', label: 'Overall', prefix: '' }],
        SKYWARS_MODE_DEFS: [{ id: 'overall', label: 'Overall', kind: 'overall' }],
        DUELS_MODE_DEFS: [{ id: 'overall', label: 'Overall', prefix: '' }]
    });
}

function makeStore(overrides = {}) {
    const writes = [];
    const store = createSessionStore({
        sessionFile: tempFile('session'),
        writeJsonOffThread: (file, value) => writes.push(value),
        saveDelayMs: 0,
        ...overrides
    });
    return { store, writes };
}

// --- snapshot capture ------------------------------------------------------

{
    const snapshot = captureSessionSnapshot(makePlayer(), { now: () => 1000 });
    assert.strictEqual(snapshot.at, 1000, 'snapshot stamps the injected clock');
    assert.strictEqual(snapshot.uuid, UUID_A, 'snapshot normalizes the uuid');
    assert.strictEqual(snapshot.stats.Bedwars.wins_bedwars, 100);
    assert.strictEqual(snapshot.achievements.bedwars_level, 100);
    assert.ok(!('practice' in snapshot.stats.Bedwars), 'nested objects are dropped');
    assert.ok(!('packages' in snapshot.stats.Bedwars), 'arrays are dropped');
}

{
    // Accepts a bare player object as well as a { player } wrapper.
    const wrapped = captureSessionSnapshot(makePlayer(), { now: () => 1 });
    const bare = captureSessionSnapshot(makePlayer().player, { now: () => 1 });
    assert.deepStrictEqual(bare, wrapped, 'bare player and wrapped lookup agree');
    assert.strictEqual(captureSessionSnapshot(null), null, 'null input yields null');
}

{
    const leaves = numericLeaves({ a: 1, b: 'x', c: null, d: NaN, e: 2.5, f: { g: 1 } });
    assert.deepStrictEqual(leaves, { a: 1, e: 2.5 }, 'only finite numbers survive');
}

// --- delta maths -----------------------------------------------------------

{
    const before = captureSessionSnapshot(makePlayer(), { now: () => 0 });
    const after = captureSessionSnapshot(makePlayer({
        wins: 104, losses: 52, finals: 420, finalDeaths: 210,
        beds: 126, bedsLost: 63, kills: 940, deaths: 730,
        games: 156, experience: 510000, networkExp: 1012000
    }), { now: () => 60000 });

    const delta = diffSessionSnapshots(before, after);
    assert.strictEqual(delta.stats.Bedwars.wins_bedwars, 4);
    assert.strictEqual(delta.stats.Bedwars.final_kills_bedwars, 20);
    assert.strictEqual(delta.spanMs, 60000);
    assert.strictEqual(delta.networkExp, 12000);
    assert.ok(!('winstreak' in delta.stats.Bedwars), 'unchanged keys are omitted');
    assert.ok(!('wins' in delta.stats.SkyWars), 'untouched games produce no keys');

    // The point of the whole design: ratios are computed FROM the deltas.
    const { collectBedwarsStats } = makeCollectors();
    const stats = collectBedwarsStats(delta.stats.Bedwars, { id: 'overall', prefix: '' }, delta.root);
    assert.strictEqual(stats.wins, 4);
    assert.strictEqual(stats.finals, 20);
    assert.strictEqual(stats.fkdr, 2, 'session FKDR is 20 finals / 10 final deaths');
    assert.strictEqual(stats.wlr, 2, 'session WLR is 4 wins / 2 losses');
    assert.strictEqual(stats.bblr, 2, 'session BBLR is 6 beds / 3 beds lost');
    assert.strictEqual(stats.starsGained, 2, '10000 delta XP is 2 stars');
}

{
    // Zero-denominator sessions must not blow up or report Infinity.
    const before = captureSessionSnapshot(makePlayer(), { now: () => 0 });
    const after = captureSessionSnapshot(makePlayer({ finals: 405, finalDeaths: 200 }), { now: () => 1 });
    const delta = diffSessionSnapshots(before, after);
    const { collectBedwarsStats } = makeCollectors();
    const stats = collectBedwarsStats(delta.stats.Bedwars, { id: 'overall', prefix: '' }, delta.root);
    assert.strictEqual(stats.finalDeaths, 0);
    assert.strictEqual(stats.fkdr, 5, '5 finals with 0 deaths reads as 5.00, not Infinity');
    assert.ok(Number.isFinite(stats.fkdr));
}

{
    const before = captureSessionSnapshot(makePlayer(), { now: () => 0 });
    assert.strictEqual(deltaIsEmpty(diffSessionSnapshots(before, before)), true, 'identical snapshots are empty');

    const after = captureSessionSnapshot(makePlayer({ swWins: 21 }), { now: () => 1 });
    const delta = diffSessionSnapshots(before, after);
    assert.strictEqual(deltaIsEmpty(delta), false);
    assert.strictEqual(deltaIsEmpty(delta, 'Bedwars'), true, 'per-game emptiness is independent');
    assert.strictEqual(deltaIsEmpty(delta, 'SkyWars'), false);
    assert.deepStrictEqual(activeGamesInDelta(delta), ['SkyWars']);
}

// Streak records for a mode called tnt_games must not invent Duels activity.
{
    const { compactModes } = require('../../src/session/launcherSessionHistory');
    const stats = { Duels: { best_tnt_games_winstreak: 27, current_tnt_games_winstreak: 2 } };
    assert.deepStrictEqual(activeGamesInDelta({ stats }), []);
    assert.deepStrictEqual(compactModes({ stats }), []);
    stats.Duels.tnt_games_kills = 1;
    assert.deepStrictEqual(activeGamesInDelta({ stats }), ['Duels']);
    assert.strictEqual(compactModes({ stats })[0].mode, 'DUELS');
}

// --- partial API readings --------------------------------------------------

{
    // The reported bug: a snapshot whose SkyWars block came back empty,
    // followed by a normal one, must NOT report the whole SkyWars lifetime as
    // this session's gains.
    const partial = makePlayer();
    delete partial.player.stats.SkyWars;
    const before = captureSessionSnapshot(partial, { now: () => 0 });
    const after = captureSessionSnapshot(makePlayer({ wins: 101 }), { now: () => 60000 });

    assert.strictEqual(before.present.SkyWars, false, 'the missing block is recorded as absent');
    assert.strictEqual(after.present.SkyWars, true);

    const delta = diffSessionSnapshots(before, after);
    assert.deepStrictEqual(delta.stats.SkyWars, {}, 'SkyWars reports nothing rather than a lifetime dump');
    assert.deepStrictEqual(delta.unmeasurable, ['SkyWars'], 'and is flagged unmeasurable');
    assert.strictEqual(delta.stats.Bedwars.wins_bedwars, 1, 'the game that WAS readable still measures fine');
    assert.strictEqual(deltaIsEmpty(delta, 'SkyWars'), true, 'so no SkyWars block renders');
}

{
    // The reverse direction (present -> missing) must not produce negatives.
    const partial = makePlayer();
    delete partial.player.stats.SkyWars;
    const before = captureSessionSnapshot(makePlayer(), { now: () => 0 });
    const after = captureSessionSnapshot(partial, { now: () => 60000 });

    const delta = diffSessionSnapshots(before, after);
    assert.deepStrictEqual(delta.stats.SkyWars, {}, 'no negative lifetime dump either');
    assert.deepStrictEqual(delta.unmeasurable, ['SkyWars']);
    // A vanished monotonic counter is also a regression, so the tracker
    // re-baselines instead of trusting the reading.
    assert.strictEqual(snapshotRegressed(before, after), true, 'a vanished stat block forces a re-baseline');
}

{
    // Legacy snapshots (written before `present` existed) still work.
    const before = captureSessionSnapshot(makePlayer(), { now: () => 0 });
    const after = captureSessionSnapshot(makePlayer({ swWins: 25 }), { now: () => 1 });
    delete before.present;
    delete after.present;
    const delta = diffSessionSnapshots(before, after);
    assert.strictEqual(delta.stats.SkyWars.wins, 5, 'presence is inferred from the key count');
    assert.deepStrictEqual(delta.unmeasurable, []);
}

{
    // A genuinely untouched game stays silent — the normal case.
    const before = captureSessionSnapshot(makePlayer(), { now: () => 0 });
    const after = captureSessionSnapshot(makePlayer({ wins: 104, finals: 420 }), { now: () => 60000 });
    const delta = diffSessionSnapshots(before, after);
    assert.deepStrictEqual(delta.stats.SkyWars, {}, 'BedWars-only play leaves SkyWars empty');
    assert.deepStrictEqual(delta.unmeasurable, [], 'and that is not an unmeasurable case');
    assert.strictEqual(deltaIsEmpty(delta, 'SkyWars'), true);
}

// --- only real gameplay counts as playing a game ----------------------------

{
    // Coins/souls/experience tick from lobby activity and daily rewards. On
    // their own they must NOT make a game look played.
    const before = captureSessionSnapshot(makePlayer(), { now: () => 0 });
    const after = captureSessionSnapshot(makePlayer(), { now: () => 60000 });
    after.stats.SkyWars.coins = (after.stats.SkyWars.coins || 0) + 250;
    after.stats.SkyWars.souls = 12;

    const delta = diffSessionSnapshots(before, after);
    assert.strictEqual(delta.stats.SkyWars.coins, 250, 'the key still appears in the raw delta');
    assert.strictEqual(hasGameplayMovement(delta.stats.SkyWars), false, 'but it is not gameplay');
    assert.strictEqual(deltaIsEmpty(delta, 'SkyWars'), true, 'so SkyWars renders nothing');
    assert.deepStrictEqual(activeGamesInDelta(delta), [], 'and counts as no games played');
}

{
    // A real SkyWars game does register.
    const before = captureSessionSnapshot(makePlayer(), { now: () => 0 });
    const after = captureSessionSnapshot(makePlayer({ swWins: 21 }), { now: () => 60000 });
    const delta = diffSessionSnapshots(before, after);
    assert.strictEqual(hasGameplayMovement(delta.stats.SkyWars), true);
    assert.deepStrictEqual(activeGamesInDelta(delta), ['SkyWars']);
}

{
    // A negative or zero gameplay counter is noise, not a game. This also
    // covers the SkyWars overall collector, which computes
    // max(0, games - games_mini) and would turn a negative games_mini into a
    // phantom "+1 game".
    assert.strictEqual(hasGameplayMovement({ games_mini: -1 }), false, 'a negative counter is not a game');
    assert.strictEqual(hasGameplayMovement({ wins: 0 }), false, 'a zero counter is not a game');
    assert.strictEqual(hasGameplayMovement({ coins: 5000 }), false);
    assert.strictEqual(hasGameplayMovement({ wins: 1 }), true);
    assert.strictEqual(hasGameplayMovement({ final_kills_bedwars: 3 }), true, 'finals count as gameplay');
    assert.strictEqual(hasGameplayMovement({}), false);
    assert.strictEqual(hasGameplayMovement(null), false);
}

// --- regression detection --------------------------------------------------

{
    const before = captureSessionSnapshot(makePlayer({ wins: 100 }), { now: () => 0 });
    const same = captureSessionSnapshot(makePlayer({ wins: 101 }), { now: () => 1 });
    const backwards = captureSessionSnapshot(makePlayer({ wins: 99 }), { now: () => 1 });
    const otherAccount = captureSessionSnapshot(makePlayer({ uuid: UUID_B }), { now: () => 1 });

    assert.strictEqual(snapshotRegressed(before, same), false);
    assert.strictEqual(snapshotRegressed(before, backwards), true, 'a lifetime win count cannot drop');
    assert.strictEqual(snapshotRegressed(before, otherAccount), true, 'a different uuid is a regression');
}

{
    // Winstreak is deliberately NOT monotonic — losing resets it and the
    // negative delta must survive.
    const before = captureSessionSnapshot(makePlayer(), { now: () => 0 });
    const after = captureSessionSnapshot(makePlayer({ losses: 51 }), { now: () => 1 });
    after.stats.Bedwars.winstreak = 0;
    assert.strictEqual(snapshotRegressed(before, after), false, 'winstreak drop is not a regression');
    assert.strictEqual(diffSessionSnapshots(before, after).stats.Bedwars.winstreak, -5);
}

// --- result derivation -----------------------------------------------------

{
    const win = { stats: { Bedwars: { wins_bedwars: 1, final_kills_bedwars: 3 } } };
    const loss = { stats: { Bedwars: { losses_bedwars: 1 } } };
    const neither = { stats: { Bedwars: { final_kills_bedwars: 2 } } };
    const both = { stats: { Bedwars: { wins_bedwars: 1, losses_bedwars: 1 } } };

    assert.strictEqual(deriveResult(win, 'BEDWARS'), 'win');
    assert.strictEqual(deriveResult(loss, 'BEDWARS'), 'loss');
    assert.strictEqual(deriveResult(neither, 'BEDWARS'), null, 'no win/loss movement is undecided');
    assert.strictEqual(deriveResult(both, 'BEDWARS'), null, 'ambiguous movement is undecided');
    assert.strictEqual(gameForMode('SKYWARS'), 'SkyWars');
    assert.strictEqual(gameForMode('LOBBY'), null);
}

// --- store lifecycle -------------------------------------------------------

{
    const { store, writes } = makeStore();
    const snapshot = captureSessionSnapshot(makePlayer(), { now: () => 1000 });
    const session = store.startSession(snapshot);

    assert.ok(session.id, 'session gets an id');
    assert.strictEqual(session.uuid, UUID_A);
    assert.strictEqual(writes.length, 1, 'saveDelayMs 0 writes through immediately');

    store.appendGame(session.id, { at: 2000, mode: 'BEDWARS', result: 'win', delta: { stats: {} } });
    assert.strictEqual(store.findSession(session.id).games.length, 1);
    assert.strictEqual(store.getLastGame(UUID_A).result, 'win');

    // Ending collapses snapshots into a summary so history stays small.
    store.endSession(session.id);
    const ended = store.findSession(session.id);
    assert.strictEqual(ended.baseline, null, 'ended sessions drop their baseline snapshot');
    assert.strictEqual(ended.latest, null);
    assert.ok(ended.summary, 'ended sessions keep a computed summary');
    assert.ok(ended.endedAt > 0);
}

{
    // Completed history keeps only meaningful sessions. A pending API retry
    // is retained until it resolves. Only confirmed empty records are pruned.
    const { store } = makeStore();
    const snapshot = captureSessionSnapshot(makePlayer(), { now: () => 1000 });

    const empty = store.startSession(snapshot);
    assert.strictEqual(store.endSession(empty.id), null, 'a zero-game session is discarded on end');
    assert.strictEqual(store.findSession(empty.id), null);

    const unknown = store.startSession(snapshot);
    store.appendGame(unknown.id, {
        at: 2000,
        mode: 'BEDWARS',
        result: null,
        verificationStatus: 'unverified',
        delta: { stats: { Bedwars: { wins_bedwars: 0 } }, achievements: {} }
    });
    assert.strictEqual(store.endSession(unknown.id), null, 'A known empty session summary is discarded after verification retries');
    assert.strictEqual(store.findSession(unknown.id), null);

    const gained = store.startSession(snapshot);
    store.appendGame(gained.id, {
        at: 3000,
        mode: 'BEDWARS',
        result: null,
        verificationStatus: 'verified',
        delta: { stats: { Bedwars: { final_kills_bedwars: 2 } }, achievements: {} }
    });
    assert.ok(store.endSession(gained.id), 'an unknown result with a real stat gain remains useful');

    const known = store.startSession(snapshot);
    store.appendGame(known.id, {
        at: 4000,
        mode: 'BEDWARS',
        result: 'loss',
        verificationStatus: 'verified',
        delta: { stats: {}, achievements: {} }
    });
    assert.ok(store.endSession(known.id), 'a known game result is retained even when no other stat moved');

    const pending = store.startSession(snapshot);
    const pendingGame = store.appendGame(pending.id, {
        at: 5000,
        mode: 'BEDWARS',
        result: null,
        verificationStatus: 'pending',
        delta: null
    });
    assert.ok(store.endSession(pending.id), 'pending verification must survive session finalization');
    assert.ok(store.findSession(pending.id));
    store.updateGame(pending.id, pendingGame.id, { verificationStatus: 'unverified' });
    assert.strictEqual(store.findSession(pending.id), null, 'An exhausted retry with a known empty summary is pruned');
}

{
    // Resume window: an open, recently touched session is reused; an old one
    // is left alone.
    let clock = 10_000_000;
    const { store } = makeStore({ now: () => clock });
    const snapshot = captureSessionSnapshot(makePlayer(), { now: () => clock });
    const session = store.startSession(snapshot);

    assert.strictEqual(store.findResumableSession(UUID_A, 3600_000)?.id, session.id);
    clock += 7200_000; // two hours later
    assert.strictEqual(store.findResumableSession(UUID_A, 3600_000), null, 'stale sessions are not resumed');
    assert.strictEqual(store.findResumableSession(UUID_A, 10800_000)?.id, session.id, 'a wider window resumes');
    assert.strictEqual(store.findResumableSession(UUID_B, 10800_000), null, 'other accounts never match');
}

{
    // Session and game caps.
    const { store } = makeStore({ maxSessions: 2, maxGamesPerSession: 3 });
    const snapshot = captureSessionSnapshot(makePlayer(), { now: () => 1 });
    const first = store.startSession(snapshot);
    store.startSession(snapshot);
    const third = store.startSession(snapshot);
    assert.strictEqual(store.getSessions().length, 2, 'oldest session is trimmed');
    assert.strictEqual(store.findSession(first.id), null);

    for (let i = 0; i < 5; i += 1) {
        store.appendGame(third.id, { at: 100 + i, mode: 'BEDWARS', delta: { stats: {} } });
    }
    const games = store.findSession(third.id).games;
    assert.strictEqual(games.length, 3, 'game list is capped');
    assert.strictEqual(games[games.length - 1].at, 104, 'newest games are kept');
}

{
    // Individual history removal is durable, while a live session must be
    // ended first so the tracker cannot keep writing to a deleted record.
    const { store } = makeStore();
    const snapshot = captureSessionSnapshot(makePlayer(), { now: () => 1000 });
    const saved = store.startSession(snapshot);
    store.appendGame(saved.id, { at: 2000, mode: 'BEDWARS', result: 'win', delta: { stats: {} } });
    store.endSession(saved.id);

    const removed = store.removeSession(saved.id);
    assert.strictEqual(removed.removed, true, 'one ended session can be removed by id');
    assert.strictEqual(store.findSession(saved.id), null, 'removed session no longer appears in the store');
    assert.strictEqual(store.removeSession(saved.id).reason, 'not_found', 'repeat removal is harmless');

    const active = store.startSession(snapshot);
    assert.strictEqual(store.removeSession(active.id).reason, 'active', 'active sessions require an explicit end first');
    assert.strictEqual(store.findSession(active.id)?.id, active.id, 'refused active removal leaves the session intact');
}

// --- history ---------------------------------------------------------------

{
    // Ending a session keeps a usable delta after the snapshots are dropped.
    let clock = 1000;
    const { store } = makeStore({ now: () => clock });
    const session = store.startSession(captureSessionSnapshot(makePlayer(), { now: () => clock }));
    clock = 61000;
    store.updateLatest(session.id, captureSessionSnapshot(makePlayer({ wins: 104, finals: 420, finalDeaths: 210 }), { now: () => clock }));
    store.appendGame(session.id, { at: clock, mode: 'BEDWARS', result: 'win', delta: { stats: { Bedwars: { wins_bedwars: 4 } } } });
    store.endSession(session.id);

    const [entry] = store.getHistory(UUID_A);
    assert.ok(entry, 'ended sessions appear in history');
    assert.strictEqual(entry.active, false);
    assert.strictEqual(entry.delta.stats.Bedwars.wins_bedwars, 4, 'the summary still carries the delta');
    assert.strictEqual(entry.delta.spanMs, 60000, 'and the span');
    assert.strictEqual(entry.session.baseline, null, 'snapshots are gone');
    assert.ok(entry.delta.root, 'history deltas carry the collector root');
}

{
    // History is newest-first and includes the live session.
    let clock = 1000;
    const { store } = makeStore({ now: () => clock });
    const first = store.startSession(captureSessionSnapshot(makePlayer(), { now: () => clock }));
    store.updateLatest(first.id, captureSessionSnapshot(makePlayer({ wins: 101 }), { now: () => clock + 10 }));
    store.appendGame(first.id, { at: clock + 10, mode: 'BEDWARS', result: 'win', delta: { stats: { Bedwars: { wins_bedwars: 1 } } } });
    store.endSession(first.id);

    clock = 500000;
    const second = store.startSession(captureSessionSnapshot(makePlayer({ wins: 101 }), { now: () => clock }));
    store.updateLatest(second.id, captureSessionSnapshot(makePlayer({ wins: 105 }), { now: () => clock + 10 }));

    const history = store.getHistory(UUID_A);
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].session.id, second.id, 'newest first');
    assert.strictEqual(history[0].active, true, 'the open session is flagged live');
    assert.strictEqual(history[1].active, false);
    assert.strictEqual(history[0].delta.stats.Bedwars.wins_bedwars, 4, 'live delta comes from snapshots');
    assert.strictEqual(history[1].delta.stats.Bedwars.wins_bedwars, 1, 'closed delta comes from the summary');

    assert.strictEqual(store.getHistory(UUID_B).length, 0, 'history is per account');
}

{
    // Abandoned sessions get closed rather than lingering open.
    let clock = 1000;
    const { store } = makeStore({ now: () => clock });
    const abandoned = store.startSession(captureSessionSnapshot(makePlayer(), { now: () => clock }));
    store.updateLatest(abandoned.id, captureSessionSnapshot(makePlayer({ wins: 102 }), { now: () => 2000 }));
    store.appendGame(abandoned.id, { at: 2000, mode: 'BEDWARS', result: 'win', delta: { stats: { Bedwars: { wins_bedwars: 2 } } } });

    clock = 99999999;
    assert.strictEqual(store.closeStaleSessions(UUID_A), 1, 'one session was closed');
    const closed = store.findSession(abandoned.id);
    assert.strictEqual(closed.endedAt, 2000, 'end time is when it was last seen, not now');
    assert.strictEqual(closed.baseline, null, 'snapshots dropped');
    assert.strictEqual(closed.summary.stats.Bedwars.wins_bedwars, 2, 'delta preserved');

    assert.strictEqual(store.closeStaleSessions(UUID_A), 0, 'closing twice is a no-op');
    assert.strictEqual(store.closeStaleSessions(null), 0, 'no uuid, nothing to close');
}

{
    // closeStaleSessions never touches the session you are keeping.
    const { store } = makeStore();
    const snapshot = captureSessionSnapshot(makePlayer(), { now: () => 1 });
    const keep = store.startSession(snapshot);
    const drop = store.startSession(snapshot);
    store.appendGame(drop.id, { at: 2, mode: 'BEDWARS', result: 'loss', delta: { stats: {} } });
    assert.strictEqual(store.closeStaleSessions(UUID_A, keep.id), 1);
    assert.strictEqual(store.findSession(keep.id).endedAt, 0, 'the kept session stays open');
    assert.ok(store.findSession(drop.id).endedAt > 0);
}

// --- tracker lifecycle -----------------------------------------------------

function makeTracker({ players, clock = { value: 1000 }, ...overrides } = {}) {
    const { store } = makeStore({ now: () => clock.value });
    const recaps = [];
    let index = 0;
    const tracker = createSessionTracker({
        store,
        now: () => clock.value,
        gameEndDelayMs: 0, // capture synchronously so tests can await it
        minRefreshIntervalMs: 0,
        fetchOwnStats: async () => {
            const next = players[Math.min(index, players.length - 1)];
            index += 1;
            return next;
        },
        onGameRecap: recap => recaps.push(recap),
        logger: { error: () => {}, warn: () => {} },
        ...overrides
    });
    return { tracker, store, recaps, clock, fetchCount: () => index };
}

(async () => {
    {
        // A finished game produces one recap with the right delta and result.
        const clock = { value: 1000 };
        const { tracker, store, recaps } = makeTracker({
            clock,
            players: [
                makePlayer(),
                makePlayer({ wins: 101, finals: 404, finalDeaths: 201, beds: 121, games: 151 })
            ]
        });

        await tracker.ensureSession();
        tracker.onGameStart({ mode: 'BEDWARS' });
        clock.value = 400000;
        await tracker.onGameEnd({ mode: 'BEDWARS', roster: [{ name: 'Foo', uuid: UUID_B }] });

        assert.strictEqual(recaps.length, 1, 'one recap per finished game');
        const recap = recaps[0];
        assert.strictEqual(recap.game, 'Bedwars');
        assert.strictEqual(recap.record.result, 'win');
        assert.strictEqual(recap.delta.stats.Bedwars.final_kills_bedwars, 4);
        assert.strictEqual(recap.record.durationMs, 399000, 'duration spans game start to end');
        assert.deepStrictEqual(recap.record.opponents, ['Foo'], 'roster names persist on the record');
        assert.deepStrictEqual(recap.roster, [{ name: 'Foo', uuid: UUID_B }], 'uuids ride along on the recap only');
        assert.strictEqual(store.getLastGame(UUID_A).result, 'win');

        // Session delta covers the same movement.
        const sessionDelta = tracker.getSessionDelta();
        assert.strictEqual(sessionDelta.stats.Bedwars.wins_bedwars, 1);
    }

    {
        // A "game end" fired seconds after the game began is a scoreboard
        // flicker (enterBedwarsPregame -> resetMatchState), not a real game.
        // It must not emit a 0s recap for a game still being played.
        const clock = { value: 1000 };
        const { tracker, store, recaps, fetchCount } = makeTracker({
            clock,
            players: [makePlayer(), makePlayer({ wins: 101 })]
        });
        await tracker.ensureSession();
        tracker.onGameStart({ mode: 'BEDWARS' });
        clock.value += 1500; // 1.5s later
        await tracker.onGameEnd({ mode: 'BEDWARS', sessionKey: 1 });

        assert.strictEqual(recaps.length, 0, 'no recap for an implausibly short game');
        assert.strictEqual(store.getLastGame(UUID_A), null, 'and no game row');
        const afterSpurious = fetchCount();

        // The genuine end still works, and still reports the FULL duration —
        // the spurious end must not have cleared the pending game.
        clock.value += 400_000;
        await tracker.onGameEnd({ mode: 'BEDWARS', sessionKey: 1 });
        assert.strictEqual(recaps.length, 1, 'the real end still produces a recap');
        assert.strictEqual(recaps[0].record.durationMs, 401_500, 'duration spans the true game start');
        assert.ok(fetchCount() > afterSpurious, 'and only the real end costs an API call');
    }

    {
        // The host may supply the duration itself (proxy.js owns the
        // authoritative gameStartTime); it wins over the tracker's own.
        const { tracker, recaps } = makeTracker({
            players: [makePlayer(), makePlayer({ wins: 101 })]
        });
        await tracker.ensureSession();
        await tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 300_000 });
        assert.strictEqual(recaps[0].record.durationMs, 300_000, 'supplied duration is used');
    }

    {
        // resetMatchState can fire twice for one game — only one recap.
        const { tracker, recaps } = makeTracker({
            players: [makePlayer(), makePlayer({ wins: 101 }), makePlayer({ wins: 102 })]
        });
        await tracker.ensureSession();
        await tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 300_000, sessionKey: 7 });
        await tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 300_000, sessionKey: 7 });
        assert.strictEqual(recaps.length, 1, 'a repeated end for the same game is ignored');

        await tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 300_000, sessionKey: 8 });
        assert.strictEqual(recaps.length, 2, 'the next game still reports');
    }

    {
        // Unknown duration (proxy started mid-game) still records the game —
        // the card just omits the duration rather than claiming 0s.
        const { tracker, recaps } = makeTracker({
            players: [makePlayer(), makePlayer({ wins: 101 })]
        });
        await tracker.ensureSession();
        await tracker.onGameEnd({ mode: 'BEDWARS' });
        assert.strictEqual(recaps.length, 1, 'an unmeasured game is still recorded');
        assert.strictEqual(recaps[0].record.durationMs, 0, '0 means unknown downstream');
    }

    {
        // Nothing changed: spectated or not yet propagated -> no recap, no row.
        const { tracker, store, recaps } = makeTracker({ players: [makePlayer(), makePlayer()] });
        await tracker.ensureSession();
        tracker.onGameStart({ mode: 'BEDWARS' });
        await tracker.onGameEnd({ mode: 'BEDWARS', roster: [] });
        assert.strictEqual(recaps.length, 0, 'an empty delta produces no recap');
        assert.strictEqual(store.getLastGame(UUID_A), null, 'and no game row');
    }

    {
        // Two games in a row: the second delta measures from the first game's
        // boundary, not from the session baseline.
        const { tracker, recaps } = makeTracker({
            players: [
                makePlayer(),
                makePlayer({ wins: 101, finals: 410 }),
                makePlayer({ wins: 102, finals: 425 })
            ]
        });
        await tracker.ensureSession();
        await tracker.onGameEnd({ mode: 'BEDWARS' });
        await tracker.onGameEnd({ mode: 'BEDWARS' });

        assert.strictEqual(recaps.length, 2);
        assert.strictEqual(recaps[0].delta.stats.Bedwars.final_kills_bedwars, 10);
        assert.strictEqual(recaps[1].delta.stats.Bedwars.final_kills_bedwars, 15, 'second game measures from the first boundary');
        assert.strictEqual(recaps[1].sessionDelta.stats.Bedwars.final_kills_bedwars, 25, 'session total accumulates');
    }

    {
        // A regressed snapshot re-baselines instead of reporting negatives.
        const { tracker, store, recaps } = makeTracker({
            players: [makePlayer({ wins: 100 }), makePlayer({ wins: 40 })]
        });
        const sessionId = await tracker.ensureSession();
        await tracker.onGameEnd({ mode: 'BEDWARS' });

        assert.strictEqual(recaps.length, 0, 'a regression produces no recap');
        const session = store.findSession(sessionId);
        assert.strictEqual(session.baseline.stats.Bedwars.wins_bedwars, 40, 'baseline moved to the new reading');
        assert.strictEqual(session.games.length, 0, 'games were reset with the baseline');
    }

    {
        // Disabled tracker does nothing and burns no API calls.
        const { tracker, recaps, fetchCount } = makeTracker({
            players: [makePlayer(), makePlayer({ wins: 101 })],
            isEnabled: () => false
        });
        tracker.onGameStart({ mode: 'BEDWARS' });
        const result = await tracker.onGameEnd({ mode: 'BEDWARS' });
        assert.strictEqual(result, null);
        assert.strictEqual(recaps.length, 0);
        assert.strictEqual(fetchCount(), 0, 'no snapshot is fetched while disabled');
        assert.strictEqual(await tracker.refresh({ force: true }), null);
    }

    {
        // API unavailable (kill switch / no key): degrade quietly.
        const { tracker, fetchCount } = makeTracker({
            players: [makePlayer()],
            isApiAvailable: () => false
        });
        assert.strictEqual(await tracker.ensureSession(), null, 'no session without a snapshot');
        assert.strictEqual(fetchCount(), 0, 'the fetch is never attempted');
        assert.strictEqual(tracker.getSessionDelta(), null);
    }

    {
        // Refresh throttling: a second call inside the window reuses state.
        const clock = { value: 1000 };
        const { tracker, fetchCount } = makeTracker({
            clock,
            minRefreshIntervalMs: 60000,
            players: [makePlayer(), makePlayer({ wins: 101 }), makePlayer({ wins: 102 })]
        });
        await tracker.refresh({ force: true });
        const afterFirst = fetchCount();
        await tracker.refresh();
        assert.strictEqual(fetchCount(), afterFirst, 'throttled refresh does not re-fetch');
        clock.value += 61000;
        await tracker.refresh();
        assert.ok(fetchCount() > afterFirst, 'refresh works again after the window');
    }

    {
        // Resume: a fresh tracker over the same store continues the session.
        const clock = { value: 5000 };
        const { store } = makeStore({ now: () => clock.value });
        const make = () => createSessionTracker({
            store,
            now: () => clock.value,
            gameEndDelayMs: 0,
            minRefreshIntervalMs: 0,
            fetchOwnStats: async () => makePlayer({ wins: 100 }),
            logger: { error: () => {}, warn: () => {} }
        });

        const first = make();
        const firstId = await first.ensureSession();
        first.detach();

        clock.value += 60_000;
        const second = make();
        const secondId = await second.ensureSession();
        assert.strictEqual(secondId, firstId, 'reconnect inside the window resumes the session');

        clock.value += 10 * 60 * 60 * 1000;
        const third = make();
        const thirdId = await third.ensureSession();
        assert.notStrictEqual(thirdId, firstId, 'reconnect outside the window starts a new session');
    }

    {
        // reset() discards an old zero-game session and opens a new one.
        const { tracker, store } = makeTracker({
            players: [makePlayer(), makePlayer({ wins: 105 }), makePlayer({ wins: 105 })]
        });
        const firstId = await tracker.ensureSession();
        const newId = await tracker.reset();
        assert.notStrictEqual(newId, firstId);
        assert.strictEqual(store.findSession(firstId), null, 'the old zero-game session is discarded');
    }

    {
        // Nonzero summary stats survive even when per-game records are absent.
        const { tracker, store } = makeTracker({
            players: [makePlayer({ wins: 100 }), makePlayer({ wins: 103 })]
        });
        const sessionId = await tracker.ensureSession();
        const endedId = await tracker.finish();
        assert.strictEqual(endedId, sessionId, 'finish returns the session it closed');
        assert.strictEqual(store.findSession(sessionId).summary.stats.Bedwars.wins_bedwars, 3, 'finish preserves real wins without per-game records');
        assert.strictEqual(tracker.getActiveSession(), null, 'finish clears the live session reference');
    }

    {
        // Starting a fresh session (nothing resumable) closes the abandoned
        // one on the way, so history never shows two "live" sessions.
        const clock = { value: 1000 };
        const { store } = makeStore({ now: () => clock.value });
        const make = () => createSessionTracker({
            store,
            now: () => clock.value,
            gameEndDelayMs: 0,
            minRefreshIntervalMs: 0,
            fetchOwnStats: async () => makePlayer(),
            logger: { error: () => {}, warn: () => {} }
        });

        const first = make();
        const firstId = await first.ensureSession();
        first.detach();

        clock.value += 10 * 60 * 60 * 1000; // well past the resume window
        const second = make();
        const secondId = await second.ensureSession();

        assert.notStrictEqual(secondId, firstId);
        assert.strictEqual(store.findSession(firstId), null, 'the abandoned zero-game session was discarded');
        const history = second.getHistory();
        assert.strictEqual(history.length, 1, 'only the new live session appears in history');
        assert.strictEqual(history.filter(entry => entry.active).length, 1, 'exactly one is live');
        assert.strictEqual(history[0].session.id, secondId, 'newest first');
    }

    console.log('test_session_tracker.js: all assertions passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
