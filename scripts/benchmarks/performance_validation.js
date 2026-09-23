'use strict';

// Analysis only. Production modules are read, never rewritten. Experimental
// variants exist only in this benchmark process and are not application imports.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const FIXED_NOW = 1800000000000;
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function replaceOnce(text, from, to) {
    assert.strictEqual(text.split(from).length, 2, `Source changed: ${from.slice(0, 80)}`);
    return text.replace(from, to);
}
function isolatedModule(file, text = source(file), overrides = {}) {
    const filename = path.join(ROOT, file), nativeRequire = createRequire(filename);
    const localRequire = name => Object.hasOwn(overrides, name) ? overrides[name] : nativeRequire(name);
    const module = { exports: {} };
    new Function('require', 'module', 'exports', '__filename', '__dirname', text)(
        localRequire, module, module.exports, filename, path.dirname(filename));
    return module.exports;
}
function fixedClock(fn) {
    const original = Date.now;
    Date.now = () => FIXED_NOW;
    try { return fn(); } finally { Date.now = original; }
}
function stats(samples) {
    const sorted = samples.slice().sort((a, b) => a - b);
    return { samplesMs: samples, medianMs: sorted[Math.floor(sorted.length / 2)],
        minMs: sorted[0], maxMs: sorted.at(-1) };
}
function timed(fn, count = 7) {
    fn();
    const samples = [];
    for (let i = 0; i < count; i++) {
        global.gc?.();
        const start = performance.now(); fn(); samples.push(performance.now() - start);
    }
    return stats(samples);
}
function paired(baseline, candidate, count = 7) {
    baseline(); candidate();
    const times = [[], []];
    for (let i = 0; i < count; i++) for (const index of i % 2 ? [1, 0] : [0, 1]) {
        global.gc?.();
        const start = performance.now();
        (index ? candidate : baseline)();
        times[index].push(performance.now() - start);
    }
    return { baseline: stats(times[0]), experimental: stats(times[1]) };
}

function historyExperiment() {
    let code = source('src/session/gameEvents.js');
    code = replaceOnce(code, 'function dedupeGameEvents(events = []) {', `
let benchmarkCache = null;
function dedupeGameEvents(events = []) {
    // No caching of clock-sensitive inputs. Preserve the original first AND
    // second normalizations: they are not necessarily idempotent at text limits.
    const reusable = benchmarkCache && Array.isArray(events)
        && events.every(event => event && typeof event.at === 'number' && event.at > 0);
    if (reusable && benchmarkCache.has(events)) return benchmarkCache.get(events);
    const result = originalDedupeGameEvents(events);
    if (reusable) benchmarkCache.set(events, result);
    return result;
}
function originalDedupeGameEvents(events = []) {`);
    code += '\nmodule.exports.benchmarkScope = fn => { const previous = benchmarkCache; benchmarkCache = new WeakMap(); try { return fn(); } finally { benchmarkCache = previous; } };';
    const events = isolatedModule('src/session/gameEvents.js', code);
    const history = isolatedModule('src/session/launcherSessionHistory.js', undefined, { './gameEvents.js': events });
    const build = history.buildLauncherSessionHistory;
    history.buildLauncherSessionHistory = (...args) => typeof args[1]?.encounterLookup === 'function'
        ? build(...args) : events.benchmarkScope(() => build(...args));
    return { events, history };
}

function recorderExperiment() {
    let code = source('src/recorder/packetRecorder.js');
    code = replaceOnce(code, 'const ring = [];', 'const ring = []; let ringHead = 0;');
    code = replaceOnce(code, `        let drop = 0;
        while (drop < ring.length && ring[drop].t < cutoff) drop += 1;
        if (drop > 0) ring.splice(0, drop);`, `        while (ringHead < ring.length && ring[ringHead].t < cutoff) ring[ringHead++] = null;
        if (ringHead > 4096 && ringHead * 2 >= ring.length) {
            ring.splice(0, ringHead); ringHead = 0;
        }`);
    code = replaceOnce(code, 'if (!buffering) ring.length = 0;', 'if (!buffering) { ring.length = 0; ringHead = 0; }');
    code = replaceOnce(code, 'bufferedEvents: ring.length', 'bufferedEvents: ring.length - ringHead');
    code = replaceOnce(code, 'const buffered = ring.length;', 'const buffered = ring.length - ringHead;');
    code = replaceOnce(code, 'ring.forEach(record => writeSessionLine(session, record));',
        'for (let index = ringHead; index < ring.length; index++) writeSessionLine(session, ring[index]);');
    return isolatedModule('src/recorder/packetRecorder.js', code);
}

