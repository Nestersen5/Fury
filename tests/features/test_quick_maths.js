'use strict';

const assert = require('assert');
const { createQuickMathsSession } = require('../../features/quick_maths');
const { createHypixelCommandQueue } = require('../../src/net/hypixelCommandQueue');

function harness(random = 0, queued = false) {
    let time = 0, enabled = true, ready = true, nextId = 0;
    const timers = new Map(), sent = [];
    const clock = {
        now: () => time,
        setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: time + delay }); return id; },
        clearTimeout(id) { timers.delete(id); }
    };
    const queue = createHypixelCommandQueue({ ...clock, minIntervalMs: 400,
        send: command => sent.push({ command, at: time }), canSend: () => ready });
    const session = createQuickMathsSession({ ...clock, isEnabled: () => enabled,
        isOwnUuid: uuid => uuid === 'self',
        isPlayState: () => ready, random: () => random,
        sendCommand: queued ? queue.enqueue : command => sent.push({ command, at: time }) });
    return {
        session, sent, queue, timers,
        packet(name, data) { session.observeServer(data, { name }); },
        enable(value) { enabled = value; }, ready(value) { ready = value; },
        chat(component, position = 0) { session.observeServer({ message: JSON.stringify(component), position }, { name: 'chat' }); },
        tick(delta) {
            const until = time + delta;
            for (;;) {
                const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
                if (!next || next[1].at > until) break;
                timers.delete(next[0]); time = next[1].at; next[1].fn();
            }
            time = until;
        }
    };
}

// Synthetic 1.8.9 components reflecting the supplied screenshots. Commands are
// deliberately opaque fixtures: production must use the actual click payload.
function choices(values = [8, 13, 5]) {
    return { text: '', extra: [...values.map((answer, index) => ({ text: `[${answer}]`, color: 'green',
        clickEvent: { action: 'run_command', value: `/fixture-answer token-${index}` } })), { text: ' (Click)' }] };
}
function question(expression) { return { text: `\u00a7dQUICK MATHS! \u00a7e${expression} = ?` }; }
function start(h, expression = '8 / 1', values = [8, 13, 5]) { h.chat(question(expression)); h.chat(choices(values)); }


function mode(h, gameMode) { h.packet('game_state_change', { reason: 3, gameMode }); }

