'use strict';

// Opt-in live experiment, separate from the application. Only the production
// Urchin concurrency constant varies in memory; spacing/budgets stay intact.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const axios = require('axios');
const { shuffle, quantile } = require('./hypixel_live_concurrency');
const { makeUrchinData, parseUrchinBatchTags, classifyUrchinRequestError } = require('../../src/stats/urchin');

const root = path.resolve(__dirname, '../..');
const limits = [1, 2, 3, 4, 5, 6, 8, 16], rounds = 3, playersPerBatch = 16, warmupCount = 4;
const windowMs = 300000, quietMs = 600000, minSpacingMs = 500;
const directory = path.join(root, 'output/urchin-live-concurrency');
const sourceFile = path.join(root, 'features/urchin_client.js');
const source = fs.readFileSync(sourceFile, 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timestamp = value => typeof value === 'number' ? value : Date.parse(value);
const sources = ['features/urchin_client.js', 'features/hypixel_api_client.js', 'src/stats/urchin.js'];
const beforeSources = Object.fromEntries(sources.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));

function collectPlayers(file, now, ledger = []) {
    const latest = new Map();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const session of data.sessions || []) for (const game of session.games || []) {
        const at = timestamp(game.at);
        if (!Number.isFinite(at)) continue;
        for (const player of game.roster || []) {
            const uuid = String(player.uuid || '').replace(/-/g, '').toLowerCase();
            const name = String(player.realName || player.name || '').trim();
            if (player.nicked || !/^[A-Za-z0-9_]{3,16}$/.test(name)
                || !/^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/.test(uuid)) continue;
            if (!latest.has(uuid) || at > latest.get(uuid).at) latest.set(uuid, { uuid, name, at });
        }
    }
    const recent = ledger.filter(x => now - x.at < quietMs);
    const ids = new Set(recent.map(x => x.player)), names = new Set(recent.map(x => x.name));
    const usedNames = new Set();
    return [...latest.values()].filter(x => x.at < now - quietMs && !ids.has(hash(x.uuid)) && !names.has(hash(x.name.toLowerCase())))
        .sort((a, b) => b.at - a.at).filter(x => {
            const key = x.name.toLowerCase(); if (usedNames.has(key)) return false; usedNames.add(key); return true;
        });
}
function loadClient(cap, transport, key) {
    const pattern = /const URCHIN_REQUEST_CONCURRENCY = \d+;/g;
    assert.equal([...source.matchAll(pattern)].length, 1);
    const module = { exports: {} };
    vm.runInNewContext(source.replace(pattern, `const URCHIN_REQUEST_CONCURRENCY = ${cap};`), {
        module, exports: module.exports, require: createRequire(sourceFile), Date, Math, URL,
        AbortController, setTimeout, clearTimeout, console
    }, { filename: sourceFile });
    return module.exports.createUrchinClient({ axios: { get: transport, post: () => { throw Error('Unexpected POST'); } },
        getKey: () => key, getGameState: () => ({ gameActive: true }), makeUrchinData,
        parseBatchTags: parseUrchinBatchTags, classifyRequestError: classifyUrchinRequestError });
}
function loadKey(dataDirectory) {
    const lines = fs.readFileSync(path.join(dataDirectory, 'statmod_key.txt'), 'utf8').split(/\r?\n/);
    for (const label of ['urchin api key', 'urchin']) {
        const line = lines.find(x => x.includes(':') && x.slice(0, x.indexOf(':')).trim().toLowerCase() === label);
        const value = line?.slice(line.indexOf(':') + 1).trim(); if (value) return value;
    }
    return lines.some(x => x.includes(':')) ? '' : lines[1]?.trim() || '';
}
function retryAt(headers = {}, now = Date.now()) {
    const raw = headers['retry-after'];
    if (raw !== undefined) {
        const seconds = Number(raw); if (Number.isFinite(seconds)) return now + Math.max(0, seconds) * 1000;
        const date = Date.parse(raw); if (Number.isFinite(date)) return date;
    }
    const reset = Number(headers['x-ratelimit-reset']);
    if (!Number.isFinite(reset) || reset <= 0) return 0;
    return reset > 1e12 ? reset : reset > Math.floor(now / 1000) - 86400 ? reset * 1000 : now + reset * 1000;
}

