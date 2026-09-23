'use strict';

// Compact, renderer-safe projection of the local session store. The store's
// active session contains full Hypixel snapshots, which are useful for delta
// maths but much too large (and unnecessarily detailed) for the launcher.

const { hasGameplayMovement } = require('./sessionSnapshot.js');
const { sessionGoalsFromSettings } = require('./settings.js');
const { dedupeGameEvents, eventTotals, reconcileGameStats } = require('./gameEvents.js');
const { withGameEventNormalizationCache } = require('./gameEventNormalizationCache.js');
const { sessionBelongsToAccount } = require('../accounts/launcherAccounts.js');
const { sessionHasCardStats } = require('./sessionStore.js');
// Required once here: resolving a require() inside the per-game and
// per-session loops cost more than the history work itself.
const { hasCardStatMovement } = require('./cardStatsPolicy');
const { modeBreakdown } = require('./modeBreakdown');
const { submodeStats } = require('./submodeStats');
const localTracking = require('./localTracking');
const { deriveRatios } = require('./localStats');

const MODE_DEFINITIONS = [
    {
        key: 'Bedwars',
        mode: 'BEDWARS',
        label: 'BedWars',
        fields: {
            wins: 'wins_bedwars',
            losses: 'losses_bedwars',
            kills: 'kills_bedwars',
            deaths: 'deaths_bedwars',
            finals: 'final_kills_bedwars',
            finalDeaths: 'final_deaths_bedwars',
            beds: 'beds_broken_bedwars',
            bedsLost: 'beds_lost_bedwars',
            games: 'games_played_bedwars',
            experience: 'Experience'
        }
    },
    {
        key: 'SkyWars',
        mode: 'SKYWARS',
        label: 'SkyWars',
        fields: {
            wins: 'wins',
            losses: 'losses',
            kills: 'kills',
            deaths: 'deaths',
            assists: 'assists',
            games: 'games'
        }
    },
    {
        key: 'Duels',
        mode: 'DUELS',
        label: 'Duels',
        fields: {
            wins: 'wins',
            losses: 'losses',
            kills: 'kills',
            deaths: 'deaths',
            games: 'games_played_duels'
        }
    }
];

const MAX_LAUNCHER_SESSIONS = 250;
const MAX_LAUNCHER_GAMES = 250;

function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function compactModeStats(definition, stats = {}) {
    if (!hasGameplayMovement(stats)) return null;
    const out = { mode: definition.mode, label: definition.label };
    Object.entries(definition.fields).forEach(([name, key]) => {
        out[name] = number(stats[key]);
    });

    // Duels does not reliably expose games_played_duels. The rounds counter
    // is the next-best completed-game measure, followed by win/loss movement.
    if (definition.mode === 'DUELS' && !out.games) {
        out.games = number(stats.rounds_played) || out.wins + out.losses;
    }
    if (definition.mode === 'SKYWARS') {
        // These counters can update at different times. Recorded completed
        // results are a lower bound, even when the generic games counter lags.
        out.games = Math.max(out.games, number(stats.games_played_skywars), out.wins + out.losses);
    }
    out.breakdown = modeBreakdown(definition.mode, stats, out.games);
    if (definition.mode === 'SKYWARS' || definition.mode === 'DUELS') {
        out.submodes = submodeStats(definition.mode, stats);
    }
    if (definition.mode === 'BEDWARS') {
        out.submodes = [['eight_one','Solos'],['eight_two','Doubles'],['four_three','Threes'],['four_four','Fours'],['two_four','4v4']].flatMap(([id,label]) => {
            const counters = Object.fromEntries(Object.entries(definition.fields).filter(([name]) => name !== 'experience').map(([name,key]) => [name, number(stats[`${id}_${key}`])]));
            if (!Object.values(counters).some(value => value > 0)) return [];
            const available = Object.entries(definition.fields).some(([name,key]) => !['games','experience'].includes(name) && Object.hasOwn(stats,`${id}_${key}`));
            const detail = { id, label, mode: definition.mode, games: counters.games };
            if (available) Object.assign(detail, counters, { wlr: counters.wins / Math.max(1,counters.losses), fkdr: counters.finals / Math.max(1,counters.finalDeaths), kdr: counters.kills / Math.max(1,counters.deaths), bblr: counters.beds / Math.max(1,counters.bedsLost), ...(counters.games > 0 ? {winRate: counters.wins / counters.games * 100} : {}) });
            return [detail];
        });
    }
    out.wlr = out.wins / Math.max(1, out.losses);
    out.winRate = out.games > 0 ? (out.wins / out.games) * 100 : 0;
    out.kdr = out.kills / Math.max(1, out.deaths);
    if (definition.mode === 'BEDWARS') {
        out.fkdr = out.finals / Math.max(1, out.finalDeaths);
        out.bblr = out.beds / Math.max(1, out.bedsLost);
        // BedWars levels progress at 5,000 experience per star. The session
        // chat card already presents this as a fractional star gain, so expose
        // the same value to the launcher rather than an unrelated XP counter.
        out.stars = out.experience / 5000;
        delete out.experience;
    }
    return out;
}

