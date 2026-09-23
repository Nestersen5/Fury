'use strict';

const assert = require('assert');
const {
    AUTOGAMBLER_COMMAND,
    isAutoGamblerTriggerText,
    shouldHideAutoGamblerDialogue,
    normalizeAutoGamblerChatText,
    flattenAutoGamblerChatPayload,
    createAutoGamblerSession
} = require('../../features/auto_gambler.js');

const visibleLine = '[18\u272b] [VIP] DemoPlayer_: [I bet I can] - [Nah not right now] .............';
for (const line of [
    "That's the spirit! [1/4]",
    "No worries, come talk to me later if you change your mind.",
    "I'd rather not do that. [4/4]",
    "If you fail, I'll have to go to work on Saturday to get those Tickets back. [3/4]",
    "Win 2 Bed Wars matches in a row, and I'll give you 200 Slumber Tickets. [2/4]",
    "I knew you could, so I bet a lot of Slumber Tickets on your success. [3/4]",
    "That's pretty cool! [2/4]",
    "Well what do you know, you did it. [1/4]",
    "Here, have some of my earnings, I think you deserve it. [4/4]",
    "I think you can do it again. [1/3]",
    "I'll bet big Tickets on your success, and we'll both win a lot. [2/3]",
    "I bet you can't win 2 Bed Wars matches in a row. [3/3]"
]) {
    const text = `[NPC] Gambler George: ${line}`;
    const data = {message: JSON.stringify({text:'§e[NPC] Gambler George: ',extra:[{text:`§f${line}`}]}),position:0};
    assert(shouldHideAutoGamblerDialogue(data,{name:'chat'},true),line);
    assert(!shouldHideAutoGamblerDialogue(data,{name:'chat'},false),'Off keeps NPC dialogue');
    assert(!shouldHideAutoGamblerDialogue({...data,position:2},{name:'chat'},true));
    assert(!shouldHideAutoGamblerDialogue({message:`Player: ${text}`},{name:'chat'},true),'Player quotes remain visible');
}
for (const message of ['[NPC] Gambler George: You failed the bet!', '[NPC] Gambler George: You won the bet!', '[I bet I can] - [Nah not right now]']) {
    assert(!shouldHideAutoGamblerDialogue({message},{name:'chat'},true),'Other messages remain visible');
}
const colorCodedLine = '[18\u272b] [VIP] DemoPlayer_: \u00a7a[I \u00a7bbet \u00a7dI \u00a7ccan] \u00a77- \u00a7c[Nah \u00a76not \u00a7bright \u00a7anow] .............';
const splitComponent = {
    text: '',
    extra: [
        { text: '[18\u272b] ' },
        { text: '[VIP] ' },
        { text: 'DemoPlayer_: ' },
        { text: '\u00a7a[' },
        { text: '\u00a7eI \u00a7bbet \u00a7dI \u00a7ccan' },
        { text: '\u00a7a] \u00a77- \u00a7c[' },
        { text: '\u00a7eNah \u00a76not \u00a7bright \u00a7anow' },
        { text: '\u00a7c] .............' }
    ]
};

assert.strictEqual(AUTOGAMBLER_COMMAND, '/wanttobet true');
assert(isAutoGamblerTriggerText(visibleLine), 'Auto Gambler should match the visible sample line');
assert(isAutoGamblerTriggerText(colorCodedLine), 'Auto Gambler should match a color-coded prompt line');
assert(isAutoGamblerTriggerText(splitComponent), 'Auto Gambler should match a split Minecraft JSON component');
assert(isAutoGamblerTriggerText(JSON.stringify(splitComponent)), 'Auto Gambler should match a raw JSON packet string');
assert(!isAutoGamblerTriggerText('[18\u272b] DemoPlayer_: I bet I can maybe later'), 'Auto Gambler should not match partial prompt text');

const flattened = flattenAutoGamblerChatPayload(splitComponent).join('');
assert(
    normalizeAutoGamblerChatText(flattened).includes('[I bet I can] - [Nah not right now]'),
    'Auto Gambler normalization should produce the visible prompt text'
);

