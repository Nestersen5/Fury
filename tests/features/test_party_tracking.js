const assert = require('assert');
const { createPartyTracker, isWithinReconnectGrace } = require('../../src/net/session/partyTracking.js');

function stripFormatting(text) {
    return String(text || '').replace(/§[0-9A-FK-OR]/gi, '');
}

function sleepSync(ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* busy-wait: keeps tick()-driven checks sync and dependency-free */ }
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function createTracker({ selfName = 'Nestersen', onRequest = () => {} } = {}) {
    return createPartyTracker({
        stripFormatting,
        getSelfName: () => selfName,
        requestPartyListCommand: onRequest,
        sendChat: () => {}
    });
}

(async () => {
    // Join event: roster starts uncertain and includes self, and immediately
    // schedules one /p list (sent after the ~1s send delay, not instantly).
    {
        let requests = 0;
        const tracker = createTracker({ onRequest: () => { requests += 1; } });

        tracker.handleChatLine("You have joined Leaderman's party!");
        assert.strictEqual(tracker.isInParty(), true, 'should be in party after join message');
        assert.strictEqual(tracker.getLeaderName(), 'Leaderman', 'leader should be parsed from join message');
        assert.strictEqual(tracker.isUncertain(), true, 'roster is uncertain until /p list confirms it');
        assert.strictEqual(tracker.isTrackedMember('Nestersen'), true, 'self should be folded into the roster');
        assert.strictEqual(requests, 0, '/p list should not fire instantly - it waits out the send delay first');

        await wait(1_100);
        assert.strictEqual(requests, 1, 'joining a party should request exactly one /p list after the send delay');
    }

    // /p list confirms the full roster and clears uncertainty.
    {
        const tracker = createTracker();
        tracker.handleChatLine("You have joined Leaderman's party!");

        tracker.handleChatLine('Party Members');
        tracker.handleChatLine('Party Leader: Leaderman');
        tracker.handleChatLine('Party Moderators: ModderMan');
        tracker.handleChatLine('Party Members: Nestersen ● FriendOne ● FriendTwo');
        sleepSync(450);
        tracker.tick();

        assert.strictEqual(tracker.hasUsableState(), true, 'state should be confirmed after /p list parses');
        assert.deepStrictEqual(tracker.getModerators(), ['ModderMan']);
        assert.deepStrictEqual(tracker.getMembers().sort(), ['FriendOne', 'FriendTwo', 'Nestersen'].sort());
        assert.strictEqual(tracker.isTrackedMember('friendone'), true, 'membership check should be case-insensitive');
        assert.strictEqual(tracker.isTrackedMember('RandomEnemy'), false);
    }

    // Member leaving updates the roster instantly with no /p list call needed.
    {
        let requests = 0;
        const tracker = createTracker({ onRequest: () => { requests += 1; } });
        tracker.handleChatLine('Party Members');
        tracker.handleChatLine('Party Leader: Leaderman');
        tracker.handleChatLine('Party Moderators:');
        tracker.handleChatLine('Party Members: Nestersen ● FriendOne');
        sleepSync(450);
        tracker.tick();
        requests = 0; // reset counter after the setup snapshot

        tracker.handleChatLine('FriendOne has left the party.');
        assert.strictEqual(tracker.isTrackedMember('FriendOne'), false, 'left member should drop out instantly');
        assert.strictEqual(requests, 0, 'a plain member leaving should not trigger a /p list call');
    }

    // Leader disconnecting is ambiguous -> uncertain, but no proactive /p list; only
    // fires lazily the next time something asks isTrackedMember/getStatusSnapshot,
    // and only after the send delay elapses.
    {
        let requests = 0;
        const tracker = createTracker({ onRequest: () => { requests += 1; } });
        tracker.handleChatLine('Party Members');
        tracker.handleChatLine('Party Leader: Leaderman');
        tracker.handleChatLine('Party Moderators:');
        tracker.handleChatLine('Party Members: Nestersen');
        sleepSync(450);
        tracker.tick();
        requests = 0;

        tracker.handleChatLine('Leaderman has left the party.');
        assert.strictEqual(tracker.isUncertain(), true, 'losing the leader should mark state uncertain');
        assert.strictEqual(requests, 0, 'no proactive /p list on the ambiguous event itself');

        tracker.isTrackedMember('Nestersen'); // any consumer asking should lazily trigger a refresh
        assert.strictEqual(requests, 0, 'the /p list should not fire before the send delay elapses');

        tracker.isTrackedMember('Nestersen'); // calling again immediately must not schedule a second one
        await wait(1_100);
        assert.strictEqual(requests, 1, 'a consumer query while uncertain should trigger exactly one /p list');

        tracker.isTrackedMember('Nestersen');
        await wait(1_100);
        assert.strictEqual(requests, 1, 'the 10s cooldown should block an immediate second request');
    }

    // Leaving the party entirely is unambiguous -> confirmed, no refresh needed.
    // Starts from an already-confirmed roster (not a fresh join) so there's no
    // dangling scheduled request left over to confuse this check.
    {
        let requests = 0;
        const tracker = createTracker({ onRequest: () => { requests += 1; } });
        tracker.handleChatLine('Party Members');
        tracker.handleChatLine('Party Leader: Leaderman');
        tracker.handleChatLine('Party Moderators:');
        tracker.handleChatLine('Party Members: Nestersen');
        sleepSync(450);
        tracker.tick();
        requests = 0;

        tracker.handleChatLine('You left the party.');
        assert.strictEqual(tracker.isInParty(), false);
        assert.strictEqual(tracker.hasUsableState(), true, 'confirmed not-in-party is a usable state');
        await wait(1_100);
        assert.strictEqual(requests, 0, 'leaving the party is unambiguous and needs no /p list');
    }

    // Reconnect grace window: skip the connect-time /p list if we just disconnected.
    {
        assert.strictEqual(isWithinReconnectGrace(0), false, 'no prior disconnect means no grace window');
        assert.strictEqual(isWithinReconnectGrace(Date.now() - 1000), true, '1s since disconnect is within the 5s grace');
        assert.strictEqual(isWithinReconnectGrace(Date.now() - 6000), false, '6s since disconnect is past the grace window');
    }

    // notifyConnected({ skip: true }) should not request a /p list at all.
    {
        let requests = 0;
        const tracker = createTracker({ onRequest: () => { requests += 1; } });
        tracker.notifyConnected({ skip: true });
        await wait(1_100);
        assert.strictEqual(requests, 0, 'a skipped connect notification should never fire /p list');
    }

    // notifyConnected() must be idempotent: repeated calls (simulating Hypixel's
    // lobby -> pregame -> game -> lobby server switches, which each resend a
    // protocol login packet on the same connection) should only fire /p list once.
    // notifyConnected's own ~750ms connect delay plus requestPartyListRefresh's
    // ~1s send delay stack, so wait out both before checking.
    {
        let requests = 0;
        const tracker = createTracker({ onRequest: () => { requests += 1; } });
        tracker.notifyConnected();
        tracker.notifyConnected();
        tracker.notifyConnected();
        await wait(2_000);
        assert.strictEqual(requests, 1, 'only the first notifyConnected() call per tracker should request /p list');
    }

    console.log('test_party_tracking.js: all assertions passed');
})();
