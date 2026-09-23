'use strict';

const assert = require('assert');
const {
    GAMBLER_GEORGE_ACCEPT_COMMAND,
    GAMBLER_GEORGE_REMINDER_MESSAGE,
    GAMBLER_GEORGE_PROGRESS_SOUND,
    GAMBLER_GEORGE_COMPLETE_SOUND,
    GAMBLER_GEORGE_WIN_ALERT_DELAY_MS,
    GAMBLER_GEORGE_FAIL_COOLDOWN_MS,
    GAMBLER_GEORGE_RESULT_GRACE_MS,
    formatGeorgeCooldown,
    normalizeGamblerGeorgeReminderState,
    isGeorgeAcceptanceCommand,
    isGeorgeAcceptanceText,
    isGeorgeClaimText,
    isVictoryText,
    isDefeatText,
    createGamblerGeorgeReminder
} = require('../../features/gambler_george_reminder.js');

function createHarness(options = {}) {
    let enabled = options.enabled !== false;
    let autoGambler = options.autoGambler !== false;
    let saved = options.saved || null;
    let clock = Number(options.now) || 123456;
    const alerts = [];
    const sounds = [];
    const writes = [];
    // Held-back alerts are queued here instead of on a real clock, so a test
    // decides when — and whether — they fire.
    const queued = [];
    const reminder = createGamblerGeorgeReminder({
        getEnabled: () => enabled,
        getSavedState: () => saved,
        saveState: state => {
            saved = state;
            writes.push(state);
        },
        sendChat: message => alerts.push(message),
        playSound: sound => sounds.push(sound),
        getAutoGamblerEnabled: () => autoGambler,
        now: () => clock,
        setTimer: (fn, ms) => {
            const entry = { fn, ms };
            queued.push(entry);
            return entry;
        },
        clearTimer: entry => {
            const index = queued.indexOf(entry);
            if (index >= 0) queued.splice(index, 1);
        },
        logger: { log() {}, warn() {} }
    });
    return {
        reminder,
        alerts,
        sounds,
        writes,
        saved: () => saved,
        queued: () => queued.slice(),
        flushAlerts: () => {
            const due = queued.splice(0, queued.length);
            due.forEach(entry => entry.fn());
            return due;
        },
        setEnabled: value => { enabled = Boolean(value); },
        setAutoGambler: value => { autoGambler = Boolean(value); },
        advance: ms => { clock += Number(ms) || 0; },
        now: () => clock
    };
}

assert.deepStrictEqual(normalizeGamblerGeorgeReminderState({
    active: true,
    wins: 99,
    source: ' auto ',
    acceptedAt: 12
}), {
    active: true,
    wins: 2,
    claimReady: true,
    acceptedAt: 12,
    source: 'auto',
    lastWinSessionKey: '',
    lastResultSessionKey: '',
    failedAt: 0,
    cooldownUntil: 0
});
// A save written before the cooldown existed still knows which game it scored.
assert.strictEqual(
    normalizeGamblerGeorgeReminderState({ active: true, wins: 1, lastWinSessionKey: 'bedwars:7' }).lastResultSessionKey,
    'bedwars:7'
);
// The cooldown outlives the bet it ended.
assert.deepStrictEqual(
    normalizeGamblerGeorgeReminderState({ active: false, failedAt: 900, cooldownUntil: 1000 }),
    {
        active: false,
        wins: 0,
        claimReady: false,
        acceptedAt: 0,
        source: '',
        lastWinSessionKey: '',
        lastResultSessionKey: '',
        failedAt: 900,
        cooldownUntil: 1000
    }
);
assert.strictEqual(isGeorgeAcceptanceCommand('  /wanttobet true  '), true);
assert.strictEqual(isGeorgeAcceptanceCommand('/wanttobet false'), false);
assert.strictEqual(isGeorgeAcceptanceText('§e[NPC] Gambler George: Go win 2 Bed Wars matches, I will be watching.'), true);
assert.strictEqual(isGeorgeClaimText('§e[NPC] Gambler George: You won the bet!'), true);

assert.strictEqual(formatGeorgeCooldown(0), 'ready');
assert.strictEqual(formatGeorgeCooldown(GAMBLER_GEORGE_FAIL_COOLDOWN_MS), '24h');
assert.strictEqual(formatGeorgeCooldown(90 * 60 * 1000), '1h 30m');
assert.strictEqual(formatGeorgeCooldown(45 * 1000), '1m');