function installExperiment(kind) {
    const put = (file, exports) => { const id = require.resolve(path.join(ROOT, file)); require.cache[id] = { id, filename: id, loaded: true, exports }; };
    if (kind === 'history') {
        const experiment = historyExperiment();
        put('src/session/gameEvents.js', experiment.events);
        put('src/session/launcherSessionHistory.js', experiment.history);
    } else if (kind === 'recorder') put('src/recorder/packetRecorder.js', recorderExperiment());
}

function loadFixture(file) {
    const text = fs.readFileSync(file, 'utf8');
    const raw = JSON.parse(text);
    const storeModule = require(path.join(ROOT, 'src/session/sessionStore'));
    const store = fixedClock(() => storeModule.normalizeStore(raw, 0, 250));
    const groups = new Map();
    for (const session of store.sessions) {
        const key = session.uuid || session.name;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(session);
    }
    const sessions = [...groups.values()].sort((a, b) => b.length - a.length)[0] || [];
    const entries = fixedClock(() => sessions.slice().sort((a, b) => b.startedAt - a.startedAt)
        .map(session => ({ session, delta: storeModule.sessionDeltaFor(session), active: !session.endedAt })).filter(row => row.delta));
    return { text, raw, store, entries, storeModule, metadata: { sha256: sha(text), bytes: Buffer.byteLength(text),
        accounts: groups.size, totalRetainedSessions: store.sessions.length, selectedSessions: sessions.length,
        selectedGames: sessions.reduce((n, s) => n + s.games.length, 0),
        selectedEvents: sessions.reduce((n, s) => n + s.games.reduce((m, g) => m + g.events.length, 0), 0) } };
}

