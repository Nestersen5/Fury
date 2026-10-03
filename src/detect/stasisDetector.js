'use strict';

// Live Stasis (Blink) detector - LIVE GAMES ONLY, "Possibly" tier only.
//
// Blink ("Movement only", the closest source mechanism to Stasis) holds
// the client's movement packets while interaction packets still go out.
// From the outside: a player frozen mid-air (height off the block grid)
// whose swings / block placements keep arriving DURING the freeze, then a
// jump when the held movement is flushed. Plain lag freezes the player
// too, but delays everything - the actions arrive in the burst at the
// end, not during - so only actions strictly inside the freeze count.
//
// Corpus (live games, 2026-09-25): ~1,350 mid-air update gaps, zero with
// a swing inside the gap (they are shop NPCs and idle players). Replays
// re-pace movement and are unusable, so the proxy runs this live only.
//
// Guards: the player must have been moving just before (NPCs never are),
// no knockback within 1.5s, no sneaking during the freeze, and no ladder/vine seen near the freeze spot
// (a player on a ladder - e.g. a Pop-up Tower - legitimately hangs still
// in the air and can fight or build). Local observer recordings exercise this
// pattern; original-client and real-world equivalence remain limited, so this
// reports POSSIBLE only: 2+ freezes-while-acting within 60s.

const DEFAULTS = {
    minFreezeMs: 400,
    edgeMarginMs: 100,
    minActions: 2,
    activeWindowMs: 2000,
    knockbackGraceMs: 1500,
    eventWindowMs: 60_000,
    possibleEvents: 2,
    actionRange: 4.5,
    ladderRange: 1.5
};

const CLIMBABLE = new Set([65, 106]); // ladder, vine