// End-of-game banners score; players typing the same words never do.
assert.strictEqual(isVictoryText('§6§lVICTORY!'), true);
assert.strictEqual(isDefeatText('§c§lGAME OVER!'), true);
assert.strictEqual(isDefeatText('§4§lDEFEAT!'), true);
assert.strictEqual(isVictoryText('[MVP+] Steve: victory!'), false);
assert.strictEqual(isDefeatText('[18✫] [VIP] DemoPlayer_: game over lol'), false);
assert.strictEqual(isDefeatText('1st Killer - Steve - 10'), false);

const harness = createHarness();
assert.strictEqual(harness.reminder.observeCommand(GAMBLER_GEORGE_ACCEPT_COMMAND, 'auto_gambler'), true);
assert.deepStrictEqual(harness.reminder.getStatus(), {
    active: true,
    wins: 0,
    claimReady: false,
    acceptedAt: 123456,
    source: 'auto_gambler',
    lastWinSessionKey: '',
    lastResultSessionKey: '',
    failedAt: 0,
    cooldownUntil: 0,
    enabled: true,
    autoGamblerEnabled: true,
    paused: false,
    requiredWins: 2,
    cooldownRemainingMs: 0,
    onCooldown: false
});

// Only BedWars victories from an active game count, and duplicate packet forms
// for the same game session can increment the streak only once.
assert.strictEqual(harness.reminder.observeChatLine('VICTORY!', {
    gameActive: true,
    mode: 'SKYWARS',
    gameSessionId: 1
}), false);
assert.strictEqual(harness.reminder.observeChatLine('§6§lVICTORY!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 10
}), true);
assert.strictEqual(harness.reminder.observeChatLine('VICTORY!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 10
}), false);
assert.strictEqual(harness.reminder.getStatus().wins, 1);
// The same game's title banner must not double-count either.
assert.strictEqual(harness.reminder.observeTitle('§6§lVICTORY!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 10
}), false);
// Nor may a stray "GAME OVER" from a game already scored as a win undo it.
assert.strictEqual(harness.reminder.observeChatLine('GAME OVER', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 10
}), false);
// The win alert must not land on the win itself: the end-of-game summary is
// still filling chat at that point and would bury it.
assert.deepStrictEqual(harness.alerts, [], 'a win must not announce itself instantly');
assert.deepStrictEqual(harness.sounds, []);
assert.deepStrictEqual(harness.queued().map(entry => entry.ms), [GAMBLER_GEORGE_WIN_ALERT_DELAY_MS],
    'exactly one alert is waiting, and it waits out the summary');
harness.flushAlerts();
assert.deepStrictEqual(harness.alerts, ['§6§lGambler George §8» §aWin §f1§7/§f2 §arecorded.']);
assert.deepStrictEqual(harness.sounds, [GAMBLER_GEORGE_PROGRESS_SOUND],
    'the first win rings once, and the rejected duplicates ring not at all');

assert.strictEqual(harness.reminder.observeTitle('§6§lVICTORY!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 11
}), true);
assert.strictEqual(harness.reminder.getStatus().claimReady, true);
assert.strictEqual(harness.alerts.length, 1, 'the completing win is held back too');
harness.flushAlerts();
assert.strictEqual(harness.alerts.length, 2, 'a completed bet is confirmed once its alert comes due');
assert.deepStrictEqual(harness.sounds, [GAMBLER_GEORGE_PROGRESS_SOUND, GAMBLER_GEORGE_COMPLETE_SOUND],
    'the completing win gets its own sound, distinct from a progress win');
assert.notStrictEqual(GAMBLER_GEORGE_PROGRESS_SOUND.name, GAMBLER_GEORGE_COMPLETE_SOUND.name);
assert.strictEqual(harness.reminder.observeChatLine('DEFEAT!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 12
}), false, 'a completed bet must remain claimable if another game is lost');

assert.strictEqual(harness.reminder.onTransition('lobby', 'lobby:1'), true);
assert.deepStrictEqual(harness.alerts.slice(-1), [GAMBLER_GEORGE_REMINDER_MESSAGE]);
assert.strictEqual(harness.reminder.onTransition('lobby', 'lobby:1'), false, 'same transition must be deduplicated');
assert.strictEqual(harness.reminder.onTransition('pregame', 'pregame:2'), true);

harness.setEnabled(false);
assert.strictEqual(harness.reminder.onTransition('game', 'game:3'), false);

