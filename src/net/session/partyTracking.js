'use strict';

// Per-connection Hypixel party tracker, ported from the NestySkyblock5 Forge
// mod's PartyStateManager.java. Learns who is in the player's Hypixel /p party
// (leader/moderators/members) from chat lines, independent of any in-game
// Bedwars scoreboard team.
//
// Design (deliberately minimal on /p list traffic):
// - Chat lines (join/leave/promote/kick/etc) update the roster instantly and
//   are the primary source of truth.
// - "/p list" is only ever requested:
//     1. Once, immediately, the first time we detect we're in a party with no
//        prior roster ("You have joined X's party!") - we have zero member
//        data otherwise.
//     2. Lazily, on demand, when a consumer calls isTrackedMember()/getStatus()
//        while the roster is `uncertain` - not proactively, and not on any
//        time-based staleness timer.
// - A 10s cooldown and 5s response timeout guard every /p list request.

const PARTY_LIST_REQUEST_COOLDOWN_MS = 10_000;
const PARTY_LIST_RESPONSE_TIMEOUT_MS = 5_000;
const PARTY_LIST_LINE_GAP_MS = 400;
const PARTY_LIST_COMMAND_DELAY_MS = 1_000;
const TICK_INTERVAL_MS = 300;
const CONNECT_REFRESH_DELAY_MS = 750;
const RECONNECT_GRACE_MS = 5_000;

// If the player reconnects within this grace window of their last disconnect,
// the roster almost certainly hasn't changed - skip the connect-time /p list.
// lastDisconnectAt must be tracked by the caller since a fresh tracker
// instance is created on every new connection and has no memory of the last one.
function isWithinReconnectGrace(lastDisconnectAt) {
    return Boolean(lastDisconnectAt) && (Date.now() - lastDisconnectAt) < RECONNECT_GRACE_MS;
}

const PARTY_JOINED_PATTERN = /^(.+?) joined the party\.$/;
const PARTY_LEFT_PATTERN = /^(.+?) has left the party\.$/;
const PARTY_REMOVED_PATTERN = /^(.+?) has been removed from the party\.$/;
const PARTY_TRANSFERRED_PATTERN = /^The party was transferred to (.+?) by (.+?)$/;
const PARTY_DISBANDED_BY_PLAYER_PATTERN = /^(.+?) has disbanded the party!$/;
const PARTY_DISCONNECTED_PATTERN = /^(.+?) has disconnected, they have 5 minutes to rejoin before they are removed from the party\.$/;
const PARTY_REJOINED_PATTERN = /^(.+?) has rejoined\.$/;
const PARTY_OFFLINE_KICKED_PATTERN = /^Kicked (.+?) because they were offline\.$/;
const PARTY_PROMOTED_TO_MODERATOR_PATTERN = /^(.+?) has promoted (.+?) to Party Moderator$/;
const PARTY_DEMOTED_TO_MEMBER_PATTERN = /^(.+?) has demoted (.+?) to Party Member$/;
const PARTY_PROMOTED_TO_LEADER_PATTERN = /^(.+?) has promoted (.+?) to Party Leader$/;
const PARTY_LIST_LEADER_PATTERN = /^Party Leader:\s*(.+)$/;
const PARTY_LIST_MODERATORS_PATTERN = /^Party Moderators:\s*(.+)$/;
const PARTY_LIST_MEMBERS_PATTERN = /^Party Members:\s*(.+)$/;
const YOU_WERE_KICKED_PATTERN = /^You have been kicked from the party by (.+?)$/;
const PARTY_LEADER_DISCONNECTED_PATTERN = /^The party leader, (.+?) has disconnected, they have 5 minutes to rejoin before the party is disbanded\.$/;
const PARTY_LEADER_REJOINED_PATTERN = /^The party leader (.+?) has rejoined\.$/;
const YOU_JOINED_PARTY_PATTERN = /^You have joined (.+?)'s party!$/;
const YOU_LEFT_PARTY_PATTERN = /^You left the party\.$/;