let now = 2000;
const sentChat = [];
const sentCommands = [];
const observedCommands = [];
const timers = [];
const session = createAutoGamblerSession({
    isEnabled: () => true,
    isPlayState: () => true,
    sendChat: message => sentChat.push(message),
    sendCommand: command => sentCommands.push(command),
    onCommandSent: command => observedCommands.push(command),
    random: () => 0,
    now: () => now,
    setTimeout: (callback, delayMs) => {
        const timer = { callback, delayMs, unref() {} };
        timers.push(timer);
        return timer;
    },
    clearTimeout: timer => {
        timer.cleared = true;
    },
    logger: { log() {} }
});

assert(session.observeRawChatPacket({ plainMessage: visibleLine }, { name: 'player_chat' }), 'Raw player_chat packets should schedule Auto Gambler');
assert.strictEqual(timers[0].delayMs, 500, 'Random delay should be rounded to 0.50s when random returns 0');
assert.strictEqual(sentChat.length, 0, 'Detection must not announce the pending command in chat');
timers[0].callback();
assert.deepStrictEqual(sentCommands, ['/wanttobet true']);
assert.deepStrictEqual(observedCommands, ['/wanttobet true'], 'Quest reminders should be told when Auto Gambler accepts the bet');
assert.strictEqual(sentChat.length, 1, 'Chat confirmation should be sent once the command fires');
assert(sentChat[0].includes('Quest accepted!'), 'Chat confirmation should be the short Quest accepted line');
assert(sentChat[0].includes('Fury'), 'Chat confirmation should carry the proxy prefix');
assert(!sentChat[0].includes('/wanttobet'), 'Chat confirmation must not leak the command text');
assert(!/\d+\.\d+s/.test(sentChat[0]), 'Chat confirmation must not mention timing');

assert(!session.observeRawChatPacket({ plainMessage: visibleLine }, { name: 'player_chat' }), 'Duplicate observations inside the dedupe window should not schedule');
now += 1000;
assert(session.observeChatEvent({ plainMessage: visibleLine }), 'High-level playerChat/systemChat payloads should schedule after dedupe expires');
const pendingTimer = timers[timers.length - 1];
session.clearTimers();
assert.strictEqual(pendingTimer.cleared, true, 'clearTimers should clear pending Auto Gambler timers');

// A blocked acceptance (George is on a post-loss cooldown) must swallow the
// command without pretending the bet was accepted.
const blockedTimers = [];
const blockedCommands = [];
const blockedObserved = [];
const blockedChat = [];
let acceptanceAllowed = false;
const blockedSession = createAutoGamblerSession({
    isEnabled: () => true,
    isPlayState: () => true,
    sendChat: message => blockedChat.push(message),
    sendCommand: command => blockedCommands.push(command),
    onCommandSent: command => blockedObserved.push(command),
    canAccept: () => acceptanceAllowed,
    random: () => 0,
    now: () => now,
    setTimeout: (callback, delayMs) => {
        const timer = { callback, delayMs, unref() {} };
        blockedTimers.push(timer);
        return timer;
    },
    clearTimeout: () => {},
    logger: { log() {} }
});

assert(blockedSession.observeRawChatPacket({ plainMessage: visibleLine }, { name: 'player_chat' }), 'Detection should still schedule while blocked');
blockedTimers[0].callback();
assert.deepStrictEqual(blockedCommands, [], 'A blocked acceptance must not send the command');
assert.deepStrictEqual(blockedObserved, [], 'A blocked acceptance must not report the bet as accepted');
assert.deepStrictEqual(blockedChat, [], 'A blocked acceptance must not claim the quest was accepted');

now += 1000;
acceptanceAllowed = true;
assert(blockedSession.observeRawChatPacket({ plainMessage: visibleLine }, { name: 'player_chat' }), 'Blocking one prompt must not disable later ones');
blockedTimers[blockedTimers.length - 1].callback();
assert.deepStrictEqual(blockedCommands, ['/wanttobet true'], 'Acceptance resumes once the gate reopens');

console.log('Auto Gambler matcher tests passed.');
