'use strict';

// Per-connection Hypixel party tracker, ported from the NestySkyblock5 Forge
// mod's PartyStateManager.java. Learns who is in the player's Hypixel /p party
// (leader/moderators/members) from chat lines, independent of any in-game
// Bedwars scoreboard team.
//
// Design (deliberately minimal on /p list traffic):
// - Chat lines (join/leave/promote/kick/etc) update the roster instantly and
//   are the primary source of truth. Joining a party also lists everyone in
//   it ("You'll be partying with"), and party chat names a member by real IGN.
// - The reply to a /p list Fury sends itself is parsed but hidden from the
//   player; a /p list the player types is shown as usual.
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
// Hypixel sends a reply's border, header and rows within a few milliseconds.
// A held border that is not followed by a party list is released after this.
const HELD_BORDER_MS = 250;
// "You'll be partying with" follows the join line in the same burst.
const JOIN_ROSTER_WINDOW_MS = 5_000;
// A /p list the player typed answers Fury's pending one too.
const PLAYER_LIST_COMMAND_GRACE_MS = 5_000;

// If the player reconnects within this grace window of their last disconnect,
// the roster almost certainly hasn't changed - skip the connect-time /p list.
// lastDisconnectAt must be tracked by the caller since a fresh tracker
// instance is created on every new connection and has no memory of the last one.
function isWithinReconnectGrace(lastDisconnectAt) {
    return Boolean(lastDisconnectAt) && (Date.now() - lastDisconnectAt) < RECONNECT_GRACE_MS;
}

const PARTY_JOINED_PATTERN = /^(.+?) joined the party\.$/;
const PARTY_LEFT_PATTERN = /^(.+?) has left the party\.$/;
const PARTY_REMOVED_PATTERN = /^(.+?) (?:has been removed from the party|was removed from your party because they disconnected)\.$/;
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
// Leaders whose names end in "s" are written "[MVP++] FortuneCks' party!".
const YOU_JOINED_PARTY_PATTERN = /^You have joined (.+?)'s? party!$/;
const YOU_LEFT_PARTY_PATTERN = /^You left the party\.$/;
// Sent right after the join line; lists everyone except the leader and you.
// Large parties end with "and 21 other players!", so that list is partial.
const PARTYING_WITH_PATTERN = /^You['’]ll be partying with: (.+)$/;
const PARTYING_WITH_MORE_PATTERN = /\s+and \d+ other players?!$/;
// Party chat always shows the sender's real IGN, even while they are nicked.
const PARTY_CHAT_SENDER_PATTERN = /^Party > (?:\[[^\]]+\] )?([A-Za-z0-9_]{1,16}): /;
const PARTY_LIST_HEADER_PATTERN = /^Party Members(?: \(\d+\))?$/;
const CHAT_BORDER_PATTERN = /^-{10,}$/;
const NOT_IN_PARTY_LINE = 'You are not currently in a party.';
const PLAYER_PARTY_LIST_COMMAND_PATTERN = /^\/(?:(?:p|party)\s+list|pl)(?:\s|$)/i;
const VALID_NAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;

