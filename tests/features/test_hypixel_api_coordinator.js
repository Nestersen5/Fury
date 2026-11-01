'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { EventEmitter } = require('events');
const { attachHypixelApiCoordinator, createHypixelApiCoordinatorClient, responseSummary } = require('../../src/net/hypixelApiCoordinator');

const clientFile = path.resolve(__dirname, '../../features/hypixel_api_client.js');
const currentSource = fs.readFileSync(clientFile, 'utf8');
const URL = 'https://api.hypixel.net/v2/player?uuid=synthetic';
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };

function fixture(source = currentSource) {
    let now = 1000000, sequence = 0;
    const timers = new Map();
    const clock = {
        get now() { return now; },
        setTimeout(fn, delay) {
            const timer = { id: ++sequence, at: now + Math.max(1, delay), fn, unref() {} };
            timers.set(timer.id, timer);
            return timer;
        },
        clearTimeout(timer) { timers.delete(timer?.id); },
        async until(elapsed) {
            const deadline = 1000000 + elapsed;
            await flush();
            for (let steps = 0; ; steps++) {
                assert(steps < 10000, 'Queue must not busy-loop.');
                const timer = [...timers.values()].sort((a, b) => a.at - b.at)[0];
                if (!timer || timer.at >= deadline) break;
                timers.delete(timer.id);
                now = timer.at;
                timer.fn();
                await flush();
            }
            now = deadline;
            await flush();
        }
    };
    class ClockDate extends Date { static now() { return now; } }
    const deterministicMath = Object.create(Math);
    deterministicMath.random = () => 0.5;
    const module = { exports: {} };
    vm.runInNewContext(source, {
        require: createRequire(clientFile), module, exports: module.exports,
        Date: ClockDate, Math: deterministicMath, URL: global.URL,
        setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, console
    }, { filename: clientFile });
    return { clock, createClient: module.exports.createHypixelApiClient };
}

function pair() {
    const parent = new EventEmitter(), child = new EventEmitter(), messages = [];
    for (const [from, to] of [[parent, child], [child, parent]]) {
        from.connected = true;
        from.send = (message, callback) => {
            if (!from.connected) throw new Error('Disconnected');
            const copy = JSON.parse(JSON.stringify(message));
            messages.push(copy);
            queueMicrotask(() => { if (to.connected) to.emit('message', copy); callback?.(); });
        };
    }
    return { parent, child, messages, disconnect() {
        parent.connected = child.connected = false;
        parent.emit('disconnect'); child.emit('disconnect');
    } };
}

async function budgetScenario(priority, source = currentSource) {
    const { clock, createClient } = fixture(source);
    let count = 0;
    const client = createClient({
        axios: { async get() { count++; return { status: 200, headers: {}, data: {} }; } },
        getKeys: () => ({ hypixel: 'synthetic-key' }), logger: { warn() {} }
    });
    const jobs = Array.from({ length: 1000 }, () => client.hypixelApiGet(URL, { apiPriority: priority }));
    await clock.until(300000);
    const result = { priority, startsInFiveMinutes: count };
    // Do not drain the intentionally oversubscribed backlog into real networking.
    void jobs;
    return result;
}

