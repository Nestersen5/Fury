'use strict';

// Local session lifecycle: decides WHEN to snapshot and turns consecutive
// snapshots into session + per-game deltas.
//
// Snapshot economy is the whole design constraint. Hypixel's player endpoint
// is rate limited and shared with every other lookup the proxy makes, so this
// module takes exactly one snapshot per finished game (plus one at session
// start and one per throttled manual /session). A game's delta is measured
// against the PREVIOUS game-end snapshot — the "boundary" — rather than a
// fresh snapshot at game start, which halves the API cost with no loss of
// accuracy for completed games.
//
// Hypixel does not publish a game's stats the instant the game ends, so the
// end-of-game capture is delayed by `gameEndDelayMs`. Everything here is
// injectable (clock, timers, fetch) so the timing rules are unit-testable
// without a live connection.

const {
    captureSessionSnapshot,
    diffSessionSnapshots,
    snapshotRegressed,
    deltaIsEmpty
} = require('./sessionSnapshot.js');
const { resolveGameResult, isOwnTeamElimination } = require('./gameResult.js');

const MODE_TO_GAME = {
    BEDWARS: 'Bedwars',
    SKYWARS: 'SkyWars',
    DUELS: 'Duels'
};

const DEFAULT_RESUME_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_GAME_END_DELAY_MS = 15000;
const DEFAULT_MIN_REFRESH_INTERVAL_MS = 60000;
const DEFAULT_VERIFICATION_RETRY_DELAYS_MS = [15000, 30000, 60000, 120000];

// The proxy's game state is driven by scoreboard text, which flickers: a
// pregame lobby can be re-detected moments after a game activates, and
// enterBedwarsPregame() calls resetMatchState() whenever that happens. That
// produces a "game ended" a second or two after it began. No real BedWars,
// SkyWars, or Duels game is over this fast, so a shorter one is a state-machine
// artefact — ending it would emit a 0s recap for a game still being played.
const DEFAULT_MIN_GAME_DURATION_MS = 30000;

function gameForMode(mode) {
    return MODE_TO_GAME[String(mode || '').toUpperCase()] || null;
}

// Win/loss straight off the delta — no scoreboard parsing needed, and it is
// correct for every mode that increments wins/losses.
function deriveResult(delta, mode) {
    const game = gameForMode(mode);
    if (!delta || !game) return null;
    const stats = delta.stats?.[game] || {};
    const wins = Object.keys(stats).some(key => /(^|_)wins(_|$)/.test(key) && stats[key] > 0);
    const losses = Object.keys(stats).some(key => /(^|_)losses(_|$)/.test(key) && stats[key] > 0);
    if (wins && !losses) return 'win';
    if (losses && !wins) return 'loss';
    return null;
}

