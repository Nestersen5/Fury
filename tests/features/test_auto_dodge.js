const assert = require('assert');
const { createAutoDodger } = require('../../src/dodge/autoDodge.js');

// Minimal harness: mutable flags + a captured setTimeout so we can inspect the
// scheduled delay without waiting on real timers.
function makeHarness(overrides = {}) {
    const sent = [];
    let leaveSent = 0;
    const isPartyMember = typeof overrides.isPartyMember === 'function'
        ? overrides.isPartyMember
        : () => false;
    const cfg = {
        enabled: true,
        delaySeconds: 3,
        leaveMode: 'before_start',
        taggedPlayers: true,
        nickedPlayers: false,
        statThreats: false,
        includePreset: 'custom',
        minFkdr: 3,
        minStars: 1000,
        ...overrides
    };
    const state = { pregame: true, game: false, sessionId: 1 };

    const dodger = createAutoDodger({
        // Pinned clock: countdown estimates depend on elapsed wall time
        // between noteScoreboard() and maybeSchedule(); a real clock makes
        // "Xs left" tests flaky whenever a millisecond ticks between calls.
        now: overrides.now || (() => 100000),
        sendChat: msg => sent.push(msg),
        sendLeaveCommand: shouldSend => {
            if (overrides.sendLeaveCommand) overrides.sendLeaveCommand(shouldSend);
            else leaveSent += 1;
        },
        isPregameActive: () => state.pregame,
        isGameActive: () => state.game,
        getPregameSessionId: () => state.sessionId,
        isEnabled: () => cfg.enabled,
        getLeaveMode: () => cfg.leaveMode,
        getDodgeSettings: () => ({
            taggedPlayers: cfg.taggedPlayers,
            nickedPlayers: cfg.nickedPlayers,
            statThreats: cfg.statThreats,
            includePreset: cfg.includePreset,
            minFkdr: cfg.minFkdr,
            minStars: cfg.minStars
        }),
        applyConfig: ({ enabled, leaveMode, delaySeconds, taggedPlayers, nickedPlayers, statThreats, includePreset, minFkdr, minStars }) => {
            if (leaveMode !== undefined) cfg.leaveMode = leaveMode;
            if (enabled !== undefined) cfg.enabled = Boolean(enabled);
            if (delaySeconds !== undefined) cfg.delaySeconds = Math.max(0, Math.min(15, Math.round(Number(delaySeconds))));
            if (taggedPlayers !== undefined) cfg.taggedPlayers = Boolean(taggedPlayers);
            if (nickedPlayers !== undefined) cfg.nickedPlayers = Boolean(nickedPlayers);
            if (statThreats !== undefined) cfg.statThreats = Boolean(statThreats);
            if (includePreset !== undefined) cfg.includePreset = String(includePreset || '').trim().toLowerCase();
            if (minFkdr !== undefined) cfg.minFkdr = Math.max(0, Number(minFkdr));
            if (minStars !== undefined) cfg.minStars = Math.max(0, Number(minStars));
        },
        compactTagName: tag => (tag ? String(tag).split(/[\s:\-]/)[0] : ''),
        isPartyMember,
        isPartyRosterUsable: overrides.isPartyRosterUsable || (() => true),
        getKnownDenick: overrides.getKnownDenick || (() => null)
    });

    if (!overrides.noCountdown) dodger.noteScoreboard('BED WARS Starting in 4s');
    return { dodger, sent, cfg, state, getLeaveSent: () => leaveSent };
}

const taggedProfile = { data: { urchin: { tag: 'Cheater' } } };
const seraphProfile = { data: { seraph: { tagged: true, report_type: 'Blacklisted' } } };
const cleanProfile = { data: { urchin: {}, seraph: { tagged: false } } };
const nickedProfile = { data: { lookupFailed: false, isNicked: true } };
const statThreatProfile = {
    data: {
        lookupFailed: false,
        isNicked: false,
        player: {
            achievements: { bedwars_level: 250 },
            stats: { Bedwars: { final_kills_bedwars: 100, final_deaths_bedwars: 20 } }
        },
        urchin: {},
        seraph: { tagged: false }
    }
};
const knownNickedThreatProfile = {
    data: {
        ...statThreatProfile.data,
        isNicked: true,
        urchin: { tag: 'Cheater' }
    }
};
const knownDenick = { nick: 'KnownNick', realName: 'PartyMate' };