// Include every batch outcome, including rate limits and checks cancelled by
// the experiment. A quick failed settlement is never full-tag completion.
function summarizeOutcomes(batches) {
    return limits.map(cap => {
        const cases = batches.filter(x => x.cap === cap), records = cases.flatMap(x => x.records);
        const full = cases.filter(x => !x.contaminated && !x.guardErrors?.length && !x.failures && !x.unavailableLookups);
        const unstarted = cases.reduce((n, x) => n + x.successes + x.failures - x.requests, 0);
        const cancelledAfter429 = cases.filter(x => x.records.some(r => r.status === 429))
            .reduce((n, x) => n + x.successes + x.failures - x.requests, 0);
        return { cap, trials: cases.length, checks: cases.reduce((n, x) => n + x.successes + x.failures, 0),
            available: cases.reduce((n, x) => n + x.successes, 0), httpAttempts: records.length,
            http429: records.filter(x => x.status === 429).length, cancelledAfter429,
            timeouts: records.filter(x => x.error === 'ECONNABORTED').length,
            notFound: records.filter(x => x.status === 404).length,
            serverErrors: records.filter(x => x.status >= 500).length,
            otherHttpFailures: records.filter(x => !x.ok && x.status !== 429 && x.status !== 404 && x.status < 500 && x.error !== 'ECONNABORTED').length,
            otherUnstarted: unstarted - cancelledAfter429, fullSuccessTrials: full.length,
            fullCompletionMs: quantile(full.map(x => x.completeMs), .5), recoveryAfter429Ms: null,
            contaminatedTrials: cases.filter(x => x.contaminated).length,
            guardFailedTrials: cases.filter(x => x.guardErrors?.length).length };
    });
}