function compactModes(delta = {}) {
    return MODE_DEFINITIONS
        .filter(definition => hasCardStatMovement(definition.key, delta?.stats?.[definition.key]))
        .map(definition => compactModeStats(definition, delta?.stats?.[definition.key] || {}))
        .filter(Boolean);
}

// Compact game, reused from the caller's `gameCache` when it has one. Only
// the proxy's history cache passes one: SessionStore replaces a game record
// instead of editing it (appendGame, updateGame), so a record's compact form
// stays valid for the record's lifetime and a rebuild only compacts new
// games. That output is serialized, never edited, so the session list and
// calendar may share it. Without a cache every call builds fresh output.
function compactGameFrom(record, { gameCache = null, ...options } = {}) {
    if (!gameCache || options.encounterLookup || !record || typeof record !== 'object') return compactGame(record, options);
    const ownName = options.ownName ?? null;
    let byOwner = gameCache.get(record);
    if (!byOwner) gameCache.set(record, byOwner = new Map());
    if (!byOwner.has(ownName)) byOwner.set(ownName, compactGame(record, options));
    return byOwner.get(ownName);
}

function compactGame(record = {}, { encounterLookup = null, ownName = null } = {}) {
    if (record.verificationStatus === 'local') return {
        id: String(record.id || ''), at: number(record.at), mode: record.mode,
        durationMs: number(record.durationMs), result: ['win','loss'].includes(record.result)?record.result:null, stats: record.localModes?.[0] || null,
        statsSource: 'local', verificationStatus: 'local', events: [],
        coverage: { status: record.localModes?.[0]?.unavailable?.length?'partial':'local' }, metadata:record.metadata||null, opponents: [], teammates: [], roster: []
    };
    const mode = String(record.mode || '').toUpperCase();
    const definition = MODE_DEFINITIONS.find(item => item.mode === mode);
    const apiStats = definition
        ? compactModeStats(definition, record.delta?.stats?.[definition.key] || {})
        : null;
    const events = dedupeGameEvents(record.events || []);
    return withGameEventNormalizationCache(events, () => {
        const ownTeam = record.metadata?.team || null;
        const derived = eventTotals(events, { ownName, ownTeam });
        const hasDerivedMovement = Object.values(derived).some(value => number(value) > 0);
        const stats = apiStats || (definition && hasDerivedMovement ? {
            mode: definition.mode,
            label: definition.label,
            ...derived,
            games: derived.wins + derived.losses || 1,
            wlr: derived.wins / Math.max(1, derived.losses),
            winRate: derived.wins + derived.losses > 0 ? (derived.wins / (derived.wins + derived.losses)) * 100 : 0,
            kdr: derived.kills / Math.max(1, derived.deaths),
            ...(definition.mode === 'BEDWARS' ? {
                fkdr: derived.finals / Math.max(1, derived.finalDeaths),
                bblr: derived.beds / Math.max(1, derived.bedsLost)
            } : {})
        } : null);
        const opponents = Array.isArray(record.opponents)
            ? record.opponents.slice(0, 32).map(value => String(value)).filter(Boolean)
            : [];
        const reconciliation = reconcileGameStats(apiStats, events, { ownName, ownTeam });
        let coverageStatus = reconciliation.status === 'matched' ? 'complete' : reconciliation.status;
        if (record.verificationStatus === 'pending') coverageStatus = 'pending';
        else if (record.verificationStatus === 'unverified' && !apiStats) coverageStatus = 'unverified';
        else if (record.metadata?.observedFromStart === false || record.metadata?.disconnected) coverageStatus = 'partial';
        const roster = Array.isArray(record.roster) ? record.roster.slice(0, 32).map(player => ({
            name: String(player?.name || ''),
            uuid: player?.uuid ? String(player.uuid) : null,
            team: player?.team ? String(player.team) : null,
            relation: ['self', 'teammate', 'opponent', 'unknown'].includes(player?.relation)
                ? player.relation
                : 'unknown'
        })).filter(player => player.name) : [];
        return {
            id: String(record.id || ''),
            at: number(record.at),
            mode: definition?.mode || (mode || null),
            label: definition?.label || (mode ? mode.toLowerCase() : 'Unknown mode'),
            durationMs: Math.max(0, number(record.durationMs)),
            result: (['win', 'loss'].includes(String(record.result || '').toLowerCase())
                ? String(record.result).toLowerCase()
                : null),
            opponents,
            teammates: Array.isArray(record.teammates) ? record.teammates.slice(0, 16).map(String) : [],
            roster,
            opponentDetails: typeof encounterLookup === 'function'
                ? opponents.map((name) => ({ name, encounter: encounterLookup(name) || null }))
                : opponents.map(name => ({ name, encounter: null })),
            stats,
            statsSource: apiStats ? 'api' : (stats ? 'events' : 'none'),
            metadata: record.metadata && typeof record.metadata === 'object' ? {
                serverId: record.metadata.serverId || null,
                map: record.metadata.map || null,
                variant: record.metadata.variant || null,
                team: record.metadata.team || null,
                party: Array.isArray(record.metadata.party) ? record.metadata.party.slice(0, 16).map(String) : [],
                observedFromStart: record.metadata.observedFromStart !== false,
                disconnected: Boolean(record.metadata.disconnected)
            } : null,
            events,
            reconciliation,
            coverage: {
                status: coverageStatus,
                observedFromStart: record.metadata?.observedFromStart !== false,
                disconnected: Boolean(record.metadata?.disconnected)
            },
            verificationStatus: ['pending', 'unverified'].includes(record.verificationStatus)
                ? record.verificationStatus
                : 'verified',
            verificationAttempts: number(record.verificationAttempts),
            nextVerificationAt: number(record.nextVerificationAt)
        };
    });
}

