'use strict';

// /clip: named moments in a live game, shown later in the Recent Games
// (/replay) menu next to the game they belong to.
//
// A clip's time is its offset from the game start. There is no running timer:
// the offset is worked out when /clip is typed, so time spent disconnected
// counts automatically and nothing can keep counting after a missed game end.
//
// Standard BedWars reads the offset off Hypixel's own sidebar countdown
// ("Emerald II in 3:20"), which is the clock the replay uses and which stays
// right even when the proxy missed the game start. Everything else falls back
// to wall-clock time since the proxy's game start.
//
// Clips live in their own file, written the moment each one is made, so they
// survive disconnects, crashes and games whose end was never detected.

const { JsonFileCache } = require('../storage/json_file_cache.js');

const MINUTE_MS = 60000;

// Standard BedWars event timeline: when each sidebar countdown reaches zero,
// measured from the game start. The game is over at 50 minutes.
const BEDWARS_TIMELINE = [
    { pattern: /^diamond ii$/i, atMs: 6 * MINUTE_MS, spanMs: 6 * MINUTE_MS },
    { pattern: /^emerald ii$/i, atMs: 12 * MINUTE_MS, spanMs: 6 * MINUTE_MS },
    { pattern: /^diamond iii$/i, atMs: 18 * MINUTE_MS, spanMs: 6 * MINUTE_MS },
    { pattern: /^emerald iii$/i, atMs: 24 * MINUTE_MS, spanMs: 6 * MINUTE_MS },
    { pattern: /^bed (?:gone|destruction)$/i, atMs: 30 * MINUTE_MS, spanMs: 6 * MINUTE_MS },
    { pattern: /^sudden death$/i, atMs: 40 * MINUTE_MS, spanMs: 10 * MINUTE_MS },
    { pattern: /^(?:more )?dragons?$/i, atMs: 45 * MINUTE_MS, spanMs: 5 * MINUTE_MS },
    { pattern: /^game end$/i, atMs: 50 * MINUTE_MS, spanMs: 5 * MINUTE_MS }
];
const STANDARD_BEDWARS_VARIANTS = /^(Solos|Doubles|Threes|Fours)$/i;

// Longest a game can run (BedWars ends at 50 minutes) plus slack. A clip past
// this is refused: the game end was missed, and the offset would be nonsense.
const MAX_GAME_MS = 55 * MINUTE_MS;
const MAX_CLIPS_PER_GAME = 10;
const CLIP_COOLDOWN_MS = 3000;
const MAX_LABEL_LENGTH = 24;
// Two clips belong to the same game when their derived starts are this close.
const SAME_GAME_START_MS = 2 * MINUTE_MS;
const RETENTION_MS = 30 * 24 * 3600000;
const MAX_GAMES = 200;

function stripFormatting(value) {
    return String(value == null ? '' : value)
        .replace(/(?:Â)?§[0-9a-fk-or]/gi, '')
        .replace(/[\u{10000}-\u{10FFFF}]/gu, '');
}

function isStandardBedwarsVariant(variant) {
    return STANDARD_BEDWARS_VARIANTS.test(String(variant || '').trim());
}

// Milliseconds since the game start according to the sidebar countdown, or
// null when no known event line is showing.
function bedwarsElapsedFromSidebar(lines) {
    for (const raw of Array.isArray(lines) ? lines : []) {
        const line = stripFormatting(raw).replace(/\s+/g, ' ').trim();
        const match = line.match(/^(.+?):?\s+in\s+(\d{1,2}):(\d{2})$/i);
        if (!match) continue;
        const stage = BEDWARS_TIMELINE.find(entry => entry.pattern.test(match[1].trim()));
        if (!stage) continue;
        const remainingMs = (Number(match[2]) * 60 + Number(match[3])) * 1000;
        if (remainingMs > stage.spanMs) continue;
        return stage.atMs - remainingMs;
    }
    return null;
}

function cleanClipLabel(value) {
    return stripFormatting(value)
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_LABEL_LENGTH)
        .trim();
}

