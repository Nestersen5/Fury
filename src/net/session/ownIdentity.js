'use strict';

// Per-connection own-identity tracker, extracted from createProxyServer.
// Remembers the player's own UUIDs and known nick names (account name,
// observed display names, nicks they /denick add'd) so other features can
// answer "is this row me?" without misattributing teammates or scanning
// the player themselves.
//
// State is per-connection. Permanent entries (account name, anchoring UUID)
// survive resetOwnNickNames(); transient entries (observed nicks) get
// pruned after 6h or wiped on game-state transitions that change identity.

const STALE_OWN_NAME_TTL_MS = 6 * 60 * 60 * 1000;

function createOwnIdentityTracker(deps) {
    const {
        client,
        hypixelClient,
        isValidPlayerName,
        normalizeUuid,
        nickKey
    } = deps;

    const ownKnownNames = new Map();
    const ownUuidCandidates = new Set();

    function rememberOwnUuid(value) {
        const normalized = normalizeUuid(value);
        if (normalized) ownUuidCandidates.add(normalized);
    }

    function rememberOwnName(name, source = 'observed', options = {}) {
        if (!isValidPlayerName(name)) return false;
        const key = nickKey(name);
        ownKnownNames.set(key, {
            name,
            source,
            at: Date.now(),
            permanent: Boolean(options.permanent) || key === nickKey(client.username)
        });
        return true;
    }

    function seedOwnIdentity() {
        rememberOwnName(client.username, 'account', { permanent: true });
        rememberOwnUuid(client.uuid);
        rememberOwnUuid(client.profile?.id);
        rememberOwnUuid(client.session?.selectedProfile?.id);
        rememberOwnUuid(hypixelClient.uuid);
        rememberOwnUuid(hypixelClient.profile?.id);
        rememberOwnUuid(hypixelClient.session?.selectedProfile?.id);
    }

    function pruneOwnNames() {
        const now = Date.now();
        for (const [key, value] of ownKnownNames.entries()) {
            if (!value?.permanent && now - (value.at || 0) > STALE_OWN_NAME_TTL_MS) {
                ownKnownNames.delete(key);
            }
        }
    }

    function resetOwnNickNames() {
        for (const [key, value] of ownKnownNames.entries()) {
            if (!value?.permanent) ownKnownNames.delete(key);
        }
    }

    function isOwnUuid(value) {
        seedOwnIdentity();
        const normalized = normalizeUuid(value);
        return Boolean(normalized && ownUuidCandidates.has(normalized));
    }

    function isOwnPlayerName(name) {
        if (!isValidPlayerName(name)) return false;
        seedOwnIdentity();
        pruneOwnNames();
        return ownKnownNames.has(nickKey(name));
    }

    function getOwnKnownNames() {
        seedOwnIdentity();
        pruneOwnNames();
        return Array.from(ownKnownNames.values())
            .map(value => value?.name)
            .filter(isValidPlayerName);
    }

    function getOwnKnownNameEntries() {
        seedOwnIdentity();
        pruneOwnNames();
        return Array.from(ownKnownNames.entries()).map(([key, value]) => [
            key,
            {
                name: value?.name,
                source: value?.source,
                at: value?.at,
                permanent: Boolean(value?.permanent)
            }
        ]);
    }

    function getOwnUuidCandidates() {
        seedOwnIdentity();
        return Array.from(ownUuidCandidates);
    }

    function restoreOwnIdentitySnapshot(snapshot = {}) {
        ownKnownNames.clear();
        ownUuidCandidates.clear();

        const entries = Array.isArray(snapshot.ownKnownNames) ? snapshot.ownKnownNames : [];
        entries.forEach((entry) => {
            if (!Array.isArray(entry) || entry.length < 2) return;
            const [, value] = entry;
            if (!isValidPlayerName(value?.name)) return;
            const key = nickKey(value.name);
            ownKnownNames.set(key, {
                name: value.name,
                source: String(value.source || 'snapshot'),
                at: Number.isFinite(Number(value.at)) ? Number(value.at) : Date.now(),
                permanent: Boolean(value.permanent) || key === nickKey(client.username)
            });
        });

        const uuids = Array.isArray(snapshot.ownUuidCandidates) ? snapshot.ownUuidCandidates : [];
        uuids.forEach(value => rememberOwnUuid(value));
    }

    return {
        rememberOwnUuid,
        rememberOwnName,
        seedOwnIdentity,
        pruneOwnNames,
        resetOwnNickNames,
        isOwnUuid,
        isOwnPlayerName,
        getOwnKnownNames,
        getOwnKnownNameEntries,
        getOwnUuidCandidates,
        restoreOwnIdentitySnapshot
    };
}

module.exports = { createOwnIdentityTracker, STALE_OWN_NAME_TTL_MS };
