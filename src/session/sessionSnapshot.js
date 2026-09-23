'use strict';

// Pure snapshot + delta maths for local session tracking.
//
// The trick that keeps this module small: a session delta is emitted in the
// SAME shape Hypixel uses for `player.stats.<Game>` — flat, numeric, same
// keys. That means the existing collectors (src/stats/collect.js) can be run
// straight over a delta blob and every ratio comes out right, because
// collectBedwarsStats computes `ratioValue(wins, losses)` from whatever
// numbers it is handed. Session FKDR therefore ends up as
// Δfinals / Δfinal_deaths automatically — never a subtraction of two
// lifetime FKDRs, which is the classic way session trackers get it wrong.
//
// It also means /session renders through the same path as the Urchin-backed
// /daily card: proxy.js's `safeStatNumber` already accepts plain numbers, so
// a delta blob drops into `root.delta.stats.Bedwars` unchanged.
//
// Snapshots keep only finite numeric leaves. Hypixel's stat blobs carry
// nested objects (practice records, packages, cosmetic arrays) that no
// collector reads and that would bloat session_data.json for nothing.

const SNAPSHOT_GAMES = ['Bedwars', 'SkyWars', 'Duels'];

// Achievement counters the collectors fall back to for level/star progress.
const SNAPSHOT_ACHIEVEMENTS = ['bedwars_level', 'skywars_you_re_a_star'];

// Key fragments for counters that can only ever go up. If one of these
// decreases between two snapshots the baseline is stale or belongs to a
// different account, and the tracker re-baselines instead of reporting a
// negative session. Winstreaks are deliberately absent — they legitimately
// drop to 0 on a loss and must keep their negative delta.
const MONOTONIC_KEY_PARTS = [
    'games_played',
    'wins',
    'losses',
    'kills',
    'deaths',
    'beds_broken',
    'beds_lost',
    'rounds_played',
    'Experience'
];

// Matched on underscore boundaries, not as a bare substring: `winstreak`
// contains "wins" but is emphatically not monotonic, and treating it as such
// would flag every lost game as a stat rollback.
const MONOTONIC_KEY_PATTERNS = MONOTONIC_KEY_PARTS.map(part => new RegExp(`(^|_)${part}(_|$)`));

function isMonotonicKey(key) {
    const name = String(key);
    return MONOTONIC_KEY_PATTERNS.some(pattern => pattern.test(name));
}

// Flatten one Hypixel stat blob to its finite numeric leaves.
function numericLeaves(source) {
    const out = {};
    if (!source || typeof source !== 'object') return out;
    Object.keys(source).forEach((key) => {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    });
    return out;
}

function normalizeUuidLoose(value) {
    const raw = String(value || '').replace(/-/g, '').toLowerCase();
    return /^[0-9a-f]{32}$/.test(raw) ? raw : null;
}

// Accepts either a full lookup result (`{ player: {...} }`) or a bare player
// object, so callers can hand it whatever getPlayerData gave them.
function captureSessionSnapshot(source, { now = Date.now } = {}) {
    const player = (source && source.player) ? source.player : source;
    if (!player || typeof player !== 'object') return null;

    // `present` records whether the API actually returned a populated stat
    // block for each game. Without it, a snapshot taken from a degraded or
    // partial response (empty SkyWars block) followed by a normal one would
    // diff the player's ENTIRE SkyWars lifetime in as this session's gains —
    // the game appears out of nowhere and its counts jump.
    const stats = {};
    const present = {};
    SNAPSHOT_GAMES.forEach((game) => {
        const leaves = numericLeaves(player.stats?.[game]);
        stats[game] = leaves;
        present[game] = Object.keys(leaves).length > 0;
    });

    const achievements = {};
    SNAPSHOT_ACHIEVEMENTS.forEach((key) => {
        const value = Number(player.achievements?.[key]);
        if (Number.isFinite(value)) achievements[key] = value;
    });

    return {
        at: now(),
        uuid: normalizeUuidLoose(player.uuid),
        name: typeof player.displayname === 'string' ? player.displayname : null,
        networkExp: Number.isFinite(Number(player.networkExp)) ? Number(player.networkExp) : 0,
        karma: Number.isFinite(Number(player.karma)) ? Number(player.karma) : 0,
        achievements,
        present,
        stats
    };
}

// Snapshots written before `present` existed do not carry it; infer it from
// whether the block has any keys so old session files keep working.
function gamePresent(snapshot, game) {
    if (!snapshot) return false;
    if (snapshot.present && typeof snapshot.present === 'object'
        && Object.prototype.hasOwnProperty.call(snapshot.present, game)) {
        return Boolean(snapshot.present[game]);
    }
    return Object.keys(snapshot.stats?.[game] || {}).length > 0;
}

