'use strict';

// Pregame party-arrival tracker (observe mode).
//
// Packet-level party co-arrival diagnostics.
// Built on measured Hypixel behavior (recordings, 2026-07):
//
// - Every pregame stranger gets a tab entry named "§k<alias>" with a fake but
//   stable uuid, one add_player packet per player (duplicated ~40-100ms apart),
//   and the same alias appears in the "<alias> has joined (k/n)!" chat line.
// - Tab add packets keep their true spacing; chat lines get flushed in
//   same-tick batches (all-identical timestamps), so tab timing is the clock.
// - A player quitting = remove_player of their fake uuid. The game-start
//   transition also removes+re-adds the same uuids within ~200ms, so a quit
//   is only confirmed after a re-add grace period.
// - Each stranger is spawned as an entity referencing the fake uuid; at game
//   start the SAME entity id respawns with the player's real uuid/name, and
//   per-player scoreboard teams ("Red8" -> "Red") follow. That bridge lets
//   every played game label its own co-arrival groups: same final team =>
//   party evidence (weak in 2-team modes, strong in 8-team modes).
//
// This module only observes and reports; it never sends commands.

const GROUP_GAP_MS = 400;          // max gap between co-arrival first-adds
                                   // (measured party spreads are <=100ms; 2000ms
                                   // chained unrelated joins into false groups)
const AT_JOIN_CHAIN_MS = 150;      // adds chained this close to our own add = existing occupants
const DUPLICATE_ADD_MS = 1500;     // re-add of a known uuid within this = duplicate/churn, not new info
const QUIT_GRACE_MS = 1200;        // remove not re-added within this = real quit
const RESOLUTION_WINDOW_MS = 20000; // after game start, how long to wait for the entity-id bridge
const ADD_BUFFER_MS = 10000;       // obfuscated adds buffered before pregame detection
const ADD_BUFFER_MAX = 64;
const TICK_INTERVAL_MS = 250;

const OBFUSCATION_MARKER = '§k';

function stripFormatting(text) {
    return String(text || '').replace(/§[0-9a-fk-or]/gi, '').trim();
}

// Tab packets and entity spawns can disagree on uuid casing/dashes.
function normUuid(value) {
    if (!value) return null;
    return String(value).replace(/-/g, '').toLowerCase() || null;
}

function normalizeTeamGroup(teamName) {
    const stripped = String(teamName || '').replace(/\d+$/, '').trim();
    return stripped || null;
}

const QUEUE_JOIN_RE = /^([A-Za-z0-9_]{1,16}) has joined \((\d+)\/(\d+)\)!$/;
const QUEUE_QUIT_RE = /^([A-Za-z0-9_]{1,16}) has quit!$/;

