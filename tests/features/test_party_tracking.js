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

    // Final disconnect removals use the same path as ordinary party kicks.
    for (const { line, moderator = false } of [
        { line: 'lemle was removed from your party because they disconnected.' },
        { line: '§b[MVP§c+§b] lemle §ewas removed from your party because they disconnected.' },
        { line: '[MVP+] lemle was removed from your party because they disconnected.', moderator: true },
        { line: '[MVP+] lemle has been removed from the party.' }
    ]) {
        let requests = 0;
        const tracker = createTracker({ onRequest: () => { requests += 1; } });
        tracker.handleChatLine("You have joined Leaderman's party!");
        tracker.handleChatLine("You'll be partying with: lemle, FriendOne");
        if (moderator) tracker.handleChatLine('Leaderman has promoted lemle to Party Moderator');
        tracker.handleChatLine('lemle has disconnected, they have 5 minutes to rejoin before they are removed from the party.');
        assert.strictEqual(tracker.isTrackedMember('lemle'), true, 'disconnect grace keeps the player in the party');
        assert.deepStrictEqual(tracker.getStatusSnapshot().disconnectedMembers, ['lemle']);

        tracker.handleChatLine(`Party > Leaderman: ${line}`);
        assert.strictEqual(tracker.isTrackedMember('lemle'), true, 'quoted removal messages cannot remove a member');
        const before = tracker.getStatusSnapshot().revision;
        tracker.handleChatLine(line);
        const snapshot = tracker.getStatusSnapshot();
        assert.strictEqual(tracker.isTrackedMember('lemle'), false, `removed player must drop out instantly: ${line}`);
        assert.deepStrictEqual(snapshot.members, ['Nestersen', 'FriendOne']);
        assert.deepStrictEqual(snapshot.moderators, []);
        assert.deepStrictEqual(snapshot.disconnectedMembers, [], 'removed players no longer count as disconnected party members');
        assert.strictEqual(snapshot.leader, 'Leaderman');
        assert.strictEqual(snapshot.inParty, true);
        assert.strictEqual(snapshot.uncertain, false);
        assert.strictEqual(snapshot.revision, before + 1, 'removal invalidates consumers once');
        await wait(1_100);
        assert.strictEqual(requests, 0, 'a confirmed removal needs no /p list');
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

    // Joining lists the rest of the party, so the join's /p list is cancelled.
    // Lines are taken from real Hypixel chat, including a leader ending in "s".
    {
        let requests = 0;
        const tracker = createTracker({ onRequest: () => { requests += 1; } });
        tracker.handleChatLine("You have joined §6[MVP§c++§6] FortuneCks' party!");
        tracker.handleChatLine("You'll be partying with: §b[MVP§c+§b] 250mph§e, §b[MVP§c+§b] 7purp§e, Parmed");
        assert.strictEqual(tracker.getLeaderName(), 'FortuneCks', 'possessive without "s" must still parse');
        assert.strictEqual(tracker.hasUsableState(), true, 'join + partying-with is the whole party');
        assert.deepStrictEqual(tracker.getMembers().sort(), ['250mph', '7purp', 'Nestersen', 'Parmed'].sort());
        await wait(1_100);
        assert.strictEqual(requests, 0, 'a confirmed join needs no /p list');
    }

    // A partial list ("and N other players!") still needs the /p list.
    {
        let requests = 0;
        const tracker = createTracker({ onRequest: () => { requests += 1; } });
        tracker.handleChatLine("You have joined [MVP++] Tiddles76's party!");
        tracker.handleChatLine("You'll be partying with: TheMissingCode, [VIP+] Mylars and 21 other players!");
        assert.strictEqual(tracker.isTrackedMember('Mylars'), true);
        assert.strictEqual(tracker.isUncertain(), true, 'a partial list does not confirm the party');
        await wait(1_100);
        assert.strictEqual(requests, 1);
    }

    // The join's /p list is cancelled at send time if chat confirmed the party meanwhile.
    {
        let request = null;
        const tracker = createTracker({ onRequest: options => { request = options; } });
        tracker.handleChatLine("You have joined Leaderman's party!");
        await wait(1_100);
        assert(request && typeof request.shouldSend === 'function');
        tracker.handleChatLine('Party Members (2)');
        tracker.handleChatLine('Party Leader: Leaderman ●');
        tracker.handleChatLine('Party Members: Nestersen ●');
        sleepSync(450);
        tracker.tick();
        assert.strictEqual(request.shouldSend(), false, 'an already confirmed party must not send /p list');
        assert.strictEqual(tracker.isHidingChat(), false);
    }

    // Party chat shows real IGNs, so the sender is a member.
    {
        const tracker = createTracker();
        tracker.handleChatLine("You have joined Leaderman's party!");
        tracker.handleChatLine('§9Party §8> §a[VIP] rapidbird§f: go go');
        tracker.handleChatLine('§9Party §8> TheRealBraker§f: Party > [VIP] Fake: x');
        assert.strictEqual(tracker.isTrackedMember('rapidbird'), true);
        assert.strictEqual(tracker.isTrackedMember('TheRealBraker'), true, 'unranked senders count too');
        assert.strictEqual(tracker.isTrackedMember('Fake'), false, 'quoted text is not a sender');
        tracker.handleChatLine('§9Party §8> §a[VIP] rapidbird§f: Spoofed joined the party.');
        assert.strictEqual(tracker.isTrackedMember('Spoofed'), false, 'party messages cannot fake party events');
        tracker.handleChatLine('[VIP] Stranger: hello');
        assert.strictEqual(tracker.isTrackedMember('Stranger'), false, 'public chat is not party chat');

        const solo = createTracker();
        solo.handleChatLine('You left the party.');
        solo.handleChatLine('Party > [MVP+] Friend: hi');
        assert.strictEqual(solo.isInParty(), true, 'party chat proves a party exists');
        assert.strictEqual(solo.isUncertain(), true, 'the rest of that party is still unknown');
        assert.strictEqual(solo.isTrackedMember('Friend'), true);
    }

    // Fury's own /p list reply is parsed but hidden, including its borders.
    function hiddenTracker() {
        const forwarded = [];
        let onRequest = () => {};
        const tracker = createPartyTracker({
            stripFormatting,
            getSelfName: () => 'Nestersen',
            requestPartyListCommand: options => onRequest(options),
            forwardChat: packet => forwarded.push(packet),
            sendChat: () => {}
        });
        return { tracker, forwarded, setOnRequest: fn => { onRequest = fn; } };
    }
    {
        const { tracker, forwarded, setOnRequest } = hiddenTracker();
        const sent = new Promise(resolve => setOnRequest(options => resolve(options.shouldSend())));
        tracker.handleChatLine("You have joined Leaderman's party!");
        assert.strictEqual(await sent, true);
        assert.strictEqual(tracker.isHidingChat(), true);

        const border = '§9§m-----------------------------------------------------';
        const reply = [border, '§6Party Members (3)', '', '§eParty Leader: §b[MVP§c+§b] Leaderman §a●',
            '§eParty Members: §a[VIP] FriendOne§a ● Nestersen§a ● ', border];
        for (const line of reply) {
            const result = tracker.filterClientboundChat(line, { line });
            assert.deepStrictEqual(result, { forward: false, release: [] }, `hidden: ${JSON.stringify(line)}`);
            tracker.handleChatLine(line);
        }
        sleepSync(450);
        tracker.tick();
        assert.strictEqual(tracker.isTrackedMember('FriendOne'), true, 'a hidden reply still updates the party');
        assert.strictEqual(tracker.isHidingChat(), false, 'hiding ends with the closing border');
        assert.deepStrictEqual(tracker.filterClientboundChat('Next message', {}), { forward: true, release: [] });
        await wait(300);
        assert.deepStrictEqual(forwarded, [], 'the opening border was dropped, not released');
    }

    // Other bordered messages during the window stay visible and in order.
    {
        const { tracker, forwarded, setOnRequest } = hiddenTracker();
        const sent = new Promise(resolve => setOnRequest(options => resolve(options.shouldSend())));
        tracker.handleChatLine("You have joined Leaderman's party!");
        await sent;
        const border = { id: 'border' };
        assert.deepStrictEqual(tracker.filterClientboundChat('-----------------------------------------------------', border), { forward: false, release: [] });
        assert.deepStrictEqual(tracker.filterClientboundChat('Some other announcement', {}), { forward: true, release: [border] });

        const lone = { id: 'lone' };
        tracker.filterClientboundChat('-----------------------------------------------------', lone);
        await wait(300);
        assert.deepStrictEqual(forwarded, [lone], 'a held border is released if nothing follows');
    }

    // A /p list typed by the player is shown, and replaces Fury's pending one.
    {
        const { tracker, forwarded, setOnRequest } = hiddenTracker();
        let request = null;
        setOnRequest(options => { request = options; });
        tracker.handleChatLine("You have joined Leaderman's party!");
        await wait(1_100);
        tracker.observeOwnCommand('/p list');
        assert.strictEqual(request.shouldSend(), false, "the player's own /p list answers Fury's request");
        assert.strictEqual(tracker.isHidingChat(), false);
        assert.deepStrictEqual(tracker.filterClientboundChat('Party Members (2)', {}), { forward: true, release: [] });
        assert.deepStrictEqual(forwarded, []);
    }

    // A quick reconnect restores the last party as unconfirmed.
    {
        const before = createTracker();
        before.handleChatLine("You have joined Leaderman's party!");
        before.handleChatLine("You'll be partying with: [VIP] FriendOne");
        const state = before.exportState();

        let requests = 0;
        const after = createTracker({ onRequest: () => { requests += 1; } });
        assert.strictEqual(after.restoreState(state), true);
        assert.strictEqual(after.isInParty(), true);
        assert.strictEqual(after.isTrackedMember('FriendOne'), true, 'restored members stay protected');
        assert.strictEqual(after.isUncertain(), true, 'changes during the disconnect may have been missed');
        await wait(1_100);
        assert.strictEqual(requests, 1, 'the first check refreshes the restored party once');
        assert.strictEqual(createTracker().exportState(), null, 'an unknown party is not carried over');
    }

    console.log('test_party_tracking.js: all assertions passed');
})();