// True when `after` cannot be a later reading of the same account as
// `before` — different UUID, or a monotonic counter that went backwards.
function snapshotRegressed(before, after) {
    if (!before || !after) return false;
    if (before.uuid && after.uuid && before.uuid !== after.uuid) return true;

    return SNAPSHOT_GAMES.some((game) => {
        const from = before.stats?.[game] || {};
        const to = after.stats?.[game] || {};
        return Object.keys(from).some((key) => {
            if (!isMonotonicKey(key)) return false;
            const start = Number(from[key]) || 0;
            const end = Number(to[key]);
            // A monotonic counter that VANISHES is a broken read, not a stat
            // rollback — but it is still not something we can measure against,
            // so it counts as a regression and forces a re-baseline.
            if (!Number.isFinite(end)) return start > 0;
            return end < start;
        });
    });
}

function diffNumericMaps(before = {}, after = {}) {
    const out = {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    keys.forEach((key) => {
        const delta = (Number(after[key]) || 0) - (Number(before[key]) || 0);
        if (delta !== 0) out[key] = delta;
    });
    return out;
}

// Produce the delta blob. `stats` mirrors `player.stats`, so the result can be
// handed to the collectors as-is; `root` is the `{ delta: … }` wrapper the
// render layer expects for star/level progress fallbacks.
function diffSessionSnapshots(before, after) {
    if (!before || !after) return null;

    const stats = {};
    const unmeasurable = [];
    SNAPSHOT_GAMES.forEach((game) => {
        // If a game's stat block was absent in one reading and populated in
        // the other, the two are not comparable: diffing them would report the
        // whole lifetime as session movement (or wipe it out as a negative).
        // Report nothing for that game rather than something wrong.
        if (gamePresent(before, game) !== gamePresent(after, game)) {
            stats[game] = {};
            unmeasurable.push(game);
            return;
        }
        stats[game] = diffNumericMaps(before.stats?.[game], after.stats?.[game]);
    });

    const achievements = diffNumericMaps(before.achievements, after.achievements);

    return {
        from: before.at,
        to: after.at,
        spanMs: Math.max(0, (Number(after.at) || 0) - (Number(before.at) || 0)),
        networkExp: (Number(after.networkExp) || 0) - (Number(before.networkExp) || 0),
        karma: (Number(after.karma) || 0) - (Number(before.karma) || 0),
        achievements,
        stats,
        unmeasurable,
        root: { delta: { stats, achievements } }
    };
}

// Counters that only move when you actually played. A stat blob holds far
// more than these — coins, souls, cosmetic counters, experience — and those
// can tick from lobby activity, daily rewards, or Hypixel backfilling a field.
// Treating any non-zero key as "you played this game" is what makes a game you
// never touched appear on the session card.
const GAMEPLAY_KEY_PATTERN = /(^|_)(games|games_played|wins|losses|kills|deaths|beds_broken|beds_lost|rounds_played|assists)(_|$)/;

function isGameplayKey(key) {
    // Mode names can contain "games" (for example tnt_games). Streaks are
    // records/current state, not evidence that a match was played this session.
    return !/streak/i.test(String(key)) && GAMEPLAY_KEY_PATTERN.test(String(key));
}

// Did you actually play this game? Requires a POSITIVE gameplay counter:
// these are all monotonic, so a zero or negative delta is noise, not a game.
function hasGameplayMovement(stats) {
    if (!stats || typeof stats !== 'object') return false;
    return Object.keys(stats).some(key => isGameplayKey(key) && Number(stats[key]) > 0);
}

// Did anything worth reporting happen in this delta? Used to suppress empty
// recap cards when a game ended before Hypixel propagated (or you spectated),
// and to keep untouched games off the session card.
function deltaIsEmpty(delta, game = null) {
    if (!delta) return true;
    const games = game ? [game] : SNAPSHOT_GAMES;
    return !games.some(name => hasGameplayMovement(delta.stats?.[name]));
}

// Games that saw any movement, in SNAPSHOT_GAMES order.
function activeGamesInDelta(delta) {
    if (!delta) return [];
    return SNAPSHOT_GAMES.filter(game => hasGameplayMovement(delta.stats?.[game]));
}

module.exports = {
    SNAPSHOT_GAMES,
    SNAPSHOT_ACHIEVEMENTS,
    MONOTONIC_KEY_PARTS,
    isMonotonicKey,
    numericLeaves,
    normalizeUuidLoose,
    captureSessionSnapshot,
    gamePresent,
    snapshotRegressed,
    diffNumericMaps,
    diffSessionSnapshots,
    deltaIsEmpty,
    activeGamesInDelta,
    isGameplayKey,
    hasGameplayMovement,
    GAMEPLAY_KEY_PATTERN
};
