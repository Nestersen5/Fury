'use strict';

const { gameEventNormalizationCache } = require('./gameEventNormalizationCache.js');

// Structured, renderer-safe events captured while a supported game is live.
// API deltas remain the authoritative aggregate counters; this module adds the
// who/when/source detail needed for timelines and reconciles the two views.

const GAME_EVENT_TYPES = [
    'game_start',
    'kill',
    'final_kill',
    'bed_break',
    'team_eliminated',
    'disconnect',
    'reconnect',
    'victory',
    'defeat',
    'note'
];

const GAME_EVENT_SOURCES = ['chat', 'scoreboard', 'manual', 'system'];
const GAME_EVENT_CONFIDENCE = ['confirmed', 'inferred', 'manual'];
const BEDWARS_TEAMS = ['Red', 'Blue', 'Green', 'Yellow', 'Aqua', 'White', 'Pink', 'Gray'];
const MAX_GAME_EVENTS = 512;

function cleanName(value) {
    const name = String(value || '').trim();
    return /^[A-Za-z0-9_]{2,16}$/.test(name) ? name : null;
}

function cleanTeam(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^your$/i.test(raw)) return 'Your';
    const team = BEDWARS_TEAMS.find(entry => entry.toLowerCase() === raw.toLowerCase().replace(/^grey$/, 'gray'));
    return team || null;
}

function cleanText(value, max = 320) {
    return String(value || '')
        .replace(/\r/g, '')
        .replace(/(?:\u00c2)?\u00a7[0-9A-FK-OR]/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function normalizeGameEvent(raw = {}, { now = Date.now, startedAt = 0 } = {}) {
    const type = GAME_EVENT_TYPES.includes(String(raw.type || '').toLowerCase())
        ? String(raw.type).toLowerCase()
        : 'note';
    const source = GAME_EVENT_SOURCES.includes(String(raw.source || '').toLowerCase())
        ? String(raw.source).toLowerCase()
        : 'manual';
    const confidence = GAME_EVENT_CONFIDENCE.includes(String(raw.confidence || '').toLowerCase())
        ? String(raw.confidence).toLowerCase()
        : (source === 'manual' ? 'manual' : 'inferred');
    const stamp = Math.max(0, Number(raw.at) || Number(now()) || 0);
    const offsetMs = Math.max(0, Number(raw.offsetMs) || (startedAt && stamp ? stamp - startedAt : 0));
    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 80) : null,
        at: stamp,
        offsetMs,
        type,
        actor: cleanName(raw.actor),
        victim: cleanName(raw.victim),
        actorTeam: cleanTeam(raw.actorTeam),
        victimTeam: cleanTeam(raw.victimTeam),
        targetTeam: cleanTeam(raw.targetTeam),
        cause: cleanText(raw.cause, 80) || null,
        source,
        confidence,
        rawText: cleanText(raw.rawText),
        note: cleanText(raw.note, 240) || null,
        correctedAt: Math.max(0, Number(raw.correctedAt) || 0)
    };
}

function sameName(a, b) {
    return Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
}