// The single "Claim alerts" toggle governs the sound as well as the message:
// turning the reminder off must not leave a win ringing silently in the dark.
const mutedHarness = createHarness({ enabled: false });
mutedHarness.reminder.acceptQuest('manual_control', { restart: true });
assert.strictEqual(mutedHarness.reminder.observeTitle('§6§lVICTORY!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 40
}), true, 'progress is still tracked while alerts are off');
assert.strictEqual(mutedHarness.reminder.getStatus().wins, 1);
mutedHarness.flushAlerts();
assert.deepStrictEqual(mutedHarness.sounds, []);
assert.deepStrictEqual(mutedHarness.alerts, []);

// A sound backend that throws must not swallow the chat alert beside it.
const brokenSounds = createGamblerGeorgeReminder({
    getEnabled: () => true,
    getSavedState: () => ({ active: true, wins: 0 }),
    saveState: () => {},
    sendChat: message => brokenSoundAlerts.push(message),
    playSound: () => { throw new Error('no client'); },
    setTimer: fn => { fn(); return null; },
    logger: { log() {}, warn() {} }
});
const brokenSoundAlerts = [];
assert.strictEqual(brokenSounds.observeTitle('§6§lVICTORY!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 41
}), true);
assert.strictEqual(brokenSoundAlerts.length, 1, 'a failed sound write must not cost the player the message');
harness.setEnabled(true);
assert.strictEqual(harness.reminder.onTransition('game', 'game:3'), true, 'disabled transitions must not consume the reminder key');

assert.strictEqual(harness.reminder.observeChatLine('[NPC] Gambler George: You won the bet!'), true);
assert.strictEqual(harness.reminder.getStatus().active, false);
assert.strictEqual(harness.reminder.getStatus().onCooldown, false, 'claiming must not start a cooldown');
assert.strictEqual(harness.reminder.onTransition('lobby', 'lobby:4'), false);

// A victory that lands after the match state was torn down — the /leave case —
// still scores against the game that produced it, exactly once.
const lateHarness = createHarness();
assert.strictEqual(lateHarness.reminder.hasPendingResult(), false, 'no bet, nothing to score');
lateHarness.reminder.acceptQuest('chat_confirmation');
assert.strictEqual(lateHarness.reminder.hasPendingResult(), true);
lateHarness.reminder.observeTitle('§6§lVICTORY!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 30
});
assert.strictEqual(lateHarness.reminder.getStatus().wins, 1);
const postLeaveContext = {
    gameActive: false,
    mode: null,
    gameSessionId: 31,
    recentBedwarsSessionId: 30,
    recentBedwarsAt: lateHarness.now()
};
assert.strictEqual(
    lateHarness.reminder.observeChatLine('VICTORY!', postLeaveContext),
    false,
    'the trailing chat banner belongs to the game the title already scored'
);
lateHarness.advance(5000);
assert.strictEqual(lateHarness.reminder.observeChatLine('§6§lVICTORY!', {
    ...postLeaveContext,
    recentBedwarsSessionId: 32,
    recentBedwarsAt: lateHarness.now()
}), true, 'a banner inside the grace window scores the game that just ended');
assert.strictEqual(lateHarness.reminder.getStatus().claimReady, true);
assert.strictEqual(lateHarness.reminder.hasPendingResult(), false, 'a finished bet ignores further results');

const staleHarness = createHarness();
staleHarness.reminder.acceptQuest('chat_confirmation');
assert.strictEqual(staleHarness.reminder.observeChatLine('VICTORY!', {
    gameActive: false,
    mode: null,
    gameSessionId: 41,
    recentBedwarsSessionId: 40,
    recentBedwarsAt: staleHarness.now() - GAMBLER_GEORGE_RESULT_GRACE_MS - 1
}), false, 'a banner past the grace window belongs to no game');
assert.strictEqual(staleHarness.reminder.observeChatLine('VICTORY!', {
    gameActive: false,
    mode: null,
    gameSessionId: 41
}), false, 'a banner with no BedWars game in sight is ignored');