// Capture the delay passed to the next setTimeout (and don't actually fire it).
function captureScheduleDelay(fn) {
    const realSetTimeout = global.setTimeout;
    let captured = null;
    global.setTimeout = (cb, delay) => { captured = delay; return { __fake: true }; };
    try { fn(); } finally { global.setTimeout = realSetTimeout; }
    return captured;
}

function captureDodgeTimer(fn) {
    const realSetTimeout = global.setTimeout;
    let timer = null;
    global.setTimeout = (callback, delay) => (timer = { callback, delay });
    try { fn(); } finally { global.setTimeout = realSetTimeout; }
    return timer;
}

function withFakeClock(run) {
    const realSetTimeout = global.setTimeout, realClearTimeout = global.clearTimeout;
    let time = 100000;
    const timers = new Set();
    global.setTimeout = (callback, delay) => {
        const timer = { callback, at: time + Math.max(0, Number(delay) || 0) };
        timers.add(timer);
        return timer;
    };
    global.clearTimeout = timer => timers.delete(timer);
    const clock = {
        now: () => time,
        advance(ms) {
            const end = time + ms;
            for (;;) {
                const next = [...timers].filter(timer => timer.at <= end).sort((a, b) => a.at - b.at)[0];
                if (!next) break;
                timers.delete(next);
                time = next.at;
                next.callback();
            }
            time = end;
        }
    };
    try { run(clock); } finally {
        global.setTimeout = realSetTimeout;
        global.clearTimeout = realClearTimeout;
    }
}

function componentText(component) {
    if (typeof component === 'string') return component;
    if (Array.isArray(component)) return component.map(componentText).join('');
    if (!component || typeof component !== 'object') return '';
    return `${component.text || ''}${componentText(component.extra || [])}`;
}

function findComponent(component, predicate) {
    if (!component || typeof component !== 'object') return null;
    if (predicate(component)) return component;
    const children = Array.isArray(component.extra) ? component.extra : [];
    for (const child of children) {
        const found = findComponent(child, predicate);
        if (found) return found;
    }
    return null;
}

// 1. No countdown info -> wait without a timer, keeping cancellation available.
{
    const h = makeHarness({ noCountdown: true });
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Cheater1', taggedProfile));
    assert.equal(delay, null, 'no countdown must wait for game-start timing');
    assert.equal(h.dodger.cancel('manual'), true);
    assert.equal(h.dodger.getDebugState().pendingDodge, 'none');
    const cancelButton = findComponent(h.sent.find(message => componentText(message).includes('[Cancel]')), item => String(item.text || '') === '[Cancel]');
    assert.equal(cancelButton?.clickEvent?.value, '/dodge cancel', 'scheduled dodge warning should include clickable cancel text');
}

// 2. A long countdown keeps a cancel window and reserves two seconds to leave.
{
    const h = makeHarness();
    h.dodger.noteScoreboard('BED WARS Map: Airshow Players: 8/16 Starting in §a12s Mode: Doubles');
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Cheater2', taggedProfile));
    assert.equal(delay, 10000, '12s left should wait until two seconds before start');
}

// 3. At the two-second safety boundary, leave immediately.
{
    const h = makeHarness();
    h.dodger.noteScoreboard('BED WARS Starting in §a2s Mode: Solo');
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Cheater3', taggedProfile));
    assert.equal(delay, 0, '2s left should leave room for paced command dispatch');
}

// 4. Only 1s left -> leave immediately (0 delay).
{
    const h = makeHarness();
    h.dodger.noteScoreboard('BED WARS Starting in 1s Mode: Solo');
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Cheater4', taggedProfile));
    assert.equal(delay, 0, '1s left should fire immediately');
}

// 5. Retired provider data must never trigger a dodge.
{
    const h = makeHarness();
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Cheater5', seraphProfile));
    assert.equal(delay, null, 'retired provider data must not schedule a dodge');
}

// 6. Clean player -> no dodge scheduled.
{
    const h = makeHarness();
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Friendly', cleanProfile));
    assert.equal(delay, null, 'clean player should not schedule a dodge');
}

// 7. Disabled -> no dodge.
{
    const h = makeHarness({ enabled: false });
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Cheater6', taggedProfile));
    assert.equal(delay, null, 'disabled dodger should not schedule');
}