function historySemantics(baseline, experimental, entries) {
    let comparisons = 0;
    function check(data, options = {}) {
        const before = JSON.stringify(data);
        const left = fixedClock(() => baseline.buildLauncherSessionHistory(data, { now: FIXED_NOW, limit: 0, ...options }));
        const right = fixedClock(() => experimental.buildLauncherSessionHistory(data, { now: FIXED_NOW, limit: 0, ...options }));
        assert.strictEqual(JSON.stringify(right), JSON.stringify(left));
        assert.strictEqual(JSON.stringify(data), before, 'Input must not be mutated');
        comparisons++;
    }
    check(entries);
    check(entries, { limit: 1 });
    check(entries, { account: { name: 'Nobody', uuid: 'f'.repeat(32) }, accountScoped: true });
    const types = ['kill', 'final_kill', 'bed_break', 'victory', 'defeat', 'note', 'BAD'];
    let seed = 13985;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    for (let index = 0; index < 60; index++) {
        const events = Array.from({ length: index % 10 === 0 ? 600 : 40 }, (_, i) => ({
            type: types[random() % types.length], at: i % 13 ? 10000 + i : [0, -1, 'bad'][index % 3],
            offsetMs: Math.floor(i / 2) * 1000, actor: i % 2 ? 'Tester' : 'Other', victim: 'Target',
            targetTeam: i % 2 ? 'Grey' : 'Red', actorTeam: 'Red', source: 'chat', confidence: 'confirmed',
            rawText: i % 5 ? '  hello\r\n world  ' : 'x'.repeat(319) + ' trailing', note: 'n'.repeat(239) + ' tail'
        }));
        events.push(...events.slice(0, 5));
        const game = { id: 'g', at: 10000, mode: ['BEDWARS', 'SKYWARS', 'DUELS'][index % 3],
            events, verificationStatus: ['verified', 'pending', 'unverified'][index % 3],
            metadata: { team: 'Red', disconnected: index % 2 === 0, observedFromStart: index % 4 !== 0 },
            delta: index % 2 ? { stats: { Bedwars: { wins_bedwars: 1 } } } : null };
        const session = { id: 's', name: 'Tester', startedAt: 1000, endedAt: index % 2 ? 20000 : 0,
            lastSeen: 18000, games: [game] };
        const data = [{ session, active: !session.endedAt, delta: { stats: { Bedwars: { wins_bedwars: 1 } } } }];
        check(data);
        game.result = 'win'; game.verificationStatus = 'verified'; game.events.push({ type: 'victory', at: 19000 });
        check(data); // Delayed updates with identical input object identities.
    }
    const e = require(path.join(ROOT, 'src/session/gameEvents'));
    const once = e.dedupeGameEvents([{ type: 'note', at: 1000, rawText: 'x'.repeat(319) + ' trailing' }]);
    const twice = e.dedupeGameEvents(once);
    assert.notStrictEqual(once[0].rawText, twice[0].rawText);
    const clockFixture = [{ active: true, delta: { stats: {} }, session: { id: 'clock', name: 'Tester', startedAt: 1,
        games: [{ id: 'g', mode: 'BEDWARS', events: [{ type: 'victory', at: -1 }, { type: 'note', at: 0 }] }] } }];
    function advancingClock(module) {
        const original = Date.now; let calls = 0;
        Date.now = () => FIXED_NOW + calls++;
        try { return { json: JSON.stringify(module.buildLauncherSessionHistory(clockFixture, { now: FIXED_NOW })), calls }; }
        finally { Date.now = original; }
    }
    assert.deepStrictEqual(advancingClock(experimental), advancingClock(baseline)); comparisons++;
    function mutatingCallback(module) {
        const record = { id: 'g', mode: 'BEDWARS', opponents: ['Other'], events: [{ type: 'victory', at: 1000 }] };
        const data = [{ active: true, delta: { stats: {} }, session: { id: 'callback', name: 'Tester', startedAt: 1, games: [record] } }];
        let calls = 0;
        const result = module.buildLauncherSessionHistory(data, { now: FIXED_NOW, encounterLookup: () => {
            calls++; record.events.push({ type: 'kill', actor: 'Tester', victim: 'Other', at: 2000 }); return null;
        } });
        return { json: JSON.stringify(result), calls };
    }
    assert.deepStrictEqual(mutatingCallback(experimental), mutatingCallback(baseline)); comparisons++;
    return { comparisons, fullJsonEqual: true, inputsUnchanged: true, advancingClockAndCallbacksPreserved: true,
        rejectedShortcut: 'Normalization is not idempotent: truncation can leave a trailing space removed by a later pass.' };
}

function runHistory(fixture, baselineDirectory = null) {
    const current = require(path.join(ROOT, 'src/session/launcherSessionHistory'));
    const baseline = baselineDirectory ? isolatedModule('src/session/launcherSessionHistory.js',
        fs.readFileSync(path.join(baselineDirectory, 'launcherSessionHistory.js'), 'utf8'), {
            './gameEvents.js': isolatedModule('src/session/gameEvents.js',
                fs.readFileSync(path.join(baselineDirectory, 'gameEvents.js'), 'utf8'))
        }) : current;
    const experimental = baselineDirectory ? current : historyExperiment().history;
    const semantics = historySemantics(baseline, experimental, fixture.entries);
    const options = { now: FIXED_NOW, limit: 0 };
    const build = fn => () => fixedClock(() => fn(fixture.entries, options));
    const projection = paired(build(baseline.buildLauncherSessionHistory), build(experimental.buildLauncherSessionHistory));
    const output = build(baseline.buildLauncherSessionHistory)();
    return { comparison: baselineDirectory ? 'Saved pre-change source versus current production' : 'Production versus experiment',
        baselineSourceHashes: baselineDirectory ? Object.fromEntries(['gameEvents.js', 'launcherSessionHistory.js']
            .map(file => [file, sha(fs.readFileSync(path.join(baselineDirectory, file)))])) : null,
        semantics, projection, serialize: timed(() => JSON.stringify(output)), payloadBytes: Buffer.byteLength(JSON.stringify(output)),
        normalizeStore: timed(() => fixedClock(() => fixture.storeModule.normalizeStore(fixture.raw, 0, 250))),
        historyEntries: timed(() => fixedClock(() => fixture.store.sessions.map(session => fixture.storeModule.sessionDeltaFor(session)))) };
}

