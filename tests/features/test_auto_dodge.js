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
        now: () => 100000,
        sendChat: msg => sent.push(msg),
        sendLeaveCommand: () => { leaveSent += 1; },
        isPregameActive: () => state.pregame,
        isGameActive: () => state.game,
        getPregameSessionId: () => state.sessionId,
        isEnabled: () => cfg.enabled,
        getDelaySeconds: () => cfg.delaySeconds,
        getDodgeSettings: () => ({
            taggedPlayers: cfg.taggedPlayers,
            nickedPlayers: cfg.nickedPlayers,
            statThreats: cfg.statThreats,
            includePreset: cfg.includePreset,
            minFkdr: cfg.minFkdr,
            minStars: cfg.minStars
        }),
        applyConfig: ({ enabled, delaySeconds, taggedPlayers, nickedPlayers, statThreats, includePreset, minFkdr, minStars }) => {
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
        isPartyMember
    });

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

// 1. No countdown info -> full configured delay.
{
    const h = makeHarness();
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Cheater1', taggedProfile));
    assert.equal(delay, 3000, 'no countdown should use full delay');
    const cancelButton = findComponent(h.sent.find(message => componentText(message).includes('[Cancel]')), item => String(item.text || '') === '[Cancel]');
    assert.equal(cancelButton?.clickEvent?.value, '/dodge cancel', 'scheduled dodge warning should include clickable cancel text');
}

// 2. Plenty of time on the scoreboard -> still full delay.
{
    const h = makeHarness();
    h.dodger.noteScoreboard('BED WARS Map: Airshow Players: 8/16 Starting in §a12s Mode: Doubles');
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Cheater2', taggedProfile));
    assert.equal(delay, 3000, '12s left should keep the full 3s delay');
}

// 3. Only ~2s left -> clamp to ~1s (remaining - 1s buffer), keeping a brief window.
{
    const h = makeHarness();
    h.dodger.noteScoreboard('BED WARS Starting in §a2s Mode: Solo');
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Cheater3', taggedProfile));
    assert.equal(delay, 1000, '2s left should clamp the delay to 1s');
}

// 4. Only 1s left -> leave immediately (0 delay).
{
    const h = makeHarness();
    h.dodger.noteScoreboard('BED WARS Starting in 1s Mode: Solo');
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Cheater4', taggedProfile));
    assert.equal(delay, 0, '1s left should fire immediately');
}

// 5. Seraph-tagged player is also dodged.
{
    const h = makeHarness();
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Cheater5', seraphProfile));
    assert.equal(delay, 3000, 'seraph-tagged player should schedule a dodge');
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
    assert.equal(delay, 3000, 'nicked players should schedule when nick dodging is enabled');
}

// 10. Stat threats use separate auto-dodge thresholds.
{
    const h = makeHarness({ statThreats: true, minFkdr: 4, minStars: 1000 });
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('Sweat1', statThreatProfile));
    assert.equal(delay, 3000, 'stat threats should schedule when separate FKDR threshold is met');
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
    assert.equal(delay, 3000, 'a real tag alongside the notice should still dodge');
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
    const h = makeHarness({ delaySeconds: 10 });
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
    assert.deepStrictEqual(scheduled.map(timer => timer.delay), [10000, 1000], 'late countdown must reschedule the leave before game start');
    assert.strictEqual(cleared[0], scheduled[0], 'the original long timer must be cancelled');
}

// 10e. A known nick that resolves to a current party member never dodges.
{
    const h = makeHarness({
        isPartyMember: name => String(name).toLowerCase() === 'partymate'
    });
    const delay = captureScheduleDelay(() => h.dodger.maybeSchedule('KnownNick', knownNickedThreatProfile, { knownDenick }));
    assert.equal(delay, null, 'the real IGN in the denick list must be checked against the party roster');
}

// 10f. Known denicks still use the enabled tag/stat checks with their real stats.
{
    const tagged = makeHarness({ taggedPlayers: true });
    const tagDelay = captureScheduleDelay(() => tagged.dodger.maybeSchedule('KnownNick', knownNickedThreatProfile, { knownDenick }));
    assert.equal(tagDelay, 3000, 'a known denick with a tag should dodge when tagged-player dodging is enabled');

    const statThreat = makeHarness({ taggedPlayers: false, statThreats: true, minFkdr: 4, minStars: 1000 });
    const statDelay = captureScheduleDelay(() => statThreat.dodger.maybeSchedule('KnownNick', knownNickedThreatProfile, { knownDenick }));
    assert.equal(statDelay, 3000, 'a known denick with threat stats should dodge when stat-threat dodging is enabled');
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