// 8. Tagged players can be disabled separately.
{
    const h = makeHarness({ taggedPlayers: false });
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Cheater7', taggedProfile));
    assert.equal(delay, null, 'tagged players should not dodge when tagged category is off');
}

// 9. Nicked players dodge only when the nick category is enabled.
{
    const h = makeHarness({ nickedPlayers: true });
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Nick1', nickedProfile));
    assert.equal(delay, 2000, 'nicked players should schedule when nick dodging is enabled');
}

// 10. Stat threats use separate auto-dodge thresholds.
{
    const h = makeHarness({ statThreats: true, minFkdr: 4, minStars: 1000 });
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Sweat1', statThreatProfile));
    assert.equal(delay, 2000, 'stat threats should schedule when separate FKDR threshold is met');
}

// 10b. The Urchin API developer/deprecation notice must NOT trigger a dodge.
{
    const h = makeHarness();
    const noticeProfile = { data: { urchin: {
        tag: 'Caution',
        rawTags: [{
            text: 'Caution',
            tooltip: 'Caution (Added by Unknown 2026-07-22) - Notice for the developer of this service: the Urchin API is deprecated and shuts down on July 31. Blacklist tags are no longer being updated. Migrate to the new API - docs: https://api.urchin.gg'
        }]
    } } };
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('DevNotice', noticeProfile));
    assert.equal(delay, null, 'Urchin developer notice should never schedule a dodge');
}

// 10c. A genuine report tag alongside the notice still dodges.
{
    const h = makeHarness();
    const noticePlusRealProfile = { data: { urchin: {
        tag: 'Blatant',
        rawTags: [
            { text: 'Caution', tooltip: 'Caution (Added by Unknown 2026-07-22) - the Urchin API is deprecated and shuts down on July 31. Migrate to the new API - docs: https://api.urchin.gg' },
            { text: 'Blatant', tooltip: 'Blatant (Added by Mod 2026-01-01) - scaffold, killaura' }
        ]
    } } };
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('RealCheater', noticePlusRealProfile));
    assert.equal(delay, 2000, 'a real tag alongside the notice should still dodge');
}

// 10d. A known denick is not dodged merely for using a nick.
{
    const h = makeHarness({ nickedPlayers: true });
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('KnownNick', nickedProfile, { knownDenick }));
    assert.equal(delay, null, 'known denicks should be evaluated as their real account, not an unknown nick');
}

// 4b. A countdown learned after scheduling must pull a long decision window
// forward, so the leave cannot spill into the active game.
{
    const h = makeHarness({ noCountdown: true });
    const realSetTimeout = global.setTimeout;
    const realClearTimeout = global.clearTimeout;
    const scheduled = [];
    const cleared = [];
    global.setTimeout = (callback, delay) => {
        const timer = { callback, delay };
        scheduled.push(timer);
        return timer;
    };
    global.clearTimeout = timer => cleared.push(timer);
    try {
        h.dodger.maybeSchedule('LateCountdown', taggedProfile);
        h.dodger.noteScoreboard('BED WARS Starting in 2s Mode: Solo');
    } finally {
        global.setTimeout = realSetTimeout;
        global.clearTimeout = realClearTimeout;
    }
    assert.deepStrictEqual(scheduled.map(timer => timer.delay), [0], 'late countdown must reschedule the leave before game start');
    assert.strictEqual(cleared[0], null, 'waiting without a countdown owns no timer');
}

// 10e. A known nick that resolves to a current party member never dodges.
{
    const h = makeHarness({
        isPartyMember: name => String(name).toLowerCase() === 'partymate'
    });
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('KnownNick', knownNickedThreatProfile, { knownDenick }));
    assert.equal(delay, null, 'the real IGN in the denick list must be checked against the party roster');
}

// Party membership can arrive after a match was found. Recheck the confirmed
// roster when the countdown timer fires, including the target's real IGN.
for (const [profile, settings] of [[taggedProfile, {}], [nickedProfile, { nickedPlayers: true }], [statThreatProfile, { statThreats: true }]]) {
    const h = makeHarness({ ...settings, isPartyMember: name => name.toLowerCase() === 'fyechris' });
    assert.strictEqual(captureScheduleDelay(() => h.dodger.maybeSchedule('FyeChris', profile)), null, 'Party members are protected across all dodge filters');
}