async function run({ live = false, resume = false, firstPassOnly = false, requestBudget = 200, standalone = false } = {}) {
    assert(Number.isInteger(requestBudget) && requestBudget >= 16 && requestBudget <= 200, 'Experiment budget must be 16-200');
    const dataDirectory = process.env.FURY_DATA_DIR || root, ledgerFile = path.join(directory, 'requests.jsonl');
    const output = path.join(directory, 'results.json');
    const prior = resume ? JSON.parse(fs.readFileSync(output, 'utf8')) : null;
    if (prior) {
        assert(['stopped', 'partial'].includes(prior.status), 'Only a stopped/partial experiment can be resumed');
        for (const file of sources) assert.equal(prior.sourceHashes[file], hash(beforeSources[file]), 'Production source changed since the earlier batches');
    }
    const ledger = fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x)) : [];
    const now = Date.now();
    const candidates = collectPlayers(path.join(dataDirectory, 'session_data.json'), now,
        resume ? ledger.map(x => ({ ...x, at: now })) : ledger).slice(0, 2048);
    const completed = new Set((prior?.batches || []).map(x => `${x.round}:${x.cap}`));
    const roundLimit = firstPassOnly ? 1 : rounds;
    const completedInScope = (prior?.batches || []).filter(x => x.round < roundLimit).length;
    const needsWarmup = !prior?.warmup?.length;
    const needed = (limits.length * roundLimit - completedInScope) * playersPerBatch + (needsWarmup ? warmupCount : 0), seed = 20261103;
    const players = shuffle(candidates, seed).slice(0, needed);
    assert.equal(players.length, needed, 'Not enough eligible distinct players');
    const key = loadKey(dataDirectory); assert(key, 'Configure an Urchin key in Fury before running this test');
    const settings = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'server_config.json'), 'utf8'));
    const health = async () => {
        try { return (await axios.get(`http://127.0.0.1:${Number(settings.healthPort) || 3100}/health`, { timeout: 2000 })).data; }
        catch (error) {
            if (!standalone || error.code !== 'ECONNREFUSED') throw error;
            // Explicit caller-verified stopped-proxy mode. This is orchestration
            // state, never a substitute for a provider response/measurement.
            return { standalone: true, liveGame: { gameActive: false, bedwarsPregameActive: false },
                urchinUsage: { concurrency: Number(source.match(/URCHIN_REQUEST_CONCURRENCY = (\d+)/)[1]),
                    localBudget: { limit: 300, remaining: 300 } } };
        }
    };
    const startHealth = await health(), order = shuffle(limits, seed + 1);
    const plan = prior?.order || Array.from({ length: rounds }, (_, round) => order.slice(round * 3 % order.length).concat(order.slice(0, round * 3 % order.length)));
    console.log(JSON.stringify({ mode: live ? 'live' : 'preflight-only', limits, rounds, playersPerBatch,
        distinctPlayers: needed, candidatePool: candidates.length, order: plan, gameActive: startHealth.liveGame?.gameActive,
        productionConcurrency: startHealth.urchinUsage?.concurrency, minSpacingMs, keyConfigured: true, resume,
        completedBatches: completed.size, roundLimit, requestBudget }));
    if (!live) return;
    fs.mkdirSync(directory, { recursive: true });
    const lockFile = path.join(directory, 'running.lock');
    if (fs.existsSync(lockFile)) {
        const pid = Number(fs.readFileSync(lockFile, 'utf8')); let running = false;
        try { process.kill(pid, 0); running = true; } catch {}
        assert(!running, 'Another live Urchin experiment is running'); fs.unlinkSync(lockFile);
    }
    fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    if (fs.existsSync(output)) fs.copyFileSync(output, path.join(directory, `prior-${Date.now()}.json`));
    const batches = prior?.batches || [], warmup = prior?.warmup || [], clients = new Set();
    const report = prior || { startedAt: new Date().toISOString(), status: 'running', mode: 'live HTTPS /v3/player/tags',
        runtime: process.versions, limits, rounds, playersPerBatch, order: plan, distinctPlayers: needed,
        sourceHashes: Object.fromEntries(sources.map(file => [file, hash(beforeSources[file])])), priorLedgerRequests: ledger.length,
        productionConcurrency: startHealth.urchinUsage?.concurrency, minSpacingMs, batches, warmup, pauses: [],
        methodology: ['Production username tag lookup, 500 ms start spacing, real monotonic time and ten-second HTTP timeout.',
            'Only concurrency varies in memory. Fresh per-batch client caches; experiment budget persists across all batches.',
            'Different, randomly assigned real players for each batch; recent names and UUIDs are excluded across restarts.',
            'Validate HTTP 200, tags array and response UUID against the saved real player; empty tags are a valid result.',
            'At most 200 experiment starts per rolling five minutes and 80 per minute; smaller limits further restrict dispatch.',
            'Stop on authentication/rate-limit errors; one HTTP attempt per player and no cache-busting.',
            'Profile sizes, upstream caches, changing server/network conditions and connection reuse remain sources of variance.',
            'Measures tag readiness, not Hypixel primary stats, complete Scan output, rendering, IPC or heap/FPS.'] };
    report.status = 'running'; report.stopReason = null;
    if (resume) (report.resumedAt ||= []).push(new Date().toISOString());
    (report.phases ||= []).push({ at: new Date().toISOString(), roundLimit, requestBudget, standalone: Boolean(startHealth.standalone) });
    (report.failurePolicyHistory ||= []).push({ at: new Date().toISOString(), previous: report.failurePolicy || 'Initial stop after any service error' });
    report.failurePolicy = 'Continue isolated 404/identity errors; pause thirty seconds after an isolated timeout/service failure. Stop authentication/429 immediately, four physical service failures in one batch, or at least two physical service failures in consecutive batches.';
    const cooldownFile = path.join(directory, 'cooldown.json');
    let fatal = null, active = 0, observedLimit = 300, remaining = null, resetAt = 0, cooldownUntil = 0, previousServiceFailures = 0;
    if (fs.existsSync(cooldownFile)) cooldownUntil = Number(JSON.parse(fs.readFileSync(cooldownFile, 'utf8')).until) || 0;
    const prior429 = batches.flatMap(x => x.records).filter(x => x.status === 429);
    if (prior429.length) {
        cooldownUntil = Math.max(cooldownUntil, ...prior429.map(x => x.at + (x.httpMs || 0) + windowMs));
        fs.writeFileSync(cooldownFile, JSON.stringify({ until: cooldownUntil, reason: 'full_five_minute_quiet_after_429' }));
    }
    const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
    const stop = reason => { fatal ||= reason; for (const client of clients) client.resetUrchinLookupState(); };
    const interrupt = () => stop('interrupted'); process.once('SIGINT', interrupt);
    function noteHeaders(headers = {}, status = 0) {
        const rawLimit = headers['x-ratelimit-limit'], rawRemaining = headers['x-ratelimit-remaining'];
        const limit = rawLimit === undefined ? NaN : Number(rawLimit), available = rawRemaining === undefined ? NaN : Number(rawRemaining);
        if (Number.isFinite(limit) && limit > 0) observedLimit = Math.min(300, limit);
        if (Number.isFinite(available)) remaining = remaining === null ? available : Math.min(remaining, available);
        resetAt = retryAt(headers) || resetAt;
        if (status === 429 || (status >= 400 && headers['retry-after'] !== undefined)) {
            cooldownUntil = Math.max(cooldownUntil, retryAt(headers) || Date.now() + 30000);
            fs.writeFileSync(cooldownFile, JSON.stringify({ until: cooldownUntil, status }));
        }
    }
    const proxyUsed = h => Math.max(0, (h.urchinUsage?.localBudget?.limit || 300) - (h.urchinUsage?.localBudget?.remaining ?? 300));
    async function waitForCapacity(count) {
        const started = Date.now(); let announced = false;
        while (!fatal) {
            const h = await health(), now = Date.now(), u = h.urchinUsage || {};
            if (resetAt && now >= resetAt + 500) { remaining = null; resetAt = 0; }
            const ownFive = ledger.filter(x => now - x.at < windowMs).length, ownMinute = ledger.filter(x => now - x.at < 60000).length;
            const cap = Math.min(requestBudget, Math.floor(observedLimit * 2 / 3)), reserve = Math.max(16, Math.ceil(observedLimit / 5));
            const busy = h.liveGame?.gameActive || h.liveGame?.bedwarsPregameActive || h.liveGame?.scanActive
                || u.activeRequests || u.queuedRequests || u.cooldownInMs;
            const budget = ownFive + count > cap || ownMinute + count > Math.min(80, cap)
                || ownFive + proxyUsed(h) + count > observedLimit - reserve
                || (remaining !== null && remaining < count + reserve)
                || (u.remaining !== null && u.remaining !== undefined && u.remaining < count + reserve)
                || cooldownUntil > now;
            if (!busy && !budget) {
                if (announced) report.pauses.push({ ms: now - started, reason: 'gameplay_or_quota_headroom' });
                const gap = (ledger.at(-1)?.at || 0) + minSpacingMs - Date.now(); if (gap > 0) await sleep(gap);
                return { proxyUsed: proxyUsed(h), ownFive, ownMinute, headerRemaining: remaining, standalone: Boolean(h.standalone) };
            }
            if (!announced) { console.log(JSON.stringify({ waiting: true, gameBusy: Boolean(busy), quotaWait: Boolean(budget) })); announced = true; }
            if (now - started > 12 * 60000) throw Error('Idle/quota wait exceeded twelve minutes');
            await sleep(5000);
        }
        throw Error('Experiment stopped');
    }
    async function batch(cap, group, round, isWarmup = false) {
        const before = await waitForCapacity(group.length), records = [], ready = [], guardErrors = [];
        const expected = new Map(group.map(x => [x.name.toLowerCase(), x])), start = performance.now(); let peak = 0;
        const client = loadClient(cap, async (url, options) => {
            if (fatal) throw Object.assign(Error('Stopped'), { code: 'ERR_CANCELED' });
            const check = (condition, message) => { if (!condition) { guardErrors.push(message); throw Object.assign(Error(message), { code: 'BENCHMARK_GUARD' }); } };
            check(url === 'https://api.urchin.gg/v3/player/tags', 'Unexpected endpoint');
            const player = expected.get(String(options.params.player).toLowerCase()); check(player, 'Unexpected player');
            // Enforce the shared floor even if a timer/Date boundary differs
            // slightly from the per-client dispatch timestamp.
            while (ledger.length && Date.now() - ledger.at(-1).at < minSpacingMs) await sleep(minSpacingMs - (Date.now() - ledger.at(-1).at) + 1);
            const now = Date.now();
            check(!ledger.some(x => now - x.at < quietMs && (x.player === hash(player.uuid) || x.name === hash(player.name.toLowerCase()))), 'Player repeated');
            ledger.push({ at: now, player: hash(player.uuid), name: hash(player.name.toLowerCase()) });
            fs.appendFileSync(ledgerFile, JSON.stringify(ledger.at(-1)) + '\n'); if (remaining !== null) remaining--;
            const record = { index: records.length, at: now, queuedMs: performance.now() - start, ok: false, status: 0 };
            records.push(record); peak = Math.max(peak, ++active); const sent = performance.now();
            try {
                const response = await axios.get(url, options);
                record.httpMs = performance.now() - sent; record.status = response.status;
                noteHeaders(response.headers, response.status);
                record.ok = response.status === 200 && Array.isArray(response.data?.tags)
                    && String(response.data?.uuid || '').replace(/-/g, '').toLowerCase() === player.uuid;
                record.tagCount = Array.isArray(response.data?.tags) ? response.data.tags.length : null;
                record.jsonBytes = Buffer.byteLength(JSON.stringify(response.data)); record.reusedSocket = Boolean(response.request?.reusedSocket);
                record.headers = Object.fromEntries(['age', 'cf-cache-status', 'cache-control', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']
                    .filter(name => response.headers[name] !== undefined).map(name => [name, String(response.headers[name]).slice(0, 160)]));
                if (!record.ok) record.error = 'invalid_payload_or_player_mismatch';
                return response;
            } catch (error) {
                record.httpMs = performance.now() - sent; record.status = error.response?.status || 0;
                record.error = String(error.code || 'REQUEST_FAILED').slice(0, 64); noteHeaders(error.response?.headers, record.status);
                record.headers = Object.fromEntries(['age', 'cf-cache-status', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']
                    .filter(name => error.response?.headers?.[name] !== undefined).map(name => [name, String(error.response.headers[name]).slice(0, 160)]));
                const errorText = JSON.stringify(error.response?.data || {}).toLowerCase();
                record.providerErrorSource = errorText.includes('mojang') ? 'mojang' : errorText.includes('hypixel') ? 'hypixel' : 'unspecified';
                if ([401, 403, 429].includes(record.status)) stop(`HTTP_${record.status}`);
                throw error;
            } finally { active--; record.responseMs = performance.now() - start; }
        }, key);
        clients.add(client);
        try {
            await Promise.all(group.map(p => client.getUrchinRaw(p.name).then(data => {
                ready.push({ at: performance.now() - start, ok: data.ok === true, status: data.requestStatus });
            })));
            while (active) await sleep(5);
            const completeMs = performance.now() - start, after = await health();
            const result = { cap, round, warmup: isWarmup, completeMs,
                firstMs: ready.some(x => x.ok) ? Math.min(...ready.filter(x => x.ok).map(x => x.at)) : null,
                medianHttpMs: quantile(records.map(x => x.httpMs), .5), p95HttpMs: quantile(records.map(x => x.httpMs), .95),
                meanJsonBytes: records.reduce((n, x) => n + (x.jsonBytes || 0), 0) / Math.max(1, records.length),
                peakConcurrency: peak, requests: records.length, successes: records.filter(x => x.ok).length,
                failures: group.length - records.filter(x => x.ok).length, unavailableLookups: ready.filter(x => !x.ok).length,
                unstartedLookups: group.length - records.length, guardErrors,
                lookupStatuses: Object.fromEntries([...new Set(ready.map(x => x.status))].map(status => [status, ready.filter(x => x.status === status).length])),
                clientAfter: client.getUrchinRateLimitSnapshot(),
                before, after: { proxyUsed: proxyUsed(after), gameActive: after.liveGame?.gameActive,
                    pregame: after.liveGame?.bedwarsPregameActive, standalone: Boolean(after.standalone) }, records };
            result.contaminated = Boolean(result.after.gameActive || result.after.pregame || before.proxyUsed !== result.after.proxyUsed);
            assert(peak <= cap); assert.equal(active, 0);
            (isWarmup ? warmup : batches).push(result); save();
            console.log(JSON.stringify({ cap, round, completeMs: Math.round(completeMs), firstMs: Math.round(result.firstMs),
                medianHttpMs: Math.round(result.medianHttpMs), peak, successes: result.successes, failures: result.failures, contaminated: result.contaminated }));
            const serviceFailures = records.filter(x => !x.ok && (x.status >= 500 || x.status === 0)).length;
            if (guardErrors.length) fatal ||= 'Benchmark guard failed; this batch is not a provider failure measurement';
            else if (serviceFailures >= 4 || (serviceFailures >= 2 && previousServiceFailures >= 2)) fatal ||= 'Frequent Urchin transport/service failures; stopped without retrying';
            else if (serviceFailures) {
                cooldownUntil = Math.max(cooldownUntil, Date.now() + 30000);
                fs.writeFileSync(cooldownFile, JSON.stringify({ until: cooldownUntil, reason: 'isolated_service_failure_pause' }));
            }
            previousServiceFailures = serviceFailures;
        } finally { clients.delete(client); client.resetUrchinLookupState(); }
    }
    try {
        save(); if (needsWarmup) await batch(2, players.splice(0, warmupCount), -1, true);
        for (let round = 0; round < roundLimit && !fatal; round++) for (const cap of plan[round]) {
            if (fatal) break;
            if (!completed.has(`${round}:${cap}`)) await batch(cap, players.splice(0, playersPerBatch), round);
        }
        report.status = fatal ? 'stopped' : firstPassOnly ? 'partial' : 'complete';
        report.stopReason = fatal || (firstPassOnly ? 'Only first-pass snapshots collected; repeated comparison deferred after rate-limiting' : null);
    } catch (error) { report.status = 'stopped'; report.stopReason = String(error.message).slice(0, 200); }
    finally {
        stop('finished'); process.removeListener('SIGINT', interrupt); report.finishedAt = new Date().toISOString();
        report.productionSourceUnchanged = sources.every(file => fs.readFileSync(path.join(root, file), 'utf8') === beforeSources[file]);
        report.actualRequests = warmup.concat(batches).reduce((n, x) => n + x.requests, 0);
        report.outcomeSummary = summarizeOutcomes(batches);
        report.rateLimitInterpretation = 'HTTP 429 and checks cancelled after it count as unavailable tags. Recovery to full success was not measured. Cumulative quota and trial order prevent attributing rate-limit risk to the ceiling alone.';
        report.summary = limits.map(cap => {
            const cases = batches.filter(x => x.cap === cap && !x.contaminated && !x.failures && !x.unavailableLookups);
            const allCases = batches.filter(x => x.cap === cap && !x.contaminated && !x.guardErrors?.length);
            return { cap, validTrials: cases.length, medianCompleteMs: quantile(cases.map(x => x.completeMs), .5),
                minCompleteMs: cases.length ? Math.min(...cases.map(x => x.completeMs)) : null,
                maxCompleteMs: cases.length ? Math.max(...cases.map(x => x.completeMs)) : null,
                medianFirstMs: quantile(cases.map(x => x.firstMs), .5), medianHttpMs: quantile(cases.map(x => x.medianHttpMs), .5),
                peakConcurrency: cases.length ? Math.max(...cases.map(x => x.peakConcurrency)) : null,
                measuredTrials: allCases.length, successfulChecks: allCases.reduce((n, x) => n + x.successes, 0),
                failedChecks: allCases.reduce((n, x) => n + x.failures, 0),
                medianSettledMs: quantile(allCases.map(x => x.completeMs), .5),
                minSettledMs: allCases.length ? Math.min(...allCases.map(x => x.completeMs)) : null,
                maxSettledMs: allCases.length ? Math.max(...allCases.map(x => x.completeMs)) : null };
        });
        save(); fs.unlinkSync(lockFile);
        console.log(JSON.stringify({ status: report.status, stopReason: report.stopReason, actualRequests: report.actualRequests,
            unchanged: report.productionSourceUnchanged, output, summary: report.summary }));
    }
}

if (require.main === module) run({ live: process.argv.includes('--live'), resume: process.argv.includes('--resume'),
    firstPassOnly: process.argv.includes('--first-pass-only'),
    standalone: process.argv.includes('--standalone'),
    requestBudget: Number(process.argv.find(x => x.startsWith('--budget='))?.slice('--budget='.length) || 200)
}).catch(error => { console.error(String(error.message).slice(0, 200)); process.exitCode = 1; });
module.exports = { collectPlayers, loadClient, retryAt, summarizeOutcomes };