function createPartyTracker(deps) {
    const {
        stripFormatting,
        getSelfName,
        requestPartyListCommand,
        sendChat
    } = deps;

    let tickHandle = null;
    let hasNotifiedConnect = false;

    let inParty = false;
    let leaderName = null;
    let moderators = new Set();
    let members = new Set();

    let initialized = false;
    let uncertain = true;

    let lastStateUpdateTime = 0;
    let lastFullRefreshTime = 0;
    let lastPartyListRequestTime = 0;

    let awaitingPartyListResponse = false;
    let partyListRequestStartTime = 0;

    let parsingPartyList = false;
    let pendingLeaderName = null;
    let pendingModerators = new Set();
    let pendingMembers = new Set();
    let lastPartyListLineTime = 0;

    function normalizePlayerName(raw) {
        if (raw == null) return '';
        let stripped = stripFormatting(String(raw)).trim();

        if (stripped.startsWith('[') && stripped.includes(']')) {
            const endBracket = stripped.indexOf(']');
            if (endBracket >= 0 && endBracket + 1 < stripped.length) {
                stripped = stripped.slice(endBracket + 1).trim();
            }
        }

        return stripped.replace(/●/g, '').trim();
    }

    function namesFromPartyListSegment(segment) {
        if (!segment) return [];
        const stripped = stripFormatting(segment);
        return stripped
            .split('●')
            .map(normalizePlayerName)
            .filter(name => name.length > 0);
    }

    function firstNameFromPartyListSegment(segment) {
        const names = namesFromPartyListSegment(segment);
        return names.length ? names[0] : null;
    }

    function isSelf(player) {
        const self = normalizePlayerName(getSelfName());
        return Boolean(self) && self.toLowerCase() === String(player || '').toLowerCase();
    }

    function ensureSelfIncluded() {
        const self = normalizePlayerName(getSelfName());
        if (!self) return;
        if (leaderName && leaderName.toLowerCase() === self.toLowerCase()) return;
        if ([...moderators].some(name => name.toLowerCase() === self.toLowerCase())) return;
        if (![...members].some(name => name.toLowerCase() === self.toLowerCase())) {
            members.add(self);
        }
    }

    function addToModeratorsIfMissing(player) {
        if (!player) return;
        if (leaderName && leaderName.toLowerCase() === player.toLowerCase()) return;
        members.forEach(name => { if (name.toLowerCase() === player.toLowerCase()) members.delete(name); });
        if (![...moderators].some(name => name.toLowerCase() === player.toLowerCase())) {
            moderators.add(player);
        }
    }

    function addToMembersIfMissing(player) {
        if (!player) return;
        if (leaderName && leaderName.toLowerCase() === player.toLowerCase()) return;
        if ([...moderators].some(name => name.toLowerCase() === player.toLowerCase())) return;
        if (![...members].some(name => name.toLowerCase() === player.toLowerCase())) {
            members.add(player);
        }
    }

    function removeKnownPlayer(player) {
        if (!player) return;
        const lower = player.toLowerCase();

        if (leaderName && leaderName.toLowerCase() === lower) leaderName = null;
        moderators.forEach(name => { if (name.toLowerCase() === lower) moderators.delete(name); });
        members.forEach(name => { if (name.toLowerCase() === lower) members.delete(name); });

        if (isSelf(player)) {
            inParty = false;
            leaderName = null;
            moderators.clear();
            members.clear();
            uncertain = false;
        } else if (!leaderName && moderators.size === 0 && members.size === 0) {
            inParty = false;
        }
    }

    function touchUpdate(fullRefresh) {
        lastStateUpdateTime = Date.now();
        if (fullRefresh) lastFullRefreshTime = lastStateUpdateTime;
    }

    function resetPendingPartyListState() {
        pendingLeaderName = null;
        pendingModerators = new Set();
        pendingMembers = new Set();
    }

    function clear() {
        inParty = false;
        leaderName = null;
        moderators = new Set();
        members = new Set();
        initialized = false;
        uncertain = true;
        lastStateUpdateTime = 0;
        lastFullRefreshTime = 0;
        lastPartyListRequestTime = 0;
        awaitingPartyListResponse = false;
        partyListRequestStartTime = 0;
        parsingPartyList = false;
        lastPartyListLineTime = 0;
        resetPendingPartyListState();
    }

    function clearAndMarkKnownNotInParty() {
        inParty = false;
        leaderName = null;
        moderators = new Set();
        members = new Set();
        initialized = true;
        uncertain = false;
        awaitingPartyListResponse = false;
        parsingPartyList = false;
        lastPartyListLineTime = 0;
        resetPendingPartyListState();
        touchUpdate(true);
    }

    function requestPartyListRefresh() {
        const now = Date.now();
        if (awaitingPartyListResponse) return;
        if (now - lastPartyListRequestTime < PARTY_LIST_REQUEST_COOLDOWN_MS) return;

        lastPartyListRequestTime = now;
        awaitingPartyListResponse = true;
        parsingPartyList = false;
        lastPartyListLineTime = 0;
        resetPendingPartyListState();
        // Slight delay before actually sending /p list, so a burst of ambiguous
        // chat events collapses into a single request instead of firing instantly.
        setTimeout(() => {
            partyListRequestStartTime = Date.now();
            requestPartyListCommand();
        }, PARTY_LIST_COMMAND_DELAY_MS);
    }

    function refreshIfUncertain() {
        if (uncertain) requestPartyListRefresh();
    }

    function finalizePartyListParse() {
        parsingPartyList = false;
        awaitingPartyListResponse = false;
        lastPartyListLineTime = 0;

        if (!pendingLeaderName) {
            resetPendingPartyListState();
            return;
        }

        leaderName = pendingLeaderName;
        moderators = new Set(pendingModerators);
        members = new Set(pendingMembers);

        moderators.forEach(name => { if (name.toLowerCase() === leaderName.toLowerCase()) moderators.delete(name); });
        members.forEach(name => { if (name.toLowerCase() === leaderName.toLowerCase()) members.delete(name); });
        moderators.forEach((modName) => {
            members.forEach(name => { if (name.toLowerCase() === modName.toLowerCase()) members.delete(name); });
        });

        inParty = true;
        initialized = true;
        uncertain = false;

        ensureSelfIncluded();
        touchUpdate(true);
        resetPendingPartyListState();
    }

    function handlePartyListLines(stripped) {
        if (stripped === 'Party Members') {
            parsingPartyList = true;
            awaitingPartyListResponse = true;
            lastPartyListLineTime = Date.now();
            resetPendingPartyListState();
            return true;
        }

        const leaderMatch = stripped.match(PARTY_LIST_LEADER_PATTERN);
        if (leaderMatch) {
            if (!parsingPartyList) { parsingPartyList = true; resetPendingPartyListState(); }
            awaitingPartyListResponse = true;
            lastPartyListLineTime = Date.now();
            pendingLeaderName = firstNameFromPartyListSegment(leaderMatch[1]);
            return true;
        }

        const moderatorsMatch = stripped.match(PARTY_LIST_MODERATORS_PATTERN);
        if (moderatorsMatch) {
            if (!parsingPartyList) { parsingPartyList = true; resetPendingPartyListState(); }
            awaitingPartyListResponse = true;
            lastPartyListLineTime = Date.now();
            pendingModerators = new Set(namesFromPartyListSegment(moderatorsMatch[1]));
            return true;
        }

        const membersMatch = stripped.match(PARTY_LIST_MEMBERS_PATTERN);
        if (membersMatch) {
            if (!parsingPartyList) { parsingPartyList = true; resetPendingPartyListState(); }
            awaitingPartyListResponse = true;
            lastPartyListLineTime = Date.now();
            pendingMembers = new Set(namesFromPartyListSegment(membersMatch[1]));
            return true;
        }

        return false;
    }

    function handleChatLine(rawText) {
        const stripped = stripFormatting(String(rawText || '')).trim();
        if (!stripped) return;

        if (handlePartyListLines(stripped)) return;

        if (stripped === 'You are not currently in a party.') {
            clearAndMarkKnownNotInParty();
            return;
        }

        if (stripped === 'The party was disbanded because all invites expired and the party was empty.') {
            clearAndMarkKnownNotInParty();
            return;
        }

        if (YOU_LEFT_PARTY_PATTERN.test(stripped)) {
            clearAndMarkKnownNotInParty();
            return;
        }

        const youJoined = stripped.match(YOU_JOINED_PARTY_PATTERN);
        if (youJoined) {
            const leader = normalizePlayerName(youJoined[1]);
            if (leader) {
                inParty = true;
                initialized = true;
                uncertain = true;
                leaderName = leader;
                moderators = new Set();
                members = new Set();
                ensureSelfIncluded();
                touchUpdate(false);
                requestPartyListRefresh();
            }
            return;
        }

        if (YOU_WERE_KICKED_PATTERN.test(stripped)) {
            clearAndMarkKnownNotInParty();
            return;
        }

        const transferred = stripped.match(PARTY_TRANSFERRED_PATTERN);
        if (transferred) {
            const newLeader = normalizePlayerName(transferred[1]);
            const oldLeader = normalizePlayerName(transferred[2]);
            if (newLeader) {
                inParty = true;
                initialized = true;
                uncertain = false;

                if (oldLeader && oldLeader.toLowerCase() !== newLeader.toLowerCase()) {
                    if (leaderName && leaderName.toLowerCase() === oldLeader.toLowerCase()) leaderName = null;
                    moderators.forEach(n => { if (n.toLowerCase() === newLeader.toLowerCase()) moderators.delete(n); });
                    members.forEach(n => { if (n.toLowerCase() === newLeader.toLowerCase()) members.delete(n); });
                    addToModeratorsIfMissing(oldLeader);
                }

                leaderName = newLeader;
                ensureSelfIncluded();
                touchUpdate(false);
            }
            return;
        }

        const promotedToModerator = stripped.match(PARTY_PROMOTED_TO_MODERATOR_PATTERN);
        if (promotedToModerator) {
            const target = normalizePlayerName(promotedToModerator[2]);
            if (target) {
                inParty = true;
                initialized = true;
                uncertain = false;
                members.forEach(n => { if (n.toLowerCase() === target.toLowerCase()) members.delete(n); });
                if (!leaderName || leaderName.toLowerCase() !== target.toLowerCase()) addToModeratorsIfMissing(target);
                ensureSelfIncluded();
                touchUpdate(false);
            }
            return;
        }

        const demotedToMember = stripped.match(PARTY_DEMOTED_TO_MEMBER_PATTERN);
        if (demotedToMember) {
            const target = normalizePlayerName(demotedToMember[2]);
            if (target) {
                inParty = true;
                initialized = true;
                uncertain = false;
                moderators.forEach(n => { if (n.toLowerCase() === target.toLowerCase()) moderators.delete(n); });
                if (!leaderName || leaderName.toLowerCase() !== target.toLowerCase()) addToMembersIfMissing(target);
                ensureSelfIncluded();
                touchUpdate(false);
            }
            return;
        }

        const promotedToLeader = stripped.match(PARTY_PROMOTED_TO_LEADER_PATTERN);
        if (promotedToLeader) {
            const promoter = normalizePlayerName(promotedToLeader[1]);
            const newLeader = normalizePlayerName(promotedToLeader[2]);
            if (newLeader) {
                inParty = true;
                initialized = true;
                uncertain = false;

                moderators.forEach(n => { if (n.toLowerCase() === newLeader.toLowerCase()) moderators.delete(n); });
                members.forEach(n => { if (n.toLowerCase() === newLeader.toLowerCase()) members.delete(n); });

                if (promoter && promoter.toLowerCase() !== newLeader.toLowerCase()) {
                    if (leaderName && leaderName.toLowerCase() === promoter.toLowerCase()) leaderName = null;
                    moderators.forEach(n => { if (n.toLowerCase() === promoter.toLowerCase()) moderators.delete(n); });
                    members.forEach(n => { if (n.toLowerCase() === promoter.toLowerCase()) members.delete(n); });
                    addToModeratorsIfMissing(promoter);
                }

                leaderName = newLeader;
                ensureSelfIncluded();
                touchUpdate(false);
            }
            return;
        }

        const joined = stripped.match(PARTY_JOINED_PATTERN);
        if (joined) {
            const player = normalizePlayerName(joined[1]);
            if (player) {
                inParty = true;
                initialized = true;
                addToMembersIfMissing(player);
                ensureSelfIncluded();
                touchUpdate(false);
            }
            return;
        }

        const left = stripped.match(PARTY_LEFT_PATTERN);
        if (left) {
            const player = normalizePlayerName(left[1]);
            if (player) {
                initialized = true;
                const wasLeader = Boolean(leaderName) && leaderName.toLowerCase() === player.toLowerCase();
                removeKnownPlayer(player);
                if (wasLeader) uncertain = true;
                touchUpdate(false);
            }
            return;
        }

        const removed = stripped.match(PARTY_REMOVED_PATTERN);
        if (removed) {
            const player = normalizePlayerName(removed[1]);
            if (player) {
                initialized = true;
                const wasLeader = Boolean(leaderName) && leaderName.toLowerCase() === player.toLowerCase();
                removeKnownPlayer(player);
                if (isSelf(player)) {
                    clearAndMarkKnownNotInParty();
                } else {
                    if (wasLeader) uncertain = true;
                    touchUpdate(false);
                }
            }
            return;
        }

        if (PARTY_DISBANDED_BY_PLAYER_PATTERN.test(stripped)) {
            clearAndMarkKnownNotInParty();
            return;
        }

        const leaderDisconnected = stripped.match(PARTY_LEADER_DISCONNECTED_PATTERN);
        if (leaderDisconnected) {
            const player = normalizePlayerName(leaderDisconnected[1]);
            if (player) {
                inParty = true;
                initialized = true;
                uncertain = false;
                leaderName = player;
                moderators.forEach(n => { if (n.toLowerCase() === player.toLowerCase()) moderators.delete(n); });
                members.forEach(n => { if (n.toLowerCase() === player.toLowerCase()) members.delete(n); });
                ensureSelfIncluded();
                touchUpdate(false);
            }
            return;
        }

        const disconnected = stripped.match(PARTY_DISCONNECTED_PATTERN);
        if (disconnected) {
            const player = normalizePlayerName(disconnected[1]);
            if (player) {
                inParty = true;
                initialized = true;
                addToMembersIfMissing(player);
                ensureSelfIncluded();
                touchUpdate(false);
            }
            return;
        }

        const leaderRejoined = stripped.match(PARTY_LEADER_REJOINED_PATTERN);
        if (leaderRejoined) {
            const player = normalizePlayerName(leaderRejoined[1]);
            if (player) {
                inParty = true;
                initialized = true;
                uncertain = false;
                leaderName = player;
                moderators.forEach(n => { if (n.toLowerCase() === player.toLowerCase()) moderators.delete(n); });
                members.forEach(n => { if (n.toLowerCase() === player.toLowerCase()) members.delete(n); });
                ensureSelfIncluded();
                touchUpdate(false);
            }
            return;
        }

        const rejoined = stripped.match(PARTY_REJOINED_PATTERN);
        if (rejoined) {
            const player = normalizePlayerName(rejoined[1]);
            if (player) {
                inParty = true;
                initialized = true;
                addToMembersIfMissing(player);
                ensureSelfIncluded();
                touchUpdate(false);
            }
            return;
        }

        const offlineKicked = stripped.match(PARTY_OFFLINE_KICKED_PATTERN);
        if (offlineKicked) {
            const player = normalizePlayerName(offlineKicked[1]);
            if (player) {
                const wasLeader = Boolean(leaderName) && leaderName.toLowerCase() === player.toLowerCase();
                removeKnownPlayer(player);
                if (wasLeader) uncertain = true;
                touchUpdate(false);
            }
        }
    }

    function tick() {
        const now = Date.now();

        if (awaitingPartyListResponse && now - partyListRequestStartTime > PARTY_LIST_RESPONSE_TIMEOUT_MS) {
            awaitingPartyListResponse = false;
            if (parsingPartyList) {
                finalizePartyListParse();
            } else {
                resetPendingPartyListState();
            }
        }

        if (parsingPartyList && lastPartyListLineTime > 0 && now - lastPartyListLineTime > PARTY_LIST_LINE_GAP_MS) {
            finalizePartyListParse();
        }
    }

    function isInParty() {
        return inParty;
    }

    function getLeaderName() {
        return leaderName;
    }

    function getModerators() {
        return Array.from(moderators);
    }

    function getMembers() {
        return Array.from(members);
    }

    function hasUsableState() {
        return initialized && !uncertain;
    }

    function isUncertain() {
        return uncertain;
    }

    function isTrackedMember(player) {
        refreshIfUncertain();
        const normalized = normalizePlayerName(player);
        if (!normalized) return false;
        const lower = normalized.toLowerCase();
        if (leaderName && leaderName.toLowerCase() === lower) return true;
        if ([...moderators].some(name => name.toLowerCase() === lower)) return true;
        return [...members].some(name => name.toLowerCase() === lower);
    }

    function getStatusSnapshot() {
        refreshIfUncertain();
        return {
            inParty,
            leader: leaderName,
            moderators: getModerators(),
            members: getMembers(),
            uncertain,
            initialized,
            lastFullRefreshTime
        };
    }

    function handleCommand(args) {
        const subCmd = String(args[1] || '').toLowerCase();
        if (subCmd !== 'status') {
            sendChat('§cUsage: /partyy status');
            return;
        }

        const snapshot = getStatusSnapshot();
        if (!snapshot.initialized) {
            sendChat('§6[Party] §7State unknown yet — requesting an update from Hypixel...');
        } else if (!snapshot.inParty) {
            sendChat('§6[Party] §7You are not currently in a party.');
        } else {
            sendChat(`§6[Party] §7Leader: §e${snapshot.leader || 'Unknown'}`);
            sendChat(`§7Moderators: §e${snapshot.moderators.length ? snapshot.moderators.join(', ') : 'None'}`);
            sendChat(`§7Members: §e${snapshot.members.length ? snapshot.members.join(', ') : 'None'}`);
            sendChat(snapshot.uncertain ? '§7State: §cUncertain §7(refreshing...)' : '§7State: §aConfirmed');
        }
    }

    // Owns its own poll loop: start()/stop() bracket the connection lifetime,
    // so proxy.js never has to manage a party-specific timer itself.
    function start() {
        if (tickHandle) return;
        tickHandle = setInterval(tick, TICK_INTERVAL_MS);
    }

    function stop() {
        if (!tickHandle) return;
        clearInterval(tickHandle);
        tickHandle = null;
    }

    // Called when the underlying connection reaches the Hypixel PLAY state.
    // On a Bungee network like Hypixel, moving between their internal servers
    // (lobby -> pregame -> game -> lobby) re-sends a protocol login packet on
    // the SAME proxy connection every time, so this fires far more than once
    // per real reconnect. Only the first call per tracker instance actually
    // does anything - later calls are just repeat server switches, not a real
    // reconnect (a real reconnect creates a brand new tracker instance).
    // Pass { skip: true } on that first call when the reconnect happened
    // within the grace window (see isWithinReconnectGrace) so a quick blip
    // doesn't cost a /p list either.
    function notifyConnected({ skip = false } = {}) {
        if (hasNotifiedConnect) return;
        hasNotifiedConnect = true;
        if (skip) return;
        setTimeout(() => requestPartyListRefresh(), CONNECT_REFRESH_DELAY_MS);
    }

    return {
        handleChatLine,
        handleCommand,
        start,
        stop,
        tick, // exposed for tests; start()/stop() drive it in production
        notifyConnected,
        clear,
        isInParty,
        getLeaderName,
        getModerators,
        getMembers,
        hasUsableState,
        isUncertain,
        isTrackedMember,
        getStatusSnapshot,
        requestPartyListRefresh
    };
}

module.exports = { createPartyTracker, isWithinReconnectGrace, RECONNECT_GRACE_MS };