for (const known of [null, knownDenick]) {
    const party = new Set();
    const h = makeHarness({ isPartyMember: name => party.has(name.toLowerCase()) });
    const name = known ? 'KnownNick' : 'fyechris';
    const timer = captureDodgeTimer(() => h.dodger.maybeSchedule(name, taggedProfile, { knownDenick: known }));
    assert(timer, 'a confirmed opponent initially schedules a dodge');
    party.add(known ? 'partymate' : 'fyechris');
    timer.callback();
    assert.strictEqual(h.getLeaveSent(), 0, 'a newly confirmed party member must not cause a leave');
    assert.strictEqual(h.dodger.getDebugState().pendingDodge, 'none');
    assert(!h.sent.some(message => componentText(message).includes('Leaving lobby')), 'a cancelled party dodge must not announce a leave');
}

{
    let usable = false;
    const h = makeHarness({ isPartyRosterUsable: () => usable });
    assert.strictEqual(captureScheduleDelay(() => h.dodger.maybeSchedule('fyechris', taggedProfile)), null, 'unknown party state must not be treated as solo');
    usable = true;
    const timer = captureDodgeTimer(() => h.dodger.maybeSchedule('Opponent', taggedProfile));
    assert(timer, 'confirmed solo players still dodge tagged opponents');
    usable = false;
    timer.callback();
    assert.strictEqual(h.getLeaveSent(), 0, 'an uncertain roster at execution must prevent a leave');
}

{
    let mapping = null;
    const h = makeHarness({
        isPartyMember: name => name.toLowerCase() === 'partymate',
        getKnownDenick: () => mapping
    });
    const timer = captureDodgeTimer(() => h.dodger.maybeSchedule('KnownNick', taggedProfile));
    mapping = knownDenick;
    timer.callback();
    assert.strictEqual(h.getLeaveSent(), 0, 'a denick learned during the delay must protect a party member');
}

{
    let member = false, dispatchGuard = null;
    const h = makeHarness({
        isPartyMember: () => member,
        sendLeaveCommand: shouldSend => { dispatchGuard = shouldSend; }
    });
    const timer = captureDodgeTimer(() => h.dodger.maybeSchedule('fyechris', taggedProfile));
    timer.callback();
    assert.strictEqual(dispatchGuard(), true, 'A confirmed opponent permits dispatch');
    member = true;
    assert.strictEqual(dispatchGuard(), false, 'Party membership learned while the leave is queued prevents dispatch');
}

// 10f. Known denicks still use the enabled tag/stat checks with their real stats.
{
    const tagged = makeHarness({ taggedPlayers: true });
    const tagDelay = captureScheduleDelay(() => tagged.dodger.maybeSchedule('KnownNick', knownNickedThreatProfile, { knownDenick }));
    assert.equal(tagDelay, 2000, 'a known denick with a tag should dodge when tagged-player dodging is enabled');

    const statThreat = makeHarness({ taggedPlayers: false, statThreats: true, minFkdr: 4, minStars: 1000 });
    const statDelay = captureScheduleDelay(() => statThreat.dodger.maybeSchedule('KnownNick', knownNickedThreatProfile, { knownDenick }));
    assert.equal(statDelay, 2000, 'a known denick with threat stats should dodge when stat-threat dodging is enabled');
}

// 11. Commands update include switches and stat thresholds.
{
    const h = makeHarness();
    h.dodger.handleCommand(['/dodge', 'include', 'nicks', 'on']);
    assert.equal(h.cfg.nickedPlayers, true, '/dodge include nicks on should persist nick dodging');
    assert.equal(h.cfg.includePreset, 'custom', 'individual include edits should switch to custom preset');
    h.dodger.handleCommand(['/dodge', 'threat', 'fkdr', '6.5']);
    assert.equal(h.cfg.minFkdr, 6.5, '/dodge threat fkdr should persist the separate FKDR threshold');
}

// 12. Bare /dodge is read-only status, never an interactive panel.
{
    const h = makeHarness();
    h.dodger.handleCommand(['/dodge']);
    assert(h.sent.some(message => componentText(message).includes('Auto Dodge')));
    assert(h.sent.some(message => componentText(message).includes('Power: ON')));
    assert(!h.sent.some(message => findComponent(message, item => item.clickEvent)), 'Status must not expose controls');
}