function sessionMetrics(modes = [], games = [], durationMs = 0) {
    const totals = modes.reduce((out, mode) => {
        ['wins', 'losses', 'kills', 'deaths', 'finals', 'finalDeaths', 'beds', 'bedsLost'].forEach((field) => {
            out[field] += number(mode[field]);
        });
        return out;
    }, { wins: 0, losses: 0, kills: 0, deaths: 0, finals: 0, finalDeaths: 0, beds: 0, bedsLost: 0 });
    totals.games = games.length;
    totals.verifiedGames = games.filter(game => game.verificationStatus === 'verified').length;
    totals.pendingGames = games.filter(game => game.verificationStatus === 'pending').length;
    totals.unverifiedGames = games.filter(game => game.verificationStatus === 'unverified').length;
    totals.minutes = Math.max(0, Math.round(number(durationMs) / 60000));
    totals.winRate = totals.games > 0 ? (totals.wins / totals.games) * 100 : 0;
    totals.fkdr = totals.finals / Math.max(1, totals.finalDeaths);
    totals.kdr = totals.kills / Math.max(1, totals.deaths);
    return totals;
}

function compactSession(entry = {}, now = Date.now(), options = {}) {
    const session = entry.session || {};
    const startedAt = number(session.startedAt);
    const lastSeen = number(session.lastSeen) || startedAt;
    const active = Boolean(entry.active ?? !session.endedAt);
    const endedAt = active ? 0 : number(session.endedAt);
    const local = session.trackingSource === 'local';
    const modes = local ? localTracking.localModes(session.localTracking).filter(mode=>active||localTracking.FIELDS.some(key=>mode[key]>0)) : compactModes(entry.delta || {});
    const games = Array.isArray(session.games)
        ? session.games.slice(-MAX_LAUNCHER_GAMES).reverse().map(record => compactGameFrom(record, {
            ...options,
            ownName: session.name || null
        }))
        : [];

    return withSessionClock({
        id: String(session.id || ''),
        uuid: session.uuid ? String(session.uuid) : null,
        name: session.name ? String(session.name) : 'Unknown account',
        startedAt,
        lastSeen,
        endedAt,
        active,
        durationMs: 0,
        games,
        modes,
        trackingSource: local ? 'local' : 'api'
    }, now);
}

