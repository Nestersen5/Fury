'use strict';
const assert = require('assert');
const { createNickReroller } = require('../../src/nick/reroller');
const { DEFAULTS, matches, validate, matchReason, normalizeSettings } = require('../../src/nick/settings');
const { createHypixelCommandQueue } = require('../../src/net/hypixelCommandQueue');
const { createNickPacing } = require('../../src/nick/pacing');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function clock() {
    let time = 0, id = 0;
    const timers = new Map();
    return { now: () => time, setTimeout(fn, ms) { timers.set(++id, { fn, at: time + ms }); return id; },
        clearTimeout(key) { timers.delete(key); },
        tick(ms) { const end = time + ms; for (;;) {
            const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break; timers.delete(next[0]); time = next[1].at; next[1].fn();
        } time = end; } };
}
function book(commands) {
    return { blockId: 387, nbtData: { type: 'compound', name: '', value: {
        pages: { type: 'list', value: { type: 'string', value: [JSON.stringify(commands.map(value => ({ text: 'Button', clickEvent: { action: 'run_command', value } })))] } }
    } } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const messageText = message => typeof message === 'string' ? message
    : (message.text || '') + (message.extra || []).map(messageText).join('');
function harness(config = {}, random = () => 0) {
    const time = clock(), sent = [], messages = [], sounds = [];
    let preferences = { ...DEFAULTS, digits: 'exclude', ...config }, blocked = null;
    const queue = createHypixelCommandQueue({ now: time.now, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
        send(command) { sent.push(command); } });
    const controller = createNickReroller({ sendCommand: (c, o) => queue.enqueue(c, o), sendChat: m => messages.push(m),
        playSound: sound => sounds.push({ ...sound, at: time.now() }),
        getSettings: () => preferences, saveSettings: s => { preferences = s; }, canStart: () => blocked,
        now: time.now, setTimer: time.setTimeout, clearTimer: time.clearTimeout, random });
    const command = text => controller.command(text.split(' '));
    const packet = (name, data) => controller.observeServer(data, { name });
    const respond = commands => {
        assert.strictEqual(packet('set_slot', { windowId: 0, slot: 36, item: book(commands) }), false, 'inventory updates always pass through');
        return packet('custom_payload', { channel: 'MC|BOpen', data: Buffer.alloc(0) });
    };
    const advance = async ms => { time.tick(ms); await flush(); };
    async function setup() {
        command('/nickroll start'); await advance(0);
        assert.strictEqual(sent.at(-1), '/nick help start');
        assert(respond(['/nick help rank NONE'])); await advance(1500);
        assert.strictEqual(sent.at(-1), '/nick help rank NONE');
        assert(respond(['/nick help skin random', '/nick help skin actual'])); await advance(1500);
        assert.strictEqual(sent.at(-1), '/nick help skin random');
        assert(respond(['/nick help setrandom'])); await advance(1500);
        assert.strictEqual(sent.at(-1), '/nick help setrandom');
    }
    return { time, sent, messages, sounds, controller, queue, command, packet, respond, advance, setup, preferences: () => preferences, block: value => { blocked = value; } };
}

async function main() {
    const migrated = normalizeSettings({ adaptive: false, delay: 9000, prefix: 'cat' });
    assert.equal(migrated.adaptive, true);
    assert.equal(migrated.delay, 1500);
    assert.equal(migrated.prefix, 'cat', 'Pacing migration preserves matching rules');
    for (const offered of [true, false]) {
        const previous = harness({ skin: 'previous' });
        previous.command('/nickroll start'); await previous.advance(0);
        previous.respond(['/nick help rank NONE']); await previous.advance(1500);
        previous.respond(['/nick help skin random', '/nick help skin actual', ...(offered ? ['/nick help skin COUNTRYGIRL'] : [])]);
        await previous.advance(1500);
        if (offered) assert.equal(previous.sent.at(-1), '/nick help skin COUNTRYGIRL');
        else {
            assert.equal(previous.controller.isBusy(), false);
            assert(previous.messages.some(message => messageText(message).includes('No previous skin was offered')));
        }
        previous.controller.dispose(); previous.queue.close();
    }
    assert.equal(normalizeSettings({ prefix: 'cat' }).ogEnabled, true, 'Existing profiles retain OG matching');
    assert.equal(matchReason('aaaName', { ...DEFAULTS, words: [], wordGroups: [], ogEnabled: false }), null, 'OG matching can be disabled');
    assert.equal(matchReason('aaaName', { ...DEFAULTS, words: [], wordGroups: [], ogEnabled: true }), 'OG: repeated letters');
    const helpOnly = harness();
    const originalPreferences = JSON.stringify(helpOnly.preferences());
    for (const command of ['/nickroll', '/nickroll help filters', '/nickroll help words', '/nickroll help setup',
        '/nickroll filters', '/nickroll filter', '/nickroll words', '/nickroll status', '/nickroll timing',
        '/nickroll filter digits', '/nickroll rank', '/nickroll skin', '/nickroll delay']) {
        helpOnly.command(command);
    }
    assert(!JSON.stringify(helpOnly.messages).match(/clickEvent|hoverEvent/), 'Usage must be entirely static');
    assert.strictEqual(JSON.stringify(helpOnly.preferences()), originalPreferences, 'Help must not change settings');
    await helpOnly.advance(30000);
    assert.deepStrictEqual(helpOnly.sent, [], 'Help must not start nickname operations');
    for (const command of ['/nickroll filter max 8', '/nickroll rank VIP', '/nickroll skin actual',
        '/nickroll words add cat', '/nickroll words remove cat', '/nickroll words group blue head',
        '/nickroll words ungroup fresh head', '/nickroll words clear']) helpOnly.command(command);
    assert.strictEqual(JSON.stringify(helpOnly.preferences()), originalPreferences, 'In-game commands cannot change settings');
    assert(helpOnly.messages.some(m => messageText(m).includes('launcher > Nick Reroller')));

    const audible = harness(); await audible.setup();
    audible.respond(['/nick actuallyset Player123 respawn', '/nick help setrandom']);
    assert.equal(audible.sounds.length, 0, 'nonmatching names are silent');
    await audible.advance(1500);
    audible.respond(['/nick actuallyset NiceName respawn', '/nick help setrandom']);
    assert.equal(audible.sounds.length, 1, 'match starts alert immediately');
    await audible.advance(660);
    assert.equal(audible.sounds.length, 12);
    assert.equal(audible.sounds[11].at - audible.sounds[0].at, 660);
    await audible.advance(10000); assert.equal(audible.sounds.length, 12, 'bounded burst');
    audible.controller.dispose(); audible.queue.close();
    for (const action of ['stop', 'use', 'again', 'dispose']) {
        const alert = harness(); await alert.setup();
        alert.respond(['/nick actuallyset NiceName respawn', '/nick help setrandom']);
        if (action === 'dispose') alert.controller.dispose();
        else if (action === 'stop') alert.command('/nickroll stop');
        else alert.command(alert.messages.find(m => typeof m === 'object').extra[action === 'use' ? 0 : 1].clickEvent.value);
        await alert.advance(1000); assert.equal(alert.sounds.length, 1, `${action} cancels alert`);
        alert.controller.dispose(); alert.queue.close();
    }
    const timing = createNickPacing(); timing.begin(1500);
    for (let i = 0; i < 4; i++) timing.observe(200, 700, true);
    assert.equal(timing.delay(1500, true), 1500, 'warm up before reducing delay');
    for (let i = 0; i < 20; i++) timing.observe(200, 700, true);
    assert.equal(timing.delay(1500, true), 500, 'adaptive pacing retains a margin');
    assert.equal(timing.snapshot(1500, true).samples, 20, 'bounded samples');
    assert.equal(timing.snapshot(1500, true).average, 200, 'queue wait excluded');
    timing.observe(6000, 0, true); timing.observe(6000, 0, true);
    assert.equal(timing.delay(1500, true), 3000, 'slow response tail increases pause immediately');
    timing.cooldown(1500); timing.begin(1500);
    assert.equal(timing.delay(1500, true), 6000, 'backoff survives manual restart on this connection');

    async function pacedRun() {
        const simulated = harness();
        await simulated.setup();
        const begin = simulated.time.now();
        for (let i = 0; i < 20; i++) {
            const before = simulated.sent.length;
            await simulated.advance(200);
            assert.equal(simulated.sent.length, before, 'never overlap requests');
            simulated.respond(['/nick actuallyset Player123 respawn', '/nick help setrandom']);
            await simulated.advance(1500);
            assert.equal(simulated.sent.length, before + 1);
        }
        const elapsed = simulated.time.now() - begin;
        simulated.packet('chat', { message: JSON.stringify({ text: 'You are sending ', extra: [{ text: 'commands too fast!' }] }) });
        assert(!simulated.controller.isBusy());
        simulated.command('/nickroll start'); await simulated.advance(0); await simulated.advance(400);
        assert(simulated.respond(['/nick help rank NONE']));
        const count = simulated.sent.length;
        await simulated.advance(999); assert.equal(simulated.sent.length, count, 'cooldown backoff respected after restart');
        simulated.command('/nickroll stop'); await simulated.advance(30000);
        assert.equal(simulated.sent.length, count, 'stop cancels backed-off work');
        simulated.command('/nickroll delay 1500'); assert.equal(simulated.preferences().adaptive, true);
        simulated.controller.dispose(); simulated.queue.close();
        return elapsed;
    }
    await pacedRun();
    let randomCalls = 0;
    const jitter = harness({ adaptive: true }, () => { randomCalls++; return 0.999999; });
    jitter.command('/nickroll start'); await jitter.advance(0);
    assert.equal(randomCalls, 0, 'initial command does not add a pause');
    assert(jitter.respond(['/nick help rank NONE']));
    jitter.command('/nickroll timing'); jitter.command('/nickroll timing');
    assert.equal(randomCalls, 1, 'sample once when scheduling, not when viewing timing');
    await jitter.advance(1699); assert.equal(jitter.sent.length, 1);
    await jitter.advance(1); assert.equal(jitter.sent.length, 2);
    assert(jitter.respond(['/nick help skin random']));
    assert.equal(randomCalls, 2, 'each subsequent pause gets a new random sample');
    jitter.command('/nickroll stop'); await jitter.advance(30000);
    assert.equal(jitter.sent.length, 2, 'Stop cancels the randomized wait');
    jitter.controller.dispose(); jitter.queue.close();

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-nick-settings-'));
    try {
        execFileSync(process.execPath, ['-e', `
            const assert = require('assert');
            const config = require('./app_config');
            const settings = { ...require('./src/nick/settings').DEFAULTS, adaptive: true, digits: 'exclude', max: 8, words: ['cat', 'moon'], wordGroups: [['blue', 'head']] };
            config.saveFeatureSettings({ nickRoll: settings });
            config.saveFeatureSettings({ tabStatsEnabled: false });
            assert.deepStrictEqual(config.loadFeatureSettings().nickRoll, settings);
            assert.strictEqual(config.loadFeatureSettings().tabStatsEnabled, false);
        `], { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, FURY_DATA_DIR: directory }, stdio: 'pipe' });
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    // Real captured Hypixel pages; server selects the slot after sending the item.
    const captured = require('./fixtures/nick_books.json');
    const replay = harness(); replay.command('/nickroll start'); await replay.advance(0);
    for (const page of captured) {
        replay.controller.observeClient({ slotId: 2 }, { name: 'held_item_slot' });
        const item = book([]);
        item.nbtData.value.pages.value.value = page.pages;
        replay.packet('set_slot', { windowId: 0, slot: 36, item });
        replay.packet('held_item_slot', { slot: 0 });
        assert(replay.packet('custom_payload', { channel: 'MC|BOpen' }));
        replay.packet('set_slot', { windowId: 0, slot: 36, item: { blockId: -1 } });
        await replay.advance(1500);
    }
    assert.strictEqual(replay.sent.at(-1), '/nick help setrandom');
    replay.controller.dispose(); replay.queue.close();
    const config = { ...DEFAULTS, min: 5, max: 8, digits: 'exclude', underscores: 'require', prefix: 'ab', suffix: '_', contains: 'CD' };
    assert(matches('Abcd_', validate(config)));
    assert(!matches('Abcd1_', config));
    assert.throws(() => validate({ ...config, contains: '123' }), /cannot match/);
    assert.throws(() => validate({ ...DEFAULTS, min: 3, max: 3, prefix: 'abc', suffix: 'xyz' }), /cannot match/);
    assert.throws(() => validate({ ...DEFAULTS, min: 3, max: 3, prefix: 'abc', digits: 'require' }), /cannot match/);
    validate({ ...DEFAULTS, max: 3, prefix: 'ab', suffix: 'bc', contains: 'b' });
    const restrictive = { ...DEFAULTS, prefix: 'zzz', max: 3 };
    for (const name of ['MiIiA', 'MiiIa', 'MIIia', 'HopeEeE']) assert.equal(matchReason(name, restrictive), null, 'OG runs must have identical capitalization');
    for (const name of ['Miiia', 'Miaaa', 'Coleee', 'Hopeeee', 'MIIIA', 'MiIIIa']) assert.equal(matchReason(name, restrictive), 'OG: repeated letters');
    for (const name of ['fresh_head', 'HeadXXFresh', 'FreshBlueHead']) assert.equal(matchReason(name, restrictive), 'Words: fresh + head');
    for (const name of ['MiiA', 'Mia111', 'Mia___', 'FreshName', 'HeadName', 'MiAiAiA']) assert.equal(matchReason(name, restrictive), null);
    assert.equal(matchReason('NormalName', DEFAULTS), null, 'unset filters must not match every name');
    assert.equal(matchReason('CatName', { ...DEFAULTS, prefix: 'cat' }), 'Filters matched');
    assert.deepEqual(normalizeSettings({ prefix: 'cat' }).wordGroups, [['fresh', 'head']], 'old preferences keep the original word pair');
    const wordLists = harness({ prefix: 'zzz', words: ['moon'], wordGroups: [['blue', 'head']] });
    assert.equal(matchReason('MoonChild', wordLists.preferences()), 'Word: moon');
    assert.equal(matchReason('HeadXXBlue', wordLists.preferences()), 'Words: blue + head');
    assert.equal(matchReason('BlueChild', wordLists.preferences()), null);
    wordLists.command('/nickroll words');
    assert(wordLists.messages.some(m => messageText(m).includes('moon')));
    await wordLists.setup();
    wordLists.command('/nickroll words clear');
    assert.deepEqual(wordLists.preferences().words, ['moon']);
    wordLists.respond(['/nick actuallyset MoonChild respawn', '/nick help setrandom']);
    assert(!wordLists.controller.isBusy());
    assert(!wordLists.sent.some(c => c.includes('actuallyset')), 'word match still needs manual acceptance');
    wordLists.controller.dispose(); wordLists.queue.close();

    for (const name of ['Miiia', 'FreshXXHead']) {
        const special = harness(restrictive); await special.setup();
        assert(special.respond([`/nick actuallyset ${name} respawn`, '/nick help setrandom']));
        assert(!special.controller.isBusy(), 'special names stop despite failed filters');
        assert(!special.sent.some(c => c.includes('actuallyset')), 'special names require manual acceptance');
        const specialResult = special.messages.find(m => typeof m === 'object');
        assert(specialResult.text.includes(matchReason(name, restrictive)));
        special.command(specialResult.extra[0].clickEvent.value); await special.advance(400);
        assert.equal(special.sent.at(-1), `/nick actuallyset ${name} respawn`);
        special.controller.dispose(); special.queue.close();
    }

    const h = harness(); await h.setup();
    await h.advance(5000); assert.strictEqual(h.sent.length, 4, 'no rerolls without a response');
    assert(h.respond(['/nick actuallyset Player123 respawn', '/nick help setrandom']));
    await h.advance(1499); assert.strictEqual(h.sent.length, 4);
    await h.advance(1); assert.strictEqual(h.sent.length, 5, 'pacing begins after response');
    assert(h.respond(['/nick actuallyset NiceName respawn', '/nick help setrandom']));
    assert(!h.controller.isBusy());
    assert(!h.sent.some(c => c.includes('actuallyset')), 'matching never applies automatically');
    const result = h.messages.find(m => typeof m === 'object');
    h.command('/nickroll use stale'); assert.strictEqual(h.sent.length, 5);
    h.command(result.extra[0].clickEvent.value); await h.advance(400);
    assert.strictEqual(h.sent.at(-1), '/nick actuallyset NiceName respawn');
    h.command(result.extra[0].clickEvent.value); await h.advance(1000);
    assert.strictEqual(h.sent.filter(c => c.includes('actuallyset')).length, 1, 'one-shot acceptance');

    const delayed = harness(); delayed.command('/nickroll start'); await delayed.advance(0);
    delayed.packet('set_slot', { windowId: 0, slot: 36, item: book(['/nick help rank NONE']) });
    await delayed.advance(3000); assert.strictEqual(delayed.sent.length, 1, 'must wait for book open, not just item');
    assert(delayed.packet('custom_payload', { channel: 'MC|BOpen' }));
    delayed.command('/nickroll stop'); await delayed.advance(20000); assert.strictEqual(delayed.sent.length, 1);

    const cancelled = harness();
    await cancelled.queue.enqueue('/other'); cancelled.command('/nickroll start'); await cancelled.advance(0);
    cancelled.command('/nickroll stop'); await cancelled.advance(1000);
    assert.deepStrictEqual(cancelled.sent, ['/other'], 'stop cancels queued commands');

    const stale = harness(); await stale.setup();
    stale.respond(['/nick actuallyset NiceName respawn', '/nick help setrandom']);
    const buttons = stale.messages.find(m => typeof m === 'object').extra;
    stale.command(buttons[1].clickEvent.value); stale.command(buttons[0].clickEvent.value);
    await stale.advance(1500); assert(!stale.sent.some(c => c.includes('actuallyset')));
    stale.packet('respawn', {}); await stale.advance(30000); assert(!stale.controller.isBusy());
    assert.strictEqual(stale.respond(['/nick actuallyset LateName respawn', '/nick help setrandom']), false);

    const timeout = harness(); timeout.command('/nickroll start'); await timeout.advance(0); await timeout.advance(15000);
    assert(timeout.controller.isBusy()); assert(timeout.messages.some(m => String(m).includes('timed out')));
    await timeout.advance(9999); assert.equal(timeout.sent.length, 1);
    await timeout.advance(1); assert.equal(timeout.sent.length, 2);
    await timeout.advance(15000); assert(!timeout.controller.isBusy());
    await timeout.advance(60000); assert.equal(timeout.sent.length, 2, 'no third attempt after repeated timeouts');
    const unrelated = harness(); unrelated.command('/nickroll start'); await unrelated.advance(0);
    assert.strictEqual(unrelated.respond(['/shop']), false, 'unrelated book opens normally'); assert(unrelated.controller.isBusy());
    await unrelated.advance(9999); assert.equal(unrelated.sent.length, 1);
    // Late packets during the wait must not consume or extend the single retry.
    unrelated.respond(['/shop']);
    await unrelated.advance(1); assert.equal(unrelated.sent.length, 2);
    unrelated.respond(['/shop']); assert(!unrelated.controller.isBusy());
    await unrelated.advance(60000); assert.equal(unrelated.sent.length, 2);
    unrelated.command('/nickroll start'); await unrelated.advance(0);
    assert(unrelated.controller.isBusy(), 'manual start remains available');
    unrelated.respond(['/shop']); unrelated.command('/nickroll stop');
    await unrelated.advance(30000); assert.equal(unrelated.sent.length, 3, 'Stop cancels recovery');
    const recovered = harness(); await recovered.setup();
    recovered.respond(['/shop']); await recovered.advance(10000);
    assert.equal(recovered.sent.at(-1), '/nick help start', 'recovery reestablishes the full setup');
    recovered.respond(['/nick help rank NONE']); await recovered.advance(1500);
    recovered.respond(['/nick help skin random']); await recovered.advance(1500);
    recovered.respond(['/nick help setrandom']); await recovered.advance(1500);
    recovered.respond(['/nick actuallyset Player123 respawn', '/nick help setrandom']); await recovered.advance(1500);
    recovered.respond(['/shop']); assert(!recovered.controller.isBusy(), 'success does not replenish the one-retry allowance');
    const countAfterRecovery = recovered.sent.length;
    await recovered.advance(60000); assert.equal(recovered.sent.length, countAfterRecovery);
    recovered.controller.dispose(); recovered.queue.close();
    for (const cancel of ['disconnect', 'cooldown', 'permission']) {
        const waiting = harness(); waiting.command('/nickroll start'); await waiting.advance(0);
        waiting.respond(['/shop']);
        if (cancel === 'disconnect') waiting.controller.dispose();
        else waiting.packet('chat', { message: JSON.stringify({ text: cancel === 'cooldown' ? 'You are sending commands too fast!' : 'You cannot nick here.' }) });
        await waiting.advance(30000); assert.equal(waiting.sent.length, 1, `${cancel} cancels recovery`);
        waiting.controller.dispose(); waiting.queue.close();
    }
    const manual = harness(); await manual.setup(); manual.controller.observeCommand('/nick reset');
    await manual.advance(20000); assert(!manual.controller.isBusy());
    const denied = harness(); denied.command('/nickroll start'); await denied.advance(0);
    denied.packet('chat', { message: JSON.stringify({ text: 'You are sending commands too fast!' }) });
    assert(!denied.controller.isBusy());
    const empty = harness({ digits: 'any' }); await empty.setup();
    empty.respond(['/nick actuallyset NormalName respawn', '/nick help setrandom']);
    assert(empty.controller.isBusy(), 'no filters means special-name matching only');
    await empty.advance(1500);
    empty.respond(['/nick actuallyset Coleee respawn', '/nick help setrandom']);
    assert(!empty.controller.isBusy());
    const disposed = harness(); disposed.command('/nickroll start'); disposed.controller.dispose(); await disposed.advance(10000); assert.strictEqual(disposed.sent.length, 0);
    const cancelledAccept = harness(); await cancelledAccept.setup();
    cancelledAccept.respond(['/nick actuallyset NiceName respawn', '/nick help setrandom']);
    const use = cancelledAccept.messages.find(m => typeof m === 'object').extra[0].clickEvent.value;
    cancelledAccept.command(use); cancelledAccept.command('/nickroll stop'); await cancelledAccept.advance(1000);
    assert(!cancelledAccept.sent.some(c => c.includes('actuallyset')), 'Stop cancels queued acceptance');
    cancelledAccept.controller.dispose(); cancelledAccept.queue.close();
    for (const item of [h, delayed, cancelled, stale, timeout, unrelated, manual, denied, empty, disposed]) { item.controller.dispose(); item.queue.close(); }
    console.log('Nick reroller tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