// A loss fails the bet and parks it for 24h from the moment it happened.
const lossHarness = createHarness();
lossHarness.reminder.acceptQuest('chat_confirmation');
lossHarness.reminder.recordWin('bedwars:20');
lossHarness.alerts.length = 0;
assert.strictEqual(lossHarness.reminder.observeTitle('§c§lGAME OVER!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 21
}), true);
const failed = lossHarness.reminder.getStatus();
assert.strictEqual(failed.active, false, 'a loss before two wins ends the bet');
assert.strictEqual(failed.wins, 0);
assert.strictEqual(failed.failedAt, lossHarness.now());
assert.strictEqual(failed.cooldownUntil, lossHarness.now() + GAMBLER_GEORGE_FAIL_COOLDOWN_MS);
assert.strictEqual(failed.cooldownRemainingMs, GAMBLER_GEORGE_FAIL_COOLDOWN_MS);
assert.strictEqual(failed.onCooldown, true);
assert.deepStrictEqual(lossHarness.alerts, [
    '§6§lGambler George §8» §cBet failed §7— that loss ended it. §7New bet in §f24h§7.'
]);
// The failure is immediate, and it takes the queued win alert down with it: a
// "Win 1/2 recorded" landing after "Bet failed" would read as a live bet.
assert.deepStrictEqual(lossHarness.queued(), [], 'failing the bet drops any alert still waiting');
lossHarness.flushAlerts();
assert.strictEqual(lossHarness.alerts.length, 1);

// Auto Gambler must not restart the bet during the cooldown; the player can.
lossHarness.reminder.observeCommand(GAMBLER_GEORGE_ACCEPT_COMMAND, 'auto_gambler');
assert.strictEqual(lossHarness.reminder.getStatus().active, false, 'auto acceptance is blocked while on cooldown');
lossHarness.advance(60 * 60 * 1000);
assert.strictEqual(lossHarness.reminder.getCooldownRemainingMs(), 23 * 60 * 60 * 1000);
lossHarness.reminder.observeCommand(GAMBLER_GEORGE_ACCEPT_COMMAND, 'manual_command');
const restarted = lossHarness.reminder.getStatus();
assert.strictEqual(restarted.active, true, 'a manually typed acceptance overrides the cooldown');
assert.strictEqual(restarted.onCooldown, false, 'a bet that actually started clears the cooldown');
assert.strictEqual(restarted.lastResultSessionKey, '', 'a fresh bet forgets the games the previous one settled');

// The cooldown expires on its own, and can be dropped by hand.
const expiryHarness = createHarness();
expiryHarness.reminder.acceptQuest('chat_confirmation');
expiryHarness.reminder.recordLoss('bedwars:50');
expiryHarness.advance(GAMBLER_GEORGE_FAIL_COOLDOWN_MS);
assert.strictEqual(expiryHarness.reminder.getStatus().onCooldown, false);
expiryHarness.reminder.observeCommand(GAMBLER_GEORGE_ACCEPT_COMMAND, 'auto_gambler');
assert.strictEqual(expiryHarness.reminder.getStatus().active, true, 'auto acceptance resumes once the cooldown lapses');

const clearHarness = createHarness();
clearHarness.reminder.acceptQuest('chat_confirmation');
clearHarness.reminder.recordLoss('bedwars:60');
assert.strictEqual(clearHarness.reminder.getStatus().onCooldown, true);
clearHarness.reminder.clearCooldown('manual_control');
assert.strictEqual(clearHarness.reminder.getStatus().onCooldown, false);
assert.strictEqual(clearHarness.reminder.getStatus().failedAt, 0);

// George announcing the failure himself carries the same penalty.
const npcFailHarness = createHarness();
npcFailHarness.reminder.acceptQuest('chat_confirmation');
assert.strictEqual(npcFailHarness.reminder.observeChatLine('[NPC] Gambler George: You failed the bet!'), true);
assert.strictEqual(npcFailHarness.reminder.getStatus().onCooldown, true);

const persistedHarness = createHarness({
    saved: { active: true, wins: 2, claimReady: true, acceptedAt: 1, source: 'saved' }
});
assert.strictEqual(persistedHarness.reminder.onTransition('lobby', 'after-reconnect'), true);

const persistedCooldownHarness = createHarness({
    saved: { active: false, failedAt: 100, cooldownUntil: 123456 + 5000 }
});
assert.strictEqual(persistedCooldownHarness.reminder.getCooldownRemainingMs(), 5000,
    'a cooldown must survive a restart');

const restartedBetHarness = createHarness({
    saved: { active: true, wins: 1, acceptedAt: 1, source: 'stale' }
});
restartedBetHarness.reminder.observeCommand(GAMBLER_GEORGE_ACCEPT_COMMAND, 'auto_gambler');
assert.strictEqual(restartedBetHarness.reminder.getStatus().wins, 0, 'a fresh acceptance command should restart stale progress');

