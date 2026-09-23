'use strict';

// Persistence for local session tracking (session_data.json).
//
// Follows the denick-history idiom: read through a JsonFileCache so a corrupt
// or missing file degrades to an empty store, write through the off-thread
// JSON writer on a debounce so a busy game never blocks the packet loop.
//
// Storage shape:
//   { version: 1, sessions: [ …oldest → newest… ] }
//
// Only the ACTIVE session carries full baseline/latest snapshots (~30KB of
// flat numbers). Finalizing a session collapses those to the computed delta
// and drops the snapshots, so the retained history stays small no matter how
// many sessions accumulate.

const { JsonFileCache } = require('../storage/json_file_cache.js');
const { diffSessionSnapshots } = require('./sessionSnapshot.js');
const { hasCardStatMovement, pruneEmptyModeStats } = require('./cardStatsPolicy');
const { dedupeGameEvents, MAX_GAME_EVENTS } = require('./gameEvents.js');
const { RESULT_SOURCES } = require('./gameResult.js');

const STORE_VERSION = 4;
// Ended sessions collapse to a small summary (snapshots dropped), so keeping
// a long history costs very little — roughly a few hundred bytes each.
const DEFAULT_MAX_SESSIONS = 50;
const DEFAULT_MAX_GAMES_PER_SESSION = 250;
const DEFAULT_SAVE_DELAY_MS = 2000;

function normalizeGameRecord(raw = {}) {
    const at = Number(raw.at) || 0;
    const status = ['verified', 'pending', 'unverified', 'local'].includes(raw.verificationStatus)
        ? raw.verificationStatus
        : 'verified';
    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : (at ? `g${at.toString(36)}` : null),
        at,
        mode: typeof raw.mode === 'string' ? raw.mode : null,
        durationMs: Math.max(0, Number(raw.durationMs) || 0),
        result: typeof raw.result === 'string' ? raw.result : null,
        resultSource: RESULT_SOURCES.includes(raw.resultSource) ? raw.resultSource : null,
        opponents: Array.isArray(raw.opponents) ? raw.opponents.slice(0, 32).map(String) : [],
        teammates: Array.isArray(raw.teammates) ? raw.teammates.slice(0, 16).map(String) : [],
        roster: (Array.isArray(raw.roster) ? raw.roster : []).slice(0, 32).map(player => ({
            name: typeof player?.name === 'string' ? player.name : null,
            realName: typeof player?.realName === 'string' && /^[A-Za-z0-9_]{2,16}$/.test(player.realName)
                ? player.realName
                : null,
            display: typeof player?.display === 'string' ? player.display.replace(/[\r\n]/g, '').slice(0, 64) : null,
            nicked: Boolean(player?.nicked),
            uuid: typeof player?.uuid === 'string' ? player.uuid : null,
            team: typeof player?.team === 'string' ? player.team.slice(0, 24) : null,
            relation: ['self', 'teammate', 'opponent', 'unknown'].includes(player?.relation)
                ? player.relation
                : 'unknown'
        })).filter(player => player.name),
        metadata: raw.metadata && typeof raw.metadata === 'object' ? {
            serverId: typeof raw.metadata.serverId === 'string' ? raw.metadata.serverId.slice(0, 80) : null,
            map: typeof raw.metadata.map === 'string' ? raw.metadata.map.slice(0, 80) : null,
            variant: typeof raw.metadata.variant === 'string' ? raw.metadata.variant.slice(0, 80) : null,
            team: typeof raw.metadata.team === 'string' ? raw.metadata.team.slice(0, 24) : null,
            party: Array.isArray(raw.metadata.party) ? raw.metadata.party.slice(0, 16).map(String) : [],
            observedFromStart: raw.metadata.observedFromStart !== false,
            disconnected: Boolean(raw.metadata.disconnected)
        } : null,
        events: dedupeGameEvents(Array.isArray(raw.events) ? raw.events.slice(-MAX_GAME_EVENTS) : []),
        delta: raw.delta && typeof raw.delta === 'object' ? raw.delta : null,
        verificationStatus: status,
        localModes: status === 'local' && Array.isArray(raw.localModes) ? raw.localModes : null,
        verificationAttempts: Math.max(0, Number(raw.verificationAttempts) || 0),
        nextVerificationAt: Math.max(0, Number(raw.nextVerificationAt) || 0),
        lastVerificationAt: Math.max(0, Number(raw.lastVerificationAt) || 0),
        verificationBaseline: status === 'pending' && raw.verificationBaseline && typeof raw.verificationBaseline === 'object'
            ? raw.verificationBaseline
            : null
    };
}

