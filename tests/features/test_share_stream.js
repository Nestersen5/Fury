'use strict';

// Covers the live /share streaming sink: grouped mode emits teams in completion
// order (each team internally FKDR-sorted), including legacy settings, and dedupes repeats.

const assert = require('assert');
const { createShareTagsBroadcaster } = require('../../src/overlay/shareTags.js');

function makeBroadcaster(state, messages) {
    return createShareTagsBroadcaster({
        state,
        sendChat() {},
        getHypixelClient: () => ({ write: (_name, { message }) => messages.push(message) }),
        getLocalUsername: () => '',
        saveFeatureConfig() {},
        getPartyStatus: () => true,
        getPresentAtGameStart: () => true
    });
}

function baseState(overrides = {}) {
    return {
        shareTagsGroupByTeam: true,
        shareTagsFancy: false,
        shareTagsColorLocal: false,
        shareTagsIncludeTagged: true,
        shareTagsIncludeNicks: true,
        shareTagsIncludeThreats: true,
        shareTagsDestination: 'party',
        ...overrides
    };
}

const threat = (name, team, fkdr) => ({ name, team, gameMode: 'BEDWARS', isThreat: true, fkdr, sortValue: fkdr });

// Extract the player names from the sent "/pc [TEAM] Name: FKDR: x" lines.
function namesFrom(messages) {
    return messages
        .filter(m => !/\+\d+ more/.test(m))
        .map(m => (m.match(/\]\s+([A-Za-z0-9_]+)/) || [])[1])
        .filter(Boolean);
}

(async () => {
    // --- grouped: completion order, FKDR-sorted within a team ---
    {
        const messages = [];
        const b = makeBroadcaster(baseState({ shareTagsGroupByTeam: true }), messages);
        const stream = b.createStream({}, { gameMode: 'BEDWARS', includeSet: ['threats'], isStillActive: () => true });
        stream.onTeam('BLUE', [threat('C', 'BLUE', 3)]);          // BLUE completes first
        stream.onTeam('RED', [threat('A', 'RED', 5), threat('B', 'RED', 8)]); // RED second
        await stream.end();
        assert.deepStrictEqual(namesFrom(messages), ['C', 'B', 'A'],
            'grouped: BLUE first, then RED sorted by FKDR desc (B=8 before A=5)');
    }

    // --- legacy disabled preference still keeps teams together ---
    {
        const messages = [];
        const b = makeBroadcaster(baseState({ shareTagsGroupByTeam: false }), messages);
        const stream = b.createStream({}, { gameMode: 'BEDWARS', includeSet: ['threats'], isStillActive: () => true });
        stream.onRow(threat('A', 'RED', 5));
        stream.onRow(threat('C', 'BLUE', 3));
        stream.onRow(threat('B', 'RED', 8));
        stream.onTeam('BLUE', [threat('C', 'BLUE', 3)]);
        stream.onTeam('RED', [threat('A', 'RED', 5), threat('B', 'RED', 8)]);
        await stream.end();
        assert.strictEqual(b.getSettings().groupByTeam, true);
        assert.deepStrictEqual(namesFrom(messages), ['C', 'B', 'A'], 'legacy false preference cannot disable team order');
    }

    // --- dedup: the same player pushed twice is sent once ---
    {
        const messages = [];
        const b = makeBroadcaster(baseState({ shareTagsGroupByTeam: false }), messages);
        const stream = b.createStream({}, { gameMode: 'BEDWARS', includeSet: ['threats'], isStillActive: () => true });
        const row = threat('Dup', 'RED', 4);
        stream.onTeam('RED', [row]);
        stream.onTeam('RED', [row]);
        await stream.end();
        assert.deepStrictEqual(namesFrom(messages), ['Dup'], 'dedup: duplicate row sent once');
    }

    // --- grouped sharing ignores individual onRow events ---
    {
        const messages = [];
        const b = makeBroadcaster(baseState({ shareTagsGroupByTeam: true }), messages);
        const stream = b.createStream({}, { gameMode: 'BEDWARS', includeSet: ['threats'], isStillActive: () => true });
        stream.onRow(threat('Ignored', 'RED', 9)); // grouped mode must ignore onRow
        stream.onTeam('RED', [threat('Kept', 'RED', 4)]);
        await stream.end();
        assert.deepStrictEqual(namesFrom(messages), ['Kept'], 'grouped mode ignores onRow events');
    }

    console.log('test_share_stream.js passed');
})().catch(err => { console.error(err); process.exit(1); });
