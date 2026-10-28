'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { createDenickCommands, parseStatCount } = require('../../src/denick/commands');
const { createDenickTracker } = require('../../src/net/session/denickTracking');
const { getBedwarsScanStats, formatBedwarsScanLine } = require('../../src/stats/scanLine');
const { stripAnsi } = require('../../features/minecraft_chat');

const source = fs.readFileSync(require.resolve('../../proxy.js'), 'utf8');
const start = source.indexOf('        function isAutoDenickAlreadyResolved(');
const end = source.indexOf('        function touchLobbyPlayer(', start);
assert(start >= 0 && end > start);
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const player = (finals = 1000, beds = 500) => ({ data: { player: {
    displayname: 'RealPlayer', achievements: { bedwars_level: 250 },
    stats: { Bedwars: { final_kills_bedwars: finals, beds_broken_bedwars: beds, final_deaths_bedwars: 100, wins_bedwars: 90, losses_bedwars: 30, winstreak: 4 } }
} } });
const candidate = (name = 'RealPlayer') => ({ name, displayName: name, finals: 1000, beds: 500, scanStats: getBedwarsScanStats(player().data.player) });
const match = () => ({ complete: true, candidates: [candidate()] });

function lookupHarness({ lists = { finals: ['realplayer'], beds: ['realplayer'] }, profiles = {}, response, lookup } = {}) {
    const requests = [], verified = [];
    const commands = createDenickCommands({
        axios: { get: async (url, options) => {
            requests.push({ url, options });
            if (response) return response;
            const stat = url.includes('/finals?') ? 'finals' : 'beds';
            return { data: { success: true, data: (lists[stat] || []).map(name => ({ name })) } };
        } },
        sendChat: () => {}, getKeys: () => ({ aurora: 'fixture' }), hasHypixelApiKeyConfigured: () => true,
        cosmeticSearchApiUrl: 'http://fixture.invalid', getCosmeticSearchToken: () => '',
        denickRange: 200, formatInt: String,
        getPlayerData: async (name, options) => {
            verified.push({ name, options });
            return lookup ? lookup(name) : (Object.hasOwn(profiles, name) ? profiles[name] : player());
        },
        getRealNameFromSkin: () => null, isMinecraftUsername: () => true,
        appendDenickHistory: () => {}, parseDenickFilters: () => ({})
    });
    return { find: commands.findDenickCandidatesByStats, requests, verified };
}