// The only parts of a compact session that follow the clock: a live session's
// duration and the metrics derived from it.
function withSessionClock(compact, now) {
    const durationEnd = compact.active ? Math.max(compact.lastSeen, number(now)) : (compact.endedAt || compact.lastSeen);
    const durationMs = Math.max(0, durationEnd - compact.startedAt);
    const { modes, games } = compact;
    return {
        ...compact,
        durationMs,
        metrics: compact.trackingSource === 'local' ? deriveRatios(Object.fromEntries([
            ['minutes', Math.max(0, Math.round(durationMs / 60000))],
            ...localTracking.FIELDS.filter(key => modes.length && modes.every(mode => key in mode))
                .map(key => [key, modes.reduce((sum, mode) => sum + mode[key], 0)])
        ])) : sessionMetrics(modes, games, durationMs)
    };
}

function summarize(sessions) {
    const total = sessions.reduce((total, session) => {
        total.games += session.trackingSource==='local' ? number(session.metrics.games) : session.games.length;
        total.pendingGames += number(session.metrics.pendingGames);
        total.unverifiedGames += number(session.metrics.unverifiedGames);
        session.modes.forEach(mode => {
            total.wins += mode.wins || 0;
            total.losses += mode.losses || 0;
            total.finals += mode.finals || 0;
        });
        return total;
    }, { sessions: sessions.length, games: 0, wins: 0, losses: 0, finals: 0, pendingGames: 0, unverifiedGames: 0 });
    for (const key of ['games', 'wins', 'losses', 'finals']) {
        if (sessions.some(session => session.trackingSource === 'local' && !(key in session.metrics))) total[key] = null;
    }
    return total;
}

function buildTrends(sessions = [], limit = 8) {
    const recent = sessions.slice(0, limit).reverse();
    return ['wins', 'finals', 'games', 'fkdr', 'winRate'].reduce((out, key) => {
        out[key] = recent.map(session => ({ id: session.id, at: session.startedAt,
            value: session.trackingSource === 'local' && !(key in session.metrics) ? null : number(session.metrics?.[key]) }));
        return out;
    }, {});
}

function buildGoalProgress(active, settings = {}) {
    return goalProgress(active, sessionGoalsFromSettings(settings));
}

function goalProgress(active, goals) {
    const metrics = active?.metrics || {};
    return goals.map(goal => ({
        ...goal,
        value: active?.trackingSource === 'local' && !(goal.key in metrics) ? null : number(metrics[goal.key]),
        available: active?.trackingSource !== 'local' || goal.key in metrics,
        progress: active?.trackingSource === 'local' && !(goal.key in metrics) ? null : goal.target > 0 ? Math.min(1, number(metrics[goal.key]) / goal.target) : 0,
        complete: goal.target > 0 && number(metrics[goal.key]) >= goal.target
    }));
}

// `entries` is SessionStore#getHistory(): newest-first, with a fully usable
// delta for both active and completed sessions.
function buildLauncherSessionHistory(entries = [], {
    now = Date.now(),
    limit = MAX_LAUNCHER_SESSIONS,
    encounterLookup = null,
    gameCache = null,
    sessionSettings = {},
    account = null,
    accountScoped = false
} = {}) {
    const scopedEntries = (Array.isArray(entries) ? entries : [])
        .filter(entry => !(accountScoped || account) || sessionBelongsToAccount(entry.session, account))
        .filter(entry => !entry.session?.endedAt || sessionHasCardStats(entry.session, entry.delta));
    const sessions = scopedEntries
        .slice(0, Math.max(0, Math.min(MAX_LAUNCHER_SESSIONS, number(limit) || MAX_LAUNCHER_SESSIONS)))
        .map(entry => compactSession(entry, now, { encounterLookup, gameCache }))
        .filter(session => session.id);
    // Calendar views need every retained session, independently of the page's
    // detail limit. Send only timestamps and counters, not rosters or events.
    const calendarSessions = scopedEntries.map(({session,delta,active}) => ({
        id:session.id,uuid:session.uuid,name:session.name,startedAt:session.startedAt,
        endedAt:session.endedAt,lastSeen:session.lastSeen,active:Boolean(active ?? !session.endedAt),
        modes:session.trackingSource==='local'?localTracking.localModes(session.localTracking).filter(mode=>!session.endedAt||localTracking.FIELDS.some(key=>mode[key]>0)):compactModes(delta),
        games:(session.games||[]).map(record=>{
            const game=compactGameFrom(record,{ownName:session.name,gameCache});
            return {id:game.id,at:game.at,from:number(record.delta?.from),mode:game.mode,stats:game.stats,statsSource:game.statsSource,verificationStatus:game.verificationStatus};
        })
    }));
    const accounts = [...new Set(sessions.map(session => session.name))].sort((a, b) => a.localeCompare(b));
    return {
        account: accountScoped || account ? account : undefined,
        sessions,
        calendarSessions,
        accounts,
        ...sessionTotals(sessions, sessionGoalsFromSettings(sessionSettings)),
        settings: {
            bedwarsFields: sessionSettings.sessionBedwarsFields || [],
            skywarsFields: sessionSettings.sessionSkywarsFields || [],
            duelsFields: sessionSettings.sessionDuelsFields || []
        }
    };
}