// Collapse a live session's snapshots into the stored summary shape.
function summarizeSession(session) {
    const delta = diffSessionSnapshots(session?.baseline, session?.latest);
    const summary = delta ? {
        stats: delta.stats,
        achievements: delta.achievements,
        spanMs: delta.spanMs,
        networkExp: delta.networkExp,
        karma: delta.karma
    } : session?.summary || null;
    return pruneEmptyModeStats(recoverSessionSummary(session, summary));
}

// Late API verification can arrive after the session snapshots were collapsed.
// Recover only missing game-mode summaries; never add to an existing total.
function recoverSessionSummary(session, summary = session?.summary || null) {
    const modeKeys = { BEDWARS: 'Bedwars', SKYWARS: 'SkyWars', DUELS: 'Duels' };
    const recovered = {};
    for (const game of session?.games || []) {
        const key = modeKeys[game.mode];
        if (!key || hasCardStatMovement(key, summary?.stats?.[key])) continue;
        const stats = game.delta?.stats?.[key];
        if (hasCardStatMovement(key, stats)) {
            const totals = recovered[key] ||= {};
            for (const [field, value] of Object.entries(stats)) {
                if (typeof value === 'number' && Number.isFinite(value)) totals[field] = (totals[field] || 0) + value;
            }
        } else if (['win', 'loss'].includes(game.result)) {
            const field = `${game.result === 'win' ? 'wins' : 'losses'}${key === 'Bedwars' ? '_bedwars' : ''}`;
            const totals = recovered[key] ||= {};
            totals[field] = (totals[field] || 0) + 1;
        }
    }
    return Object.keys(recovered).length ? { ...summary, stats: { ...summary?.stats, ...recovered } } : summary;
}

function sessionHasCardStats(session, summary = summarizeSession(session)) {
    if (session?.trackingSource === 'local') {
        const { localModes, FIELDS } = require('./localTracking');
        return localModes(session.localTracking).some(mode => FIELDS.some(field => Number.isFinite(mode[field]) && mode[field] > 0));
    }
    return ['Bedwars', 'SkyWars', 'Duels'].some(key => hasCardStatMovement(key, summary?.stats?.[key]));
}

// For destructive cleanup, missing data is not evidence of zero. Ignore timing
// metadata and inspect only recorded stat deltas, never lifetime snapshots.
function sessionHasOnlyZeroStats(session, summary = summarizeSession(session)) {
    if (session?.trackingSource === 'local') {
        const { localModes, FIELDS } = require('./localTracking');
        const modes = localModes(session.localTracking);
        return modes.length > 0 && modes.every(mode => FIELDS.every(field => mode[field] === 0));
    }
    const games = session?.games || [];
    if (games.some(game => ['pending','unverified'].includes(game.verificationStatus))) return false;
    if (!summary?.stats || typeof summary.stats !== 'object') return false;
    const nonzero = value => typeof value === 'number' ? !Number.isFinite(value) || value !== 0
        : value && typeof value === 'object' ? Object.values(value).some(nonzero) : false;
    if (nonzero(summary.stats) || nonzero(summary.achievements) || nonzero(summary.networkExp) || nonzero(summary.karma)) return false;
    return games.every(game => !['win','loss'].includes(game.result) && game.delta?.stats &&
        !nonzero(game.delta.stats) && !nonzero(game.delta.achievements));
}

function hasPositiveStatGain(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'number' || typeof value === 'string') {
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric > 0;
    }
    if (Array.isArray(value)) return value.some(hasPositiveStatGain);
    if (typeof value === 'object') return Object.values(value).some(hasPositiveStatGain);
    return false;
}