function formatClipTime(offsetMs) {
    const totalSeconds = Math.max(0, Math.floor((Number(offsetMs) || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return hours
        ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
        : `${String(minutes).padStart(2, '0')}:${seconds}`;
}

function normalizeClip(raw = {}) {
    const offsetMs = Number(raw.offsetMs);
    const label = cleanClipLabel(raw.label);
    if (!Number.isFinite(offsetMs) || offsetMs < 0 || offsetMs > MAX_GAME_MS || !label) return null;
    return { offsetMs: Math.round(offsetMs), label, at: Math.max(0, Number(raw.at) || 0) };
}

function normalizeClipGame(raw = {}) {
    const startedAt = Number(raw.startedAt) || 0;
    if (!startedAt) return null;
    const clips = (Array.isArray(raw.clips) ? raw.clips : [])
        .map(normalizeClip)
        .filter(Boolean)
        .slice(0, MAX_CLIPS_PER_GAME);
    if (!clips.length) return null;
    return {
        serverId: typeof raw.serverId === 'string' && raw.serverId ? raw.serverId.slice(0, 40) : null,
        mode: typeof raw.mode === 'string' && raw.mode ? raw.mode.slice(0, 24) : null,
        startedAt,
        clips
    };
}

function normalizeClipGames(raw) {
    const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.games) ? raw.games : []);
    return rows.map(normalizeClipGame).filter(Boolean);
}

function createClipStore({ clipFile, writeJsonOffThread, now = Date.now }) {
    if (!clipFile) throw new Error('createClipStore: clipFile is required');
    if (typeof writeJsonOffThread !== 'function') {
        throw new Error('createClipStore: writeJsonOffThread is required');
    }

    const cache = new JsonFileCache(clipFile, {
        fallback: () => [],
        checkIntervalMs: 1000,
        transform: normalizeClipGames
    });

    function listGames() {
        return cache.get();
    }

    function persist(games) {
        const cutoff = now() - RETENTION_MS;
        const kept = games.filter(game => game.startedAt >= cutoff).slice(-MAX_GAMES);
        cache.set(kept);
        try {
            writeJsonOffThread(clipFile, { version: 1, games: kept }, 'GameClips');
        } catch (ignore) {}
    }

    // `elapsedMs` is the offset into the game right now; the game start is
    // derived from it, so a sidebar-based offset also fixes a late start.
    function addClip({ serverId = null, mode = null, elapsedMs, label = '' } = {}) {
        const elapsed = Number(elapsedMs);
        if (!Number.isFinite(elapsed) || elapsed < 0) return { ok: false, reason: 'no_game' };
        if (elapsed > MAX_GAME_MS) return { ok: false, reason: 'too_long' };

        const stamp = now();
        const startedAt = stamp - elapsed;
        const games = listGames().map(game => ({ ...game, clips: game.clips.slice() }));
        let game = games.find(entry => (
            (entry.serverId || null) === (serverId || null)
            && (entry.mode || null) === (mode || null)
            && Math.abs(entry.startedAt - startedAt) <= SAME_GAME_START_MS
        ));
        if (game) {
            const last = game.clips[game.clips.length - 1];
            if (last && stamp - last.at < CLIP_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
            if (game.clips.length >= MAX_CLIPS_PER_GAME) return { ok: false, reason: 'full' };
        } else {
            game = { serverId: serverId || null, mode: mode || null, startedAt, clips: [] };
            games.push(game);
        }

        const clip = {
            offsetMs: Math.round(elapsed),
            label: cleanClipLabel(label) || `Clip ${game.clips.length + 1}`,
            at: stamp
        };
        game.clips.push(clip);
        persist(games);
        return { ok: true, clip, number: game.clips.length, game };
    }

    return { addClip, listGames };
}

module.exports = {
    createClipStore,
    bedwarsElapsedFromSidebar,
    isStandardBedwarsVariant,
    cleanClipLabel,
    formatClipTime,
    MAX_GAME_MS,
    MAX_CLIPS_PER_GAME
};