console.log('Gambler George reminder tests passed.');

// --- Only BedWars wins may score the bet -------------------------------------
// The grace window that lets a banner land after a fast /leave must not lend a
// BedWars session key to a game the player is demonstrably still inside.
const modeHarness = createHarness();
modeHarness.reminder.acceptQuest('manual_control', { restart: true });
modeHarness.reminder.observeTitle('§6§lVICTORY!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 70
});
assert.strictEqual(modeHarness.reminder.getStatus().wins, 1, 'a BedWars win scores');

// Straight into SkyWars, well inside the BedWars grace window, and win it.
assert.strictEqual(modeHarness.reminder.observeTitle('§6§lVICTORY!', {
    gameActive: true,
    mode: 'SKYWARS',
    gameSessionId: 71,
    recentBedwarsSessionId: 70,
    recentBedwarsAt: modeHarness.now()
}), false, 'a SkyWars win must not score a BedWars bet');
assert.strictEqual(modeHarness.reminder.getStatus().wins, 1);

// Nor may a non-BedWars loss fail the bet into a 24h cooldown.
assert.strictEqual(modeHarness.reminder.observeChatLine('DEFEAT!', {
    gameActive: true,
    mode: 'DUELS',
    gameSessionId: 72,
    recentBedwarsSessionId: 70,
    recentBedwarsAt: modeHarness.now()
}), false, 'a Duels loss must not fail a BedWars bet');
assert.strictEqual(modeHarness.reminder.getStatus().active, true);
assert.strictEqual(modeHarness.reminder.getStatus().onCooldown, false);

// The grace window still works for its actual purpose: no game active, because
// the player left the instant the banner showed.
assert.strictEqual(modeHarness.reminder.observeTitle('§6§lVICTORY!', {
    gameActive: false,
    mode: null,
    recentBedwarsSessionId: 73,
    recentBedwarsAt: modeHarness.now()
}), true, 'a banner landing after a fast /leave still scores');
assert.strictEqual(modeHarness.reminder.getStatus().claimReady, true);

// --- The bet rides on the Auto Gambler switch --------------------------------
// Auto Gambler is what answers George's prompt, so with it off there is no bet.
const offHarness = createHarness({ autoGambler: false });
assert.strictEqual(offHarness.reminder.getStatus().paused, true);
offHarness.reminder.acceptQuest('manual_control', { restart: true });
assert.strictEqual(offHarness.reminder.getStatus().active, false, 'no bet may start while Auto Gambler is off');
assert.strictEqual(offHarness.reminder.observeCommand(GAMBLER_GEORGE_ACCEPT_COMMAND, 'auto_gambler'), false);
assert.strictEqual(offHarness.reminder.observeTitle('§6§lVICTORY!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 80
}), false, 'wins must not score while Auto Gambler is off');
assert.strictEqual(offHarness.reminder.hasPendingResult(), false);
assert.deepStrictEqual(offHarness.alerts, []);
assert.deepStrictEqual(offHarness.sounds, []);

// Turning Auto Gambler off parks a bet in flight rather than destroying it.
const parkedHarness = createHarness();
parkedHarness.reminder.acceptQuest('manual_control', { restart: true });
parkedHarness.reminder.observeTitle('§6§lVICTORY!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 90
});
assert.strictEqual(parkedHarness.reminder.getStatus().wins, 1);

parkedHarness.setAutoGambler(false);
assert.strictEqual(parkedHarness.reminder.getStatus().paused, true);
assert.strictEqual(parkedHarness.reminder.getStatus().wins, 1, 'banked progress survives the pause');
assert.strictEqual(parkedHarness.reminder.observeTitle('§6§lVICTORY!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 91
}), false);
assert.strictEqual(parkedHarness.reminder.getStatus().wins, 1, 'and no win scores while parked');

parkedHarness.setAutoGambler(true);
assert.strictEqual(parkedHarness.reminder.getStatus().paused, false);
assert.strictEqual(parkedHarness.reminder.observeTitle('§6§lVICTORY!', {
    gameActive: true,
    mode: 'BEDWARS',
    gameSessionId: 92
}), true, 'the bet resumes exactly where it was parked');
assert.strictEqual(parkedHarness.reminder.getStatus().claimReady, true);

console.log('Gambler George BedWars-only + Auto Gambler gating tests passed.');
