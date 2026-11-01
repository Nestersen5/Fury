'use strict';

// Explicit, bounded live experiment. Reuses Fury's production scheduler with
// only its concurrency constant changed in memory; never alters app settings.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const axios = require('axios');

const root = path.resolve(__dirname, '../..');
const limits = [1, 2, 3, 4, 5, 6, 8, 16];
const playersPerBatch = 16, rounds = 3, warmupCount = 4;
const windowMs = 300000, playerQuietMs = 600000;
const directory = path.join(root, 'output/hypixel-live-concurrency');
const sourceFile = path.join(root, 'features/hypixel_api_client.js');
const source = fs.readFileSync(sourceFile, 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timestamp = value => typeof value === 'number' ? value : Date.parse(value);
const quantile = (list, p) => list.length ? [...list].sort((a, b) => a - b)[Math.ceil(p * list.length) - 1] : null;

function random(seed) {
    let state = seed >>> 0;
    return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
function shuffle(list, seed) {
    const next = random(seed), result = [...list];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
}
function collectPlayers(file, now, ledger = []) {
    const seen = new Map();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const session of data.sessions || []) for (const game of session.games || []) {
        const at = timestamp(game.at);
        if (!Number.isFinite(at)) continue;
        for (const player of game.roster || []) {
            if (player.nicked) continue;
            const uuid = String(player.uuid || '').replace(/-/g, '').toLowerCase();
            if (/^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/.test(uuid)) seen.set(uuid, Math.max(at, seen.get(uuid) || 0));
        }
    }
    const recent = new Set(ledger.filter(x => now - x.at < playerQuietMs).map(x => x.player));
    return [...seen].filter(([uuid, at]) => at < now - playerQuietMs && !recent.has(hash(uuid)))
        .sort((a, b) => b[1] - a[1]).map(([uuid]) => uuid);
}
function loadClient(cap, seed, transport, key) {
    const pattern = /const HYPIXEL_API_BURST_CONCURRENCY = \d+;/g;
    assert.equal([...source.matchAll(pattern)].length, 1);
    const module = { exports: {} }, math = Object.create(Math);
    math.random = random(seed);
    vm.runInNewContext(source.replace(pattern, `const HYPIXEL_API_BURST_CONCURRENCY = ${cap};`), {
        module, exports: module.exports, require: createRequire(sourceFile), Date, Math: math,
        URL, setTimeout, clearTimeout, console
    }, { filename: sourceFile });
    return module.exports.createHypixelApiClient({ axios: { get: transport }, getKeys: () => ({ hypixel: key }),
        getGameState: () => ({ gameActive: true }), logger: { log() {}, warn() {}, error() {} } });
}
function loadKey(dataDirectory) {
    const lines = fs.readFileSync(path.join(dataDirectory, 'statmod_key.txt'), 'utf8').split(/\r?\n/);
    for (const label of ['hypixel api key', 'hypixel']) {
        const line = lines.find(x => x.slice(0, x.indexOf(':')).trim().toLowerCase() === label);
        const value = line?.slice(line.indexOf(':') + 1).trim();
        if (value) return value;
    }
    if (!lines.some(x => x.includes(':'))) return lines[0]?.trim() || '';
    return '';
}

async function run({ live = false } = {}) {
    const dataDirectory = process.env.FURY_DATA_DIR || root;
    const ledgerFile = path.join(directory, 'requests.jsonl');
    const ledger = fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x)) : [];
    const seed = 20261101;
    const candidates = collectPlayers(path.join(dataDirectory, 'session_data.json'), Date.now(), ledger).slice(0, 2048);
    const players = shuffle(candidates, seed).slice(0, playersPerBatch * limits.length * rounds + warmupCount);
    assert.equal(players.length, playersPerBatch * limits.length * rounds + warmupCount, 'Need enough eligible distinct real players');
    assert.equal(new Set(players).size, players.length);
    const key = loadKey(dataDirectory);
    assert(key, 'Configure a Hypixel key in Fury before running this test');
    const settings = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'server_config.json'), 'utf8'));
    const healthUrl = `http://127.0.0.1:${Number(settings.healthPort) || 3100}/health`;
    const health = async () => (await axios.get(healthUrl, { timeout: 2000 })).data;
    const startHealth = await health();
    const order = shuffle(limits, seed + 1);
    const plan = Array.from({ length: rounds }, (_, round) => order.slice(round * 3 % order.length).concat(order.slice(0, round * 3 % order.length)));
    console.log(JSON.stringify({ mode: live ? 'live' : 'preflight-only', batches: limits.length * rounds, playersPerBatch,
        distinctPlayers: players.length, limits, order: plan, productionConcurrency: startHealth.hypixelUsage?.queue?.concurrency,
        gameActive: startHealth.liveGame?.gameActive, candidatePool: candidates.length, keyConfigured: true }));
    if (!live) return;
    fs.mkdirSync(directory, { recursive: true });
    const lockFile = path.join(directory, 'running.lock');
    if (fs.existsSync(lockFile)) {
        const pid = Number(fs.readFileSync(lockFile, 'utf8'));
        let running = false;
        try { process.kill(pid, 0); running = true; } catch {}
        assert(!running, 'Another live experiment is already running');
        fs.unlinkSync(lockFile);
    }
    const lock = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(lock, String(process.pid)); fs.closeSync(lock);
    // Fury's queue timers are intentionally unref'ed. A standalone experiment
    // needs a lifetime owner while no HTTP socket is active between starts.
    const lifetime = setInterval(() => {}, 10000);
    const controllers = new Set(), batches = [], warmup = [];
    const report = { startedAt: new Date().toISOString(), mode: 'live HTTPS /v2/player', runtime: process.versions,
        sourceHash: hash(source), limits, rounds, playersPerBatch, order: plan, distinctPlayers: players.length,
        priorLedgerRequests: ledger.length,
        productionConcurrency: startHealth.hypixelUsage?.queue?.concurrency,
        methodology: ['Disjoint randomly assigned real-player batches; no UUID is repeated in this run.',
            'Saved non-nicked UUIDs last seen at least ten minutes ago; recent experiment UUIDs also excluded.',
            'Real monotonic time; actual production scheduler, 200 ms base spacing and seeded +/-15% jitter.',
            'Fresh isolated queue per batch; shared experiment budget and upstream quota gates persist across batches.',
            'One HTTPS attempt per player; no local profile cache, cache-busting parameters or automatic retries.',
            'Server/edge cache state is observed when headers expose it; a cache miss is not guaranteed.',
            'Only the initial warm-up is fixed; later quota pauses and connection reuse vary between batches.',
            'Measures Hypixel queue/response time only; no Urchin, UUID resolution, Scan delay or Minecraft rendering.',
            'Different player payloads and changing network/server conditions remain sources of variance.'],
        batches, warmup, pauses: [], status: 'running' };
    const output = path.join(directory, 'results.json');
    if (fs.existsSync(output)) fs.copyFileSync(output, path.join(directory, `prior-${Date.now()}.json`));
    let fatal = null, limit = 300, remaining = null, resetAt = 0, ownActive = 0;
    const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
    const abort = reason => { fatal ||= reason; for (const controller of controllers) controller.abort(); };
    const onInterrupt = () => abort('interrupted');
    process.once('SIGINT', onInterrupt);
    function noteHeaders(headers = {}) {
        const numeric = name => { const value = headers[name]; return value === undefined ? null : Number(value); };
        const l = numeric('ratelimit-limit'), r = numeric('ratelimit-remaining'), seconds = numeric('ratelimit-reset');
        if (Number.isFinite(l) && l > 0) limit = Math.min(300, l);
        if (Number.isFinite(r)) remaining = remaining === null ? r : Math.min(remaining, r);
        if (Number.isFinite(seconds) && seconds > 0) resetAt = Date.now() + seconds * 1000;
    }
    noteHeaders({ 'ratelimit-limit': startHealth.hypixelUsage?.headers?.limit,
        'ratelimit-remaining': startHealth.hypixelUsage?.headers?.remaining,
        'ratelimit-reset': (startHealth.hypixelUsage?.headers?.resetInMs || 0) / 1000 });
    async function waitForCapacity(count) {
        const started = Date.now(); let announced = false;
        while (!fatal) {
            const h = await health(), now = Date.now(), usage = h.hypixelUsage || {};
            if (resetAt && now >= resetAt + 1000) { remaining = null; resetAt = 0; }
            const ownFive = ledger.filter(x => now - x.at < windowMs).length;
            const ownMinute = ledger.filter(x => now - x.at < 60000).length;
            const ownLimit = Math.min(200, Math.floor(limit * 2 / 3)), minuteLimit = Math.min(80, ownLimit);
            const reserve = Math.max(16, Math.ceil(limit / 5));
            const busy = h.liveGame?.gameActive || h.liveGame?.bedwarsPregameActive || h.liveGame?.scanActive
                || usage.queue?.active || usage.queue?.queued || usage.queue?.cooldownInMs || usage.recent429;
            const budget = ownFive + count > ownLimit || ownMinute + count > minuteLimit
                || ownFive + (usage.lastFiveMinutes || 0) + count > limit - reserve
                || (remaining !== null && remaining < count + reserve);
            if (!busy && !budget) {
                if (announced) report.pauses.push({ ms: now - started, reason: 'gameplay_or_quota_headroom' });
                return { proxyRequestsBefore: (usage.keyPool || []).reduce((n, x) => n + x.requests, 0),
                    headerRemaining: remaining, ownFive, ownMinute };
            }
            if (!announced) { console.log(JSON.stringify({ waiting: true, gameBusy: Boolean(busy), quotaWait: budget })); announced = true; }
            if (now - started > 12 * 60000) throw Error('Idle/quota wait exceeded twelve minutes');
            await sleep(5000);
        }
        throw Error('Experiment stopped');
    }
    async function batch(cap, ids, round, isWarmup = false) {
        const before = await waitForCapacity(ids.length);
        const controller = new AbortController(); controllers.add(controller);
        const records = [], start = performance.now(); let active = 0, peak = 0;
        const client = loadClient(cap, seed + Math.max(0, round), async (url, options) => {
            if (fatal || options.signal?.aborted) throw Object.assign(Error('Stopped'), { code: 'ERR_CANCELED' });
            const uuid = new URL(url).searchParams.get('uuid');
            assert(ids.includes(uuid));
            assert(!ledger.some(x => x.player === hash(uuid) && Date.now() - x.at < playerQuietMs), 'A player must not be requested again');
            const at = Date.now(); ledger.push({ player: hash(uuid), at });
            fs.appendFileSync(ledgerFile, JSON.stringify(ledger.at(-1)) + '\n');
            if (remaining !== null) remaining--;
            const request = { index: records.length, queuedMs: performance.now() - start, at, status: 0, ok: false };
            records.push(request); peak = Math.max(peak, ++active); ownActive++;
            const sent = performance.now();
            try {
                const response = await axios.get(url, { ...options, timeout: 5000 });
                request.httpMs = performance.now() - sent; request.status = response.status;
                noteHeaders(response.headers);
                const returnedUuid = String(response.data?.player?.uuid || '').replace(/-/g, '').toLowerCase();
                request.ok = response.status === 200 && response.data?.success === true && returnedUuid === uuid;
                request.hasBedwars = Boolean(response.data?.player?.stats?.Bedwars);
                request.jsonBytes = Buffer.byteLength(JSON.stringify(response.data));
                request.reusedSocket = Boolean(response.request?.reusedSocket);
                request.headers = Object.fromEntries(['age', 'cf-cache-status', 'cache-control', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset']
                    .filter(name => response.headers[name] !== undefined).map(name => [name, String(response.headers[name]).slice(0, 160)]));
                if (!request.ok) request.error = 'invalid_or_missing_player';
                return response;
            } catch (error) {
                request.httpMs = performance.now() - sent; request.status = error.response?.status || 0;
                request.error = String(error.code || 'REQUEST_FAILED').slice(0, 64);
                noteHeaders(error.response?.headers);
                if ([401, 403, 429].includes(request.status)) abort(`HTTP_${request.status}`);
                throw error;
            } finally { active--; ownActive--; request.responseMs = performance.now() - start; }
        }, key);
        const pending = ids.map(uuid => client.hypixelApiGet(`https://api.hypixel.net/v2/player?uuid=${uuid}`, {
            apiPriority: 'game', timeout: 5000, signal: controller.signal
        }));
        const settled = await Promise.allSettled(pending);
        const completeMs = performance.now() - start;
        controllers.delete(controller);
        const after = await health();
        const result = { cap, round, warmup: isWarmup, completeMs,
            firstMs: records.filter(x => x.ok).length ? Math.min(...records.filter(x => x.ok).map(x => x.responseMs)) : null,
            medianHttpMs: quantile(records.map(x => x.httpMs), .5), p95HttpMs: quantile(records.map(x => x.httpMs), .95),
            meanJsonBytes: records.reduce((n, x) => n + (x.jsonBytes || 0), 0) / Math.max(1, records.length),
            peakConcurrency: peak, requests: records.length, successes: records.filter(x => x.ok).length,
            failures: ids.length - records.filter(x => x.ok).length, settledRejections: settled.filter(x => x.status === 'rejected').length,
            before, after: { gameActive: after.liveGame?.gameActive, pregame: after.liveGame?.bedwarsPregameActive,
                proxyRequests: (after.hypixelUsage?.keyPool || []).reduce((n, x) => n + x.requests, 0) }, records };
        // Exclude trials whose network overlapped gameplay/new proxy requests.
        result.contaminated = Boolean(result.after.gameActive || result.after.pregame || result.after.proxyRequests !== before.proxyRequestsBefore);
        assert(peak <= cap); assert.equal(ownActive, 0);
        if (result.failures) fatal ||= 'A batch contained unavailable player stats';
        (isWarmup ? warmup : batches).push(result); save();
        console.log(JSON.stringify({ cap, round, completeMs: Math.round(result.completeMs), firstMs: Math.round(result.firstMs),
            medianHttpMs: Math.round(result.medianHttpMs), peak, successes: result.successes, failures: result.failures, contaminated: result.contaminated }));
    }
    try {
        save();
        await batch(2, players.splice(0, warmupCount), -1, true);
        for (let round = 0; round < rounds && !fatal; round++) for (const cap of plan[round]) {
            if (fatal) break;
            await batch(cap, players.splice(0, playersPerBatch), round);
        }
        report.status = fatal ? 'stopped' : 'complete';
        report.stopReason = fatal;
    } catch (error) {
        report.status = 'stopped'; report.stopReason = String(error.message).slice(0, 200);
    } finally {
        abort('finished'); process.removeListener('SIGINT', onInterrupt); clearInterval(lifetime);
        report.finishedAt = new Date().toISOString();
        report.productionSourceUnchanged = fs.readFileSync(sourceFile, 'utf8') === source;
        report.actualRequests = warmup.concat(batches).reduce((n, x) => n + x.requests, 0);
        report.summary = limits.map(cap => {
            const trials = batches.filter(x => x.cap === cap && !x.contaminated && x.failures === 0);
            return { cap, validTrials: trials.length, medianCompleteMs: quantile(trials.map(x => x.completeMs), .5),
                minCompleteMs: trials.length ? Math.min(...trials.map(x => x.completeMs)) : null,
                maxCompleteMs: trials.length ? Math.max(...trials.map(x => x.completeMs)) : null,
                medianFirstMs: quantile(trials.map(x => x.firstMs), .5), medianHttpMs: quantile(trials.map(x => x.medianHttpMs), .5),
                peakConcurrency: trials.length ? Math.max(...trials.map(x => x.peakConcurrency)) : null };
        });
        save(); fs.unlinkSync(lockFile);
        console.log(JSON.stringify({ status: report.status, stopReason: report.stopReason, actualRequests: report.actualRequests,
            unchanged: report.productionSourceUnchanged, output, summary: report.summary }));
    }
}

if (require.main === module) run({ live: process.argv.includes('--live') }).catch(error => {
    console.error(String(error.message).slice(0, 200)); process.exitCode = 1;
});
module.exports = { collectPlayers, loadClient, shuffle, quantile };
