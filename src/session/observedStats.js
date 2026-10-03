'use strict';

const { FIELDS, normalizeLocal, normalizeTotals, normalizeVariant, addVariant, mergeTotals, localModes } = require('./localStats');
const { MODE_DEFINITIONS } = require('./modeDefinitions');

// An API window is attributable to one match only when it contains exactly
// one completed result. Starts/games-played alone are not completion evidence.
function singleApiResult(delta, mode) {
    const definition = MODE_DEFINITIONS.find(entry => entry.mode === mode);
    const stats = delta?.stats?.[definition?.key];
    if (!stats) return null;
    const wins = stats[definition.fields.wins] ?? 0;
    const losses = stats[definition.fields.losses] ?? 0;
    if (wins === 1 && losses === 0) return 'win';
    if (wins === 0 && losses === 1) return 'loss';
    return null;
}

function apiCompletedGames(delta, mode) {
    const definition = MODE_DEFINITIONS.find(entry => entry.mode === mode);
    const stats = delta?.stats?.[definition?.key];
    if (!stats) return 0;
    return Math.max(0, Number(stats[definition.fields.wins]) || 0)
        + Math.max(0, Number(stats[definition.fields.losses]) || 0);
}

function gameModes(record) {
    const observed = record.localModes;
    const definition = MODE_DEFINITIONS.find(entry => entry.mode === record.mode);
    if (definition && record.verificationStatus === 'verified' && singleApiResult(record.delta, record.mode)) {
        const stats = record.delta.stats[definition.key];
        const counts = normalizeTotals();
        for (const key of FIELDS) {
            const field = definition.fields[key];
            if (field) counts[key] = { value: stats[field] || 0, available: true };
        }
        counts.games = { value: 1, available: true };
        return localModes({ totals: { [record.mode]: counts } });
    }
    return observed;
}

// The same persisted game IDs drive immediate totals and later reconciliation.
// Replacing a game's counters never adds another game to the session. Legacy
// sessions without live observations keep their existing API projection.
function countsForGame(record) {
    if (!(record.durationMs >= 1000) || record.metadata?.privateGame) return null;
    const mode = gameModes(record)?.find(entry => entry.mode === record.mode);
    const counts = normalizeTotals();
    for (const field of FIELDS) {
        if (Number.isFinite(mode?.[field])) counts[field] = { value: mode[field], available: true };
    }
    if (['win', 'loss'].includes(record.result)) {
        counts.games = { value: 1, available: true };
        counts.wins = { value: record.result === 'win' ? 1 : 0, available: true };
        counts.losses = { value: record.result === 'loss' ? 1 : 0, available: true };
    } else {
        // These totals describe confirmed completions. An abandoned/unknown
        // result contributes none until it is resolved, rather than hiding
        // progress for every other completed game in the session.
        for (const field of ['games', 'wins', 'losses']) counts[field] = { value: 0, available: true };
    }
    return counts;
}

function archiveObservedGames(session, games) {
    if (session.trackingSource === 'local' || !session.games.some(game => game.localModes?.length)) return;
    const local = normalizeLocal(session.localTracking || {});
    for (const game of games) {
        const counts = countsForGame(game);
        if (counts) addGame(local, game, counts);
    }
    session.localTracking = local;
}

function addGame(local, record, counts) {
    local.totals[record.mode] = mergeTotals(local.totals[record.mode], counts);
    addVariant(local, { mode: record.mode, counts, variant: normalizeVariant(record.mode, record.metadata?.variant) });
}

function observedSessionDelta(session, apiDelta) {
    if (!session?.games?.some(game => game.localModes?.length) && !session?.localTracking) return apiDelta;
    const local = normalizeLocal(session.localTracking || {});
    for (const record of session.games) {
        const counts = countsForGame(record);
        if (counts) addGame(local, record, counts);
    }
    return { ...apiDelta, local: true, modes: localModes(local),
        from: session.startedAt, to: session.endedAt || session.lastSeen,
        spanMs: Math.max(0, (session.endedAt || session.lastSeen) - session.startedAt) };
}

module.exports = { singleApiResult, apiCompletedGames, gameModes, observedSessionDelta, archiveObservedGames };