function createPartyTracker(deps) {
    const {
        stripFormatting,
        getSelfName,
        requestPartyListCommand,
        sendChat
    } = deps;

    let tickHandle = null;
    let hasNotifiedConnect = false;

    const disconnectedMembers = new Set();
    let revision = 0;
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

    let joinedPartyAt = 0;
    let playerListCommandAt = 0;
    // The reply to a /p list Fury sent itself: read, but not shown to the player.
    let hiddenReply = null;

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
        revision++;
        if (!inParty) disconnectedMembers.clear();
        lastStateUpdateTime = Date.now();
        if (fullRefresh) lastFullRefreshTime = lastStateUpdateTime;
        deps.onUpdate?.();
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

    function partyListStillNeeded() {
        // Chat may confirm the roster (or the player may ask themselves)
        // while Fury's request waits, which makes the request unnecessary.
        if (hasUsableState() || Date.now() - playerListCommandAt < PLAYER_LIST_COMMAND_GRACE_MS) {
            awaitingPartyListResponse = false;
            return false;
        }
        return true;
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
            if (!partyListStillNeeded()) return;
            partyListRequestStartTime = Date.now();
            requestPartyListCommand({
                // Runs at the moment the command queue sends it.
                shouldSend: () => {
                    if (!partyListStillNeeded()) return false;
                    beginHiddenReply();
                    return true;
                }
            });
        }, PARTY_LIST_COMMAND_DELAY_MS);
    }

    function clearHeldBorder() {
        if (!hiddenReply?.held) return null;
        const held = hiddenReply.held;
        clearTimeout(hiddenReply.heldTimer);
        hiddenReply.held = null;
        hiddenReply.heldTimer = null;
        return held;
    }

    function endHiddenReply() {
        const held = clearHeldBorder();
        hiddenReply = null;
        return held ? [held] : [];
    }

    function beginHiddenReply() {
        endHiddenReply().forEach(packet => deps.forwardChat?.(packet));
        hiddenReply = {
            until: Date.now() + PARTY_LIST_RESPONSE_TIMEOUT_MS,
            started: false,
            held: null,
            heldTimer: null
        };
    }

    function holdBorder(packet) {
        const reply = hiddenReply;
        reply.held = packet;
        reply.heldTimer = setTimeout(() => {
            if (hiddenReply !== reply || reply.held !== packet) return;
            reply.held = null;
            reply.heldTimer = null;
            deps.forwardChat?.(packet);
        }, HELD_BORDER_MS);
    }

    function isPartyListRow(line) {
        return line === ''
            || PARTY_LIST_LEADER_PATTERN.test(line)
            || PARTY_LIST_MODERATORS_PATTERN.test(line)
            || PARTY_LIST_MEMBERS_PATTERN.test(line);
    }

    function isHidingChat() {
        return hiddenReply !== null;
    }

    // Decides whether a clientbound chat line belongs to the hidden reply.
    // Returns { forward, release }: `release` holds earlier packets that must
    // reach the player before this one. Parsing is unaffected either way.
    function filterClientboundChat(rawText, packet) {
        if (!hiddenReply) return { forward: true, release: [] };
        const lines = stripFormatting(String(rawText || '')).split('\n').map(line => line.trim());
        const allBorders = lines.every(line => CHAT_BORDER_PATTERN.test(line));

        if (!hiddenReply.started) {
            if (Date.now() > hiddenReply.until) return { forward: true, release: endHiddenReply() };
            if (allBorders) {
                // Could open the list or any other bordered message; wait for
                // the next line to decide.
                const release = clearHeldBorder();
                holdBorder(packet);
                return { forward: false, release: release ? [release] : [] };
            }
            const opensReply = lines.some(line => PARTY_LIST_HEADER_PATTERN.test(line) || line === NOT_IN_PARTY_LINE);
            const onlyReply = lines.every(line => CHAT_BORDER_PATTERN.test(line) || PARTY_LIST_HEADER_PATTERN.test(line)
                || line === NOT_IN_PARTY_LINE || isPartyListRow(line));
            if (opensReply && onlyReply) {
                clearHeldBorder();
                hiddenReply.started = true;
                if (lines.length > 1 && CHAT_BORDER_PATTERN.test(lines[lines.length - 1])) endHiddenReply();
                return { forward: false, release: [] };
            }
            const release = clearHeldBorder();
            return { forward: true, release: release ? [release] : [] };
        }

        if (allBorders) {
            endHiddenReply();
            return { forward: false, release: [] };
        }
        if (lines.every(isPartyListRow) && Date.now() <= hiddenReply.until) return { forward: false, release: [] };
        return { forward: true, release: endHiddenReply() };
    }

    function observeOwnCommand(message) {
        if (!PLAYER_PARTY_LIST_COMMAND_PATTERN.test(String(message || '').trim())) return;
        // The player wants to see this reply; stop hiding and let it through.
        playerListCommandAt = Date.now();
        endHiddenReply().forEach(packet => deps.forwardChat?.(packet));
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
        if (PARTY_LIST_HEADER_PATTERN.test(stripped)) {
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

        // Checked first so a party message quoting a party event cannot be
        // mistaken for the event itself.
        const partyChat = stripped.match(PARTY_CHAT_SENDER_PATTERN);
        if (partyChat) {
            const sender = partyChat[1];
            if (!isTrackedName(sender)) {
                // Only Hypixel prints "Party >" lines, so the sender is a member.
                // A confirmed "not in a party" is now wrong; refresh the rest.
                if (!inParty) uncertain = true;
                inParty = true;
                initialized = true;
                addToMembersIfMissing(sender);
                ensureSelfIncluded();
                touchUpdate(false);
            }
            return;
        }

        const partyingWith = stripped.match(PARTYING_WITH_PATTERN);
        if (partyingWith) {
            const listed = partyingWith[1].trim();
            const partial = PARTYING_WITH_MORE_PATTERN.test(listed);
            const names = listed.replace(PARTYING_WITH_MORE_PATTERN, '')
                .split(',')
                .map(normalizePlayerName)
                .filter(name => VALID_NAME_PATTERN.test(name));
            inParty = true;
            initialized = true;
            names.forEach(addToMembersIfMissing);
            ensureSelfIncluded();
            // Together with the join line this is the whole party, so the
            // join's /p list is no longer needed.
            const confirmsJoin = !partial && Boolean(leaderName) && Date.now() - joinedPartyAt < JOIN_ROSTER_WINDOW_MS;
            if (confirmsJoin) uncertain = false;
            joinedPartyAt = 0;
            touchUpdate(confirmsJoin);
            return;
        }

        if (stripped === NOT_IN_PARTY_LINE) {
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
                joinedPartyAt = Date.now();
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
            if (player) disconnectedMembers.add(player.toLowerCase());
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
            if (player) disconnectedMembers.add(player.toLowerCase());
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
            if (player) disconnectedMembers.delete(player.toLowerCase());
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
            if (player) disconnectedMembers.delete(player.toLowerCase());
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
        return isTrackedName(player);
    }

    function isTrackedName(player) {
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
            lastFullRefreshTime,
            revision,
            disconnectedMembers: [...disconnectedMembers].filter(isTrackedMember)
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
        clearHeldBorder();
        hiddenReply = null;
        if (!tickHandle) return;
        clearInterval(tickHandle);
        tickHandle = null;
    }

    // Kept by the caller for a quick reconnect of the same account, so the
    // party is not forgotten for a few seconds of disconnection.
    function exportState() {
        if (!initialized) return null;
        return {
            inParty,
            leaderName,
            moderators: Array.from(moderators),
            members: Array.from(members)
        };
    }

    function restoreState(state) {
        if (!state || initialized) return false;
        inParty = Boolean(state.inParty);
        leaderName = state.leaderName || null;
        moderators = new Set(Array.isArray(state.moderators) ? state.moderators : []);
        members = new Set(Array.isArray(state.members) ? state.members : []);
        initialized = true;
        // Party changes during the disconnect were missed; the first check
        // that needs certainty refreshes it with a hidden /p list.
        uncertain = true;
        touchUpdate(false);
        return true;
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
        requestPartyListRefresh,
        isHidingChat,
        filterClientboundChat,
        observeOwnCommand,
        exportState,
        restoreState
    };
}

module.exports = { createPartyTracker, isWithinReconnectGrace, RECONNECT_GRACE_MS };