function createPartyArrivalTracker(deps = {}) {
    const {
        isOwnUuid = () => false,
        isOwnName = () => false,
        getUuidMappedName = () => null,
        announce = () => {},          // observe-mode chat lines (caller gates on debug)
        appendLabelLine = () => {},   // (object) -> persisted JSONL label record
        onUpdate = () => {},          // groups changed (future policy consumer)
        now = Date.now
    } = deps;

    let pregameActive = false;
    let sessionId = null;
    let ownAddAt = null;             // when our own tab entry landed (at-join anchor)

    // uuid -> arrival record
    // { uuid, alias, firstAt, lastAddAt, atJoin, chatPosition, chatMax, chatAt,
    //   entityId, quitAt, real, team }
    let arrivals = new Map();
    let aliasIndex = new Map();      // lower(alias) -> uuid
    let entityIndex = new Map();     // entityId -> uuid (pregame fake uuid)
    let pendingQuits = new Map();    // uuid -> removeAt

    // Obfuscated adds seen before the scoreboard flags pregame; replayed on enter.
    const bufferedAdds = [];

    // Post-game-start label resolution.
    let resolution = null;           // { startedAt, arrivals, teams: Map(realNameLower->team), sessionId }

    let tickHandle = null;

    function reset() {
        arrivals = new Map();
        aliasIndex = new Map();
        entityIndex = new Map();
        pendingQuits = new Map();
        ownAddAt = null;
    }

    function activeArrivals() {
        return [...arrivals.values()].filter(a => !a.quitAt);
    }

    // Co-arrival groups among watched (non-at-join, non-quit) arrivals,
    // chained by first-add gap. Group order follows arrival order.
    function computeGroups() {
        const watched = activeArrivals()
            .filter(a => !a.atJoin)
            .sort((a, b) => a.firstAt - b.firstAt);
        const groups = [];
        watched.forEach(arrival => {
            const last = groups[groups.length - 1];
            if (last && arrival.firstAt - last.lastAt <= GROUP_GAP_MS) {
                last.members.push(arrival);
                last.lastAt = arrival.firstAt;
            } else {
                groups.push({ members: [arrival], firstAt: arrival.firstAt, lastAt: arrival.firstAt });
            }
        });
        return groups.map(group => ({
            aliases: group.members.map(m => m.alias),
            uuids: group.members.map(m => m.uuid),
            size: group.members.length,
            firstAt: group.firstAt,
            spreadMs: group.lastAt - group.firstAt,
            maxGapMs: group.members.reduce((max, member, index) => {
                if (index === 0) return max;
                return Math.max(max, member.firstAt - group.members[index - 1].firstAt);
            }, 0)
        }));
    }

    function getActiveGroups() {
        return computeGroups().filter(group => group.size >= 2);
    }

    function announceGroups(reason) {
        const groups = getActiveGroups();
        onUpdate(groups);
        if (!groups.length) return;
        const summary = groups
            .map(g => `${g.size}x[${g.aliases.join(',')}] spread ${g.spreadMs}ms`)
            .join(' | ');
        announce(`observe ${reason}: ${summary}`);
    }

    function recordAdd(uuid, rawName, at) {
        const alias = stripFormatting(rawName);
        if (!alias) return;

        const existing = arrivals.get(uuid);
        if (existing) {
            existing.lastAddAt = at;
            if (pendingQuits.delete(uuid)) {
                // churn (game-start remove+re-add or server hiccup), not a quit
            }
            return;
        }

        const atJoin = ownAddAt !== null
            ? Math.abs(at - ownAddAt) <= AT_JOIN_CHAIN_MS || at < ownAddAt
            : true; // no own anchor yet: everything so far predates us
        arrivals.set(uuid, {
            uuid,
            alias,
            firstAt: at,
            lastAddAt: at,
            atJoin,
            chatPosition: null,
            chatMax: null,
            chatAt: null,
            entityId: null,
            quitAt: null,
            real: null,
            team: null
        });
        aliasIndex.set(alias.toLowerCase(), uuid);
        if (!atJoin) announceGroups('join');
    }

    function handleObfuscatedAdd(uuid, rawName, at) {
        if (!pregameActive) {
            bufferedAdds.push({ uuid, rawName, at });
            const cutoff = at - ADD_BUFFER_MS;
            while (bufferedAdds.length > ADD_BUFFER_MAX
                || (bufferedAdds.length && bufferedAdds[0].at < cutoff)) {
                bufferedAdds.shift();
            }
            return;
        }
        recordAdd(uuid, rawName, at);
    }

    // --- packet taps ---------------------------------------------------------

    function observePlayerInfo(data, action) {
        const at = now();
        const rows = Array.isArray(data?.data) ? data.data : [];
        const isAdd = action === 'add_player' || data?.action === 0;
        const isRemove = action === 'remove_player' || data?.action === 4;

        if (isAdd) {
            rows.forEach(row => {
                const uuid = normUuid(row?.UUID || row?.uuid);
                if (!uuid) return;
                if (typeof row.name === 'string' && row.name.includes(OBFUSCATION_MARKER)) {
                    handleObfuscatedAdd(uuid, row.name, at);
                } else if (pregameActive && isOwnUuid(row?.UUID || row?.uuid) && ownAddAt === null) {
                    ownAddAt = at;
                    // Everything that already arrived belongs to the at-join cohort.
                    arrivals.forEach(arrival => {
                        if (arrival.firstAt <= at + AT_JOIN_CHAIN_MS) arrival.atJoin = true;
                    });
                }
            });
            return;
        }

        if (isRemove && pregameActive) {
            rows.forEach(row => {
                const uuid = normUuid(row?.UUID || row?.uuid);
                if (!uuid || !arrivals.has(uuid)) return;
                if (!arrivals.get(uuid).quitAt) pendingQuits.set(uuid, at);
            });
        }
    }

    function observeChatLine(text) {
        if (!pregameActive) return;
        const clean = stripFormatting(text).replace(/\s+/g, ' ');

        const join = clean.match(QUEUE_JOIN_RE);
        if (join) {
            if (isOwnName(join[1]) && ownAddAt === null) ownAddAt = now();
            const uuid = aliasIndex.get(join[1].toLowerCase());
            const arrival = uuid ? arrivals.get(uuid) : null;
            if (arrival && arrival.chatPosition === null) {
                arrival.chatPosition = Number(join[2]);
                arrival.chatMax = Number(join[3]);
                arrival.chatAt = now();
            }
            return;
        }

        const quit = clean.match(QUEUE_QUIT_RE);
        if (quit) {
            const uuid = aliasIndex.get(quit[1].toLowerCase());
            if (uuid && arrivals.has(uuid) && !arrivals.get(uuid).quitAt) {
                // Chat quit corroborates a pending tab remove; start the grace
                // clock even if the remove packet was missed.
                if (!pendingQuits.has(uuid)) pendingQuits.set(uuid, now());
            }
        }
    }

    function observeEntitySpawn(entityId, rawUuid) {
        const id = Number(entityId);
        const uuid = normUuid(rawUuid);
        if (!Number.isFinite(id) || !uuid) return;
        if (pregameActive && arrivals.has(uuid)) {
            entityIndex.set(id, uuid);
            arrivals.get(uuid).entityId = id;
            return;
        }
        // Resolution window: same entity id re-spawning with a real uuid.
        if (resolution && resolution.entityIndex.has(id)) {
            const pregameUuid = resolution.entityIndex.get(id);
            const arrival = resolution.arrivals.find(a => a.uuid === pregameUuid);
            if (arrival && !arrival.real) {
                const realName = getUuidMappedName(rawUuid);
                if (realName) {
                    arrival.real = realName;
                    const team = resolution.teams.get(realName.toLowerCase());
                    if (team) arrival.team = team;
                }
            }
        }
    }

    function observeTeamPlayers(teamName, players) {
        if (!resolution || !Array.isArray(players)) return;
        const group = normalizeTeamGroup(teamName);
        if (!group) return;
        players.forEach(player => {
            const name = stripFormatting(player);
            if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return;
            resolution.teams.set(name.toLowerCase(), group);
            resolution.arrivals.forEach(arrival => {
                if (arrival.real && arrival.real.toLowerCase() === name.toLowerCase()) {
                    arrival.team = group;
                }
            });
        });
    }

    // --- lifecycle -----------------------------------------------------------

    function onPregameEnter(newSessionId) {
        // Deliberately do NOT finalize an open resolution here: the scoreboard
        // can flicker back to "pregame" moments after a game starts, and
        // finalizing then would discard the label before the team packets
        // arrive. The resolution keeps its own arrival/entity snapshots, so it
        // runs out its window in parallel with the (possibly phantom) new
        // pregame. A genuinely new game-start resolution supersedes it in
        // onPregameLeave.
        reset();
        pregameActive = true;
        sessionId = newSessionId ?? null;
        const at = now();
        const cutoff = at - ADD_BUFFER_MS;
        bufferedAdds.filter(add => add.at >= cutoff).forEach(add => recordAdd(add.uuid, add.rawName, add.at));
        bufferedAdds.length = 0;
    }

    function onPregameLeave(reason = '') {
        if (!pregameActive) return;
        pregameActive = false;
        const gameStarting = /^(game|match)/i.test(String(reason || ''));
        const snapshot = [...arrivals.values()];
        const groups = computeGroups();
        // Only games with watched arrivals are worth labeling; a snapshot where
        // everyone predates us (at-join cohort) carries no timing information.
        const labelable = snapshot.some(a => !a.atJoin);
        if (gameStarting && labelable) {
            finalizeResolution('superseded');
            resolution = {
                startedAt: now(),
                sessionId,
                arrivals: snapshot,
                groups,
                teams: new Map(),
                entityIndex // resolution owns this map; reset() makes a fresh one
            };
            entityIndex = new Map();
        } else if (!resolution) {
            reset();
        }
        pendingQuits = new Map();
    }

    function finalizeResolution(endReason = 'window') {
        if (!resolution) return;
        const record = {
            at: resolution.startedAt,
            sessionId: resolution.sessionId,
            endReason,
            arrivals: resolution.arrivals.map(a => ({
                alias: a.alias,
                firstAt: a.firstAt,
                atJoin: a.atJoin,
                chatPosition: a.chatPosition,
                quitAt: a.quitAt,
                real: a.real,
                team: a.team
            })),
            groups: resolution.groups.map(group => {
                const teams = group.uuids.map(uuid => {
                    const arrival = resolution.arrivals.find(a => a.uuid === uuid);
                    return arrival?.team || null;
                });
                const resolved = teams.every(Boolean);
                const sameTeam = resolved && teams.every(t => t === teams[0]);
                return { ...group, teams, label: !resolved ? 'unresolved' : sameTeam ? 'same_team' : 'split_teams' };
            })
        };
        resolution = null;
        try {
            appendLabelLine(record);
        } catch (error) {
            // labeling must never break the proxy
        }
        const labeled = record.groups.filter(g => g.label !== 'unresolved');
        if (record.groups.length) {
            announce(`observe labels: ${record.groups.map(g => `${g.size}x=${g.label}`).join(', ')}`
                + (labeled.length === record.groups.length ? '' : ' (some unresolved)'));
        }
    }

    function tick() {
        const at = now();
        if (pregameActive && pendingQuits.size) {
            pendingQuits.forEach((removeAt, uuid) => {
                if (at - removeAt < QUIT_GRACE_MS) return;
                pendingQuits.delete(uuid);
                const arrival = arrivals.get(uuid);
                if (arrival && !arrival.quitAt) {
                    arrival.quitAt = at;
                    announce(`observe quit: ${arrival.alias}`);
                    announceGroups('quit');
                }
            });
        }
        if (resolution && at - resolution.startedAt > RESOLUTION_WINDOW_MS) {
            finalizeResolution('window');
        }
    }

    function start() {
        if (tickHandle) return;
        tickHandle = setInterval(tick, TICK_INTERVAL_MS);
    }

    function stop() {
        if (tickHandle) {
            clearInterval(tickHandle);
            tickHandle = null;
        }
        finalizeResolution('shutdown');
    }

    function getDebugState() {
        return {
            partyArrivalActive: pregameActive,
            partyArrivalCount: activeArrivals().length,
            partyArrivalGroups: getActiveGroups()
                .map(g => `${g.size}x(${g.spreadMs}ms)`)
                .join(', ') || 'none'
        };
    }

    // Observation taps sit on the proxy's packet hot path; like the packet
    // recorder, they must never throw into the packet handler.
    function safe(fn) {
        return (...args) => {
            try { return fn(...args); } catch (error) { return undefined; }
        };
    }

    return {
        observePlayerInfo: safe(observePlayerInfo),
        observeChatLine: safe(observeChatLine),
        observeEntitySpawn: safe(observeEntitySpawn),
        observeTeamPlayers: safe(observeTeamPlayers),
        onPregameEnter: safe(onPregameEnter),
        onPregameLeave: safe(onPregameLeave),
        getActiveGroups,
        getDebugState,
        tick, // tests drive this; start()/stop() own it in production
        start,
        stop
    };
}

module.exports = {
    createPartyArrivalTracker,
    GROUP_GAP_MS,
    QUIT_GRACE_MS,
    RESOLUTION_WINDOW_MS
};