function catalogReader(read, cached) {
    const { buildAccountCatalog, normalizeAccount } = require(path.join(ROOT, 'src/accounts/launcherAccounts'));
    if (!cached) {
        // Execute the actual launcher functions with isolated collaborators;
        // importing launcher.js would start Electron and service side effects.
        const launcher = source('launcher.js');
        const readSource = launcher.slice(launcher.indexOf('function readJsonFile('), launcher.indexOf('function readPersistedSessionHistory('));
        const catalogSource = launcher.slice(launcher.indexOf('function getLauncherAccounts('), launcher.indexOf('function selectedLauncherAccount('));
        assert(readSource && catalogSource);
        const readJsonFile = new Function('fs', readSource + '\nreturn readJsonFile;')({ readFileSync: read });
        let auth = [], remembered = null;
        const get = new Function('readJsonFile', 'SESSION_DATA_FILE', 'removedAccounts', 'buildAccountCatalog', 'getAuthAccounts', 'reminderAccounts',
            catalogSource + '\nreturn getLauncherAccounts;')(readJsonFile, 'virtual-session-file', { filter: rows => rows }, buildAccountCatalog,
            () => auth, { selected: () => remembered });
        return (authAccounts = [], reminder = null) => { auth = authAccounts; remembered = reminder; return get(); };
    }
    let lastText = null, identities = [];
    return (authAccounts = [], remembered = null) => {
        let sessions = [];
        try {
            const text = read();
            if (cached && text === lastText) sessions = identities;
            else {
                const raw = JSON.parse(text);
                sessions = Array.isArray(raw?.sessions) ? raw.sessions : Array.isArray(raw) ? raw : [];
                if (cached) { identities = sessions.map(normalizeAccount).filter(Boolean); lastText = text; sessions = identities; }
            }
        } catch { lastText = null; identities = []; }
        return buildAccountCatalog({ sessions, authAccounts: authAccounts.filter(account => account.folderExists || account.uuid), remembered });
    };
}
function launcherSemantics() {
    let content = '', failing = false;
    const read = () => { if (failing) throw new Error('EACCES'); return content; };
    const baseline = catalogReader(read, false), candidate = catalogReader(read, true);
    const uuid = '1'.repeat(32), other = '2'.repeat(32);
    const cases = [JSON.stringify({ sessions: [{ name: 'Alice', uuid }, { name: 'Bob', uuid: other }] }),
        JSON.stringify({ sessions: [{ name: 'Carol', uuid }, { name: 'Bob', uuid: other }] }),
        '{broken', '', 'null', '{}', JSON.stringify([{ name: 'Legacy' }]),
        JSON.stringify({ sessions: [{ name: 'Legacy' }, { name: 'Legacy', uuid }, { name: 'Legacy', uuid: other },
            { name: '', profileName: 'Alternate', uuid }, null, 'StringName'] })];
    let comparisons = 0;
    for (const text of cases) for (const error of [false, false, true, false]) {
        content = text; failing = error;
        const auth = [{ username: 'Alice', uuid, state: comparisons % 2 ? 'expired' : 'valid', folderExists: true }];
        assert.deepStrictEqual(candidate(auth, { name: 'Remembered' }), baseline(auth, { name: 'Remembered' }));
        const mutated = candidate(); if (mutated[0]) mutated[0].name = 'Mutated';
        assert.deepStrictEqual(candidate(), baseline(), 'Caller mutations must not poison cached identities');
        comparisons++;
    }
    const a = JSON.stringify({ sessions: [{ name: 'Alice' }] }), b = a.replace('Alice', 'Bobby');
    assert.equal(a.length, b.length); content = a; candidate(); content = b;
    assert.deepStrictEqual(candidate(), baseline()); comparisons++;
    return { comparisons, equal: true, cases: ['unchanged contents', 'changed auth and remembered identity', 'legacy arrays',
        'UUID/name conflicts', 'same-length content replacement', 'corrupt/missing/unreadable then recovery', 'caller mutation'],
        limitation: 'Full file is still read. Timestamp-only cache and asynchronous launcherState reuse are not validated.' };
}
function runLauncher(file) {
    const baseline = catalogReader(() => fs.readFileSync(file, 'utf8'), false);
    const candidate = catalogReader(() => fs.readFileSync(file, 'utf8'), true);
    assert.deepStrictEqual(candidate(), baseline());
    return { semantics: launcherSemantics(), sessionIdentityCatalog: paired(baseline, candidate),
        freshCacheMiss: paired(baseline, () => catalogReader(() => fs.readFileSync(file, 'utf8'), true)()),
        readUtf8: timed(() => fs.readFileSync(file, 'utf8')),
        readAndParse: timed(() => JSON.parse(fs.readFileSync(file, 'utf8'))),
        scope: 'Session-derived account catalog only; auth scanning, removed-account filtering, reminders and IPC are excluded.' };
}