function sameTeam(a, b) {
    const left = cleanTeam(a);
    const right = cleanTeam(b);
    return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function eventSignature(event = {}) {
    return [
        event.type,
        String(event.actor || '').toLowerCase(),
        String(event.victim || '').toLowerCase(),
        String(event.targetTeam || '').toLowerCase(),
        Math.round((Number(event.offsetMs) || 0) / 1000)
    ].join('|');
}

function resolveSessionGameVariant(mode, {
    duelsModeName = null,
    bedwarsQueue = null,
    previousVariant = null
} = {}) {
    if (mode === 'DUELS') return String(duelsModeName || '').trim() || null;
    if (mode === 'BEDWARS' && bedwarsQueue && !bedwarsQueue.fallback) {
        return String(bedwarsQueue.label || '').trim() || String(previousVariant || '').trim() || null;
    }
    return String(previousVariant || '').trim() || null;
}

function dedupeGameEvents(events = []) {
    const cache = gameEventNormalizationCache(events);
    if (cache?.value) return cache.value;
    const seen = new Set();
    const normalized = (Array.isArray(events) ? events : [])
        .map(event => normalizeGameEvent(event))
        .filter((event) => {
            const key = eventSignature(event);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => a.offsetMs - b.offsetMs || a.at - b.at)
        .slice(-MAX_GAME_EVENTS);
    if (cache) cache.value = normalized;
    return normalized;
}

function parseFinalKill(line, resolveKillOwner = null) {
    if (!/\bFINAL KILL!?\b/i.test(line)) return null;
    const victim = cleanName(line.match(/^\s*([A-Za-z0-9_]{2,16})\b/)?.[1]);
    const killer = cleanName(
        line.match(/^\s*[A-Za-z0-9_]{2,16}\s+was\s+([A-Za-z0-9_]{2,16})'s\s+final/i)?.[1]
        || line.match(/\bby\s+([A-Za-z0-9_]{2,16})\b[.!']*\s*FINAL KILL/i)?.[1]
        || (typeof resolveKillOwner === 'function' ? resolveKillOwner(line) : null)
    );
    if (!victim || !killer || sameName(victim, killer)) return null;
    return { type: 'final_kill', actor: killer, victim, confidence: 'confirmed' };
}

function parseBedBreak(line, ownTeam = null) {
    if (!/\bBED\s+DESTRUCTION\b|\bBed was (?:bed #[\d,]+ )?destroyed by\b/i.test(line)) return null;
    const match = line.match(/\b(Your|Red|Blue|Green|Yellow|Aqua|White|Pink|Gr[ae]y)\s+Bed\b[\s\S]*?\bdestroyed by\s+([A-Za-z0-9_]{2,16})\b/i);
    if (!match) return null;
    const rawTeam = cleanTeam(match[1]);
    return {
        type: 'bed_break',
        actor: cleanName(match[2]),
        targetTeam: rawTeam === 'Your' ? cleanTeam(ownTeam) : rawTeam,
        confidence: 'confirmed'
    };
}

function parseRegularKill(line, resolveKillOwner = null) {
    if (/\bFINAL KILL!?\b/i.test(line)) return null;
    const victim = cleanName(line.match(/^\s*([A-Za-z0-9_]{2,16})\b/)?.[1]);
    if (!victim) return null;
    const looksLikeKill = /\b(?:killed|slain|stomped|bested|outclassed|shot|void|pit|edge|ground|golem|knocked|thrown|eliminated|destroyed)\b/i.test(line);
    if (!looksLikeKill) return null;
    const killer = cleanName(
        line.match(/\bby\s+([A-Za-z0-9_]{2,16})(?:'s\s+Golem)?\b/i)?.[1]
        || line.match(/\b([A-Za-z0-9_]{2,16})'s\s+Golem\b/i)?.[1]
        || (typeof resolveKillOwner === 'function' ? resolveKillOwner(line) : null)
    );
    if (!killer || sameName(victim, killer)) return null;
    let cause = null;
    if (/\bvoid|pit\b/i.test(line)) cause = 'void';
    else if (/\bshot|arrow|bow\b/i.test(line)) cause = 'projectile';
    else if (/\bgolem\b/i.test(line)) cause = 'golem';
    else if (/\bfall|ground|edge\b/i.test(line)) cause = 'fall';
    return { type: 'kill', actor: killer, victim, cause, confidence: 'inferred' };
}

function parseGameEvents(text, {
    at = Date.now(),
    startedAt = 0,
    ownTeam = null,
    resolveTeam = null,
    resolveKillOwner = null
} = {}) {
    const line = cleanText(text);
    if (!line) return [];
    const base = { at, offsetMs: Math.max(0, Number(at) - Number(startedAt || at)), source: 'chat', rawText: line };
    let parsed = parseBedBreak(line, ownTeam) || parseFinalKill(line, resolveKillOwner);

    if (!parsed) {
        const eliminated = line.match(/^TEAM ELIMINATED\s*>\s*(Red|Blue|Green|Yellow|Aqua|White|Pink|Gr[ae]y)\s+Team\s+has been eliminated[!.]?$/i);
        if (eliminated) parsed = { type: 'team_eliminated', targetTeam: cleanTeam(eliminated[1]), confidence: 'confirmed' };
    }
    if (!parsed && /\bVICTORY\s*!/i.test(line)) parsed = { type: 'victory', confidence: 'confirmed' };
    if (!parsed && /\bDEFEAT\s*!/i.test(line)) parsed = { type: 'defeat', confidence: 'confirmed' };
    if (!parsed) {
        const reconnect = line.match(/\b([A-Za-z0-9_]{2,16})\s+reconnected[.!]?$/i);
        if (reconnect) parsed = { type: 'reconnect', actor: cleanName(reconnect[1]), confidence: 'confirmed' };
    }
    if (!parsed) {
        const disconnect = line.match(/\b([A-Za-z0-9_]{2,16})\s+disconnected[.!]?$/i);
        if (disconnect) parsed = { type: 'disconnect', actor: cleanName(disconnect[1]), confidence: 'confirmed' };
    }
    if (!parsed) parsed = parseRegularKill(line, resolveKillOwner);
    if (!parsed) return [];

    if (typeof resolveTeam === 'function') {
        if (parsed.actor) parsed.actorTeam = cleanTeam(resolveTeam(parsed.actor));
        if (parsed.victim) parsed.victimTeam = cleanTeam(resolveTeam(parsed.victim));
    }
    return [normalizeGameEvent({ ...base, ...parsed }, { startedAt })];
}

// The VICTORY!/DEFEAT!/GAME OVER! banner is a title packet, not chat. BedWars
// shows GAME OVER! to losers, so it becomes a defeat tagged 'game_over' that a
// VICTORY! for the same game outranks (see gameResult.js).
function parseResultBanner(text, { mode = null, at = Date.now(), startedAt = 0 } = {}) {
    const line = cleanText(text, 40);
    let parsed = null;
    if (/^VICTORY\s*!?$/i.test(line)) parsed = { type: 'victory' };
    else if (/^DEFEAT\s*!?$/i.test(line)) parsed = { type: 'defeat' };
    else if (/^GAME OVER\s*!?$/i.test(line) && mode === 'BEDWARS') parsed = { type: 'defeat', cause: 'game_over' };
    if (!parsed) return null;
    return normalizeGameEvent({
        ...parsed, at, source: 'system', confidence: 'confirmed', rawText: line
    }, { startedAt });
}

function eventTotals(events = [], { ownName = null, ownTeam = null } = {}) {
    const totals = {
        wins: 0,
        losses: 0,
        kills: 0,
        deaths: 0,
        finals: 0,
        finalDeaths: 0,
        beds: 0,
        bedsLost: 0
    };
    dedupeGameEvents(events).forEach((event) => {
        if (event.type === 'victory') totals.wins += 1;
        if (event.type === 'defeat') totals.losses += 1;
        if (event.type === 'kill') {
            if (sameName(event.actor, ownName)) totals.kills += 1;
            if (sameName(event.victim, ownName)) totals.deaths += 1;
        }
        if (event.type === 'final_kill') {
            if (sameName(event.actor, ownName)) totals.finals += 1;
            if (sameName(event.victim, ownName)) totals.finalDeaths += 1;
        }
        if (event.type === 'bed_break') {
            if (sameName(event.actor, ownName)) totals.beds += 1;
            if (sameTeam(event.targetTeam, ownTeam)) totals.bedsLost += 1;
        }
    });
    return totals;
}

function reconcileGameStats(apiStats = null, events = [], context = {}) {
    const observed = eventTotals(events, context);
    if (!apiStats) {
        const movement = Object.values(observed).some(value => value > 0);
        return { status: movement ? 'event-only' : 'empty', api: null, observed, differences: {} };
    }
    const api = {};
    const differences = {};
    let compared = 0;
    let mismatches = 0;
    Object.keys(observed).forEach((field) => {
        api[field] = Math.max(0, Number(apiStats[field]) || 0);
        differences[field] = api[field] - observed[field];
        if (api[field] > 0 || observed[field] > 0) {
            compared += 1;
            if (differences[field] !== 0) mismatches += 1;
        }
    });
    const eventCount = dedupeGameEvents(events).filter(event => !['game_start', 'note'].includes(event.type)).length;
    let status = 'matched';
    if (!eventCount) status = 'api-only';
    else if (mismatches) status = 'partial';
    return {
        status,
        api,
        observed,
        differences,
        compared,
        mismatches,
        matchedFields: Math.max(0, compared - mismatches)
    };
}

module.exports = {
    GAME_EVENT_TYPES,
    GAME_EVENT_SOURCES,
    GAME_EVENT_CONFIDENCE,
    BEDWARS_TEAMS,
    MAX_GAME_EVENTS,
    cleanName,
    cleanTeam,
    cleanText,
    normalizeGameEvent,
    dedupeGameEvents,
    parseGameEvents,
    parseResultBanner,
    eventTotals,
    reconcileGameStats,
    sameName,
    sameTeam,
    eventSignature,
    resolveSessionGameVariant
};
