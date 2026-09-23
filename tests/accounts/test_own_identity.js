const assert = require('assert');
const { createOwnIdentityTracker } = require('../../src/net/session/ownIdentity.js');

function normalizeUuid(value) {
    const raw = String(value || '').replace(/-/g, '').toLowerCase();
    return /^[0-9a-f]{32}$/.test(raw) ? raw : null;
}

function isValidPlayerName(name) {
    return typeof name === 'string' && name.length >= 3 && name.length <= 16 && /^[a-zA-Z0-9_]+$/.test(name);
}

function nickKey(name) {
    return String(name || '').toLowerCase();
}

function createTracker(username = 'Nestersen') {
    return createOwnIdentityTracker({
        client: {
            username,
            uuid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            profile: { id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
            session: { selectedProfile: { id: 'cccccccccccccccccccccccccccccccc' } }
        },
        hypixelClient: {
            uuid: 'dddddddddddddddddddddddddddddddd',
            profile: { id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' },
            session: { selectedProfile: { id: 'ffffffffffffffffffffffffffffffff' } }
        },
        isValidPlayerName,
        normalizeUuid,
        nickKey
    });
}

{
    const tracker = createTracker();
    tracker.seedOwnIdentity();
    tracker.rememberOwnName('Nickersen', 'chat_nick');
    tracker.rememberOwnUuid('11111111-1111-1111-1111-111111111111');

    const names = tracker.getOwnKnownNames();
    assert(names.includes('Nestersen'), 'known names should include seeded account name');
    assert(names.includes('Nickersen'), 'known names should include remembered nick');

    names.push('Mutated');
    assert(!tracker.getOwnKnownNames().includes('Mutated'), 'known-name list should be copied');

    const entries = tracker.getOwnKnownNameEntries();
    const entryIndex = entries.findIndex(([, value]) => value.name === 'Nickersen');
    assert(entryIndex >= 0, 'snapshot entries should include remembered nick');
    entries[entryIndex][1].name = 'Changed';
    assert(tracker.getOwnKnownNames().includes('Nickersen'), 'snapshot entries should be copied');

    const uuids = tracker.getOwnUuidCandidates();
    assert(uuids.includes('11111111111111111111111111111111'), 'uuid candidates should normalize dashed UUIDs');
    uuids.push('22222222222222222222222222222222');
    assert(!tracker.getOwnUuidCandidates().includes('22222222222222222222222222222222'), 'uuid candidates should be copied');
}

{
    const tracker = createTracker();
    const now = Date.now();
    tracker.restoreOwnIdentitySnapshot({
        ownKnownNames: [
            ['wrong-key', { name: 'Nickersen', source: 'snapshot', at: now, permanent: false }],
            ['invalid', { name: 'xy', source: 'snapshot', at: now, permanent: false }],
            ['missing-value', null]
        ],
        ownUuidCandidates: [
            '11111111-1111-1111-1111-111111111111',
            'not-a-uuid'
        ]
    });

    assert(tracker.isOwnPlayerName('Nickersen'), 'restore should normalize known-name keys from names');
    assert(!tracker.isOwnPlayerName('xy'), 'restore should ignore invalid player names');
    assert(tracker.isOwnUuid('11111111111111111111111111111111'), 'restore should normalize uuid candidates');
    assert(!tracker.isOwnUuid('not-a-uuid'), 'restore should ignore invalid uuid candidates');
}

console.log('Own identity tracker tests passed.');