function recorderSemantics(baseline, experimental) {
    function trace(module, maxEvents, failWrites) {
        let clock = 100000, calls = 0;
        const files = new Map(), results = [];
        const recorder = module.createPacketRecorder({ dir: ROOT, now: () => clock, maxEvents,
            createWriteStream: file => ({ on() {}, end() {}, write(chunk) {
                if (failWrites && ++calls === 2) throw new Error('synthetic write failure');
                files.set(path.basename(file), (files.get(path.basename(file)) || '') + chunk); return true;
            } }) });
        const record = () => recorder.observe({ entityId: 7, dX: 1, dY: 0, dZ: 1, onGround: true }, { name: 'rel_entity_move' });
        results.push(recorder.clip({ player: 'Early', label: 'test' }));
        recorder.setBuffering(true, 5); record(); clock += 5000; record();
        results.push(recorder.getBufferInfo()); // Strict cutoff retains the first packet.
        clock++; record(); results.push(recorder.getBufferInfo());
        clock += 60000; results.push(recorder.getBufferInfo());
        results.push(recorder.clip({ player: 'Idle', label: 'test' })); // No eager expiry during idle/clip.
        recorder.stopAll();
        recorder.setBuffering(true, 300); record();
        recorder.setBuffering(true, 5); results.push(recorder.getBufferInfo()); record();
        for (let i = 0; i < 14000; i++) { clock++; record(); }
        results.push(recorder.getBufferInfo());
        results.push(recorder.clip({ player: 'Tester', label: 'test' }));
        recorder.observeOwn({ x: 2, y: 3, z: 4, onGround: false }, { name: 'position' });
        recorder.mark('marker'); recorder.stopAll();
        recorder.setBuffering(false); results.push(recorder.getBufferInfo());
        recorder.setBuffering(true, 5); record(); results.push(recorder.getBufferInfo());
        recorder.stopAll();
        return { files: [...files], results };
    }
    for (const cap of [20, 400000]) for (const fail of [false, true]) {
        assert.deepStrictEqual(trace(experimental, cap, fail), trace(baseline, cap, fail));
    }
    return { traces: 4, jsonlBytesAndReturnValuesEqual: true,
        cases: ['exact cutoff', 'idle clipping without eager expiry', 'window change', 'compaction', 'disable/re-enable', 'event cap', 'write error', 'own movement', 'markers'] };
}
function runRecorder() {
    const baseline = require(path.join(ROOT, 'src/recorder/packetRecorder'));
    const experimental = recorderExperiment();
    const semantics = recorderSemantics(baseline, experimental), runs = [];
    for (const seconds of [5, 60, 300]) {
        const samples = [[], []];
        for (let trial = 0; trial < 5; trial++) for (const index of trial % 2 ? [1, 0] : [0, 1]) {
            let now = 100000;
            const recorder = (index ? experimental : baseline).createPacketRecorder({ dir: ROOT, now: () => now });
            recorder.setBuffering(true, seconds);
            const data = { entityId: 1, dX: 1, dY: 0, dZ: 1, onGround: true }, meta = { name: 'rel_entity_move' };
            for (let i = 0; i < seconds * 1000; i++) { now = 100000 + i; recorder.observe(data, meta); }
            global.gc?.();
            const start = performance.now();
            for (let i = 0; i < 5000; i++) { now = 100000 + seconds * 1000 + i; recorder.observe(data, meta); }
            samples[index].push(performance.now() - start);
            assert.equal(recorder.getBufferInfo().bufferedEvents, seconds * 1000 + 1);
            recorder.setBuffering(false);
        }
        runs.push({ windowSeconds: seconds, packetsPerSecond: 1000, measuredPackets: 5000,
            baseline: stats(samples[0]), experimental: stats(samples[1]) });
        console.log(JSON.stringify({ progress: 'recorder', ...runs.at(-1) }));
    }
    // A short large-window sample may never compact. Also measure two complete
    // candidate compaction cycles, without GC between chunks, to expose spikes.
    let now = 100000;
    const recorder = experimental.createPacketRecorder({ dir: ROOT, now: () => now });
    recorder.setBuffering(true, 300);
    const data = { entityId: 1, dX: 1, dY: 0, dZ: 1, onGround: true }, meta = { name: 'rel_entity_move' };
    for (let i = 0; i < 300000; i++) { now++; recorder.observe(data, meta); }
    global.gc?.();
    const chunks = [];
    for (let chunk = 0; chunk < 130; chunk++) {
        const start = performance.now();
        for (let i = 0; i < 5000; i++) { now++; recorder.observe(data, meta); }
        chunks.push(performance.now() - start);
    }
    assert.equal(recorder.getBufferInfo().bufferedEvents, 300001);
    recorder.setBuffering(false);
    return { semantics, runs, experimentalCompactionStress: { packets: 650000, chunkPackets: 5000, ...stats(chunks) },
        caveat: 'Synthetic back-to-back replay CPU time; not a measured live-game stall or observed packet rate.' };
}