async function pacingSettingsTests() {
    const f = fixture(), calls = [];
    const client = f.createClient({ getKeys: () => ({ hypixel: 'fixture' }), logger: { warn() {} },
        axios: { get() { calls.push(f.clock.now - 1000000); return new Promise(resolve => f.clock.setTimeout(() => resolve({ status: 200, headers: {}, data: {} }), 1000)); } } });
    client.configureHypixelRequests({ hypixelRequestDelayMs: 500, hypixelRequestConcurrency: 1 });
    const jobs = Array.from({ length: 8 }, () => client.hypixelApiGet(URL, { apiPriority: 'game' }));
    await f.clock.until(200); assert.equal(calls.length, 1);
    client.configureHypixelRequests({ hypixelRequestDelayMs: 100, hypixelRequestConcurrency: 3 });
    await f.clock.until(750); assert.equal(calls.length, 3); assert.equal(calls[1], 200);
    client.configureHypixelRequests({ hypixelRequestDelayMs: 350, hypixelRequestConcurrency: 1 });
    await f.clock.until(1299); assert.equal(calls.length, 3, 'Active reads finish before a lower cap admits another');
    await f.clock.until(10000); await Promise.all(jobs);
    assert.equal(calls[3], 1300); assert.equal(client.getHypixelApiUsageSnapshot().lastFiveMinutes, 8);

    const slower = fixture(), starts = [];
    const paced = slower.createClient({ getKeys: () => ({ hypixel: 'fixture' }), logger: { warn() {} },
        axios: { async get() { starts.push(slower.clock.now - 1000000); return { status: 200, headers: {}, data: {} }; } } });
    const pending = Array.from({ length: 3 }, () => paced.hypixelApiGet(URL, { apiPriority: 'game' }));
    await slower.clock.until(100);
    paced.configureHypixelRequests({ hypixelRequestDelayMs: 600 });
    await slower.clock.until(599); assert.equal(starts.length, 1);
    await slower.clock.until(2000); await Promise.all(pending); assert.deepEqual(starts, [0, 600, 1200]);

    const budget = fixture(); let count = 0;
    const bounded = budget.createClient({ getKeys: () => ({ hypixel: 'fixture' }), logger: { warn() {} },
        axios: { async get() { count++; return { status: 200, headers: {}, data: {} }; } } });
    bounded.configureHypixelRequests({ hypixelRequestDelayMs: 0, hypixelRequestConcurrency: 16 });
    for (let i = 0; i < 305; i++) void bounded.hypixelApiGet(URL, { apiPriority: 'game' });
    await budget.clock.until(100000); assert.equal(count, 300);
    bounded.configureHypixelRequests({ hypixelRequestDelayMs: 50, hypixelRequestConcurrency: 4 });
    await budget.clock.until(299999); assert.equal(count, 300, 'A settings change cannot refill the rolling budget');

    const adaptive = fixture(), adaptiveStarts = [];
    const adaptiveClient = adaptive.createClient({ getKeys: () => ({ hypixel: 'fixture' }), logger: { warn() {} },
        axios: { async get() { adaptiveStarts.push(adaptive.clock.now); return { status: 200, headers: {}, data: {} }; } } });
    adaptiveClient.configureHypixelRequests({ hypixelRequestDelayMs: 10 });
    const adaptiveJobs = Array.from({ length: 165 }, () => adaptiveClient.hypixelApiGet(URL, { apiPriority: 'game' }));
    await adaptive.clock.until(5000); await Promise.all(adaptiveJobs);
    assert(adaptiveStarts[151] - adaptiveStarts[150] >= 15, 'Quota-based slowdown scales the chosen base delay');

    const shared = fixture(), channels = pair(); let allowed = true, fallback = 0;
    const ownerClient = shared.createClient({ getKeys: () => ({ hypixel: 'fixture' }), logger: { warn() {} }, axios: { async get() { throw Error('Unexpected owner HTTP'); } } });
    const local = shared.createClient({ getKeys: () => ({ hypixel: 'fixture' }), logger: { warn() {} }, axios: { async get() { fallback++; throw Error('Unexpected fallback'); } } });
    const owner = attachHypixelApiCoordinator(channels.parent, { client: ownerClient, instanceId: 'settings', canConfigure: () => allowed });
    const remote = createHypixelApiCoordinatorClient({ channel: channels.child, instanceId: 'settings', localClient: local,
        getGameState: () => ({ gameActive: true }), axios: { async get() { return { status: 200, headers: {}, data: {} }; } } });
    remote.configureHypixelRequests({ hypixelRequestDelayMs: 350, hypixelRequestConcurrency: 2 });
    await flush();
    assert.equal(ownerClient.getHypixelRequestSettings().hypixelRequestDelayMs, 350);
    assert.equal(ownerClient.getHypixelRequestSettings().hypixelRequestConcurrency, 2);
    const requests = Array.from({ length: 3 }, () => remote.hypixelApiGet(URL));
    await shared.clock.until(2000); await Promise.all(requests);
    remote.configureHypixelRequests({ hypixelRequestDelayMs: 100, hypixelRequestConcurrency: 4 }); await flush();
    assert.equal(ownerClient.getHypixelApiUsageSnapshot().lastFiveMinutes, 3);
    channels.child.send({ type: 'hypixel-api', version: 1, instanceId: 'stale', action: 'configure', settings: { hypixelRequestDelayMs: 0, hypixelRequestConcurrency: 16 } });
    channels.child.send({ type: 'hypixel-api', version: 1, instanceId: 'settings', action: 'configure', settings: { hypixelRequestDelayMs: -1, hypixelRequestConcurrency: 16 } });
    await flush(); assert.equal(ownerClient.getHypixelRequestSettings().hypixelRequestDelayMs, 100);
    allowed = false;
    channels.child.send({ type: 'hypixel-api', version: 1, instanceId: 'settings', action: 'configure', settings: { hypixelRequestDelayMs: 500, hypixelRequestConcurrency: 1 } });
    await flush(); assert.equal(ownerClient.getHypixelRequestSettings().hypixelRequestDelayMs, 100);
    assert.equal(fallback, 0); assert(channels.messages.every(m => JSON.stringify(m).length < 6000));
    remote.close(); owner.close();
}

