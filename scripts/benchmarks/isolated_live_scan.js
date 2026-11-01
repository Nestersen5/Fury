'use strict';

// Opt-in live study. All stats responses are real; only queue ceilings change
// in isolated module instances. Production source/settings are never written.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const https = require('node:https'), crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict'), axios = require('axios');
const { InFlightDeduper } = require('../../src/util/in_flight_deduper');
const { BoundedTtlMap } = require('../../src/util/bounded_ttl_map');
const urchinShape = require('../../src/stats/urchin');
const colors = require('../../src/stats/colors'), format = require('../../src/stats/format');
const { stripAnsi } = require('../../features/minecraft_chat');
const { createOverlayTagBuilder } = require('../../src/overlay/tags');
const { buildOverlayTagComponents } = require('../../src/overlay/chat_overlay_annotation');
const { shuffle, quantile } = require('./hypixel_live_concurrency');

const root = path.resolve(__dirname, '../..'), directory = path.join(root, 'output/isolated-live-scan');
const files = ['features/hypixel_api_client.js', 'features/urchin_client.js', 'src/stats/fetch.js', 'src/stats/sources.js',
    'src/stats/lookup.js', 'src/overlay/scan.js', 'proxy.js'];
const source = Object.fromEntries(files.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quietMs = 310000, sampleSize = 16, healthSize = 2;
const quietLogger = { log() {}, warn() {}, error() {} };

function readKeys() {
    const lines = fs.readFileSync(path.join(process.env.FURY_DATA_DIR || root, 'statmod_key.txt'), 'utf8').split(/\r?\n/);
    return Object.fromEntries(['hypixel', 'urchin', 'aurora'].map(provider => {
        const line = lines.find(x => x.includes(':') && x.slice(0, x.indexOf(':')).trim().toLowerCase() === provider + ' api key');
        return [provider, line?.slice(line.indexOf(':') + 1).trim() || ''];
    }));
}
function load(file, caps, observed, seed = 20261101) {
    const full = path.join(root, file), local = createRequire(full), module = { exports: {} };
    let text = source[file];
    for (const [name, cap] of [['HYPIXEL_API_BURST_CONCURRENCY', caps.h], ['URCHIN_REQUEST_CONCURRENCY', caps.u]]) {
        const pattern = new RegExp(`const ${name} = \\d+;`, 'g');
        if (text.includes(`const ${name} = `)) { assert.equal([...text.matchAll(pattern)].length, 1); text = text.replace(pattern, `const ${name} = ${cap};`); }
    }
    const math = Object.create(Math); let state = seed;
    math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    vm.runInNewContext(text, { module, exports: module.exports,
        require: name => name === 'axios' ? observed : local(name), Date, Math: math, URL,
        AbortController, AbortSignal, setTimeout, clearTimeout, console }, { filename: full });
    return module.exports;
}
function interactiveTags() {
    const extract = name => {
        const match = source['proxy.js'].match(new RegExp(`function ${name}\\([^]*?\\r?\\n}`));
        assert(match, `Production formatter ${name} missing`); return match[0];
    };
    const compact = vm.runInNewContext(extract('compactTagName') + '\ncompactTagName', { stripAnsi });
    const { buildOverlayTags } = createOverlayTagBuilder({ compactTagName: compact });
    return vm.runInNewContext(extract('getInteractiveTags') + '\ngetInteractiveTags', {
        buildOverlayTags, buildOverlayTagComponents, ...urchinShape
    });
}
function activeFury() {
    if (process.platform !== 'win32') return false;
    const command = `@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and (`
        + `$_.Name -eq 'Fury.exe' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match '\\bproxy\\.js\\b') -or `
        + `($_.Name -eq 'electron.exe' -and $_.CommandLine -match 'CustomProxyNodeJS' -and $_.CommandLine -notmatch 'scripts[\\\\/]benchmarks')) }).Count`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw Error('Cannot verify that Fury is stopped');
    return Number(result.stdout.trim()) > 0;
}
function summarizeProvider(events, provider) {
    const selected = events.filter(e => e.provider === provider), times = selected.filter(e => e.ok).map(e => e.httpMs);
    return { attempts: selected.length, successful: selected.filter(e => e.ok).length,
        http429: selected.filter(e => e.status === 429).length, timeouts: selected.filter(e => e.code === 'ECONNABORTED').length,
        cancelled: selected.filter(e => e.cancelled).length, medianHttpMs: quantile(times, .5), p95HttpMs: quantile(times, .95),
        peak: Math.max(0, ...selected.map(e => e.active)), reused: selected.filter(e => e.reusedSocket).length };
}

function summarizeCombos(trials) {
    return [...new Set(trials.filter(x => x.kind === 'combo').map(x => x.label))].map(label => {
        const attempted = trials.filter(x => x.kind === 'combo' && x.label === label);
        const admitted = attempted.filter(x => x.gatePassed), complete = admitted.filter(x => x.eligible);
        return { label, admissionAttempts: attempted.length, admissionFailures: attempted.length - admitted.length,
            admittedTrials: admitted.length, fullSuccessTrials: complete.length,
            // Admission 429s also matter; they cannot disappear from the
            // zero-throttling assessment merely because timing never started.
            any429: attempted.some(x => x.events.some(e => e.status === 429)),
            http429: attempted.reduce((n, x) => n + x.events.filter(e => e.status === 429).length, 0),
            medianFullScanMs: quantile(complete.map(x => x.fullScanMs), .5),
            worstFullScanMs: complete.length ? Math.max(...complete.map(x => x.fullScanMs)) : null,
            caps: attempted.length ? { h: attempted[0].h, u: attempted[0].u } : null };
    });
}

async function run({ live = false, resume = false } = {}) {
    const fixture = JSON.parse(fs.readFileSync(path.join(directory, 'players.private.json'), 'utf8'));
    const output = path.join(directory, 'results.json'), ledgerFile = path.join(directory, 'requests.private.jsonl'), lock = path.join(directory, 'running.lock');
    const prior = resume ? JSON.parse(fs.readFileSync(output, 'utf8')) : null;
    if (prior) {
        assert(prior.status === 'stopped', 'Resume requires a stopped checkpoint');
        for (const file of files) assert(prior.sourceHashes[file] === hash(source[file]), 'Production source changed since the checkpoint');
        assert(fs.statSync(path.join(process.env.FURY_DATA_DIR || root, 'statmod_key.txt')).mtimeMs <= Date.parse(prior.startedAt), 'Provider key file changed since the checkpoint');
    }
    const keys = readKeys(); assert(Object.values(keys).every(Boolean), 'All three configured provider keys are required');
    const earlier = resume && fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x)) : [];
    const earlierIds = new Set(earlier.map(x => x.player)), earlierNames = new Set(earlier.map(x => x.name));
    const bins = [0, 1, 2, 3].map(i => shuffle(fixture.players.filter(p => p.bucket === i && !earlierIds.has(hash(p.uuid)) && !earlierNames.has(hash(p.name.toLowerCase()))), 20261111 + i));
    const used = new Set(), usedNames = new Set(); let healthBucket = 0;
    const select = count => {
        const result = [];
        for (let i = 0; i < count; i++) {
            const bucket = (count === 16 ? i : healthBucket++) % 4;
            const player = bins[bucket].pop(); assert(player, 'Verified player pool exhausted');
            assert(!used.has(player.uuid) && !usedNames.has(player.name.toLowerCase()));
            used.add(player.uuid); usedNames.add(player.name.toLowerCase()); result.push(player);
        }
        return result;
    };
    const screens = [
        ...[5, 2, 8].map(h => ({ kind: 'hypixel', h, u: 2, label: `H${h}` })),
        ...[2, 1, 3, 4, 8].map(u => ({ kind: 'urchin', h: 5, u, label: `U${u}` }))
    ];
    const report = prior || { startedAt: new Date().toISOString(), status: 'preflight', quietMs, sampleSize, healthSize,
        sourceHashes: Object.fromEntries(files.map(file => [file, hash(source[file])])), source: 'Live Aurora superstar identities verified by Mojang',
        preparedPlayers: fixture.players.length, trials: [], selection: {}, gates: [],
        methodology: ['Real HTTPS provider responses; no simulated stats or response delays.',
            'Fresh provider queues, profile caches, dedupers and HTTPS connection pools per trial.',
            'At least 310 seconds without known provider activity between trial groups; fresh players throughout.',
            'Two independent health players before each measured group; failed gates and measured failures remain recorded.',
            'Production pacing: Hypixel 200 ms +/-15% jitter, Urchin 500 ms; quotas and request timeouts retained.',
            'Combo uses the actual lookup/Scan pipeline: sixteen Tab Stats lookups at 200 ms staggering, twelve opponents, four-second automatic Scan delay.',
            'Aurora ping and Mojang name resolution are live dependencies in combo trials.',
            'Any rate limit/provider error fails the trial; it is never a fast successful completion. No automatic retry load is generated after a fault.',
            'A health gate cannot guarantee future provider health or undisclosed/shared key/IP limits. Server caches and external users of the same key cannot be cleared.'],
        productionPolicy: { hypixel: Number(source[files[0]].match(/HYPIXEL_API_BURST_CONCURRENCY = (\d+)/)[1]),
            urchin: Number(source[files[1]].match(/URCHIN_REQUEST_CONCURRENCY = (\d+)/)[1]) } };
    if (resume && live) {
        (report.protocolCheckpoints ||= []).push({ at: new Date().toISOString(), reason: 'Repeated baseline control added before any combination outcome; previous screening data retained.' });
        report.stopReason = null; report.finishedAt = null;
    }
    console.log(JSON.stringify({ mode: live ? 'live' : 'preflight', preparedPlayers: fixture.players.length, screens: screens.map(x => x.label), quietMs,
        productionPolicy: report.productionPolicy, furyRunning: activeFury(), resume, retainedTrials: report.trials.length }));
    if (!live) return;
    fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
    if (fs.existsSync(output)) fs.copyFileSync(output, path.join(directory, `prior-${Date.now()}.json`));
    const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
    const lifetime = setInterval(() => {}, 10000);
    let lastActivity = Math.max(Number(JSON.parse(fs.readFileSync(path.join(directory, 'aurora-pool.private.json'), 'utf8')).at) || 0,
        ...report.trials.flatMap(t => t.events.map(e => e.endAt || e.at)));
    let serverNotBefore = 0;
    let halted = false, current = null, nextTrial = Math.max(0, ...report.trials.map(t => t.id));
    const halt = () => { halted = true; current?.abort('User interruption'); };
    process.once('SIGINT', halt);
    const assertSources = () => {
        for (const file of files) assert(fs.readFileSync(path.join(root, file), 'utf8') === source[file], 'Production code changed during the study');
        const currentKeys = readKeys(); assert(Object.keys(keys).every(k => currentKeys[k] === keys[k]), 'Provider keys changed during the study');
    };
    async function isolate(label) {
        let announced = false;
        for (;;) {
            if (halted) throw Error('Study interrupted');
            const controlFile = path.join(directory, 'control.json');
            if (fs.existsSync(controlFile) && JSON.parse(fs.readFileSync(controlFile, 'utf8')).stop) { halt(); throw Error('Study stopped by user'); }
            const wait = Math.max(lastActivity + quietMs, serverNotBefore) - Date.now();
            if (wait > 0) {
                if (!announced) console.log(JSON.stringify({ waitingFor: label, quietSecondsRemaining: Math.ceil(wait / 1000) }));
                announced = true; await sleep(Math.min(30000, wait)); continue;
            }
            if (activeFury()) { console.log(JSON.stringify({ waitingFor: label, reason: 'Fury is running; provider isolation cannot be established' })); lastActivity = Date.now(); continue; }
            assertSources(); return;
        }
    }
    async function trial(config, round = 0) {
        await isolate(config.label);
        const activityBefore = lastActivity;
        const id = ++nextTrial, events = [], faults = [], controller = new AbortController(), active = {}, nextStart = {};
        const expected = new Map(), calls = new Set(), start = performance.now(); let activeCount = 0, stage = 'health', measuredStart = null;
        let hypixel, urchin, fetcher, stopped = false;
        const agent = new https.Agent({ ...https.globalAgent.options, keepAlive: true });
        const http = axios.create({ httpsAgent: agent });
        const abort = reason => {
            if (stopped) return; stopped = true;
            if (!controller.signal.aborted) controller.abort();
            urchin?.resetUrchinLookupState(); fetcher?.cancelPendingRetries();
        };
        current = { abort };
        const register = players => players.forEach((p, index) => { expected.set(p.uuid, p); expected.set(p.name.toLowerCase(), p); p.index = stage === 'health' ? -(index + 1) : index; });
        const observed = { post() { throw Error('Unexpected POST in stats path'); }, get: async (url, options = {}) => {
            if (controller.signal.aborted) throw Object.assign(Error('Trial cancelled'), { code: 'ERR_CANCELED' });
            const parsed = new URL(url); let provider, identifier;
            if (parsed.hostname === 'api.hypixel.net' && parsed.pathname === '/v2/player') { provider = 'hypixel'; identifier = parsed.searchParams.get('uuid'); }
            else if (parsed.hostname === 'api.urchin.gg' && parsed.pathname === '/v3/player/tags') { provider = 'urchin'; identifier = options.params.player; }
            else if (parsed.hostname === 'bordic.xyz' && parsed.pathname === '/api/v2/resources/ping') { provider = 'aurora'; identifier = String(options.params.uuid).replace(/-/g, ''); }
            else if (parsed.hostname === 'api.mojang.com' && parsed.pathname.startsWith('/users/profiles/minecraft/')) { provider = 'mojang'; identifier = decodeURIComponent(parsed.pathname.split('/').pop()); }
            else throw Error('Unexpected endpoint in measured stats path');
            const player = expected.get(String(identifier).toLowerCase()); assert(player, 'Unexpected identity');
            const callId = `${provider}:${player.uuid}`; assert(!calls.has(callId), 'Duplicate provider/player request'); calls.add(callId);
            const floor = provider === 'urchin' ? 500 : provider === 'hypixel' ? 170 : 0;
            while (floor && Date.now() < (nextStart[provider] || 0)) await sleep(nextStart[provider] - Date.now() + 1);
            if (controller.signal.aborted) throw Object.assign(Error('Trial cancelled'), { code: 'ERR_CANCELED' });
            const sentAt = Date.now(), sent = performance.now(); nextStart[provider] = sentAt + floor;
            const event = { provider, stage, index: player.index, at: sentAt, startMs: sent - start, ok: false,
                status: 0, active: active[provider] = (active[provider] || 0) + 1 };
            activeCount++; events.push(event);
            fs.appendFileSync(ledgerFile, JSON.stringify({ trial: id, provider, at: sentAt, player: hash(player.uuid), name: hash(player.name.toLowerCase()) }) + '\n');
            try {
                const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
                const response = await http.get(url, { ...options, signal });
                event.status = response.status; event.httpMs = performance.now() - sent;
                const body = response.data;
                const uuid = value => String(value || '').replace(/-/g, '').toLowerCase();
                event.ok = response.status === 200 && (provider === 'hypixel' ? body?.success === true && uuid(body.player?.uuid) === player.uuid && Boolean(body.player?.stats?.Bedwars)
                    : provider === 'urchin' ? Array.isArray(body?.tags) && uuid(body.uuid) === player.uuid
                        : provider === 'mojang' ? uuid(body?.id) === player.uuid : body?.success !== false && Array.isArray(body?.data));
                event.jsonBytes = Buffer.byteLength(JSON.stringify(body)); event.reusedSocket = Boolean(response.request?.reusedSocket);
                event.headers = Object.fromEntries(Object.entries(response.headers).filter(([name]) => /limit|retry-after|^server$|^date$|^cf-cache-status$/.test(name))
                    .map(([name, value]) => [name, String(value).slice(0, 160)]));
                if (!event.ok) throw Object.assign(Error('Provider data failed identity/schema validation'), { code: 'INVALID_PROVIDER_DATA', response });
                return response;
            } catch (error) {
                event.httpMs = performance.now() - sent; event.status = error.response?.status || event.status;
                event.code = error.code || 'NETWORK_ERROR'; event.cancelled = error.code === 'ERR_CANCELED';
                event.optionalAbsent = provider === 'aurora' && event.status === 404;
                event.headers ||= Object.fromEntries(Object.entries(error.response?.headers || {}).filter(([name]) => /limit|retry-after|^server$|^date$|^cf-cache-status$/.test(name))
                    .map(([name, value]) => [name, String(value).slice(0, 160)]));
                const retry = event.headers['retry-after'];
                if (retry !== undefined) {
                    const seconds = Number(retry), until = Number.isFinite(seconds) ? Date.now() + Math.max(0, seconds) * 1000 : Date.parse(retry);
                    if (Number.isFinite(until)) serverNotBefore = Math.max(serverNotBefore, until + 1000);
                }
                if (event.status === 429 && Number(event.headers['ratelimit-reset']) > 0) serverNotBefore = Math.max(serverNotBefore, Date.now() + Number(event.headers['ratelimit-reset']) * 1000 + 1000);
                const rawUrchinReset = Number(event.headers['x-ratelimit-reset']);
                if (event.status >= 400 && rawUrchinReset > 0) {
                    const until = rawUrchinReset > 1e12 ? rawUrchinReset : rawUrchinReset > Date.now() / 1000 - 86400
                        ? rawUrchinReset * 1000 : Date.now() + rawUrchinReset * 1000;
                    serverNotBefore = Math.max(serverNotBefore, until + 1000);
                }
                let message = typeof error.response?.data?.error === 'string' ? error.response.data.error : typeof error.response?.data?.cause === 'string' ? error.response.data.cause : '';
                for (const secret of [...Object.values(keys), player.uuid, player.name]) if (secret) message = message.split(secret).join('[redacted]');
                event.providerMessage = message.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]').slice(0, 220);
                if (!event.cancelled && !event.optionalAbsent) { faults.push({ provider, index: player.index, status: event.status, code: event.code, stage }); abort('Provider fault'); }
                throw error;
            } finally { active[provider]--; activeCount--; event.endAt = Date.now(); lastActivity = Math.max(lastActivity, event.endAt); }
        } };
        hypixel = load(files[0], config, observed).createHypixelApiClient({ axios: observed, getKeys: () => ({ hypixel: keys.hypixel }), getGameState: () => ({ gameActive: true }), logger: quietLogger });
        urchin = load(files[1], config, observed).createUrchinClient({ axios: observed, getKey: () => keys.urchin,
            getGameState: () => ({ gameActive: true }), makeUrchinData: urchinShape.makeUrchinData,
            parseBatchTags: urchinShape.parseUrchinBatchTags, classifyRequestError: urchinShape.classifyUrchinRequestError });
        const pingModule = load(files[3], config, observed);
        const statSources = pingModule.createStatsSources({ hypixelApiGet: hypixel.hypixelApiGet,
            hasHypixelApiKeyConfigured: hypixel.hasHypixelApiKeyConfigured, getHypixelKey: () => keys.hypixel,
            getAuroraKey: () => keys.aurora, guildCache: new Map(), auroraPingCache: new Map(),
            auroraPingCacheDuration: 300000, auroraPingDeduper: new InFlightDeduper() });
        const profiles = [], primary = []; let scanAt = null, rowCount = 0, measuredSettledAt = null;
        let gatePassed = false, gateReason = null;
        const deadline = setTimeout(() => { faults.push({ provider: 'benchmark', code: 'TRIAL_DEADLINE' }); abort('Trial deadline'); }, 180000);
        try {
            const probes = select(healthSize); register(probes);
            for (const player of probes) {
                if (config.kind !== 'urchin') await hypixel.hypixelApiGet(`https://api.hypixel.net/v2/player?uuid=${player.uuid}`, { apiPriority: 'game', timeout: 5000, signal: controller.signal });
                if (config.kind !== 'hypixel') { const data = await urchin.getUrchinRaw(player.name); assert(data.ok === true, 'Urchin health probe failed'); }
                if (config.kind === 'combo') await statSources.getAuroraPingRaw(player.uuid);
            }
            await sleep(1);
            const healthEvents = events.filter(e => e.stage === 'health');
            gatePassed = !faults.length && healthEvents.filter(e => ['hypixel', 'urchin'].includes(e.provider)).every(e => e.ok && e.httpMs <= 2500);
            if (config.kind !== 'urchin') {
                const remaining = hypixel.getHypixelApiUsageSnapshot().headers.remaining;
                if (remaining !== null && remaining < 26) { gatePassed = false; gateReason = 'Insufficient provider-reported Hypixel quota'; }
            }
            if (!gatePassed) throw Error(gateReason || 'Provider health/latency gate failed');
            stage = 'measured'; const players = select(sampleSize); register(players); measuredStart = performance.now();
            if (config.kind === 'hypixel') {
                await Promise.allSettled(players.map(p => hypixel.hypixelApiGet(`https://api.hypixel.net/v2/player?uuid=${p.uuid}`, { apiPriority: 'game', timeout: 5000, signal: controller.signal })));
            } else if (config.kind === 'urchin') {
                await Promise.all(players.map(p => urchin.getUrchinRaw(p.name)));
            } else {
                const fetchModule = load(files[2], config, observed), lookupModule = load(files[4], config, observed);
                let lookup;
                fetcher = fetchModule.createStatsFetch({ globalCache: new Map(), cacheDuration: 300000,
                    getHypixelKey: () => keys.hypixel, hasHypixelApiKeyConfigured: hypixel.hasHypixelApiKeyConfigured,
                    hypixelApiGet: hypixel.hypixelApiGet, getUrchinRaw: urchin.getUrchinRaw,
                    getAuroraPingRaw: statSources.getAuroraPingRaw, getHypixelStatusRaw: statSources.getHypixelStatusRaw,
                    makePingData: pingModule.makePingData, mergeUrchinOverride: urchinShape.mergeUrchinOverride,
                    notifyUrchinOutageOnce() {}, classifyPlayerLookupError: (...args) => lookup.classifyPlayerLookupError(...args),
                    playerLookupDeduper: new InFlightDeduper(), captureRetryGuard: () => () => !controller.signal.aborted,
                    getRetrySignal: () => controller.signal });
                lookup = lookupModule.createStatsLookup({ getPlayerData: fetcher.getPlayerData, makeUrchinData: urchinShape.makeUrchinData, makePingData: pingModule.makePingData });
                const teams = ['Blue', 'Red', 'Green', 'Yellow'], codes = ['\u00a79', '\u00a7c', '\u00a7a', '\u00a7e'];
                const lobby = new Map(players.map((p, i) => [p.name, { uuid: p.uuid, team: teams[Math.floor(i / 4)], color: codes[Math.floor(i / 4)], inTab: true }]));
                const runner = load(files[5], config, observed).createScanRunner({
                    state: { scanMode: 'all', threatConfig: { countTags: true, minStars: 500, minFkdr: 5 } },
                    sendChat: (_client, message) => { if (typeof message === 'object') rowCount++; },
                    isSupportedTabStatsMode: mode => mode === 'BEDWARS', getPlayerTeam: (map, name) => map.get(name)?.team,
                    playerLookupKey: name => name.toLowerCase(), getUrchinBatchRaw: urchin.getUrchinBatchRaw,
                    getPlayerDataWithNickDetection: lookup.getPlayerDataWithNickDetection, isLikelyBot: () => false,
                    inferTeamFromColor: (map, name) => map.get(name)?.team, getTabNameColor: info => info.color, extractDisplayColor: () => null,
                    ...colors, getSkyWarsLevelValue: format.getSkyWarsLevelValue, formatSkyWarsLevel: format.formatSkyWarsLevel,
                    getInteractiveTags: interactiveTags(), setLastScanSummary() {}, setLastScanResults() { scanAt = performance.now() - measuredStart; } });
                const prefetch = urchin.getUrchinBatchRaw(players.map(p => p.name));
                const tab = players.map((p, i) => sleep(i * 200).then(async () => {
                    if (controller.signal.aborted) return;
                    const data = await lookup.getPlayerDataWithNickDetection(p.name, { apiPriority: 'game', onPrimaryProfile: () => primary.push(performance.now() - measuredStart) });
                    profiles.push({ index: i, at: performance.now() - measuredStart, valid: data?.data?.player?.uuid?.replace(/-/g, '').toLowerCase() === p.uuid && !data.data.lookupFailed && data.data.urchin?.ok === true });
                }));
                const scan = sleep(4000).then(() => controller.signal.aborted ? null : runner.performFullScan({ username: players[0].name }, lobby, new Map(), 'Blue', {
                    gameMode: 'BEDWARS', gameActive: true, gameRoster: new Set(players.map(p => p.name)), isStillActive: () => !controller.signal.aborted
                }));
                await Promise.allSettled([prefetch, ...tab, scan]);
            }
            measuredSettledAt = performance.now() - measuredStart;
        } catch (error) { gateReason ||= String(error.message).slice(0, 160); if (gatePassed && !faults.length) faults.push({ provider: 'benchmark', code: error.code || 'RUN_FAILED' }); }
        finally {
            clearTimeout(deadline); while (activeCount) await sleep(5);
            const measured = events.filter(e => e.stage === 'measured');
            const required = config.kind === 'combo' ? ['hypixel', 'urchin'] : [config.kind];
            const validData = gatePassed && required.every(provider => measured.filter(e => e.provider === provider && e.ok).length === 16);
            const contaminated = activeFury();
            const eligible = validData && !faults.length && !contaminated && (config.kind !== 'combo' || (profiles.length === 16 && profiles.every(p => p.valid) && rowCount === 12 && scanAt !== null));
            const result = { id, ...config, round, gatePassed, gateReason: gatePassed ? null : gateReason, eligible,
                startedAt: new Date(events[0]?.at || Date.now()).toISOString(), measuredAt: measuredStart === null ? null : new Date(events.find(e => e.stage === 'measured')?.at || Date.now()).toISOString(),
                finishedAt: new Date().toISOString(), measuredSettledMs: measuredSettledAt,
                fullScanMs: eligible && config.kind === 'combo' ? scanAt : null,
                firstPrimaryMs: primary.length || profiles.length ? Math.min(...primary, ...profiles.map(p => p.at)) : null,
                allProfilesMs: profiles.length === 16 ? Math.max(...profiles.map(p => p.at)) : null,
                successfulProfiles: profiles.filter(p => p.valid).length, rowCount, faults, contaminated,
                providers: Object.fromEntries(['hypixel', 'urchin', 'mojang', 'aurora'].map(p => [p, summarizeProvider(measured, p)])),
                unknownUrchinQuota: events.filter(e => e.provider === 'urchin').every(e => !Object.keys(e.headers || {}).some(k => /limit/.test(k))),
                quietBeforeMs: events.length ? events[0].at - activityBefore : null, events };
            report.trials.push(result); report.lastProviderActivityBeforeTrial = lastActivity; report.status = 'running'; save();
            abort('Trial finished'); agent.destroy(); current = null;
            console.log(JSON.stringify({ trial: id, label: config.label, round, gatePassed, eligible,
                completeMs: eligible ? Math.round(config.kind === 'combo' ? scanAt : measuredSettledAt) : null,
                faults: faults.map(f => ({ provider: f.provider, status: f.status, code: f.code })), providers: result.providers }));
            assertSources(); return result;
        }
    }
    async function admitted(config, round = 0) {
        const earlierGates = report.trials.filter(t => t.kind === config.kind && t.label === config.label && t.round === round && !t.gatePassed);
        let last = earlierGates.at(-1);
        for (let attempt = earlierGates.length; attempt < 2; attempt++) {
            last = await trial(config, round); if (last.gatePassed) return last;
        }
        last.admissionExhausted = true; save();
        return last; // Keep the rejected gates; use other healthy candidates.
    }
    const score = r => r.measuredSettledMs ?? Infinity;
    try {
        report.status = 'running'; save();
        for (const config of screens) if (!report.trials.some(t => t.kind === config.kind && t.label === config.label && t.gatePassed)) await admitted(config);
        const hs = report.trials.filter(x => x.kind === 'hypixel' && x.eligible).sort((a, b) => score(a) - score(b));
        const us = report.trials.filter(x => x.kind === 'urchin' && x.eligible).sort((a, b) => score(a) - score(b));
        assert(hs.length >= 2 && us.length >= 2, 'Not enough healthy provider candidates for a valid combo study');
        const baselineH = hs.find(x => x.h === 5), leanH = hs.find(x => x.h === 2);
        const hChoices = baselineH && leanH && Math.max(score(baselineH), score(leanH)) < score(us[0]) * .85
            ? [baselineH, leanH] : [baselineH || hs[0], ...hs.filter(x => x !== (baselineH || hs[0]))].slice(0, 2);
        const baselineU = us.find(x => x.u === 2);
        const higherAlternatives = baselineU ? us.filter(x => x.u > baselineU.u) : [];
        const uChoices = [baselineU || us[0], higherAlternatives[0] || us.find(x => x !== (baselineU || us[0]))];
        report.selection = { h: hChoices.map(x => x.h), u: uChoices.map(x => x.u), reason: 'Current policy plus a healthy alternative; Hypixel choices retain lean/current candidates when both finish well before the tag bottleneck.' }; save();
        const combos = shuffle(hChoices.flatMap(h => uChoices.map(u => ({ kind: 'combo', h: h.h, u: u.u, label: `H${h.h}/U${u.u}` }))), 20261109);
        for (const config of combos) if (!report.trials.some(t => t.kind === 'combo' && t.label === config.label && t.round === 0 && t.gatePassed)) await admitted(config, 0);
        const successfulCombos = report.trials.filter(x => x.kind === 'combo' && x.round === 0 && x.eligible).sort((a, b) => a.fullScanMs - b.fullScanMs);
        const baseline = successfulCombos.find(x => x.h === report.productionPolicy.hypixel && x.u === report.productionPolicy.urchin);
        const alternative = baseline && (successfulCombos.find(x => x.u !== baseline.u) || successfulCombos.find(x => x.label !== baseline.label));
        const finalists = baseline && alternative ? [baseline, alternative] : successfulCombos.slice(0, 2);
        assert(finalists.length === 2, 'No two clean full-scan candidates; best combo cannot be established');
        report.selection.finalists = finalists.map(x => x.label); save();
        for (let round = 1; round <= 2; round++) for (const result of round % 2 ? finalists : [...finalists].reverse()) {
            if (!report.trials.some(t => t.kind === 'combo' && t.label === result.label && t.round === round && t.gatePassed)) await admitted({ kind: 'combo', h: result.h, u: result.u, label: result.label }, round);
        }
        report.status = 'complete';
    } catch (error) { report.status = 'stopped'; report.stopReason = String(error.message).slice(0, 240); }
    finally {
        halt(); clearInterval(lifetime); process.removeListener('SIGINT', halt);
        report.finishedAt = new Date().toISOString();
        report.productionSourcesUnchanged = files.every(file => fs.readFileSync(path.join(root, file), 'utf8') === source[file]);
        report.comboSummary = summarizeCombos(report.trials);
        report.recommendationCandidates = report.comboSummary.filter(x => x.admittedTrials >= 3 && x.fullSuccessTrials === x.admittedTrials && !x.any429)
            .sort((a, b) => a.worstFullScanMs - b.worstFullScanMs || a.medianFullScanMs - b.medianFullScanMs);
        save(); fs.unlinkSync(lock); console.log(JSON.stringify({ status: report.status, stopReason: report.stopReason,
            trials: report.trials.length, recommendationCandidates: report.recommendationCandidates, output }));
    }
}

if (require.main === module) run({ live: process.argv.includes('--live'), resume: process.argv.includes('--resume') }).catch(error => { console.error(String(error.message).slice(0, 200)); process.exitCode = 1; });
module.exports = { load, interactiveTags, activeFury, summarizeProvider, summarizeCombos };