function runTests() {
    const suites = ['tests/session/test_launcher_session_history.js', 'tests/session/test_session_game_events.js', 'tests/session/test_calendar_stats.js',
        'tests/session/test_session_tracker.js', 'tests/session/test_session_enhancements.js', 'tests/session/test_game_recap.js', 'tests/session/test_local_session_tracking.js',
        'tests/session/test_session_submode_stats.js', 'tests/session/test_session_mode_breakdown.js', 'tests/session/test_empty_session_cleanup.js', 'tests/accounts/test_launcher_accounts.js'];
    const results = [];
    for (const experiment of ['baseline', 'history']) for (const suite of suites) {
        const code = `${experiment === 'baseline' ? '' : `require(${JSON.stringify(__filename)}).installExperiment('history');`}require(${JSON.stringify(path.join(ROOT, suite))});`;
        const result = spawnSync(process.execPath, ['-e', code], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
        results.push({ suite, experiment, status: result.status, error: result.error?.message || null,
            output: result.status === 0 ? 'passed' : (result.stderr + result.stdout).slice(-4000) });
    }
    for (const experiment of ['baseline', 'recorder']) {
        const code = `${experiment === 'baseline' ? '' : `require(${JSON.stringify(__filename)}).installExperiment('recorder');`}require(${JSON.stringify(path.join(ROOT, 'tests/features/test_packet_recorder.js'))});`;
        const result = spawnSync(process.execPath, ['-e', code], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
        results.push({ suite: 'tests/features/test_packet_recorder.js', experiment, status: result.status, error: result.error?.message || null,
            output: result.status === 0 ? 'passed' : (result.stderr + result.stdout).slice(-4000) });
    }
    return results;
}

async function runConditional() {
    let downloads = 0, writes = 0;
    const app = { use() {}, get() {}, post() {}, listen() {} };
    const express = () => app; express.json = () => () => {};
    const code = source('cosmetic_search_api.js') + '\nmodule.exports = { searchCosmetics };';
    const service = isolatedModule('cosmetic_search_api.js', 'const process = {env:{AURORA_API_KEY:"synthetic"}};\n' + code, {
        express, axios: { get: async () => { downloads++; await new Promise(resolve => setImmediate(resolve));
            return { data: { data: [{ name: 'Synthetic', activeWoodType: 'oak' }] } }; } },
        fs: { existsSync: () => false, writeFileSync: () => { writes++; } },
        './src/storage/runtimePaths.js': { dataPath: () => 'virtual-cache.json' }
    });
    const results = await Promise.all(Array.from({ length: 8 }, () => service.searchCosmetics({ wood: 'oak' })));
    assert(results.every(row => row.totalMatches === 1));
    assert.equal(downloads, 8); assert.equal(writes, 8);

    const { Writable } = require('stream');
    const stream = new Writable({ highWaterMark: 64, write(chunk, encoding, callback) { /* Deliberately stalled sink. */ } });
    const { createPacketRecorder } = require(path.join(ROOT, 'src/recorder/packetRecorder'));
    const recorder = createPacketRecorder({ dir: ROOT, now: () => 100000, createWriteStream: () => stream });
    recorder.start({ player: 'Synthetic', label: 'test' });
    for (let i = 0; i < 5000; i++) {
        recorder.observe({ entityId: 1, dX: 1, dY: 0, dZ: 1, onGround: true }, { name: 'rel_entity_move' });
        if (i % 1000 === 999) recorder.flushNow();
    }
    const pendingBytes = stream.writableLength;
    assert(pendingBytes > stream.writableHighWaterMark);
    recorder.stopAll(); stream.destroy();
    return { cosmeticMisses: { concurrentRequests: 8, upstreamDownloads: downloads, diskWrites: writes,
        decision: 'Reproduced; no deduplication prototype approved. Shared snapshot/failure and forced-refresh semantics require a contract decision.' },
        backlogs: { recorderPendingBytes: pendingBytes, recorderHighWaterMarkBytes: 64,
            decision: 'Architectural exposure reproduced using stalled consumers; normal-workload overload and behavior-preserving mitigation remain unproven.' } };
}

function productionHashes() {
    const files = fs.readdirSync(ROOT).filter(name => /\.(?:js|html|css)$/.test(name) && !name.startsWith('test_'));
    function visit(relative) {
        for (const item of fs.readdirSync(path.join(ROOT, relative), { withFileTypes: true })) {
            const next = path.join(relative, item.name);
            if (item.isDirectory()) visit(next); else if (/\.js$/.test(item.name)) files.push(next);
        }
    }
    for (const dir of ['src', 'features']) visit(dir);
    return Object.fromEntries(files.sort().map(file => [file, sha(fs.readFileSync(path.join(ROOT, file)))]));
}
async function main() {
    const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
    const section = args.section || 'all';
    assert(['all', 'history', 'launcher', 'recorder', 'tests', 'conditional'].includes(section));
    const file = path.resolve(args.fixture || path.join(ROOT, 'session_data.json'));
    const before = productionHashes();
    const results = { generatedAt: new Date().toISOString(), section,
        environment: { node: process.version, platform: process.platform, arch: process.arch,
            cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gcBetweenSamples: Boolean(global.gc) },
        methodology: 'Serial warm runs; paired experiments alternate order; setup and optional forced GC excluded. No real network calls. No production source writes.' };
    if (['all', 'history', 'launcher'].includes(section)) {
        // The running application can update session_data.json. Use one private
        // temporary snapshot for both variants; never write to the live file.
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-performance-fixture-'));
        const snapshot = path.join(folder, 'sessions.json');
        try {
            fs.writeFileSync(snapshot, fs.readFileSync(file), { flag: 'wx' });
            const fixture = loadFixture(snapshot); results.fixture = { ...fixture.metadata, temporarySnapshot: true };
            if (section !== 'launcher') results.history = runHistory(fixture, args['baseline-dir']);
            if (section !== 'history') results.launcher = runLauncher(snapshot);
            assert.equal(sha(fs.readFileSync(snapshot)), fixture.metadata.sha256, 'Snapshot changed during benchmark');
            results.fixture.liveFileChangedDuringRun = sha(fs.readFileSync(file)) !== fixture.metadata.sha256;
        } finally {
            if (fs.existsSync(snapshot)) fs.unlinkSync(snapshot);
            fs.rmdirSync(folder);
        }
    }
    if (['all', 'recorder'].includes(section)) results.recorder = runRecorder();
    if (['all', 'conditional'].includes(section)) results.conditional = await runConditional();
    if (['all', 'tests'].includes(section)) results.tests = runTests();
    assert.deepStrictEqual(productionHashes(), before, 'Production files changed during validation');
    results.productionUnchanged = { verified: true, sourceFiles: Object.keys(before).length };
    if (args.output) {
        const output = path.resolve(args.output); fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
    }
    console.log(JSON.stringify(results));
    if (results.tests?.some(test => test.status !== 0)) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { installExperiment, historyExperiment, recorderExperiment };