for (const [expression, answer] of [['15 - 27', -12], ['25 / 5', 5], ['12 * 2', 24], ['12 x 2', 24],
    ['12 \u00d7 2', 24], ['8 \u00f7 2', 4], ['12 + 2', 14], ['-3 - -2', -1], ['5 / 2', 2.5], ['0.1 + 0.2', 0.3]]) {
    const h = harness(); start(h, expression, [answer + 1, answer, answer - 1]);
    h.tick(7999); assert.equal(h.sent.length, 0, 'Never answer before 8 seconds');
    h.tick(1); assert.deepEqual(h.sent, [{ command: '/fixture-answer token-1', at: 8000 }], expression);
    h.chat(choices([answer + 1, answer, answer - 1])); h.tick(20000);
    assert.equal(h.sent.length, 1, 'Duplicate options must not answer twice');
    assert.equal(h.timers.size, 0);
}
for (const [random, delay] of [[0, 8000], [0.25, 8250], [0.5, 8500], [0.9999, 8999], [1, 9000]]) {
    const h = harness(random); start(h); h.tick(delay - 1); assert.equal(h.sent.length, 0);
    h.tick(1); assert.equal(h.sent[0].at, delay, 'Random delay stays within 8-9 seconds');
}
{
    const h = harness(0.5); h.chat(question('8 / 1')); h.tick(4000); h.chat(choices());
    h.tick(4499); assert.equal(h.sent.length, 0); h.tick(1);
    assert.equal(h.sent[0].at, 8500, 'Delay starts at the question, not at the options');
}
{
    const h = harness(); start(h); h.tick(5000); start(h); h.tick(3000);
    assert.equal(h.sent[0].at, 8000, 'Duplicate questions cannot restart the clock');
}
{
    const h = harness(); h.chat(question('8 / 1')); h.tick(9500); h.chat(choices()); h.tick(0);
    assert.equal(h.sent.length, 0, 'Late options must not send outside the time window');
}
{
    const h = harness();
    const payload = { text: '', extra: [question('8 / 1'), { text: '\n' }, choices()] };
    const before = JSON.stringify(payload);
    h.chat(payload); h.chat(payload); h.tick(8000);
    assert.equal(h.sent.length, 1, 'Combined and duplicate packets');
    assert.equal(JSON.stringify(payload), before, 'Server messages stay unchanged');
}
{
    const h = harness(); h.chat(question('8 / 1'));
    h.chat({ text: '', extra: [{ text: '[', extra: [{ text: '8' }, { text: ']' }],
        clickEvent: { action: 'run_command', value: '/opaque correct' } }, ...choices([13, 5]).extra] });
    h.tick(8000); assert.equal(h.sent[0].command, '/opaque correct', 'Inherited click on split answer');
}
for (const expression of ['8 / 0', '12 ** 2', '1 + 2 + 3', '9007199254740992 * 2']) {
    const h = harness(); start(h, expression); h.tick(10000); assert.equal(h.sent.length, 0, expression);
}
for (const component of [
    { text: 'Player: QUICK MATHS! 8 / 1 = ?' },
    { translate: 'chat.type.text', with: [{ text: 'Player' }, question('8 / 1')] },
    { text: 'unrelated', hoverEvent: { action: 'show_text', value: question('8 / 1') } },
    { text: 'QUICK MATHS! 8 / 1 = ? unrelated text' }
]) {
    const h = harness(); h.chat(component); h.chat(choices()); h.tick(10000); assert.equal(h.sent.length, 0);
}
for (const action of ['open_url', 'suggest_command', 'run_command']) {
    const h = harness(); h.chat(question('8 / 1'));
    const options = choices(); options.extra[0].clickEvent = { action, value: action === 'run_command' ? '/bad\ncommand' : '/fixture' };
    h.chat(options); h.tick(10000); assert.equal(h.sent.length, 0, 'Only valid slash run_command clicks');
}
for (const cancel of [h => h.enable(false), h => h.ready(false), h => h.session.reset(),
    h => h.packet('respawn', {}), h => h.packet('login', {}),
    h => h.chat({ text: 'Correct!' }), h => h.chat({ text: "Time's up!" }),
    h => h.session.observeCommand('/fixture-answer token-2')]) {
    const h = harness(); start(h); h.tick(7900); cancel(h); h.tick(2000);
    assert.equal(h.sent.length, 0, 'Cancellation before dispatch');
}
for (const command of ['/fixture-answer token-0', '/fixture-answer token-1', '/fixture-answer token-2']) {
    const h = harness(); start(h); h.tick(3000); h.session.observeCommand(command);
    start(h); h.tick(10000);
    assert.equal(h.sent.length, 0, 'Any manual choice suppresses auto-answer despite duplicate questions');
}
{
    const h = harness(); start(h); h.session.observeCommand('/unrelated'); h.tick(8000);
    assert.equal(h.sent.length, 1, 'Unrelated commands do not count as an answer');
}
{
    const h = harness(); h.enable(false); start(h); h.enable(true); h.tick(10000);
    assert.equal(h.sent.length, 0, 'Enabling must not revive a disabled challenge');
    start(h); h.tick(7900); start(h, '12 x 2', [24, 9, 1]); h.tick(100);
    assert.equal(h.sent.length, 0, 'New challenge invalidates old answer');
    h.tick(7900); assert.equal(h.sent.length, 1);
}
async function testLifecycle() {
    {
        const h = harness(0.5); h.packet('login', { dimension: 0, gameMode: 0 });
        start(h); h.tick(800);
        h.packet('update_health', { health: 0 });
        h.packet('respawn', { dimension: 0, gamemode: 3 });
        h.packet('update_health', { health: 20 }); h.tick(30000);
        assert.equal(h.sent.length, 0, 'Health recovery must not allow answers while spectating');
        assert.equal(h.timers.size, 0, 'No polling while paused');
        h.packet('respawn', { dimension: 0, gamemode: 0 }); h.tick(7699);
        assert.equal(h.sent.length, 0); h.tick(1);
        assert.equal(h.sent[0].at, 38500, 'Only active time counts toward the chosen 8.5 seconds');
    }
    {
        const h = harness(); mode(h, 3); start(h); h.tick(30000);
        assert.equal(h.sent.length, 0); mode(h, 0); h.tick(7999);
        assert.equal(h.sent.length, 0); h.tick(1); assert.equal(h.sent.length, 1);
    }
    {
        const h = harness(); start(h); h.tick(7000);
        h.packet('title', { action: 0, text: JSON.stringify({ text: 'YOU DIED!' }) });
        h.tick(20000); h.chat({ text: 'You will respawn in 1 second!' }); h.tick(1000);
        assert.equal(h.sent.length, 0);
        h.packet('title', { action: 0, text: JSON.stringify({ text: 'RESPAWNED!' }) });
        h.tick(999); assert.equal(h.sent.length, 0); h.tick(1); assert.equal(h.sent.length, 1);
    }
    {
        const h = harness(); start(h);
        h.packet('player_info', { action: 'update_game_mode', data: [{ uuid: 'other', gamemode: 3 }] });
        h.tick(8000); assert.equal(h.sent.length, 1); h.session.reset();
        h.packet('player_info', { action: 'update_game_mode', data: [{ uuid: 'self', gamemode: 3 }] });
        start(h); h.tick(20000); assert.equal(h.sent.length, 1);
        h.packet('player_info', { action: 'update_game_mode', data: [{ uuid: 'self', gamemode: 0 }] });
        h.tick(8000); assert.equal(h.sent.length, 2);
    }
    for (const boundary of [h => h.packet('login', { dimension: 0, gameMode: 0 }),
        h => h.packet('respawn', { dimension: -1, gamemode: 0 }), h => h.session.reset(),
        h => h.session.observeCommand('/fixture-answer token-0'), h => h.chat({ text: 'Correct!' })]) {
        const h = harness(); h.packet('login', { dimension: 0, gameMode: 0 }); start(h);
        mode(h, 3); h.tick(20000); boundary(h); mode(h, 0); h.tick(20000);
        assert.equal(h.sent.length, 0, 'Paused cancellation cannot revive stale answers');
    }
    {
        const h = harness(0, true); start(h); h.tick(7900); h.queue.enqueue('/earlier'); h.tick(100);
        assert.equal(h.queue.snapshot().queued, 1);
        h.session.observeCommand('/fixture-answer token-2');
        await Promise.resolve(); h.tick(2000);
        assert.deepEqual(h.sent.map(item => item.command), ['/earlier'], 'Manual answer cancels queued automation');
    }
    {
        const h = harness(0, true); start(h); h.tick(7900); h.queue.enqueue('/earlier'); h.tick(100);
        mode(h, 3); await Promise.resolve(); h.tick(20000);
        assert.equal(h.sent.length, 1); assert.equal(h.queue.snapshot().queued, 0);
        mode(h, 0); h.tick(0); await Promise.resolve(); assert.equal(h.sent.length, 2);
        mode(h, 3); h.tick(1000); mode(h, 0); h.tick(2000);
        assert.equal(h.sent.length, 2, 'Never repeat a sent answer after another death');
    }
    {
        const h = harness(0, true); start(h); h.tick(8000);
        mode(h, 3); mode(h, 0); await Promise.resolve(); h.tick(2000);
        assert.equal(h.sent.length, 1, 'Pause before promise settlement must not duplicate a sent answer');
    }
    {
        const h = harness(0.9, true); start(h); h.tick(8800); h.queue.enqueue('/earlier');
        h.tick(2000);
        assert.deepEqual(h.sent.map(item => item.command), ['/earlier'], 'A busy queue must not send after 9 seconds');
    }
    console.log('PASS Quick Maths arithmetic, random 8-9 second timing, manual answers, respawn and queue lifecycle');
}
testLifecycle().catch(error => { console.error(error); process.exitCode = 1; });