function harness({ find = async () => match(), local = true, detected = true } = {}) {
    let now = 1000000, nextTimer = 0;
    const timers = new Map(), messages = [], queries = [], saved = [], announced = [], updates = [];
    const tracker = createDenickTracker({ isValidPlayerName: () => true, nickKey: n => n.toLowerCase() });
    const detectedNames = new Set(detected ? ['hiddennick'] : []), teammates = new Set();
    const context = {
        ...tracker, denickTracker: tracker, autoDenickRetryTimers: new Map(),
        gameActive: true, currentGamemode: 'BEDWARS', gameSessionId: 1,
        lastBedwarsGameSessionId: 1, autoDenickGraceUntil: 0,
        autoStatsDenickEnabled: true, denickChatAnnouncementsEnabled: local, connectionTimersCleared: false,
        Date: { now: () => now }, client: { username: 'Self' }, gameRoster: new Set(['HiddenNick']),
        setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
        clearTimeout: id => timers.delete(id),
        nickKey: name => name.toLowerCase(), parseStatCount, stripAnsi, formatBedwarsScanLine,
        isOwnPlayerName: name => name === 'Self', isSameTeamAsClient: name => teammates.has(name),
        isDetectedNickedPlayer: name => detectedNames.has(name.toLowerCase()),
        isAutoDenickEligibleActor: name => context.gameActive && context.currentGamemode === 'BEDWARS' && name !== 'Self' && !teammates.has(name),
        markNickedPlayer: name => detectedNames.add(name.toLowerCase()),
        getPlayerDataWithNickDetection: async () => ({ data: { isNicked: true } }),
        sendChat: (_, message) => messages.push(stripAnsi(message)),
        findDenickCandidatesByStats: async (targets, options) => { queries.push({ targets, options }); return find(targets, options); },
        appendDenickHistory: entry => saved.push(entry), rememberCurrentGameDenickNames: () => {},
        cleanupDenickAliasDuplicate: () => {}, queueOverlayStatsUpdate: name => updates.push(name),
        isTabStatsActiveInGame: () => true, queueTabStatsUpdate: () => {}, saveCurrentMatchSnapshot: () => {},
        announceSuccessfulDenick: async (name, result, options) => { if (options.isCurrent()) announced.push({ name, result }); }
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    const record = async (stat, value, name = 'HiddenNick') => { context.recordAutoDenickStat(name, stat, value); await flush(); };
    const advance = async ms => {
        now += ms;
        for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
        await flush();
    };
    return { context, tracker, teammates, timers, messages, queries, saved, announced, updates, record, advance };
}

test('lookup verifies a single stat at ±100, ranks candidates, and keeps the existing discovery range', async () => {
    const h = lookupHarness({ lists: { finals: ['upper', 'outside', 'lower', 'nearest'] }, profiles: {
        upper: player(1100), outside: player(1101), lower: player(900), nearest: player(990)
    } });
    const result = await h.find({ finals: 1000 }, { verifyRange: 100, includeScanStats: true });
    assert.deepEqual(result.candidates.map(c => c.name), ['nearest', 'upper', 'lower']);
    assert.equal(result.complete, true);
    assert(h.requests[0].url.includes('range=800&max=100'));
    assert.equal(h.requests[0].options.timeout, 10000);
    assert(h.verified.every(v => v.options.includeErrors));
    assert.equal(result.candidates[0].scanStats.stars, 250);
    assert.equal((await h.find({ finals: 1000 })).candidates.length, 4, 'manual lookup retains its existing default range');
});

test('beds-only verification and combined intersection both respect ±100 on every provided stat', async () => {
    const h = lookupHarness({ lists: { finals: ['same', 'finalsonly', 'wrongbeds'], beds: ['SAME', 'wrongbeds', 'bedsonly'] }, profiles: {
        same: player(900, 600), wrongbeds: player(1000, 601), bedsonly: player(99999, 400)
    } });
    assert.deepEqual((await h.find({ beds: 500 }, { verifyRange: 100 })).candidates.map(c => c.name), ['same', 'bedsonly']);
    assert.deepEqual((await h.find({ finals: 1000, beds: 500 }, { verifyRange: 100 })).candidates.map(c => c.name), ['same']);
});

test('upstream and verification failures remain errors instead of completed no-match searches', async () => {
    for (const response of [{ data: { success: false } }, { data: { success: true, data: null } }]) {
        assert((await lookupHarness({ response }).find({ finals: 1000 })).error);
    }
    for (const profile of [null, { error: true, errorType: 'hypixel_rate_limited' }, { data: { lookupFailed: true, player: {} } }]) {
        assert((await lookupHarness({ profiles: { realplayer: profile } }).find({ finals: 1000 })).error);
    }
    const removed = await lookupHarness({ profiles: { realplayer: { error: true, errorType: 'player_not_found' } } }).find({ finals: 1000 });
    assert.equal(removed.complete, true);
    assert.equal(removed.candidates.length, 0);
    const empty = await lookupHarness({ lists: { finals: [] } }).find({ finals: 1000 });
    assert.equal(empty.complete, true);
    assert.equal(empty.candidates.length, 0);
});

test('truncated searches cannot establish uniqueness, duplicate names do not create extra matches, and stale work stops', async () => {
    const names = Array.from({ length: 16 }, (_, i) => `player${i}`);
    const limited = await lookupHarness({ lists: { finals: names } }).find({ finals: 1000 });
    assert.equal(limited.complete, false);
    assert.equal(limited.candidates.length, 15);
    const capped = await lookupHarness({ lists: { finals: Array(100).fill('realplayer') } }).find({ finals: 1000 });
    assert.equal(capped.complete, false);
    assert.equal(capped.candidates.length, 1);
    const duplicates = await lookupHarness({ lists: { finals: ['realplayer', 'REALPLAYER'] } }).find({ finals: 1000 });
    assert.equal(duplicates.complete, true);
    assert.equal(duplicates.candidates.length, 1);
    const stale = lookupHarness();
    assert.equal((await stale.find({ finals: 1000 }, { isCurrent: () => false })).cancelled, true);
    assert.equal(stale.requests.length, 0);
});

test('one-stat matches are tentative and cannot save, rename, update overlays, or broadcast', async () => {
    for (const stat of ['finals', 'beds']) {
        const h = harness();
        await h.record(stat, 1000);
        assert.equal(h.queries.length, 1);
        assert.equal(h.queries[0].options.verifyRange, 100);
        assert.equal(h.messages.length, 2);
        assert.match(h.messages[0], /Checking HiddenNick using 1,000/);
        assert.match(h.messages[1], /Possible match:.*RealPlayer.*FKDR:.*WLR:.*WS:/);
        assert(!h.messages[1].includes('✔'));
        assert.equal(h.saved.length, 0);
        assert.equal(h.announced.length, 0);
        assert.equal(h.updates.length, 0);
        assert.equal(h.context.autoDenickResults.size, 0);
        await h.record(stat, 1001);
        await h.advance(60000);
        assert.equal(h.queries.length, 1);
        assert.equal(h.messages.length, 2);
    }
});

test('no match, ambiguity, and incomplete single-stat searches wait silently for new evidence', async () => {
    for (const result of [{ complete: true, candidates: [] }, { complete: true, candidates: [candidate(), candidate('Other')] }, { complete: false, candidates: [candidate()] }]) {
        const h = harness({ find: async () => result });
        await h.record('finals', 1000);
        assert.match(h.messages[1], /Waiting for their bed count/);
        await h.record('finals', 1001);
        assert.equal(h.queries.length, 1);
        await h.record('beds', 500);
        assert.equal(h.queries.length, 2);
        assert.match(h.messages.at(-1), /Could not confidently denick/);
        await h.record('beds', 501);
        await h.advance(60000);
        assert.equal(h.queries.length, 2);
        assert.equal(h.saved.length, 0);
    }
});

test('second stat upgrades immediately, confirms once, and stores the searched counts', async () => {
    const h = harness();
    h.context.observeAutoDenickChat("Victim was HiddenNick's final #1,000. FINAL KILL!");
    await flush();
    h.context.observeAutoDenickChat('BED DESTRUCTION > Red Bed was bed #500 destroyed by HiddenNick!');
    await flush();
    assert.equal(h.queries.length, 2);
    assert.equal(h.saved.length, 1);
    assert.equal(h.saved[0].stats.finals, 1000);
    assert.equal(h.saved[0].stats.beds, 500);
    assert.equal(h.announced.length, 1);
    assert.equal(h.context.getAutoDenickResult('HiddenNick').realName, 'RealPlayer');
    await h.record('finals', 1001);
    assert.equal(h.queries.length, 2);
    assert.equal(h.saved.length, 1);
});

test('second stat arriving during a search discards the tentative result and starts combined lookup', async () => {
    const first = deferred();
    const h = harness({ find: targets => targets.beds === undefined ? first.promise : Promise.resolve(match()) });
    await h.record('finals', 1000);
    await h.record('beds', 500);
    assert.equal(h.queries.length, 1);
    first.resolve(match());
    await flush();
    assert.equal(h.queries.length, 2);
    assert.equal(h.saved.length, 1);
    assert(!h.messages.some(line => line.includes('Possible match')));
});

test('only errors retry at the existing 30-second spacing without repeated notices', async () => {
    let calls = 0;
    const h = harness({ find: async () => {
        if (++calls === 1) throw new Error('timeout');
        if (calls === 2) return { error: 'rate limited', candidates: [] };
        return match();
    } });
    await h.record('finals', 1000);
    assert.equal(h.timers.size, 1);
    await h.record('finals', 1001);
    await h.advance(29999);
    assert.equal(h.queries.length, 1);
    await h.advance(1);
    assert.equal(h.queries.length, 2);
    assert.equal(h.messages.filter(m => m.includes('Will retry')).length, 1);
    await h.advance(30000);
    assert.equal(h.queries.length, 3);
    assert.equal(h.messages.filter(m => m.includes('Checking')).length, 1);
    assert.match(h.messages.at(-1), /Possible match/);
    assert.equal(h.timers.size, 0);
    assert.equal(h.saved.length, 0);
});

test('second stat cancels a pending single-stat retry and does not inherit its cooldown', async () => {
    const h = harness({ find: async targets => targets.beds === undefined ? { error: 'offline' } : match() });
    await h.record('finals', 1000);
    assert.equal(h.timers.size, 1);
    await h.record('beds', 500);
    assert.equal(h.queries.length, 2);
    assert.equal(h.saved.length, 1);
    assert.equal(h.timers.size, 0);
    await h.advance(30000);
    assert.equal(h.queries.length, 2);
});

test('late results cannot cross session, mapping, skin, teammate, setting, or connection boundaries', async () => {
    for (const invalidate of [
        h => { h.context.gameSessionId++; },
        h => { h.tracker.applySavedMappingChange('HiddenNick', null); },
        h => { h.tracker.rememberKnownDenickInSession('HiddenNick', 'SkinPlayer', 'skin'); },
        h => { h.teammates.add('HiddenNick'); },
        h => { h.context.autoStatsDenickEnabled = false; },
        h => { h.context.connectionTimersCleared = true; },
        h => { h.context.autoDenickStats.clear(); }
    ]) {
        const next = deferred();
        const current = harness({ find: targets => targets.beds === undefined ? Promise.resolve({ complete: true, candidates: [] }) : next.promise });
        await current.record('finals', 1000);
        await current.record('beds', 500);
        invalidate(current);
        next.resolve(match());
        await flush();
        assert.equal(current.saved.length, 0);
        assert.equal(current.announced.length, 0);
    }
});

test('production lookup and automatic stages agree on ±100 and do not save a single-stat match', async () => {
    const lookup = lookupHarness({ profiles: { realplayer: player(1100, 400) } });
    const h = harness({ find: lookup.find });
    await h.record('finals', 1000);
    assert.match(h.messages.at(-1), /Possible match/);
    assert.equal(h.saved.length, 0);
    await h.record('beds', 500);
    assert.equal(h.saved.length, 1);
    assert.equal(h.saved[0].stats.matchedFinals, 1100);
    assert.equal(h.saved[0].stats.matchedBeds, 400);
    assert.equal(lookup.requests.length, 3, 'one single-stat search, followed by both searches');
});

test('configuration errors do not start background retries or repeated notices', async () => {
    const h = harness({ find: async () => ({ error: 'missing keys', retryable: false, candidates: [] }) });
    await h.record('finals', 1000);
    await h.record('finals', 1001);
    assert.equal(h.timers.size, 0);
    assert.equal(h.queries.length, 1);
    assert.match(h.messages.at(-1), /Check your Hypixel and Aurora API keys/);
    await h.advance(30000);
    assert.equal(h.queries.length, 1);
});

test('quiet mode, unknown nick verification, and snapshot clones retain their contracts', async () => {
    const quiet = harness({ local: false });
    await quiet.record('beds', 500);
    await quiet.record('finals', 1000);
    assert.equal(quiet.messages.length, 0);
    assert.equal(quiet.saved.length, 1);
    const unknown = harness({ detected: false });
    await unknown.record('beds', 500);
    assert.equal(unknown.queries.length, 1);
    const live = unknown.context.autoDenickStats.get('hiddennick');
    live.inFlight = true;
    const copy = unknown.context.cloneAutoDenickObservation(live, 2);
    copy.attempts.beds.complete = false;
    assert.equal(live.attempts.beds.complete, true);
    assert.equal(copy.inFlight, false);
    assert.equal(copy.sessionId, 2);
});

test('post-game combined errors retry only inside the existing grace period; cleanup cancels timers', async () => {
    const h = harness({ find: async () => ({ error: 'offline' }) });
    await h.record('finals', 1000);
    await h.record('beds', 500);
    h.context.gameActive = false;
    h.context.gameSessionId++;
    h.context.autoDenickGraceUntil = 1060000;
    await h.advance(30000);
    assert.equal(h.queries.length, 3);
    await h.advance(31000);
    assert.equal(h.queries.length, 3);
    assert.equal(h.timers.size, 0);
    const disconnected = harness({ find: async () => ({ error: 'offline' }) });
    await disconnected.record('finals', 1000);
    disconnected.context.clearAutoDenickRetryTimers();
    assert.equal(disconnected.timers.size, 0);
});
