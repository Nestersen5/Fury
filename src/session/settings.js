'use strict';

const SESSION_BOUNDARY_MINUTES = [30, 60, 180, 360];
// 0 means unlimited local history. Keeping the sentinel numeric lets the
// launcher persist the choice without introducing a second string schema.
const SESSION_RETENTION_CHOICES = [0, 50, 100, 250, 1000];
const SESSION_RECAP_STYLES = ['compact', 'detailed', 'custom'];
const SESSION_RECAP_FIELDS = ['result', 'duration', 'game_stats', 'session_totals', 'goals'];
// Explicit off preserves charts for older saved field lists without this option.
const SESSION_CHART_FIELDS = ['gamesByMode', 'hideGamesByMode'];
const SESSION_TRACKED_FIELDS = {
    BEDWARS: ['wins', 'losses', 'finals', 'finalDeaths', 'beds', 'bedsLost', 'kills', 'deaths', 'wlr', 'fkdr', 'kdr', 'bblr', 'games', 'stars', ...SESSION_CHART_FIELDS],
    SKYWARS: ['wins', 'losses', 'kills', 'deaths', 'assists', 'kdr', 'wlr', 'games', ...SESSION_CHART_FIELDS],
    DUELS: ['wins', 'losses', 'kills', 'deaths', 'kdr', 'wlr', ...SESSION_CHART_FIELDS]
};

const SESSION_DEFAULTS = {
    sessionBoundaryMinutes: 30,
    sessionRetention: 0,
    sessionRecapStyle: 'compact',
    sessionRecapFields: SESSION_RECAP_FIELDS.slice(),
    sessionBedwarsFields: ['wins', 'losses', 'finals', 'finalDeaths', 'beds', 'bedsLost', 'kills', 'deaths', 'wlr', 'fkdr', 'kdr', 'bblr', 'games', 'stars'],
    sessionSkywarsFields: ['wins', 'losses', 'kills', 'deaths', 'wlr', 'kdr', 'games', 'assists'],
    sessionDuelsFields: ['wins', 'losses', 'kills', 'deaths', 'wlr', 'kdr'],
    sessionGoalWins: 0,
    sessionGoalFinals: 0,
    sessionGoalGames: 0,
    sessionGoalMinutes: 0
};

function normalizeChoiceNumber(value, choices, fallback) {
    const parsed = Math.round(Number(value));
    return choices.includes(parsed) ? parsed : fallback;
}

function normalizeFieldList(value, allowed, fallback) {
    if (!Array.isArray(value)) return fallback.slice();
    const clean = value
        .map(field => String(field || '').trim())
        .filter((field, index, rows) => allowed.includes(field) && rows.indexOf(field) === index);
    return clean.length ? clean : fallback.slice();
}

function normalizeGoal(value, max = 100000) {
    const parsed = Math.round(Number(value));
    return Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : 0;
}

function normalizeSessionFeatureSettings(source = {}) {
    const style = SESSION_RECAP_STYLES.includes(String(source.sessionRecapStyle || '').toLowerCase())
        ? String(source.sessionRecapStyle).toLowerCase()
        : SESSION_DEFAULTS.sessionRecapStyle;
    return {
        // Lifecycle settings are fixed, including for profiles saved by older launchers.
        sessionBoundaryMinutes: SESSION_DEFAULTS.sessionBoundaryMinutes,
        sessionRetention: SESSION_DEFAULTS.sessionRetention,
        sessionRecapStyle: style,
        sessionRecapFields: normalizeFieldList(
            source.sessionRecapFields,
            SESSION_RECAP_FIELDS,
            SESSION_DEFAULTS.sessionRecapFields
        ),
        sessionBedwarsFields: normalizeFieldList(
            source.sessionBedwarsFields,
            SESSION_TRACKED_FIELDS.BEDWARS,
            SESSION_DEFAULTS.sessionBedwarsFields
        ),
        sessionSkywarsFields: normalizeFieldList(
            source.sessionSkywarsFields,
            SESSION_TRACKED_FIELDS.SKYWARS,
            SESSION_DEFAULTS.sessionSkywarsFields
        ),
        sessionDuelsFields: normalizeFieldList(
            source.sessionDuelsFields,
            SESSION_TRACKED_FIELDS.DUELS,
            SESSION_DEFAULTS.sessionDuelsFields
        ),
        sessionGoalWins: normalizeGoal(source.sessionGoalWins),
        sessionGoalFinals: normalizeGoal(source.sessionGoalFinals),
        sessionGoalGames: normalizeGoal(source.sessionGoalGames),
        sessionGoalMinutes: normalizeGoal(source.sessionGoalMinutes, 10080)
    };
}

function sessionGoalsFromSettings(source = {}) {
    const normalized = normalizeSessionFeatureSettings(source);
    return [
        { key: 'wins', label: 'Wins', target: normalized.sessionGoalWins },
        { key: 'finals', label: 'Final kills', target: normalized.sessionGoalFinals },
        { key: 'games', label: 'Games', target: normalized.sessionGoalGames },
        { key: 'minutes', label: 'Minutes played', target: normalized.sessionGoalMinutes }
    ].filter(goal => goal.target > 0);
}

module.exports = {
    SESSION_BOUNDARY_MINUTES,
    SESSION_RETENTION_CHOICES,
    SESSION_RECAP_STYLES,
    SESSION_RECAP_FIELDS,
    SESSION_TRACKED_FIELDS,
    SESSION_DEFAULTS,
    normalizeChoiceNumber,
    normalizeFieldList,
    normalizeGoal,
    normalizeSessionFeatureSettings,
    sessionGoalsFromSettings
};