// 13. Preset All flips stored values to true, snapshots the custom selection, and restores it on switch back.
{
    const h = makeHarness();
    // Defaults: tagged=true, nicked=false, threats=false
    h.dodger.handleCommand(['/dodge', 'preset', 'all_on']);
    assert.equal(h.cfg.includePreset, 'all_on', '/dodge preset all_on should persist the preset');
    assert.equal(h.cfg.taggedPlayers, true, 'All should flip stored tagged to true');
    assert.equal(h.cfg.nickedPlayers, true, 'All should flip stored nicked to true');
    assert.equal(h.cfg.statThreats, true, 'All should flip stored stat-threats to true');

    h.dodger.handleCommand(['/dodge', 'preset', 'custom']);
    assert.equal(h.cfg.includePreset, 'custom', 'switching back to custom should persist');
    assert.equal(h.cfg.taggedPlayers, true, 'custom snapshot should restore tagged=true');
    assert.equal(h.cfg.nickedPlayers, false, 'custom snapshot should restore nicked=false');
    assert.equal(h.cfg.statThreats, false, 'custom snapshot should restore threats=false');

    // Re-enter All to verify the locked-row rendering still works.
    h.dodger.handleCommand(['/dodge', 'preset', 'all_on']);
    assert(!h.sent.some(message => findComponent(message, item => item.clickEvent)), 'Changing presets must not reopen a panel');
}

// Instant mode ignores the old delay, while cancelled callbacks cannot leave.
{
    const h = makeHarness({ leaveMode: 'instant', delaySeconds: 15 });
    const timer = captureDodgeTimer(() => h.dodger.maybeSchedule('Instant', taggedProfile));
    assert.equal(timer.delay, 0);
    timer.callback();
    assert.equal(h.getLeaveSent(), 1);
    h.dodger.handleCommand(['/dodge', 'timing', 'before_start']);
    assert.equal(h.cfg.leaveMode, 'before_start');
    const cancelled = captureDodgeTimer(() => h.dodger.maybeSchedule('Cancelled', taggedProfile));
    h.dodger.cancel('manual');
    cancelled.callback();
    assert.equal(h.getLeaveSent(), 1);
}

// Re-reading the same sidebar must not restart the countdown or postpone a
// pending leave. Partial sidebar updates must not erase the existing timer.
{
    let time = 100000;
    const h = makeHarness({ now: () => time });
    const timer = captureDodgeTimer(() => h.dodger.maybeSchedule('CountdownRace', taggedProfile));
    time += 500;
    assert.strictEqual(captureScheduleDelay(() => h.dodger.noteScoreboard('BED WARS Starting in 4s')), null,
        'a repeated countdown must not schedule a later leave');
    time += 3500;
    assert.strictEqual(captureScheduleDelay(() => h.dodger.noteScoreboard('BED WARS Map: Airshow')), null,
        'a partial sidebar must not cancel a known leave deadline');
    timer.callback();
    assert.strictEqual(h.getLeaveSent(), 1);
}

// The actual proxy game-start predicate must leave the last Bed Wars countdown
// second available for dispatch through the paced command lane.
{
    const fs = require('fs'), vm = require('vm');
    const proxy = fs.readFileSync(require.resolve('../../proxy.js'), 'utf8');
    const start = proxy.indexOf('                    let gameStartMode = null;');
    const end = proxy.indexOf('                    // Each packet is already forwarded above;', start);
    assert(start >= 0 && end > start);
    const context = vm.createContext({
        duelsState: { active: false }, bedwarsDuelConfirmed: false,
        cleanChatText: 'the game starts in 1 second!', currentGamemode: 'BEDWARS',
        isSupportedTabStatsMode: () => true, isActionBar: false,
        activateGame: mode => activations.push(mode)
    });
    const activations = [];
    vm.runInContext(`{ ${proxy.slice(start, end)} }`, context);
    assert.deepStrictEqual(activations, [], 'a countdown warning is not a Bed Wars game start');
    context.cleanChatText = 'protect your bed and destroy the enemy beds';
    vm.runInContext(`{ ${proxy.slice(start, end)} }`, context);
    assert.deepStrictEqual(activations, ['BEDWARS'], 'actual Bed Wars start instructions still activate the game');
    context.currentGamemode = 'SKYWARS';
    context.cleanChatText = 'the game starts in 1 second!';
    vm.runInContext(`{ ${proxy.slice(start, end)} }`, context);
    assert.deepStrictEqual(activations, ['BEDWARS', 'SKYWARS'], 'the existing SkyWars start behavior is preserved');
}