function createStasisDetector(deps = {}) {
    const {
        onFlag = () => {},
        nameOf = () => null,
        isEnabled = () => true,
        log = () => {},
        now = Date.now,
        thresholds = {}
    } = deps;
    const cfg = { ...DEFAULTS, ...thresholds };
    const players = new Map();
    const climbables = []; // {x,y,z} seen via block changes, bounded

    function playerState(id) {
        let state = players.get(id);
        if (!state) {
            state = {
                id,
                x: 0, y: 0, z: 0, known: false,
                onGround: null,
                sneaking: false,
                sneakingDuringGap: false,
                lastMoveAt: -Infinity,
                recentMoves: [], // timestamps of real (non-zero) movement
                knockbackAt: -Infinity,
                actions: [],     // timestamps of swings/placements since last move
                events: [],      // {t, gapMs, actions}
                flagTier: null
            };
            players.set(id, state);
        }
        return state;
    }

    // Hypixel's relayed onGround flag is unreliable (one live game reports
    // onGround=false for 88% of flat walking moves), so airborne is read
    // from height instead when no positive grounded state is available.
    // Relative movement/teleport quantization can leave a grounded player at
    // an off-grid reconstructed height, so explicit onGround=true vetoes a gap.
    // Everything a player can stand on - full blocks,
    // slabs, carpets, beds, chests, snow - puts their feet on a 1/16-block
    // grid; positions arrive in 1/32 steps. Off-grid = not standing on
    // anything. (Half of true mid-air freezes land on-grid and are missed:
    // the conservative side.)
    function clearlyAirborne(state) {
        return Math.round(state.y * 32) % 2 !== 0;
    }

    function nearClimbable(state) {
        return climbables.some(c => Math.hypot(c.x + 0.5 - state.x, c.z + 0.5 - state.z) <= cfg.ladderRange
            && Math.abs(c.y - state.y) <= 2);
    }

    function wasActive(state) {
        const moves = state.recentMoves.filter(m => state.lastMoveAt - m <= cfg.activeWindowMs);
        return moves.length >= 2;
    }

    function onResume(state, t) {
        const gap = t - state.lastMoveAt;
        if (!clearlyAirborne(state) || gap < cfg.minFreezeMs) return;
        if (state.onGround === true) return;
        // A legitimate player can hold sneak to stop on a pre-existing ladder
        // or vine. Initial chunk blocks are not part of these compact records.
        // Keep the gap's state even when release metadata precedes its movement.
        if (state.sneakingDuringGap) return;
        if (!wasActive(state) || t - state.knockbackAt <= cfg.knockbackGraceMs) return;
        if (nearClimbable(state)) return;
        const inside = state.actions.filter(a => a > state.lastMoveAt + cfg.edgeMarginMs && a < t - cfg.edgeMarginMs);
        if (inside.length < cfg.minActions) return;
        state.events.push({ t, gapMs: gap, actions: inside.length });
        state.events = state.events.filter(e => t - e.t <= cfg.eventWindowMs);
        const name = nameOf(state.id) || `entity #${state.id}`;
        log(`[STASIS] ${name}: frozen mid-air ${(gap / 1000).toFixed(1)}s while acting (${inside.length} swings/blocks)`);
        if (!state.flagTier && state.events.length >= cfg.possibleEvents) {
            state.flagTier = 'possible';
            onFlag({
                cheat: 'Stasis',
                entityId: state.id,
                name,
                tier: 'possible',
                evidence: state.events.map(e => ({
                    group: 'Movement',
                    reason: `frozen mid-air ${(e.gapMs / 1000).toFixed(1)}s while acting (${e.actions} swings/blocks)`,
                    hard: false
                })),
                at: t
            });
        }
    }

    function move(state, x, y, z, onGround, t, moved) {
        if (moved) {
            if (state.known) onResume(state, t);
            state.lastMoveAt = t;
            state.recentMoves.push(t);
            if (state.recentMoves.length > 8) state.recentMoves.shift();
            state.actions = [];
            state.sneakingDuringGap = state.sneaking;
        }
        state.x = x; state.y = y; state.z = z; state.known = true;
        if (onGround !== undefined && onGround !== null) state.onGround = Boolean(onGround);
    }

    function attributeAction(t, x, y, z) {
        let best = null;
        let bestDist = Infinity;
        players.forEach(state => {
            if (!state.known) return;
            const d = Math.hypot(x + 0.5 - state.x, z + 0.5 - state.z);
            if (d < bestDist && y - state.y >= -1 && y - state.y <= 4) {
                best = state;
                bestDist = d;
            }
        });
        if (best && bestDist <= cfg.actionRange) best.actions.push(t);
    }

    function observeBlock(x, y, z, block, t, countAction = true) {
        if (![x, y, z, block].every(Number.isFinite)) return;
        const existing = climbables.findIndex(c => c.x === x && c.y === y && c.z === z);
        if (CLIMBABLE.has(block >> 4)) {
            if (existing < 0) {
                climbables.push({ x, y, z });
                if (climbables.length > 512) climbables.shift();
            }
        } else if (existing >= 0) climbables.splice(existing, 1);
        if (countAction && block !== 0) attributeAction(t, x, y, z);
    }

    function observeRecord(r) {
        if (!r || !isEnabled()) return;
        try {
            const t = Number.isFinite(Number(r.t)) ? Number(r.t) : now();
            switch (r.k) {
                case 'spawn':
                    if (Number.isFinite(Number(r.x))) {
                        const state = playerState(Number(r.id));
                        move(state, r.x / 32, r.y / 32, r.z / 32, r.g, t, false);
                    }
                    break;
                case 'snap':
                    if (Number.isFinite(Number(r.x))) move(playerState(Number(r.id)), Number(r.x), Number(r.y), Number(r.z), r.g, t, false);
                    break;
                case 'mv':
                case 'mvl': {
                    const state = players.get(Number(r.id));
                    if (!state || !state.known) break;
                    const dx = (Number(r.dx) || 0) / 32;
                    const dy = (Number(r.dy) || 0) / 32;
                    const dz = (Number(r.dz) || 0) / 32;
                    move(state, state.x + dx, state.y + dy, state.z + dz, r.g, t, dx !== 0 || dy !== 0 || dz !== 0);
                    break;
                }
                case 'tp': {
                    const state = players.get(Number(r.id));
                    if (!state || !Number.isFinite(Number(r.x))) break;
                    const x = r.x / 32;
                    const y = r.y / 32;
                    const z = r.z / 32;
                    const moved = !state.known || x !== state.x || y !== state.y || z !== state.z;
                    move(state, x, y, z, r.g, t, moved);
                    break;
                }
                case 'vel': {
                    const state = players.get(Number(r.id));
                    if (state) state.knockbackAt = t;
                    break;
                }
                case 'anim': {
                    if (Number(r.a) !== 0) break;
                    const state = players.get(Number(r.id));
                    if (state) state.actions.push(t);
                    break;
                }
                case 'meta': {
                    const flags = (Array.isArray(r.m) ? r.m : []).find(entry => Number(entry?.key ?? entry?.index) === 0);
                    if (!Number.isFinite(Number(flags?.value))) break;
                    const state = players.get(Number(r.id));
                    if (state) {
                        state.sneaking = (Number(flags.value) & 0x02) !== 0;
                        if (state.sneaking) state.sneakingDuringGap = true;
                    }
                    break;
                }
                case 'blk': {
                    observeBlock(Number(r.x), Number(r.y), Number(r.z), Number(r.b), t);
                    break;
                }
                case 'mblk': {
                    // Bulk updates supply collision context, not a reliable
                    // count of actions attributable to the nearest player.
                    for (const block of Array.isArray(r.r) ? r.r : []) {
                        const position = Number(block.p);
                        if (!Number.isFinite(position)) continue;
                        observeBlock(Number(r.cx) * 16 + ((position >> 4) & 15), Number(block.y),
                            Number(r.cz) * 16 + (position & 15), Number(block.b), t, false);
                    }
                    break;
                }
                case 'destroy':
                    (Array.isArray(r.ids) ? r.ids : []).forEach(id => players.delete(Number(id)));
                    break;
            }
        } catch (e) {
            // A detector bug must never break packet handling.
        }
    }

    function clear() {
        players.clear();
        climbables.length = 0;
    }

    function getStatus() {
        const rows = [];
        players.forEach(state => {
            if (!state.events.length && !state.flagTier) return;
            rows.push({
                cheat: 'Stasis',
                name: nameOf(state.id) || `entity #${state.id}`,
                detail: `${state.events.length} mid-air freezes while acting (60s)`,
                tier: state.flagTier
            });
        });
        return rows;
    }

    return { observeRecord, clear, getStatus, thresholds: cfg };
}

module.exports = { createStasisDetector };