function sessionTotals(sessions, goals) {
    const active = sessions.find(session => session.active) || null;
    return {
        summary: summarize(sessions),
        live: active,
        goals: goalProgress(active, goals),
        trends: buildTrends(sessions)
    };
}

// A built history at a later time. Without a store change only a live
// session's duration moves, so this equals a fresh build at `now` while the
// store revision is unchanged. Goal targets are carried by the goals already
// in the history. Returns a new object; the input is never modified.
function advanceSessionHistoryClock(history, now = Date.now()) {
    if (!history || !Array.isArray(history.sessions) || !history.sessions.some(session => session.active)) return history;
    const sessions = history.sessions.map(session => (session.active ? withSessionClock(session, now) : session));
    const goals = (history.goals || []).map(({ key, label, target }) => ({ key, label, target }));
    return { ...history, sessions, ...sessionTotals(sessions, goals) };
}

// Proxy side. The launcher polls every few seconds but the history only
// changes when the session store commits, so the full build runs once per
// store revision, account scope and session settings. Between builds only
// the clock is advanced. `revision` identifies the build; a caller that
// already holds it gets `unchanged` instead of the history.
function createLauncherSessionHistoryCache({ now = Date.now } = {}) {
    const epoch = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    let generation = 0;
    let cached = null;
    const gameCache = new WeakMap();

    function get(store, { limit = MAX_LAUNCHER_SESSIONS, sessionSettings = {}, account = null, accountScoped = false, knownRevision = null } = {}) {
        const key = JSON.stringify([
            store.revision(), limit, account, accountScoped, sessionGoalsFromSettings(sessionSettings),
            sessionSettings.sessionBedwarsFields, sessionSettings.sessionSkywarsFields, sessionSettings.sessionDuelsFields
        ]);
        const at = now();
        if (cached?.key !== key) {
            const history = buildLauncherSessionHistory(store.getHistory(), { now: at, limit, sessionSettings, account, accountScoped, gameCache });
            cached = { key, revision: `${epoch}:${++generation}`, history };
            return { revision: cached.revision, history };
        }
        if (knownRevision === cached.revision) return { revision: cached.revision, history: null, unchanged: true };
        return { revision: cached.revision, history: advanceSessionHistoryClock(cached.history, at) };
    }

    return { get };
}

// Main side. Keeps the last full history for one account scope and turns an
// `unchanged` reply back into the history, advanced to the current time.
// `base` is the entry whose revision was sent with the request, so a reply
// always pairs with the history it was checked against.
function createLauncherSessionHistoryReceiver({ now = Date.now } = {}) {
    let last = null;
    return {
        base(scopeKey) {
            return last?.scopeKey === scopeKey ? last : null;
        },
        accept(scopeKey, base, health) {
            const revision = typeof health?.sessionHistoryRevision === 'string' ? health.sessionHistoryRevision : null;
            if (health?.sessionHistory) {
                last = revision ? { scopeKey, revision, history: health.sessionHistory } : null;
                return health.sessionHistory;
            }
            if (health?.sessionHistoryUnchanged && revision && base?.revision === revision) {
                return advanceSessionHistoryClock(base.history, now());
            }
            return null;
        }
    };
}

module.exports = {
    MODE_DEFINITIONS,
    MAX_LAUNCHER_SESSIONS,
    MAX_LAUNCHER_GAMES,
    compactModeStats,
    compactModes,
    compactGame,
    compactSession,
    sessionMetrics,
    buildTrends,
    buildGoalProgress,
    buildLauncherSessionHistory,
    advanceSessionHistoryClock,
    createLauncherSessionHistoryCache,
    createLauncherSessionHistoryReceiver
};