function sessionHasPositiveStatGain(session, summary = session?.summary || null) {
    if (hasPositiveStatGain(summary?.stats) || hasPositiveStatGain(summary?.achievements)) return true;
    return (Array.isArray(session?.games) ? session.games : []).some(game => (
        hasPositiveStatGain(game?.delta?.stats) || hasPositiveStatGain(game?.delta?.achievements)
    ));
}

// Empty starts and wholly unverified zero-stat attempts add no useful history.
// Pending games stay temporarily so their API retries can still recover a
// result or stat delta after the session itself has ended.
function shouldDiscardCompletedSession(session, summary = session?.summary || null) {
    if (session?.trackingSource === 'local') {
        if (sessionHasCardStats(session, summary)) return false;
        if (sessionHasOnlyZeroStats(session, summary)) return true;
        // Retain partial observations for diagnosis; they are hidden from cards.
        return !require('./localTracking').localModes(session.localTracking).length;
    }
    const games = Array.isArray(session?.games) ? session.games : [];
    if (sessionHasCardStats(session, recoverSessionSummary(session, summary))) return false;
    if (games.some(game => game?.verificationStatus === 'pending')) return false;
    if (!summary?.stats && games.some(game => game?.verificationStatus === 'unverified')) return false;
    if (!games.length) return true;
    return !sessionHasCardStats(session, recoverSessionSummary(session, summary));
}

// One delta shape for both live and closed sessions, so history rendering
// does not have to care which it is looking at.
function sessionDeltaFor(session) {
    if (!session) return null;
    if (session.trackingSource === 'local') return {
        local: true, modes: require('./localTracking').localModes(session.localTracking),
        from: session.startedAt, to: session.endedAt || session.lastSeen,
        spanMs: Math.max(0, (session.endedAt || session.lastSeen) - session.startedAt),
        stats: {}, achievements: {}, root: { delta: { stats: {}, achievements: {} } }
    };
    if (session.summary) {
        const summary = recoverSessionSummary(session);
        const stats = summary.stats || {};
        const achievements = summary.achievements || {};
        return {
            from: session.startedAt,
            to: session.endedAt || session.lastSeen,
            spanMs: Number(session.summary.spanMs) || 0,
            networkExp: Number(session.summary.networkExp) || 0,
            karma: Number(session.summary.karma) || 0,
            achievements,
            stats,
            root: { delta: { stats, achievements } }
        };
    }
    return diffSessionSnapshots(session.baseline, session.latest);
}

function normalizeSession(raw = {}, maxGames = DEFAULT_MAX_GAMES_PER_SESSION) {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
    if (!id) return null;
    return {
        id,
        uuid: typeof raw.uuid === 'string' ? raw.uuid : null,
        name: typeof raw.name === 'string' ? raw.name : null,
        startedAt: Number(raw.startedAt) || 0,
        lastSeen: Number(raw.lastSeen) || Number(raw.startedAt) || 0,
        endedAt: Number(raw.endedAt) || 0,
        trackingSource: raw.trackingSource === 'local' ? 'local' : 'api',
        localTracking: raw.trackingSource === 'local' ? require('./localTracking').normalizeLocal(raw.localTracking) : null,
        baseline: raw.baseline && typeof raw.baseline === 'object' ? raw.baseline : null,
        latest: raw.latest && typeof raw.latest === 'object' ? raw.latest : null,
        summary: raw.summary && typeof raw.summary === 'object' ? raw.summary : null,
        games: (Array.isArray(raw.games) ? raw.games : [])
            .map(normalizeGameRecord)
            .filter(game => game.at > 0)
            .slice(-maxGames)
    };
}

function normalizeStore(raw, maxSessions, maxGames) {
    const rows = Array.isArray(raw?.sessions) ? raw.sessions : (Array.isArray(raw) ? raw : []);
    let sessions = rows
        .map(row => normalizeSession(row, maxGames))
        .filter(session => Boolean(session) && (!session.endedAt || !shouldDiscardCompletedSession(session, session.summary)))
        .sort((a, b) => a.startedAt - b.startedAt);
    if (Number.isFinite(maxSessions) && maxSessions > 0) {
        // Retention belongs to each account, so playing on one never prunes another.
        const counts = new Map();
        sessions = sessions.slice().reverse().filter(session => {
            const key = String(session.uuid || session.name || '').replace(/-/g, '').toLowerCase();
            const count = (counts.get(key) || 0) + 1;
            counts.set(key, count);
            return count <= maxSessions;
        }).reverse();
    }
    return { version: STORE_VERSION, sessions };
}