function createSessionTracker({
    store,
    fetchOwnStats,
    now = Date.now,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    resumeWindowMs = DEFAULT_RESUME_WINDOW_MS,
    getResumeWindowMs = null,
    gameEndDelayMs = DEFAULT_GAME_END_DELAY_MS,
    minRefreshIntervalMs = DEFAULT_MIN_REFRESH_INTERVAL_MS,
    minGameDurationMs = DEFAULT_MIN_GAME_DURATION_MS,
    verificationRetryDelaysMs = DEFAULT_VERIFICATION_RETRY_DELAYS_MS,
    isEnabled = () => true,
    isApiAvailable = () => true,
    getIdentity = null,
    onGameRecap = null,
    logger = console
} = {}) {
    if (!store) throw new Error('createSessionTracker requires store');
    if (typeof fetchOwnStats !== 'function') throw new Error('createSessionTracker requires fetchOwnStats');

    let activeSessionId = null;
    let boundarySnapshot = null;   // baseline for the NEXT per-game delta
    let pendingGame = null;        // { mode, startedAt }
    let skipCurrentGameEnd = false; // manual finish during a live game
    let lastEndedSessionKey = null; // guards against a repeated end for one game
    let endTimer = null;
    let boundaryTimer = null;
    let verificationTimer = null;
    let inFlight = null;
    let snapshotGeneration = 0, inFlightGeneration = null;
    let lastRefreshAt = 0;
    let detached = false;
    const observedEnds = new Set();
    let quiescing = false, quiescence;

    const retryDelays = (Array.isArray(verificationRetryDelaysMs) ? verificationRetryDelaysMs : [])
        .map(value => Math.max(0, Number(value) || 0));

    function currentResumeWindowMs() {
        const dynamic = typeof getResumeWindowMs === 'function' ? Number(getResumeWindowMs()) : NaN;
        return Math.max(60000, Number.isFinite(dynamic) ? dynamic : Number(resumeWindowMs) || DEFAULT_RESUME_WINDOW_MS);
    }

    function clearBoundaryTimer() {
        if (!boundaryTimer) return;
        clearTimeoutImpl(boundaryTimer);
        boundaryTimer = null;
    }

    function scheduleBoundaryClose() {
        clearBoundaryTimer();
        if (detached || pendingGame || !activeSessionId) return;
        const session = store.findSession(activeSessionId);
        if (!session || session.endedAt) return;
        const dueAt = (Number(session.lastSeen) || now()) + currentResumeWindowMs();
        boundaryTimer = setTimeoutImpl(() => {
            boundaryTimer = null;
            if (pendingGame || !activeSessionId) return;
            const current = store.findSession(activeSessionId);
            if (!current || current.endedAt) return;
            if (now() - current.lastSeen < currentResumeWindowMs()) {
                scheduleBoundaryClose();
                return;
            }
            store.endSession(activeSessionId, { endedAt: current.lastSeen });
            activeSessionId = null;
            boundarySnapshot = null;
        }, Math.max(0, dueAt - now()));
        if (typeof boundaryTimer?.unref === 'function') boundaryTimer.unref();
    }

    async function takeSnapshot() {
        if (!isApiAvailable()) return null;
        if (inFlight && inFlightGeneration === snapshotGeneration) return inFlight;
        const generation = snapshotGeneration;
        inFlightGeneration = generation;
        inFlight = (async () => {
            try {
                const data = await fetchOwnStats();
                if (generation !== snapshotGeneration || !isApiAvailable()) return null;
                return captureSessionSnapshot(data, { now });
            } catch (error) {
                logger.error?.('[Session] Snapshot fetch failed:', error?.message || error);
                return null;
            } finally {
                if (inFlightGeneration === generation) inFlight = null;
            }
        })();
        return inFlight;
    }

    // Resume the most recent open session for this account, or open a new one.
    // A regressed snapshot (different account, stat rollback) re-baselines
    // rather than reporting nonsense negatives.
    async function ensureSession() {
        const generation = snapshotGeneration;
        if (activeSessionId) {
            const active = store.findSession(activeSessionId);
            if (active && !active.endedAt && now() - active.lastSeen < currentResumeWindowMs()) {
                return activeSessionId;
            }
            if (active && !active.endedAt) store.endSession(activeSessionId, { endedAt: active.lastSeen });
            activeSessionId = null;
            boundarySnapshot = null;
        }

        const snapshot = await takeSnapshot();
        if (!snapshot || generation !== snapshotGeneration || !isApiAvailable()) return null;

        store.closeExpiredSessions(currentResumeWindowMs(), snapshot.uuid);
        let resumable = store.findResumableSession(snapshot.uuid, currentResumeWindowMs());
        if (resumable?.trackingSource === 'local') { store.endSession(resumable.id); resumable = null; }
        if (resumable) {
            activeSessionId = resumable.id;
            if (snapshotRegressed(resumable.baseline, snapshot)) {
                logger.warn?.('[Session] Baseline regressed — starting a fresh baseline.');
                store.rebaseline(activeSessionId, snapshot);
            } else {
                store.updateLatest(activeSessionId, snapshot);
            }
        } else {
            // Nothing resumable: close anything still open for this account so
            // abandoned sessions get a real end time and drop their snapshots
            // instead of lingering in the history list.
            store.closeStaleSessions(snapshot.uuid);
            activeSessionId = store.startSession(snapshot).id;
        }

        boundarySnapshot = store.findSession(activeSessionId)?.latest || snapshot;
        lastRefreshAt = now();
        scheduleBoundaryClose();
        return activeSessionId;
    }

    function getActiveSession() {
        return activeSessionId ? store.findSession(activeSessionId) : null;
    }

    // Current session delta, built from the snapshots already on disk. Pure
    // read — never triggers a fetch, so the card renders instantly.
    function getSessionDelta() {
        const session = getActiveSession();
        if (!session) return null;
        const delta = diffSessionSnapshots(session.baseline, session.latest);
        if (!delta) return null;
        return { ...delta, session };
    }

    async function refresh({ force = false, reason = 'manual' } = {}) {
        if (!isEnabled()) return null;
        const generation = snapshotGeneration;
        if (!force && now() - lastRefreshAt < minRefreshIntervalMs) return getSessionDelta();

        const sessionId = await ensureSession();
        if (!sessionId) return null;

        const snapshot = await takeSnapshot();
        if (!snapshot || generation !== snapshotGeneration || !isApiAvailable()) return getSessionDelta();

        const session = store.findSession(sessionId);
        if (session && snapshotRegressed(session.baseline, snapshot)) {
            logger.warn?.(`[Session] Snapshot regressed during ${reason} — re-baselining.`);
            store.rebaseline(sessionId, snapshot);
            boundarySnapshot = snapshot;
        } else {
            store.updateLatest(sessionId, snapshot);
        }
        lastRefreshAt = now();
        return getSessionDelta();
    }

    // A confirmed waiting room is the earliest reliable automatic boundary:
    // opening the proxy or idling in a main lobby must not create a session.
    // Hosts that cannot identify a pregame can keep using onGameStart as the
    // fallback, which calls the same idempotent ensureSession path.
    function onQueueStart({ mode } = {}) {
        if (!isEnabled() || !gameForMode(mode)) return null;
        clearBoundaryTimer();
        detached = false;
        return ensureSession().catch((error) => {
            logger.error?.('[Session] Queue baseline failed:', error?.message || error);
            return null;
        });
    }

    function onGameStart({ mode } = {}) {
        if (!isEnabled()) return;
        skipCurrentGameEnd = false;
        clearBoundaryTimer();
        detached = false;
        const startedAt = now();
        const sessionPromise = ensureSession().catch((error) => {
            logger.error?.('[Session] Automatic session start failed:', error?.message || error);
            return null;
        });
        pendingGame = { mode: mode || null, startedAt, sessionPromise };
        return sessionPromise;
    }

    function recapFor(sessionId, record, delta, context) {
        return {
            record,
            delta,
            sessionDelta: activeSessionId === sessionId ? getSessionDelta() : null,
            mode: context.mode || null,
            game: gameForMode(context.mode),
            roster: context.roster || []
        };
    }

    function emitRecap(recap) {
        if (typeof onGameRecap !== 'function') return;
        try {
            onGameRecap(recap);
        } catch (error) {
            logger.error?.('[Session] Recap handler failed:', error?.message || error);
        }
    }

    function verificationDelay(attempts) {
        if (!retryDelays.length) return 0;
        return retryDelays[Math.min(retryDelays.length - 1, Math.max(0, attempts - 1))];
    }

    function appendPendingGame(sessionId, context, baseSnapshot, immediate = false) {
        const attempts = immediate ? 0 : 1;
        const stamp = now();
        const outcome = resolveGameResult(null, context);
        return store.appendGame(sessionId, {
            at: context.endedAt || stamp,
            mode: context.mode || null,
            durationMs: context.durationMs || 0,
            result: outcome.result,
            resultSource: outcome.source,
            opponents: context.opponents || [],
            teammates: context.teammates || [],
            roster: context.roster || [],
            metadata: context.metadata || null,
            events: context.events || [],
            delta: null,
            verificationStatus: immediate || retryDelays.length ? 'pending' : 'unverified',
            verificationAttempts: attempts,
            lastVerificationAt: immediate ? 0 : stamp,
            nextVerificationAt: immediate ? stamp + gameEndDelayMs : retryDelays.length ? stamp + verificationDelay(attempts) : 0,
            verificationBaseline: immediate || retryDelays.length ? baseSnapshot : null
        });
    }

    function clearVerificationTimer() {
        if (!verificationTimer) return;
        clearTimeoutImpl(verificationTimer);
        verificationTimer = null;
    }

    function schedulePendingVerification(minWaitMs = 0) {
        clearVerificationTimer();
        if (detached || !isEnabled() || !isApiAvailable()) return;
        const next = store.getPendingGames()[0];
        if (!next) return;
        const waitMs = Math.max(Math.max(0, Number(minWaitMs) || 0), next.game.nextVerificationAt - now());
        verificationTimer = setTimeoutImpl(() => {
            verificationTimer = null;
            processPendingVerifications().catch((error) => {
                logger.error?.('[Session] Pending verification failed:', error?.message || error);
                schedulePendingVerification();
            });
        }, waitMs);
        if (typeof verificationTimer?.unref === 'function') verificationTimer.unref();
    }

    function failPendingVerification(sessionId, game) {
        const attempts = game.verificationAttempts + 1;
        const exhausted = attempts > retryDelays.length;
        return store.updateGame(sessionId, game.id, {
            verificationStatus: exhausted ? 'unverified' : 'pending',
            verificationAttempts: attempts,
            lastVerificationAt: now(),
            nextVerificationAt: exhausted ? 0 : now() + verificationDelay(attempts),
            verificationBaseline: exhausted ? null : game.verificationBaseline
        });
    }

    async function verifyPendingEntry({ session, game }) {
        const generation = snapshotGeneration;
        const snapshot = await takeSnapshot();
        if (generation !== snapshotGeneration || !isApiAvailable()) return null;
        if (!snapshot) {
            failPendingVerification(session.id, game);
            return null;
        }

        // A pending record belongs to the account that created its baseline.
        // Do not burn retries if another account is currently connected.
        if (session.uuid && snapshot.uuid && session.uuid !== snapshot.uuid) {
            store.updateGame(session.id, game.id, {
                nextVerificationAt: now() + verificationDelay(game.verificationAttempts)
            });
            return null;
        }

        const base = game.verificationBaseline;
        if (!base || snapshotRegressed(base, snapshot)) {
            failPendingVerification(session.id, game);
            return null;
        }
        const delta = diffSessionSnapshots(base, snapshot);
        const gameName = gameForMode(game.mode);
        if (!delta || deltaIsEmpty(delta, gameName)) {
            failPendingVerification(session.id, game);
            return null;
        }

        // Combat counters can publish before the loss. Keep the observed
        // elimination pending until the API has actually published its result.
        if (game.events.some(event => isOwnTeamElimination(event, game.mode, game.metadata?.team))
            && deriveResult(delta, game.mode) !== 'loss') {
            failPendingVerification(session.id, game);
            return null;
        }

        if (!session.endedAt) store.updateLatest(session.id, snapshot);
        if (activeSessionId === session.id) boundarySnapshot = snapshot;
        const outcome = resolveGameResult(deriveResult(delta, game.mode), game);
        const record = store.updateGame(session.id, game.id, {
            delta: { stats: delta.stats, achievements: delta.achievements },
            result: outcome.result,
            resultSource: outcome.source,
            verificationStatus: 'verified',
            verificationAttempts: game.verificationAttempts + 1,
            lastVerificationAt: now(),
            nextVerificationAt: 0,
            verificationBaseline: null
        });
        const context = {
            mode: game.mode,
            roster: game.roster,
            opponents: game.opponents,
            teammates: game.teammates,
            metadata: game.metadata,
            events: game.events
        };
        emitRecap(recapFor(session.id, record, delta, context));
        scheduleBoundaryClose();
        return record;
    }

    async function processPendingVerifications({ force = false } = {}) {
        if (!isApiAvailable()) return null;
        if (!isEnabled()) {
            schedulePendingVerification(30000);
            return null;
        }
        const next = store.getPendingGames().find(entry => force || entry.game.nextVerificationAt <= now());
        if (!next) {
            schedulePendingVerification();
            return null;
        }
        const result = await verifyPendingEntry(next);
        schedulePendingVerification();
        return result;
    }

    function resumePendingRetries() {
        detached = false;
        schedulePendingVerification();
    }

    function refreshSettings() {
        if (!isEnabled()) {
            end();
            clearVerificationTimer();
            return;
        }
        detached = false;
        scheduleBoundaryClose();
        schedulePendingVerification();
    }

    // The actual end-of-game capture, run after `gameEndDelayMs`.
    async function captureGameEnd(context) {
        const generation = snapshotGeneration;
        const sessionId = await context.sessionPromise || await ensureSession();
        if (!sessionId || generation !== snapshotGeneration || !isApiAvailable()) return null;

        const session = store.findSession(sessionId);
        const base = context.baseSnapshot || boundarySnapshot || session?.latest || session?.baseline;
        const snapshot = await takeSnapshot();
        if (generation !== snapshotGeneration || !isApiAvailable()) return null;
        observedEnds.delete(context);
        if (!snapshot) {
            const pending = appendPendingGame(sessionId, context, base);
            schedulePendingVerification();
            scheduleBoundaryClose();
            return pending;
        }

        if (session && snapshotRegressed(session.baseline, snapshot)) {
            logger.warn?.('[Session] Snapshot regressed at game end — re-baselining.');
            store.rebaseline(sessionId, snapshot);
            boundarySnapshot = snapshot;
            return null;
        }

        const gameDelta = diffSessionSnapshots(base, snapshot);
        const game = gameForMode(context.mode);
        if (!gameDelta || deltaIsEmpty(gameDelta, game)) {
            const pending = appendPendingGame(sessionId, context, base);
            schedulePendingVerification();
            scheduleBoundaryClose();
            return pending;
        }

        store.updateLatest(sessionId, snapshot);
        lastRefreshAt = now();
        boundarySnapshot = snapshot;

        const outcome = resolveGameResult(deriveResult(gameDelta, context.mode), context);
        const record = store.appendGame(sessionId, {
            at: context.endedAt || now(),
            mode: context.mode || null,
            // 0 means "unknown" downstream — the card omits the duration
            // rather than claiming a 0s game.
            durationMs: context.durationMs || 0,
            result: outcome.result,
            resultSource: outcome.source,
            opponents: context.opponents || [],
            teammates: context.teammates || [],
            roster: context.roster || [],
            metadata: context.metadata || null,
            events: context.events || [],
            delta: { stats: gameDelta.stats, achievements: gameDelta.achievements },
            verificationStatus: 'verified',
            verificationAttempts: 1,
            lastVerificationAt: now()
        });

        const recap = recapFor(sessionId, record, gameDelta, context);
        emitRecap(recap);
        scheduleBoundaryClose();
        return recap;
    }

    // `durationMs` may be supplied by the host (the proxy tracks its own
    // authoritative gameStartTime); otherwise it is derived from onGameStart.
    // `sessionKey` identifies the game being ended so a repeated end for the
    // same game is ignored rather than emitting a second recap.
    function onGameEnd({
        mode,
        roster = [],
        teammates = [],
        opponents = null,
        metadata = null,
        events = [],
        durationMs = null,
        sessionKey = null,
        immediate = false
    } = {}) {
        if (quiescing || !isEnabled()) return null;

        if (skipCurrentGameEnd) {
            skipCurrentGameEnd = false;
            pendingGame = null;
            return null;
        }

        if (sessionKey !== null && sessionKey === lastEndedSessionKey) return null;

        const startedAt = pendingGame?.startedAt || 0;
        const measured = Number.isFinite(Number(durationMs)) && Number(durationMs) > 0
            ? Number(durationMs)
            : (startedAt ? Math.max(0, now() - startedAt) : null);

        // Too short to be a real game: a scoreboard flicker re-entering the
        // pregame state. Leave `pendingGame` intact so the genuine end still
        // reports the full duration.
        if (!immediate && measured !== null && measured < minGameDurationMs) {
            logger.warn?.(`[Session] Ignoring a ${Math.round(measured / 1000)}s "game end" — too short to be real.`);
            return null;
        }

        if (sessionKey !== null) lastEndedSessionKey = sessionKey;

        const context = {
            mode: mode || pendingGame?.mode || null,
            durationMs: measured,
            roster,
            teammates: teammates.length
                ? teammates
                : roster.filter(entry => entry?.relation === 'teammate').map(entry => entry?.name).filter(Boolean),
            opponents: Array.isArray(opponents)
                ? opponents
                : roster.filter(entry => entry?.relation !== 'teammate' && entry?.relation !== 'self')
                    .map(entry => entry?.name).filter(Boolean),
            metadata,
            events,
            sessionPromise: pendingGame?.sessionPromise || null,
            baseSnapshot: boundarySnapshot,
            endedAt: now()
        };
        pendingGame = null;
        context.sessionId = activeSessionId;
        observedEnds.add(context);

        if (immediate) {
            const generation = snapshotGeneration;
            const save = sessionId => {
                if (!sessionId || generation !== snapshotGeneration) return null;
                observedEnds.delete(context);
                const session = store.findSession(sessionId);
                const record = appendPendingGame(sessionId, context,
                    context.baseSnapshot || session?.latest || session?.baseline, true);
                store.flush();
                schedulePendingVerification();
                scheduleBoundaryClose();
                return record;
            };
            // In normal play the queue/start baseline already exists, so this
            // writes immediately without waiting for another network request.
            if (activeSessionId) return save(activeSessionId);
            return Promise.resolve(context.sessionPromise || ensureSession()).then(save);
        }

        if (endTimer) {
            clearTimeoutImpl(endTimer);
            endTimer = null;
        }

        if (gameEndDelayMs <= 0) return captureGameEnd(context);

        endTimer = setTimeoutImpl(() => {
            endTimer = null;
            captureGameEnd(context).catch(error => {
                logger.error?.('[Session] Game-end capture failed:', error?.message || error);
            });
        }, gameEndDelayMs);
        if (typeof endTimer?.unref === 'function') endTimer.unref();
        return null;
    }

    // Close the current session and immediately open a new one from a fresh
    // snapshot (/session reset).
    async function reset() {
        snapshotGeneration++;
        observedEnds.clear();
        if (activeSessionId) store.endSession(activeSessionId);
        clearBoundaryTimer();
        activeSessionId = null;
        boundarySnapshot = null;
        lastRefreshAt = 0;
        return ensureSession();
    }

    // Manual finish: take one last fresh snapshot so the final session card
    // includes stats earned since the previous game boundary, then close it.
    async function finish() {
        if (!activeSessionId) return null;
        await refresh({ force: true, reason: 'manual_finish' });
        return end();
    }

    function end() {
        snapshotGeneration++;
        observedEnds.clear();
        clearBoundaryTimer();
        if (endTimer) {
            clearTimeoutImpl(endTimer);
            endTimer = null;
        }
        // Do not let a game which was already underway leak into a newly
        // automatic session after the player explicitly ended this one.
        skipCurrentGameEnd = Boolean(pendingGame);
        if (activeSessionId) store.endSession(activeSessionId);
        const endedId = activeSessionId;
        activeSessionId = null;
        boundarySnapshot = null;
        pendingGame = null;
        lastRefreshAt = 0;
        return endedId;
    }

    // Connection teardown: stop timers, keep the session open on disk so the
    // next connect inside the resume window continues it.
    function quiesce() {
        if (quiescing) return quiescence;
        quiescing = true;
        if (endTimer) { clearTimeoutImpl(endTimer); endTimer = null; }
        clearBoundaryTimer(); clearVerificationTimer();
        const preserve = () => {
            let missingBaseline = false;
            // Reuse the existing pending-verification record, including account
            // identity and the baseline that was already being established.
            for (const context of observedEnds) {
                const id = context.sessionId || activeSessionId;
                const session = id && store.findSession(id);
                if (session) appendPendingGame(id, context, context.baseSnapshot || session.latest || session.baseline, true);
                else missingBaseline = true;
            }
            observedEnds.clear();
            detach();
            if (missingBaseline) throw new Error('Observed game end could not establish its session baseline.');
        };
        const pending = [...observedEnds].filter(context => !context.sessionId && !activeSessionId && context.sessionPromise).map(context => context.sessionPromise);
        if (pending.length) quiescence = Promise.all(pending).then(preserve);
        else preserve();
        return quiescence;
    }

    function detach() {
        snapshotGeneration++;
        observedEnds.clear();
        if (endTimer) {
            clearTimeoutImpl(endTimer);
            endTimer = null;
        }
        clearBoundaryTimer();
        clearVerificationTimer();
        detached = true;
        pendingGame = null;
        activeSessionId = null;
        boundarySnapshot = null;
        store.flush();
    }

    // Past sessions for this account, newest first, each with a ready delta.
    // Pure read — never triggers a fetch.
    function getHistory() {
        const uuid = getActiveSession()?.uuid || null;
        return store.getHistory(uuid);
    }

    const api = {
        ensureSession,
        getActiveSession,
        getActiveSessionId: () => activeSessionId,
        getSessionDelta,
        getHistory,
        refresh,
        onQueueStart,
        onGameStart,
        onGameEnd,
        captureGameEnd,
        processPendingVerifications,
        resumePendingRetries,
        refreshSettings,
        reset,
        finish,
        end,
        detach,
        quiesce
    };
    return typeof getIdentity === 'function' ? require('./localTracking').withLocalTracking(api, {
        store, getIdentity, isApiAvailable, isEnabled, now, getResumeWindowMs, resumeWindowMs, onGameRecap, setTimeoutImpl, clearTimeoutImpl
    }) : api;
}

module.exports = {
    createSessionTracker,
    deriveResult,
    gameForMode,
    MODE_TO_GAME,
    DEFAULT_RESUME_WINDOW_MS,
    DEFAULT_GAME_END_DELAY_MS,
    DEFAULT_MIN_REFRESH_INTERVAL_MS,
    DEFAULT_VERIFICATION_RETRY_DELAYS_MS
};