// Countdown gaps and repeated sidebar reads must retain the original deadline.
withFakeClock(clock => {
    const h = makeHarness({ now: clock.now });
    h.dodger.noteScoreboard('Starting in 10s');
    h.dodger.maybeSchedule('SidebarGap', taggedProfile);
    clock.advance(4000);
    h.dodger.noteScoreboard('BED WARS Map: Airshow');
    h.dodger.noteScoreboard('Starting in 10s');
    clock.advance(3999);
    assert.strictEqual(h.getLeaveSent(), 0);
    clock.advance(1);
    assert.strictEqual(h.getLeaveSent(), 1, 'a quiet or repeated sidebar cannot erase or postpone the leave');
});

// Server chat supplies missing countdowns; quoted player chat cannot do so.
withFakeClock(clock => {
    const h = makeHarness({ now: clock.now, noCountdown: true });
    h.dodger.maybeSchedule('ChatFallback', taggedProfile);
    h.dodger.noteChat('[MVP++] Rival: The game starts in 1 second!');
    clock.advance(100);
    assert.strictEqual(h.getLeaveSent(), 0);
    h.dodger.noteChat('§eThe game starts in §c5 §eseconds!');
    clock.advance(1000);
    h.dodger.noteScoreboard('Starting in 5s');
    clock.advance(2000);
    assert.strictEqual(h.getLeaveSent(), 1, 'chat fallback survives the same countdown appearing on the sidebar');
});

// A genuine return to waiting cancels the old countdown; a restarted countdown
// can extend the cancel window, and Cancel still prevents leaving.
withFakeClock(clock => {
    const h = makeHarness({ now: clock.now });
    h.dodger.maybeSchedule('RestartedCountdown', taggedProfile);
    h.dodger.noteScoreboard('BED WARS Waiting...');
    clock.advance(5000);
    assert.strictEqual(h.getLeaveSent(), 0);
    h.dodger.noteChat('The game starts in 5 seconds!');
    clock.advance(1000);
    h.dodger.noteChat('The game starts in 20 seconds!');
    clock.advance(3000);
    assert.strictEqual(h.getLeaveSent(), 0, 'a genuine new countdown can move the deadline later');
    h.dodger.cancel('manual');
    clock.advance(20000);
    assert.strictEqual(h.getLeaveSent(), 0);
});

// Use the real paced command lane to verify both the dispatch margin and the
// existing final guard against leaving after the actual game starts.
for (const gameStartsBeforeDispatch of [false, true]) withFakeClock(clock => {
    const { createHypixelCommandQueue } = require('../../src/net/hypixelCommandQueue');
    const sent = [];
    const queue = createHypixelCommandQueue({
        now: clock.now, send: command => sent.push({ command, at: clock.now() })
    });
    const h = makeHarness({ now: clock.now, noCountdown: true,
        sendLeaveCommand: shouldSend => queue.enqueue('/l', { priority: 0, shouldSend }) });
    h.dodger.noteChat('The game starts in 1 second!');
    h.dodger.maybeSchedule('LateMatch', taggedProfile);
    void queue.enqueue('/p list');
    clock.advance(0); // enqueue the leave while command pacing is active
    if (gameStartsBeforeDispatch) {
        h.state.game = true;
        h.dodger.onGameStart();
    }
    clock.advance(400);
    assert.deepStrictEqual(sent.map(item => item.command), gameStartsBeforeDispatch ? ['/p list'] : ['/p list', '/l']);
    if (!gameStartsBeforeDispatch) assert.strictEqual(sent[1].at, 100400, 'leave dispatch still has 600ms before start');
    queue.close();
});

// 14. End-to-end timing: real timer fires and sends /l before game start.
{
    const h = makeHarness();
    h.dodger.noteScoreboard('BED WARS Starting in 1s Mode: Solo'); // -> 0 delay
    h.dodger.maybeSchedule('Cheater7', taggedProfile);
    setTimeout(() => {
        assert.equal(h.getLeaveSent(), 1, 'leave command should have been sent');
        // 15. Once game has started, a pending dodge never sends /l.
        const h2 = makeHarness();
        h2.dodger.maybeSchedule('Cheater8', taggedProfile);
        h2.state.game = true; // game starts before the 3s timer fires
        h2.dodger.onGameStart();
        setTimeout(() => {
            assert.equal(h2.getLeaveSent(), 0, 'no /l after game start');
            console.log('Auto-dodge tests passed.');
        }, 3100);
    }, 50);
}