function createSessionStore({
    sessionFile,
    writeJsonOffThread,
    now = Date.now,
    maxSessions = DEFAULT_MAX_SESSIONS,
    maxGamesPerSession = DEFAULT_MAX_GAMES_PER_SESSION,
    getMaxSessions = null,
    saveDelayMs = DEFAULT_SAVE_DELAY_MS,
    logger = console
} = {}) {
    if (!sessionFile) throw new Error('createSessionStore requires sessionFile');
    if (typeof writeJsonOffThread !== 'function') {
        throw new Error('createSessionStore requires writeJsonOffThread');
    }

    const cache = new JsonFileCache(sessionFile, {
        fallback: () => ({ version: STORE_VERSION, sessions: [] }),
        checkIntervalMs: 1000,
        publicationAware: true,
        transform: raw => normalizeStore(raw, maxSessionCount(), maxGamesPerSession)
    });

    let saveTimer = null;
    let dirty = false;
    let pendingWrite = null;
    let persistenceFailure = null;
    let lastPublication = null;
    let persistedRevision = 0;
    let sequence = 0;
    let gameSequence = 0;
    const transientSessions = new Map();
    // Bumped by every commit and every reload of the file, so a reader can
    // tell whether anything it built from the store is still current.
    let revision = 0;
    let loadedStore = null;

    function maxSessionCount() {
        const dynamic = typeof getMaxSessions === 'function' ? Number(getMaxSessions()) : NaN;
        const value = Number.isFinite(dynamic) ? dynamic : Number(maxSessions);
        if (value === 0) return Number.POSITIVE_INFINITY;
        return Math.max(1, Math.min(1000, Math.round(value) || DEFAULT_MAX_SESSIONS));
    }

    function load() {
        // Dirty memory owns accepted mutations. A published older snapshot is
        // not an external edit allowed to replace them. Resume disk reloads
        // once the accepted generation and its acknowledgement have settled.
        const store = (dirty || pendingWrite) && cache.hasValue ? cache.value : cache.get();
        if (store !== loadedStore) {
            loadedStore = store;
            revision += 1;
            lastPublication = null;
        }
        if (!transientSessions.size) return store;
        // An atomic write changes the cache stamp. Reloading the smaller disk
        // history must not lose live baselines deliberately held only in memory.
        const ids = new Set(store.sessions.map(session => session.id));
        for (const session of transientSessions.values()) {
            if (!ids.has(session.id)) store.sessions.push(session);
        }
        return store;
    }

    async function flush({ strict = false, onlyPending = false } = {}) {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        try {
            // Serialize this owner's publications, including callbacks. This
            // also lets a shutdown flush join an older write before queueing
            // the latest accepted generation, BEFORE jsonWriter seals admission.
            while (pendingWrite) await pendingWrite;
            if (persistenceFailure) throw persistenceFailure;
            if (onlyPending && !dirty) return;
            const store = load();
            if (dirty && !cache.isCurrentPublication()) {
                throw new Error('Session history changed externally while local changes were pending. Save refused; local changes remain only in memory.');
            }
            // Empty live starts remain in memory for tracking, not on disk.
            // Pending API verification is durable so delayed stats can recover.
            const sessions = store.sessions.filter(session => !shouldDiscardCompletedSession(session, summarizeSession(session)));
            const persistedIds = new Set(sessions.map(session => session.id));
            transientSessions.clear();
            for (const session of store.sessions) {
                if (!session.endedAt && !persistedIds.has(session.id)) transientSessions.set(session.id, session);
            }
            const acceptedRevision = revision;
            let complete;
            const operation = new Promise(resolve => { complete = resolve; });
            pendingWrite = operation;
            dirty = false;
            let acknowledged = false;
            const acknowledge = (error, publication) => {
                if (acknowledged) return;
                acknowledged = true;
                try {
                    if (error) throw new Error('Session history persistence failed.');
                    cache.markWritten(publication);
                    lastPublication = publication;
                    persistedRevision = acceptedRevision;
                } catch (error) {
                    persistenceFailure ||= error;
                    dirty = true;
                }
                if (pendingWrite === operation) pendingWrite = null;
                complete();
            };
            try {
                writeJsonOffThread(sessionFile, { ...store, sessions }, 'SessionStore', acknowledge, { publication: true });
            } catch (error) { acknowledge(error); }
            await operation;
            if (pendingWrite === operation) pendingWrite = null;
            if (persistenceFailure) throw persistenceFailure;
        } catch (error) {
            persistenceFailure ||= error;
            logger.error?.('[Session] Failed to queue save:', error?.message || error);
            if (strict) throw error;
        }
    }

    function verifyPersistence() {
        if (persistenceFailure) throw persistenceFailure;
        if (dirty || pendingWrite || (lastPublication && persistedRevision !== revision)) {
            throw new Error('Session history has unpersisted accepted changes.');
        }
        if (lastPublication && !cache.isCurrentPublication(lastPublication.stamp)) {
            throw new Error('Session history changed after its final publication. Shutdown cannot acknowledge persistence.');
        }
    }

    function scheduleSave() {
        if (saveDelayMs <= 0) return flush();
        if (saveTimer) return;
        saveTimer = setTimeout(() => {
            saveTimer = null;
            flush();
        }, saveDelayMs);
        if (typeof saveTimer.unref === 'function') saveTimer.unref();
    }

    function commit(store) {
        dirty = true;
        const limit = maxSessionCount();
        if (Number.isFinite(limit)) {
            const counts = new Map();
            store.sessions = store.sessions.slice().reverse().filter(session => {
                const key = String(session.uuid || session.name || '').replace(/-/g, '').toLowerCase();
                const count = (counts.get(key) || 0) + 1;
                counts.set(key, count);
                return count <= limit;
            }).reverse();
        }
        const retainedIds = new Set(store.sessions.map(session => session.id));
        for (const id of transientSessions.keys()) if (!retainedIds.has(id)) transientSessions.delete(id);
        cache.set(store);
        loadedStore = store;
        revision += 1;
        scheduleSave();
        return store;
    }

    function nextSessionId(timestamp) {
        sequence += 1;
        return `s${timestamp.toString(36)}${sequence.toString(36)}`;
    }

    function nextGameId(timestamp) {
        gameSequence += 1;
        return `g${timestamp.toString(36)}${gameSequence.toString(36)}`;
    }

    function findSession(sessionId) {
        return load().sessions.find(session => session.id === sessionId) || null;
    }

    // Most recent session for this account that is still open and was touched
    // within `resumeWindowMs`. Anything older is left closed so a new play
    // session starts from a fresh baseline.
    function findResumableSession(uuid, resumeWindowMs) {
        if (!uuid) return null;
        const cutoff = now() - Math.max(0, Number(resumeWindowMs) || 0);
        const candidates = load().sessions.filter(session => (
            session.uuid === uuid
            && !session.endedAt
            && session.lastSeen >= cutoff
            && (session.baseline || session.trackingSource === 'local')
        ));
        return candidates.length ? candidates[candidates.length - 1] : null;
    }

    function startSession(snapshot, { name = null } = {}) {
        const store = load();
        const at = Number(snapshot?.at) || now();
        const session = {
            id: nextSessionId(at),
            uuid: snapshot?.uuid || null,
            name: name || snapshot?.name || null,
            startedAt: at,
            lastSeen: at,
            endedAt: 0,
            trackingSource: snapshot?.trackingSource === 'local' ? 'local' : 'api',
            localTracking: snapshot?.trackingSource === 'local' ? require('./localTracking').normalizeLocal() : null,
            baseline: snapshot || null,
            latest: snapshot || null,
            summary: null,
            games: []
        };
        store.sessions.push(session);
        commit(store);
        return session;
    }

    function updateLatest(sessionId, snapshot) {
        const store = load();
        const session = store.sessions.find(item => item.id === sessionId);
        if (!session) return null;
        session.latest = snapshot || session.latest;
        session.lastSeen = Number(snapshot?.at) || now();
        if (snapshot?.name) session.name = snapshot.name;
        commit(store);
        return session;
    }

    function updateLocalTracking(sessionId, tracking, at = now()) {
        const store = load(), session = store.sessions.find(item => item.id === sessionId);
        if (!session || session.endedAt || session.trackingSource !== 'local') return null;
        session.localTracking = require('./localTracking').normalizeLocal(tracking);
        session.lastSeen = Math.max(session.lastSeen, Number(at) || now());
        commit(store);
        return session;
    }

    // Re-baseline in place: used when a snapshot regresses (account switch,
    // stale baseline). Keeps the session row but restarts its arithmetic.
    function rebaseline(sessionId, snapshot) {
        const store = load();
        const session = store.sessions.find(item => item.id === sessionId);
        if (!session) return null;
        session.baseline = snapshot || null;
        session.latest = snapshot || null;
        session.startedAt = Number(snapshot?.at) || now();
        session.lastSeen = session.startedAt;
        session.games = [];
        commit(store);
        return session;
    }

    function appendGame(sessionId, record) {
        const store = load();
        const session = store.sessions.find(item => item.id === sessionId);
        if (!session) return null;
        const at = Number(record?.at) || now();
        const game = normalizeGameRecord({ ...record, id: record?.id || nextGameId(at), at });
        session.games.push(game);
        session.games = session.games.slice(-maxGamesPerSession);
        session.lastSeen = Math.max(session.lastSeen, game.at);
        commit(store);
        return game;
    }

    function updateGame(sessionId, gameId, patch = {}) {
        const store = load();
        const session = store.sessions.find(item => item.id === sessionId);
        if (!session) return null;
        const index = session.games.findIndex(game => game.id === gameId);
        if (index < 0) return null;
        const updated = normalizeGameRecord({ ...session.games[index], ...patch, id: gameId });
        session.games[index] = updated;
        if (updated.at) session.lastSeen = Math.max(session.lastSeen, updated.at);
        if (session.endedAt && shouldDiscardCompletedSession(session, session.summary)) {
            store.sessions = store.sessions.filter(item => item.id !== sessionId);
        }
        commit(store);
        return updated;
    }

    function getPendingGames() {
        const pending = [];
        load().sessions.forEach((session) => {
            session.games.forEach((game) => {
                if (game.verificationStatus === 'pending') pending.push({ session, game });
            });
        });
        return pending.sort((a, b) => a.game.nextVerificationAt - b.game.nextVerificationAt || a.game.at - b.game.at);
    }

    // Close a session and collapse its snapshots to the computed delta. This
    // is what makes long history cheap: the two ~30KB snapshots go away and
    // only the (sparse) delta survives.
    function endSession(sessionId, { endedAt = null } = {}) {
        const store = load();
        const session = store.sessions.find(item => item.id === sessionId);
        if (!session) return null;
        const summary = summarizeSession(session);
        if (shouldDiscardCompletedSession(session, summary)) {
            store.sessions = store.sessions.filter(item => item.id !== sessionId);
            commit(store);
            return null;
        }
        session.summary = summary;
        session.endedAt = Number(endedAt) || now();
        session.baseline = null;
        session.latest = null;
        commit(store);
        return session;
    }

    // Close every other open session for this account. Called when a fresh
    // session starts, so abandoned sessions (past the resume window) don't sit
    // open forever holding their snapshots and polluting the history list.
    function closeStaleSessions(uuid, exceptId = null) {
        if (!uuid) return 0;
        const store = load();
        const stale = store.sessions.filter(session => (
            session.uuid === uuid && !session.endedAt && session.id !== exceptId
        ));
        if (!stale.length) return 0;
        const stamp = now();
        const discarded = new Set();
        stale.forEach((session) => {
            const summary = summarizeSession(session);
            if (shouldDiscardCompletedSession(session, summary)) {
                discarded.add(session.id);
                return;
            }
            session.summary = summary;
            // Credit the close to when it was last seen, not to now — the
            // session really ended whenever the player stopped playing.
            session.endedAt = session.lastSeen || stamp;
            session.baseline = null;
            session.latest = null;
        });
        if (discarded.size) store.sessions = store.sessions.filter(session => !discarded.has(session.id));
        commit(store);
        return stale.length;
    }

    function closeExpiredSessions(maxInactiveMs, uuid = null) {
        const windowMs = Math.max(0, Number(maxInactiveMs) || 0);
        if (!windowMs) return 0;
        const cutoff = now() - windowMs;
        const store = load();
        const expired = store.sessions.filter(session => (
            !session.endedAt
            && session.lastSeen > 0
            && session.lastSeen <= cutoff
            && (!uuid || session.uuid === uuid)
        ));
        if (!expired.length) return 0;
        const discarded = new Set();
        expired.forEach((session) => {
            const summary = summarizeSession(session);
            if (shouldDiscardCompletedSession(session, summary)) {
                discarded.add(session.id);
                return;
            }
            session.summary = summary;
            session.endedAt = session.lastSeen;
            session.baseline = null;
            session.latest = null;
        });
        if (discarded.size) store.sessions = store.sessions.filter(session => !discarded.has(session.id));
        commit(store);
        return expired.length;
    }

    // Newest first. Every entry carries a usable delta whether it is the live
    // session (computed from snapshots) or a closed one (stored summary).
    function getHistory(uuid = null) {
        return getSessions(uuid)
            .slice()
            .sort((a, b) => b.startedAt - a.startedAt)
            .map(session => ({
                session,
                delta: sessionDeltaFor(session),
                active: !session.endedAt
            }))
            .filter(entry => Boolean(entry.delta));
    }

    function getSessions(uuid = null) {
        const sessions = load().sessions;
        return uuid ? sessions.filter(session => session.uuid === uuid) : sessions.slice();
    }

    function getLastGame(uuid = null) {
        const sessions = getSessions(uuid);
        for (let index = sessions.length - 1; index >= 0; index -= 1) {
            const games = sessions[index].games;
            if (games.length) return games[games.length - 1];
        }
        return null;
    }

    function removeSession(sessionId, { allowActive = false, account = null } = {}) {
        const id = String(sessionId || '').trim();
        if (!id) return { removed: false, reason: 'invalid' };
        const store = load();
        const index = store.sessions.findIndex(session => session.id === id);
        if (index < 0) return { removed: false, reason: 'not_found' };
        if (account && !require('../accounts/launcherAccounts').sessionBelongsToAccount(store.sessions[index], account)) return { removed: false, reason: 'not_found' };
        if (!allowActive && !store.sessions[index].endedAt) {
            return { removed: false, reason: 'active', session: store.sessions[index] };
        }
        const [session] = store.sessions.splice(index, 1);
        commit(store);
        return { removed: true, session, remaining: store.sessions.length };
    }

    function clear(uuid = null) {
        const store = load();
        store.sessions = uuid ? store.sessions.filter(session => session.uuid !== uuid) : [];
        commit(store);
        return store.sessions.length;
    }

    function getRevision() {
        load();
        return revision;
    }

    return {
        load,
        revision: getRevision,
        flush,
        verifyPersistence,
        findSession,
        findResumableSession,
        startSession,
        updateLatest,
        updateLocalTracking,
        rebaseline,
        appendGame,
        updateGame,
        getPendingGames,
        endSession,
        closeStaleSessions,
        closeExpiredSessions,
        getHistory,
        getSessions,
        getLastGame,
        removeSession,
        clear,
        cache
    };
}

module.exports = {
    sessionHasOnlyZeroStats,
    createSessionStore,
    normalizeStore,
    normalizeSession,
    normalizeGameRecord,
    summarizeSession,
    recoverSessionSummary,
    sessionHasCardStats,
    sessionDeltaFor,
    hasPositiveStatGain,
    sessionHasPositiveStatGain,
    shouldDiscardCompletedSession,
    STORE_VERSION,
    DEFAULT_MAX_SESSIONS,
    DEFAULT_MAX_GAMES_PER_SESSION,
    DEFAULT_SAVE_DELAY_MS
};