async function run() {
    await pacingSettingsTests();
    for (const priority of ['game', 'background']) {
        const result = await budgetScenario(priority);
        assert.equal(result.startsInFiveMinutes, 300, 'Missing headers must still enforce the five-minute budget.');
    }

    const { clock, createClient } = fixture();
    const channels = pair(), calls = [];
    let gameState = null;
    const fullResponse = { status: 200, headers: {}, data: { player: { payload: 'x'.repeat(1000000) } } };
    const client = createClient({
        axios: { async get(url) { calls.push({ source: 'launcher', url, at: clock.now }); return fullResponse; } },
        getKeys: () => ({ hypixel: 'shared-key' }), getGameState: () => gameState, logger: { warn() {} }
    });
    const owner = attachHypixelApiCoordinator(channels.parent, {
        client, instanceId: 'instance-1', onGameState: state => { gameState = state; }
    });
    const remote = createHypixelApiCoordinatorClient({
        channel: channels.child, instanceId: 'instance-1', localClient: client,
        getGameState: () => ({ gameActive: true, gameSessionId: 'match', currentGamemode: 'BEDWARS' }),
        axios: { async get(url, options) {
            assert.equal(options.headers['API-Key'], 'shared-key');
            assert.equal(new global.URL(url).searchParams.get('key'), null);
            assert.equal('apiPriority' in options, false);
            calls.push({ source: 'proxy', url, at: clock.now });
            return fullResponse;
        } }
    });
    await flush();
    const first = client.hypixelApiGet(URL, { apiPriority: 'background' });
    await flush();
    const background = client.hypixelApiGet(URL, { apiPriority: 'background' });
    const scan = remote.hypixelApiGet(URL + '&key=legacy', { apiPriority: 'game' });
    const scan2 = remote.hypixelApiGet(URL, { apiPriority: 'game' });
    await clock.until(2000);
    const responses = await Promise.all([first, background, scan, scan2]);
    assert(responses.every(response => response === fullResponse), 'Full responses must stay local and unchanged.');
    assert.deepEqual(calls.map(call => call.source), ['launcher', 'proxy', 'proxy', 'launcher'], 'Gameplay must run ahead of queued launcher background work.');
    assert(calls[2].at - calls[1].at >= 150, 'Both proxy scans share the configured game cadence.');
    assert.equal(client.getHypixelApiUsageSnapshot().lastFiveMinutes, 4);
    remote.getHypixelApiUsageSnapshot(); await flush();
    assert.equal(remote.getHypixelApiUsageSnapshot().lastFiveMinutes, 4, 'Proxy usage includes launcher calls.');
    assert(channels.messages.every(message => JSON.stringify(message).length < 6000), 'Large player data must never be cloned over IPC.');

    // A restarted proxy retains the owner's quota, and stale instance messages cannot request grants.
    remote.close(); owner.close();
    const restartedChannels = pair();
    const restarted = attachHypixelApiCoordinator(restartedChannels.parent, { client, instanceId: 'instance-2' });
    restartedChannels.child.send({ type: 'hypixel-api', version: 1, instanceId: 'instance-1', action: 'request', id: 'stale', url: URL });
    await flush();
    assert.equal(client.getHypixelApiUsageSnapshot().lastFiveMinutes, 4);
    assert(!restartedChannels.messages.some(message => message.action === 'grant'));
    restarted.close();

    // The last upstream quota slots include requests that have not replied yet.
    const limitedFixture = fixture();
    let limitedCalls = 0;
    const limited = limitedFixture.createClient({
        axios: { get() {
            limitedCalls++;
            return new Promise(resolve => limitedFixture.clock.setTimeout(() => resolve({
                status: 200, headers: { 'RateLimit-Limit': '10', 'RateLimit-Remaining': '3', 'RateLimit-Reset': '60' }, data: {}
            }), 800));
        } }, getKeys: () => ({ hypixel: 'limited-key' }), logger: { warn() {} }
    });
    for (let i = 0; i < 20; i++) void limited.hypixelApiGet(URL, { apiPriority: 'game' });
    await limitedFixture.clock.until(5000);
    assert(limitedCalls <= 5, 'An upstream low-quota response must reserve slots for other in-flight requests.');
    const reservedCount = limitedCalls;
    limited.configureHypixelRequests({ hypixelRequestDelayMs: 0, hypixelRequestConcurrency: 16 });
    await limitedFixture.clock.until(10000);
    assert.equal(limitedCalls, reservedCount, 'Settings cannot release provider-reported quota reservations');

    // A 429 from one process cools down both, preserving the original error response.
    const cooldownFixture = fixture(), cooldownChannels = pair();
    const originalError = Object.assign(new Error('429 fixture'), { response: {
        status: 429, headers: { 'Retry-After': '60' }, data: { success: false, cause: 'Rate limited' }
    } });
    let launcherStarts = 0;
    const cooldown = cooldownFixture.createClient({
        axios: { async get() { launcherStarts++; return { status: 200, headers: {}, data: {} }; } },
        getKeys: () => ({ hypixel: 'cooldown-key' }), logger: { warn() {} }
    });
    const cooldownOwner = attachHypixelApiCoordinator(cooldownChannels.parent, { client: cooldown, instanceId: 'cooldown' });
    const cooldownRemote = createHypixelApiCoordinatorClient({
        channel: cooldownChannels.child, instanceId: 'cooldown', localClient: cooldown, getGameState: () => null,
        axios: { async get() { throw originalError; } }
    });
    const rejected = assert.rejects(cooldownRemote.hypixelApiGet(URL), error => error === originalError);
    await flush(); await rejected;
    const queued = cooldown.hypixelApiGet(URL);
    cooldownRemote.configureHypixelRequests({ hypixelRequestDelayMs: 0, hypixelRequestConcurrency: 16 });
    await flush();
    await cooldownFixture.clock.until(59000);
    assert.equal(launcherStarts, 0, 'Launcher must honor a proxy 429 cooldown.');
    await cooldownFixture.clock.until(62000);
    await queued;
    assert.equal(launcherStarts, 1);
    cooldownRemote.close(); cooldownOwner.close();

    // Disconnect cancels queued work without fallback HTTP or leaked active slots.
    const disconnectedChannels = pair();
    const disconnectedOwner = attachHypixelApiCoordinator(disconnectedChannels.parent, { client: cooldown, instanceId: 'disconnect' });
    let fallbackCalls = 0;
    const disconnectedRemote = createHypixelApiCoordinatorClient({
        channel: disconnectedChannels.child, instanceId: 'disconnect', localClient: cooldown, getGameState: () => null,
        axios: { async get() { fallbackCalls++; return fullResponse; } }
    });
    await cooldown.hypixelApiGet(URL);
    const disconnectedRequest = assert.rejects(disconnectedRemote.hypixelApiGet(URL), { code: 'HYPIXEL_COORDINATOR_UNAVAILABLE' });
    // Deliver the enqueue but not the future scheduled background grant.
    await flush(); disconnectedChannels.disconnect(); await flush(); await disconnectedRequest;
    await cooldownFixture.clock.until(65000);
    assert.equal(fallbackCalls, 0);
    assert.equal(cooldown.getHypixelApiUsageSnapshot().queue.queued, 0);
    assert.equal(cooldown.getHypixelApiUsageSnapshot().queue.active, 0);
    disconnectedOwner.close();

    const activeChannels = pair();
    const activeOwner = attachHypixelApiCoordinator(activeChannels.parent, { client: cooldown, instanceId: 'active-disconnect' });
    let activeSignal;
    const activeRemote = createHypixelApiCoordinatorClient({
        channel: activeChannels.child, instanceId: 'active-disconnect', localClient: cooldown, getGameState: () => null,
        axios: { get(url, options) {
            activeSignal = options.signal;
            return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Aborted transport')), { once: true }));
        } }
    });
    const activeRequest = assert.rejects(activeRemote.hypixelApiGet(URL), { code: 'HYPIXEL_COORDINATOR_UNAVAILABLE' });
    await flush();
    assert.equal(cooldown.getHypixelApiUsageSnapshot().queue.active, 1);
    activeChannels.disconnect(); await flush(); await activeRequest;
    assert.equal(activeSignal.aborted, true);
    assert.equal(cooldown.getHypixelApiUsageSnapshot().queue.active, 0);
    activeOwner.close();

    // A game-scoped AbortSignal also cancels a queued remote retry before grant.
    const signalChannels = pair();
    const signalOwner = attachHypixelApiCoordinator(signalChannels.parent, { client: cooldown, instanceId: 'signal' });
    let cancelledStarts = 0;
    const signalRemote = createHypixelApiCoordinatorClient({
        channel: signalChannels.child, instanceId: 'signal', localClient: cooldown, getGameState: () => null,
        axios: { async get() { cancelledStarts++; return fullResponse; } }
    });
    const controller = new AbortController();
    const signalledRequest = assert.rejects(signalRemote.hypixelApiGet(URL, { signal: controller.signal }), error => error.name === 'AbortError');
    await flush();
    controller.abort(); await flush(); await signalledRequest;
    await cooldownFixture.clock.until(66000);
    assert.equal(cancelledStarts, 0);
    assert.equal(cooldown.getHypixelApiUsageSnapshot().queue.queued, 0);
    signalRemote.close(); signalOwner.close();

    const validationFixture = fixture();
    let key = 'primary-key', validationCalls = 0;
    const validation = validationFixture.createClient({
        axios: { async get(url, options) {
            validationCalls++;
            if (options.headers['API-Key'] !== key) return {
                status: 403, headers: {}, data: { success: false, cause: 'Invalid API key' }
            };
            return { status: 400, headers: {}, data: { success: false, cause: 'Missing UUID' } };
        } }, getKeys: () => ({ hypixel: key }), logger: { warn() {} }
    });
    const badKey = validation.hypixelApiGet(URL, { apiKey: 'candidate-key', validateStatus: () => true });
    await validationFixture.clock.until(1000);
    assert.equal((await badKey).status, 403, 'Manual key checks preserve raw HTTP status handling.');
    assert.equal(validation.getHypixelApiUsageSnapshot().keyPool[0].healthy, true, 'A rejected candidate must not disable the saved key.');
    const goodKey = validation.hypixelApiGet(URL, { apiKey: key, validateStatus: () => true });
    await validationFixture.clock.until(2000);
    assert.equal((await goodKey).status, 400);
    assert.equal(validationCalls, 2);
    key = '';
    const missingKey = assert.rejects(validation.hypixelApiGet(URL), error => error.hypixelApiUnavailable);
    await validationFixture.clock.until(3000); await missingKey;
    assert.equal(validationCalls, 2);
    assert.equal(validation.getHypixelApiUsageSnapshot().lastFiveMinutes, 2, 'Locally rejected requests do not consume quota or inflate usage.');

    // Exhausting a window must resume queued work instead of dropping it.
    const resumeFixture = fixture();
    let resumedCalls = 0;
    const resume = resumeFixture.createClient({
        axios: { async get() { resumedCalls++; return { status: 200, headers: {}, data: {} }; } },
        getKeys: () => ({ hypixel: 'resume-key' }), logger: { warn() {} }
    });
    const backlog = Array.from({ length: 305 }, () => resume.hypixelApiGet(URL, { apiPriority: 'game' }));
    await resumeFixture.clock.until(300000);
    assert.equal(resumedCalls, 300);
    assert.equal(resume.getHypixelApiUsageSnapshot().queue.queued, 5);
    await resumeFixture.clock.until(305000); await Promise.all(backlog);
    assert.equal(resumedCalls, 305);

    assert.equal(responseSummary(fullResponse).data, undefined);
    console.log('Hypixel shared coordinator tests passed.');
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { budgetScenario, fixture };
