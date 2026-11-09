'use strict';

// Local session lifecycle: decides WHEN to snapshot and turns consecutive
// snapshots into session + per-game deltas.
//
// Snapshot economy is the whole design constraint. Hypixel's player endpoint
// is rate limited and shared with every other lookup the proxy makes, so this
// module takes a delayed snapshot per finished game and bounded retries (plus
// session-start/manual snapshots). A game's delta is measured
// against the PREVIOUS game-end snapshot — the "boundary" — rather than a
// fresh snapshot at game start, which reduces request pressure.
// Live observations provide the immediate match recap;
// cached or multi-match API windows never supply per-match counters.
//
// Hypixel does not publish a game's stats the instant the game ends, so the
// end-of-game capture is delayed by `gameEndDelayMs`. Everything here is
// injectable (clock, timers, fetch) so the timing rules are unit-testable
// without a live connection.

const {
    captureSessionSnapshot,
    diffSessionSnapshots,
    snapshotRegressed,
    deltaIsEmpty,
    gamePresent,
    SNAPSHOT_GAMES
} = require('./sessionSnapshot.js');
const { resolveGameResult, isOwnTeamElimination } = require('./gameResult.js');
const { createGame, observe, observeResult, localModes, FIELDS, updateGameVariant, normalizeLocal, invalidate, updateIdentity } = require('./localStats');
const { singleApiResult, apiCompletedGames, apiCountsCoverObservations, observedSessionDelta, reconciliationForSnapshot, reconciliationBaseline, weakResult } = require('./observedStats');
const { createTrailingStats } = require('./trailingStats');
const { MODE_DEFINITIONS } = require('./modeDefinitions');

const MODE_TO_GAME = {
    BEDWARS: 'Bedwars',
    SKYWARS: 'SkyWars',
    DUELS: 'Duels'
};

const DEFAULT_RESUME_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_GAME_END_DELAY_MS = 15000;
const DEFAULT_MIN_REFRESH_INTERVAL_MS = 60000;
const DEFAULT_VERIFICATION_RETRY_DELAYS_MS = [30000, 60000, 180000, 300000, 300000];

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
    apiSettleMs = 30000,
    verificationRetryDelaysMs = DEFAULT_VERIFICATION_RETRY_DELAYS_MS,
    isEnabled = () => true,
    isApiAvailable = () => true,
    getIdentity = null,
    onGameRecap = null,
    onGameVerified = null,
    logger = console
} = {}) {
    if (!store) throw new Error('createSessionTracker requires store');
    if (typeof fetchOwnStats !== 'function') throw new Error('createSessionTracker requires fetchOwnStats');

    let activeSessionId = null;
    let boundarySnapshot = null;   // baseline for the NEXT per-game delta
    let pendingGame = null;        // { mode, startedAt }
    let skipCurrentGameEnd = false; // manual finish during a live game
    let currentGameExcluded = false;
    let lastEndedSessionKey = null; // guards against a repeated end for one game
    const endTimers = new Set();
    let boundaryTimer = null;
    let verificationTimer = null;
    let verificationBatch = null;
    let reconciliationQueue = null;
    let inFlight = null;
    let snapshotGeneration = 0, inFlightGeneration = null;
    let lastRefreshAt = 0;
    let detached = false;
    const observedEnds = new Set();
    let quiescing = false, quiescence;
    const trailing = createTrailingStats({ store, now, getIdentity, isEnabled });
    const settleMs = Math.max(0,Number(apiSettleMs)||0);
    function sameModeReading(a,b,mode) {
        const key=gameForMode(mode);
        if (!a || !b || a.uuid!==b.uuid || !gamePresent(a,key) || !gamePresent(b,key)) return false;
        const left=reconciliationBaseline(a).stats[key],right=reconciliationBaseline(b).stats[key];
        const fields=new Set([...Object.keys(left),...Object.keys(right)]);
        return [...fields].every(field=>(left[field]||0)===(right[field]||0));
    }
    function modeBaseline(session,mode,fallback) {
        return session?.apiBoundaries?.[mode] || session?.games.find(game=>game.mode===mode
            && game.verificationSettled===false && game.verificationBaseline)?.verificationBaseline
            || (session?.reconciliationBaseline?.priorGameKeys?.length && gamePresent(session.reconciliationBaseline,gameForMode(mode))
                ? session.reconciliationBaseline : null) || fallback;
    }
    function acceptBoundary(sessionId,mode,snapshot) {
        const owner=store.findSession(sessionId);
        const boundary=scopedSnapshot(owner,snapshot,mode);
        store.updateApiBoundary(sessionId,mode,boundary);
        if (activeSessionId!==sessionId) return;
        boundarySnapshot=boundary;
        // An unfinished game cannot be in this API update. It may safely use
        // the now-settled previous window without losing its local counters.
        if (pendingGame?.mode===mode && !pendingGame.observed.endObserved) {
            pendingGame.baseSnapshot=boundary; saveLiveGame();
        }
        const session=store.findSession(sessionId),current=session?.localTracking?.current;
        if (session?.trackingSource==='local' && current?.mode===mode && !current.endObserved) {
            const local=normalizeLocal(session.localTracking);local.current.apiBaseline=boundary;
            store.updateLocalTracking(sessionId,local);
        }
    }
    function attachLocalSession(sessionId) {
        const session=store.findSession(sessionId),uuid=String(getIdentity?.()?.uuid||'').replace(/-/g,'').toLowerCase();
        if (!session || session.endedAt || session.trackingSource!=='local' || session.uuid!==uuid) return null;
        activeSessionId=sessionId;boundarySnapshot=session.latest||null;detached=false;
        return session;
    }
    function scopedSnapshot(session,snapshot,mode=null) {
        const current=session.trackingSource==='local'?session.localTracking?.current
            :activeSessionId===session.id?pendingGame?.observed:null;
        const completed=current?.endObserved;
        const past={...session,liveGame:null};
        if (session.trackingSource==='local') past.localTracking={...session.localTracking,current:completed?current:null};
        const prefix=observedSessionDelta(past,null)?.modes||[];
        const uncaptured=[...observedEnds].filter(context=>context.sessionId===session.id && !context.recordId).length;
        const initial=session.reconciliationBaseline||session.baseline;
        const prior=[...session.games,...[...observedEnds].filter(context=>context.sessionId===session.id && !context.recordId)]
            .filter(game=>(!mode || game.mode===mode) && game.observation && !session.apiBaselines?.[game.mode]
                && !gamePresent(initial,gameForMode(game.mode)));
        // A first readable profile does not prove that earlier games have
        // published. Keep those games inside the window; never add their
        // observed totals again as an assumed already-published prefix.
        if (prior.length) return {...reconciliationBaseline(snapshot),sequence:0,prefix:[],
            priorGameKeys:prior.map(game=>game.observation.key),
            ...(current&&!current.endObserved?{gameKey:current.key,gameMode:current.mode}:{})};
        return { ...reconciliationBaseline(snapshot),sequence:(session.gameSequence||0)+(completed?1:0)+uncaptured,prefix,
            ...(current&&!current.endObserved?{gameKey:current.key,gameMode:current.mode}:{}) };
    }
    async function captureLocalBaseline(sessionId,gameKey) {
        const session=attachLocalSession(sessionId);
        if (!session || !isEnabled() || !isApiAvailable()) return null;
        const current=session.localTracking?.current;
        if (gameKey && (!current || current.key!==gameKey || current.endObserved)) return null;
        if (!current && now()-lastRefreshAt<minRefreshIntervalMs) return null;
        const saved=current?modeBaseline(session,current.mode,current.apiBaseline):null;
        if (saved && gamePresent(saved,gameForMode(current.mode))) {
            if (!current.apiBaseline) {
                const local=normalizeLocal(session.localTracking);local.current.apiBaseline=saved;
                store.updateLocalTracking(sessionId,local);
            }
            return null;
        }
        const generation=snapshotGeneration,snapshot=await takeSnapshot();
        const latest=store.findSession(sessionId);
        if (!snapshot || generation!==snapshotGeneration || latest?.endedAt || latest?.uuid!==snapshot.uuid) return null;
        const scoped=scopedSnapshot(latest,snapshot,current?.mode);
        if (!SNAPSHOT_GAMES.some(game=>gamePresent(latest.baseline,game))) store.initializeBaseline(sessionId,scoped);
        else if (!snapshotRegressed(latest.baseline,snapshot)) store.updateLatest(sessionId,snapshot);
        boundarySnapshot=latest.latest||boundarySnapshot;lastRefreshAt=now();
        const game=latest.localTracking?.current;
        if (game && game.key===gameKey && !game.endObserved && gamePresent(snapshot,gameForMode(game.mode))) {
            store.updateApiBoundary(sessionId,game.mode,scoped);
            const local=normalizeLocal(latest.localTracking);local.current.apiBaseline=scoped;
            store.updateLocalTracking(sessionId,local);
        }
        return snapshot;
    }
    function initializeRunningBaseline(session,snapshot,game=pendingGame) {
        const scoped=scopedSnapshot(session,snapshot,game?.mode);
        if (!SNAPSHOT_GAMES.some(key=>gamePresent(session.baseline,key))) store.initializeBaseline(session.id,scoped);
        if (game && game===pendingGame && !game.observed.endObserved
            && !gamePresent(game.baseSnapshot,gameForMode(game.mode)) && gamePresent(snapshot,gameForMode(game.mode))) {
            game.baseSnapshot=scoped;store.updateApiBoundary(session.id,game.mode,scoped);saveLiveGame();
        }
    }
    async function captureApiBaseline() {
        const game=pendingGame,session=getActiveSession();
        if (!session || !game || game.observed.endObserved || !isApiAvailable()
            || gamePresent(game.baseSnapshot,gameForMode(game.mode))) return null;
        const generation=snapshotGeneration,snapshot=await takeSnapshot();
        if (!snapshot || generation!==snapshotGeneration || getActiveSession()!==session || snapshot.uuid!==session.uuid) return null;
        initializeRunningBaseline(session,snapshot,game);
        return snapshot;
    }
    function queueLocalGame(sessionId,record) {
        const session=store.findSession(sessionId);
        if (!session || !record?.observation || record.metadata?.privateGame) return record;
        const base=record.observation.apiBaseline;
        if (!base || base.uuid!==session.uuid || base.at>record.at || !gamePresent(base,gameForMode(record.mode))) return record;
        const updated=store.updateGame(sessionId,record.id,{verificationStatus:'pending',verificationSettled:false,
            observation:{...record.observation,apiBaseline:null},
            verificationBaseline:base,verificationRecoveryUntil:record.at+currentResumeWindowMs(),nextVerificationAt:now()+gameEndDelayMs});
        schedulePendingVerification();return updated;
    }
    function saveLiveGame() {
        if (activeSessionId && pendingGame) {
            pendingGame.baseSnapshot ||= boundarySnapshot || store.findSession(activeSessionId)?.baseline;
            store.updateLiveGame(activeSessionId, pendingGame);
        }
    }
    function resolveCombinedResults(session, mode, checkpoint) {
        const initial=session.reconciliationBaseline||session.baseline;
        const base=gamePresent(initial,gameForMode(mode))?initial:session.apiBaselines?.[mode];
        if (!base) return;
        const prefix=base.prefix?.find(entry=>entry.mode===mode)||{};
        const games=session.games.filter(game=>game.mode===mode && game.sequence>(base.sequence||0)
            && game.sequence<=checkpoint.throughSequence);
        // Missing/pruned details must not be allocated to the retained games.
        if (games.length!==checkpoint.values.games-(prefix.games||0)) return;
        const unresolved=games.filter(game=>weakResult(game) || (!game.result && game.observation?.endObserved));
        if (!unresolved.length) return;
        const wins=checkpoint.values.wins-(prefix.wins||0)-games.filter(game=>game.result==='win' && !unresolved.includes(game)).length;
        const losses=checkpoint.values.losses-(prefix.losses||0)-games.filter(game=>game.result==='loss' && !unresolved.includes(game)).length;
        const result=wins===unresolved.length && losses===0?'win':losses===unresolved.length && wins===0?'loss':null;
        if (!result) return;
        for (const game of unresolved) store.updateGame(session.id,game.id,{result,resultSource:'api'});
    }
    function reconcileSession(sessionId, snapshot) {
        if (reconciliationQueue) {
            const prior=reconciliationQueue.get(sessionId);
            if (!prior || prior.at<=snapshot.at) reconciliationQueue.set(sessionId,snapshot);
            return;
        }
        const session = store.findSession(sessionId);
        if (!session) return;
        const blocked = [...observedEnds].map(context => context.mode);
        if (pendingGame?.observed?.endObserved) blocked.push(pendingGame.mode);
        for (const other of store.getSessions(session.uuid)) if (other.id !== session.id && other.startedAt >= session.startedAt) {
            blocked.push(...other.games.map(game => game.mode));
            if (other.liveGame) blocked.push(other.liveGame.mode);
        }
        const totals = reconciliationForSnapshot(session, snapshot, blocked);
        if (!totals) return;
        for (const [mode,checkpoint] of Object.entries(totals)) {
            const previous=session.apiTotals?.[mode],candidate=previous?.candidate;
            const stable=previous?.throughSequence===checkpoint.throughSequence && sameModeReading(candidate?.snapshot,snapshot,mode);
            const at=stable?candidate.at:now();
            checkpoint.candidate={at,snapshot:reconciliationBaseline(snapshot)};
            checkpoint.settled=checkpoint.coversObservations && (settleMs===0 || (stable && now()-at>=settleMs));
        }
        store.updateApiTotals(sessionId, totals);
        for (const [mode,checkpoint] of Object.entries(totals)) if (checkpoint.settled) {
            resolveCombinedResults(session,mode,checkpoint);
            for (const game of [...session.games]) if (game.mode===mode && game.sequence<=checkpoint.throughSequence
                && game.verificationSettled===false) {
                store.updateGame(sessionId,game.id,{verificationSettled:true,verificationBaseline:null,
                    verificationCandidate:null,nextVerificationAt:0,
                    verificationStatus:game.verificationStatus==='verified'?'verified':'unverified'});
            }
            acceptBoundary(sessionId,mode,snapshot);
        }
    }

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

    function clearEndTimers() {
        for (const timer of endTimers) clearTimeoutImpl(timer);
        endTimers.clear();
    }

    // Completed observations belong to their original session even when a
    // reset/disconnect arrives before the delayed API capture.
    function preserveObservedEnds() {
        for (const context of observedEnds) {
            const id = context.sessionId || activeSessionId;
            const session = id && store.findSession(id);
            if (!session) continue;
            appendPendingGame(id, context, context.baseSnapshot || session.latest || session.baseline, true);
            observedEnds.delete(context);
        }
    }

    function scheduleBoundaryClose() {
        clearBoundaryTimer();
        if (detached || pendingGame || !activeSessionId) return;
        const session = store.findSession(activeSessionId);
        if (!session || session.endedAt) return;
        if (session.trackingSource==='local') return; // Its observer owns inactivity.
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
                const snapshot = captureSessionSnapshot(data, { now });
                const uuid = String(getIdentity?.()?.uuid || '').replace(/-/g, '').toLowerCase();
                if (uuid && snapshot && snapshot.uuid !== uuid) {
                    logger.warn?.('[Session] Ignoring a snapshot that does not match the connected account.');
                    return null;
                }
                return snapshot;
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
        const account = getIdentity?.();
        const uuid = String(account?.uuid || '').replace(/-/g, '').toLowerCase();
        if (activeSessionId) {
            const active = store.findSession(activeSessionId);
            if (active && !active.endedAt && (!uuid || active.uuid === uuid)
                && (pendingGame || now() - active.lastSeen < currentResumeWindowMs())) {
                return activeSessionId;
            }
            if (active && !active.endedAt) store.endSession(activeSessionId, { endedAt: active.lastSeen });
            activeSessionId = null;
            boundarySnapshot = null;
        }

        const open = snapshot => {
            store.closeExpiredSessions(currentResumeWindowMs(), snapshot.uuid);
            let session = store.findResumableSession(snapshot.uuid, currentResumeWindowMs());
            if (session?.trackingSource === 'local') { store.endSession(session.id); session = null; }
            if (!session) {
                store.closeStaleSessions(snapshot.uuid);
                session = store.startSession(snapshot);
            }
            activeSessionId = session.id;
            boundarySnapshot = session.latest || snapshot;
            return session.id;
        };
        // Save local progress while the first API request is still loading.
        // Empty presence flags cannot turn a later lifetime total into gains.
        const seed = /^[a-f0-9]{32}$/.test(uuid) && account?.name
            ? captureSessionSnapshot({ uuid, displayname: account.name, stats: {} }, { now }) : null;
        let sessionId = seed ? open(seed) : null;
        if (sessionId && !isApiAvailable()) {
            scheduleBoundaryClose();return sessionId;
        }
        const snapshot = await takeSnapshot();
        if (generation !== snapshotGeneration || !isApiAvailable()) return null;
        if (!sessionId) {
            if (!snapshot) return null;
            sessionId = open(snapshot);
        }
        const session = store.findSession(sessionId);
        if (!session || session.endedAt || activeSessionId !== sessionId
            || (snapshot && snapshot.uuid !== session.uuid)) return null;
        if (snapshot) {
            if (!SNAPSHOT_GAMES.some(game => gamePresent(session.baseline,game)) && seed) {
                store.initializeBaseline(sessionId, scopedSnapshot(session,snapshot));
                if (pendingGame && !pendingGame.observed?.endObserved
                    && !SNAPSHOT_GAMES.some(game => gamePresent(pendingGame.baseSnapshot,game))) pendingGame.baseSnapshot = snapshot;
            } else if (snapshotRegressed(session.baseline, snapshot)) {
                logger.warn?.('[Session] Baseline regressed — starting a fresh baseline.');
                store.rebaseline(sessionId, snapshot);
            } else store.updateLatest(sessionId, snapshot);
        }
        boundarySnapshot = session.latest || snapshot || seed;
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
        const projected = observedSessionDelta(session, delta);
        return projected ? { ...projected, session } : null;
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
        if (session && snapshot.uuid===session.uuid) initializeRunningBaseline(session,snapshot);
        if (session && snapshotRegressed(session.baseline, snapshot)) {
            logger.warn?.(`[Session] Snapshot regressed during ${reason} — re-baselining.`);
            store.rebaseline(sessionId, snapshot);
            boundarySnapshot = store.findSession(sessionId)?.latest || boundarySnapshot;
        } else {
            store.updateLatest(sessionId, snapshot);
            await processPendingVerifications({ suppliedSnapshot:snapshot });
            reconcileSession(sessionId, snapshot);
        }
        lastRefreshAt = now();
        return getSessionDelta();
    }

    // A confirmed waiting room is the earliest reliable automatic boundary:
    // opening the proxy or idling in a main lobby must not create a session.
    // Hosts that cannot identify a pregame can keep using onGameStart as the
    // fallback, which calls the same idempotent ensureSession path.
    function onQueueStart({ mode } = {}) {
        trailing.clear();
        if (!isEnabled() || !gameForMode(mode)) return null;
        clearBoundaryTimer();
        detached = false;
        return ensureSession().catch((error) => {
            logger.error?.('[Session] Queue baseline failed:', error?.message || error);
            return null;
        });
    }

    function confirmPreviousGameResult({ result, at, serverId = null } = {}) {
        if (!['win', 'loss'].includes(result) || !Number.isFinite(Number(at))) return null;
        const session = activeSessionId ? store.findSession(activeSessionId) : null;
        const accountUuid = String(getIdentity?.()?.uuid || '').replace(/-/g, '').toLowerCase();
        if (session?.uuid && accountUuid && session.uuid !== accountUuid) return null;
        const sameGame = entry => entry?.mode === 'BEDWARS'
            && Math.abs(Number(entry.endedAt ?? entry.at) - Number(at)) < 30000
            && (!serverId || !entry.metadata?.serverId || entry.metadata.serverId === serverId);
        const observed = [...observedEnds].find(entry => sameGame(entry)
            && (!accountUuid || !entry.sessionId || store.findSession(entry.sessionId)?.uuid === accountUuid));
        if (observed) {
            observed.manualResult = result;
            return { result, source: 'manual' };
        }
        const record = [...(session?.games || [])].reverse().find(sameGame);
        if (!record) return null;
        if (record.resultSource === 'api' || (record.result && record.resultSource !== 'manual')) {
            return { result: record.result, source: record.resultSource };
        }
        const updated = store.updateGame(session.id, record.id, { result, resultSource: 'manual' });
        // A confirmed result replaces the paused copy of this same game;
        // otherwise its old unknown result masks the saved win/loss in totals.
        if (updated && session.liveGame?.recordId === updated.id) store.updateLiveGame(session.id, null);
        return updated;
    }

    function onGameStart(options = {}) {
        const { mode, sessionKey } = options;
        if (!isEnabled()) return;
        trailing.clear();
        if (pendingGame && sessionKey && pendingGame.sessionKey === sessionKey) {
            const observed = pendingGame.observed;
            updateGameVariant(observed, options.variant);
            updateIdentity(observed, options);
            if (observed && !observed.observedFromStart && options.observedFromStart
                && now() - observed.startedAt <= 5000 && FIELDS.every(key => observed.counts[key].value === 0)) {
                pendingGame.observed = createGame({ ...options, variant: observed.variant, serverId: observed.serverId,
                    key: sessionKey, startedAt: observed.startedAt, ownName: getIdentity?.()?.name });
            }
            saveLiveGame();
            return pendingGame.sessionPromise;
        }
        currentGameExcluded = false;
        skipCurrentGameEnd = false;
        clearBoundaryTimer();
        detached = false;
        const startedAt = now();
        const hadSession=Boolean(activeSessionId);
        const sessionPromise = ensureSession().catch((error) => {
            logger.error?.('[Session] Automatic session start failed:', error?.message || error);
            return null;
        });
        let restored = null;
        if (options.resume) {
            const uuid = String(getIdentity?.()?.uuid || '').replace(/-/g, '').toLowerCase();
            const session = activeSessionId ? store.findSession(activeSessionId) : store.findResumableSession(uuid, currentResumeWindowMs());
            const same = game => game && game.mode === mode && !game.endObserved
                && (game.key === String(sessionKey) || (Number(options.startedAt) > 0 && game.startedAt === Number(options.startedAt)));
            const live = session?.liveGame;
            const prior = [...(session?.games || [])].reverse().find(game => same(game.observation) && !game.result);
            if (same(live?.observed) && (!live.recordId || !session.games.find(game => game.id === live.recordId)?.result)) restored = live;
            else if (prior) restored = { observed: prior.observation, startedAt: prior.observation.startedAt,
                recordId: prior.id, baseSnapshot: prior.verificationBaseline };
            if (restored) {
                restored = { ...restored, observed: normalizeLocal({ current: restored.observed }).current };
                invalidate(restored.observed, ['finals','beds','bedsLost','finalDeaths','kills','deaths'], 8);
                restored.observed.leftAt = 0;
                updateIdentity(restored.observed, options);
                for (const context of observedEnds) if (context.observation?.key === restored.observed.key) observedEnds.delete(context);
                lastEndedSessionKey = null;
            }
        }
        if (!restored) {
            const uuid = String(getIdentity?.()?.uuid || '').replace(/-/g, '').toLowerCase();
            const previous = activeSessionId ? store.findSession(activeSessionId) : store.findResumableSession(uuid, currentResumeWindowMs());
            if (previous?.liveGame && previous.liveGame.observed.key !== String(sessionKey)
                && ![...observedEnds].some(context => context.observation?.key === previous.liveGame.observed.key)) store.settleLiveGame(previous.id);
        }
        pendingGame = { mode: mode || null, startedAt: restored?.startedAt || startedAt, sessionPromise, sessionKey,
            baseSnapshot: restored?.baseSnapshot || modeBaseline(store.findSession(activeSessionId),mode,boundarySnapshot), recordId: restored?.recordId || null,
            observed: restored?.observed || createGame({ ...options, key: sessionKey || startedAt,
                startedAt: Number(options.startedAt) || startedAt, ownName: getIdentity?.()?.name }) };
        const starting = pendingGame;
        saveLiveGame();
        return sessionPromise.then(async sessionId => { if (pendingGame === starting) {
            const session=store.findSession(activeSessionId);
            pendingGame.baseSnapshot=modeBaseline(session,mode,pendingGame.baseSnapshot);
            if (!session?.apiBoundaries?.[mode] && gamePresent(pendingGame.baseSnapshot,gameForMode(mode))) store.updateApiBoundary(activeSessionId,mode,pendingGame.baseSnapshot);
            saveLiveGame();
            if (hadSession) await captureApiBaseline();
        } return sessionId; });
    }

    function observeLocalChat(text, context = {}) {
        if (!isEnabled() || currentGameExcluded || !pendingGame?.observed) return false;
        const modeChanged = updateGameVariant(pendingGame.observed, context.variant);
        const changed = observe(pendingGame.observed, text, { ...context, at: now() }) || modeChanged;
        if (changed || context.identityKnown === false) saveLiveGame();
        return changed;
    }

    function noteServerId(serverId) {
        if (!isEnabled() || currentGameExcluded || !pendingGame?.observed) return false;
        if (!updateIdentity(pendingGame.observed, { serverId })) return false;
        saveLiveGame(); return true;
    }

    function observeLocalResult(text) {
        if (!isEnabled() || currentGameExcluded || !pendingGame?.observed) return false;
        const changed = observeResult(pendingGame.observed, text, { at: now() });
        if (changed) saveLiveGame();
        return changed;
    }

    function excludeCurrentGame() {
        trailing.clear();
        if (activeSessionId) store.updateLiveGame(activeSessionId, null);
        currentGameExcluded = true;
        pendingGame = null;
        // Keep the last public boundary: private Bed Wars does not contribute
        // published stats, and earlier public games may still be verifying.
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
        const patch = {
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
            localModes: context.localModes || null,
            observation: context.observation || null,
            delta: null,
            verificationStatus: immediate || retryDelays.length ? 'pending' : 'unverified',
            verificationAttempts: attempts,
            verificationSettled: false,
            verificationRecoveryUntil: stamp + currentResumeWindowMs(),
            lastVerificationAt: immediate ? 0 : stamp,
            nextVerificationAt: immediate ? stamp + gameEndDelayMs : retryDelays.length ? stamp + verificationDelay(attempts) : 0,
            verificationBaseline: immediate || retryDelays.length ? baseSnapshot : null
        };
        const updated = (context.recordId && store.updateGame(sessionId, context.recordId, patch)) || store.appendGame(sessionId, patch);
        const session = store.findSession(sessionId);
        if (updated.resultSource === 'manual' && updated.result && session.liveGame?.observed.key === context.observation?.key) {
            store.updateLiveGame(sessionId, null);
        } else if (context.observation && !context.observation.endObserved && !pendingGame
            && (!session.liveGame || session.liveGame.observed.key === context.observation.key)
            && !session.games.some(game => game.at > context.endedAt)) {
            store.updateLiveGame(sessionId, { mode: context.mode, observed: context.observation,
                baseSnapshot, recordId: updated.id });
        } else if (session?.liveGame?.recordId === updated.id) store.updateLiveGame(sessionId, null);
        trailing.arm(sessionId, updated);
        return updated;
    }

    function clearVerificationTimer() {
        if (!verificationTimer) return;
        clearTimeoutImpl(verificationTimer);
        verificationTimer = null;
    }

    function pendingForAccount(includeRecovery = false) {
        const uuid = String(getIdentity?.()?.uuid || '').replace(/-/g, '').toLowerCase();
        return store.getPendingGames({includeRecovery}).filter(entry => (!uuid || entry.session.uuid === uuid) && entry.game.id !== pendingGame?.recordId
            && !(entry.session.trackingSource==='local' && entry.session.localTracking?.current?.key===entry.game.observation?.key));
    }

    function schedulePendingVerification(minWaitMs = 0) {
        clearVerificationTimer();
        if (detached || !isEnabled() || !isApiAvailable()) return;
        const next = pendingForAccount()[0];
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
            verificationBaseline: game.verificationBaseline,
            verificationSettled: false
        });
    }

    function apiWindowMatchesGame(session, game, base, snapshot, delta) {
        if (base.at>game.at || (base.sequence>=game.sequence && base.gameKey!==game.observation?.key)) return false;
        const result = singleApiResult(delta, game.mode, game.result==='draw' && game.observation?.endObserved);
        if (result==='draw') {
            const definition=MODE_DEFINITIONS.find(entry=>entry.mode===game.mode);
            if (!Number.isFinite(base.stats?.[definition.key]?.[definition.fields.games])) return false;
        }
        const sibling = session.games.some(other => other.id !== game.id && other.mode === game.mode
            && other.sequence>(base.sequence||0) && (other.at >= base.at || base.priorGameKeys?.includes(other.observation?.key)) && other.at <= snapshot.at
            && (other.durationMs >= 1000 || ['win', 'loss', 'draw'].includes(other.result)));
        const awaitingCapture = [...observedEnds].some(other => other.mode === game.mode
            && other.endedAt > base.at && other.endedAt <= snapshot.at);
        const anotherMatch = pendingGame?.mode === game.mode && pendingGame.observed?.endObserved
            && pendingGame.startedAt >= (game.endedAt || game.at);
        const localEnd=session.localTracking?.current;
        const anotherLocal=localEnd?.mode===game.mode && localEnd.endObserved && localEnd.key!==game.observation?.key;
        const anotherSession=store.getSessions(session.uuid).some(other=>other.id!==session.id
            && (other.games.some(record=>record.mode===game.mode && record.at>base.at && record.at<=snapshot.at)
                || (other.liveGame?.mode===game.mode && other.liveGame.observed?.endObserved)
                || (other.localTracking?.current?.mode===game.mode && other.localTracking.current.endObserved)));
        const weakGameOver = (!game.resultSource || game.resultSource === 'title') && game.result === 'loss'
            && game.events?.some(event => event.type === 'defeat' && event.cause === 'game_over')
            && !game.events.some(event => event.type === 'victory' || (event.type === 'defeat' && event.cause !== 'game_over')
                || isOwnTeamElimination(event, game.mode, game.metadata?.team));
        return Boolean(result && !sibling && !awaitingCapture && !anotherMatch && !anotherLocal && !anotherSession && apiCountsCoverObservations(delta, game)
            && (!game.result || game.resultSource === 'manual' || weakGameOver || result === game.result));
    }

    async function verifyPendingEntry({ session, game }, suppliedSnapshot) {
        const generation = snapshotGeneration;
        const snapshot = suppliedSnapshot === undefined ? await takeSnapshot() : suppliedSnapshot;
        if (generation !== snapshotGeneration || !isApiAvailable()) return null;
        const connected = String(getIdentity?.()?.uuid || '').replace(/-/g, '').toLowerCase();
        if (connected && session.uuid !== connected) return null;
        // Timer and manual retries may share the same fetch. Only the first
        // continuation may consume this pending record and notify chat.
        const current = store.findSession(session.id)?.games.find(entry => entry.id === game.id);
        if (pendingGame?.recordId === game.id || !current || (current.verificationStatus !== 'pending'
            && !(current.verificationSettled===false && current.verificationBaseline && current.verificationRecoveryUntil>now()))
            || current.verificationAttempts !== game.verificationAttempts) return null;
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
        if (!pendingGame && !session.endedAt && delta?.unmeasurable?.includes(gameName)
            && snapshot.present?.[gameName]) {
            // A baseline fetched during an outage had no stats for this mode.
            // Start future games from the first usable reading, without
            // pretending it can reconstruct earlier per-game counters.
            store.updateLatest(session.id, snapshot);
            if (activeSessionId === session.id) boundarySnapshot = snapshot;
        }
        if (!delta || deltaIsEmpty(delta, gameName)) {
            failPendingVerification(session.id, game);
            return null;
        }

        // Combat counters can publish before the loss. Keep the observed
        // elimination pending until the API has actually published its result.
        if (!apiWindowMatchesGame(session, game, base, snapshot, delta)) {
            // Keep a later boundary for future matches, but never slice a
            // combined window into invented per-game deltas.
            const completed = apiCompletedGames(delta, game.mode);
            const observedCount = session.games.filter(other => other.mode === game.mode
                && other.at > base.at && other.at <= snapshot.at && ['win', 'loss'].includes(other.result)).length;
            if (!pendingGame && !session.endedAt && completed > 1 && completed >= observedCount) {
                store.updateLatest(session.id, snapshot);
            }
            reconcileSession(session.id, snapshot);
            failPendingVerification(session.id, game);
            return null;
        }

        if (!session.endedAt) store.updateLatest(session.id, snapshot);
        const outcome = resolveGameResult(singleApiResult(delta,game.mode,game.result==='draw' && game.observation?.endObserved), game);
        const candidate=game.verificationCandidate;
        const stable=sameModeReading(candidate?.snapshot,snapshot,game.mode);
        if (getIdentity && game.observation && settleMs>0 && (!stable || now()-candidate.at<settleMs)) {
            const at=stable?candidate.at:now();
            const attempts=game.verificationAttempts+1,exhausted=attempts>retryDelays.length;
            const record=store.updateGame(session.id,game.id,{
                result:outcome.result,resultSource:outcome.source,
                verificationStatus:exhausted?'unverified':'pending',verificationSettled:false,
                verificationAttempts:attempts,lastVerificationAt:now(),nextVerificationAt:exhausted?0:at+settleMs,
                verificationCandidate:{ at,snapshot:reconciliationBaseline(snapshot) }
            });
            if (session.liveGame?.recordId===record.id) store.updateLiveGame(session.id,null);
            reconcileSession(session.id,snapshot);
            return null;
        }
        const record = store.updateGame(session.id, game.id, {
            delta: { stats: delta.stats, achievements: delta.achievements },
            result: outcome.result,
            resultSource: outcome.source,
            verificationStatus: 'verified',
            verificationSettled: true,
            verificationCandidate: null,
            verificationAttempts: game.verificationAttempts + 1,
            lastVerificationAt: now(),
            nextVerificationAt: 0,
            verificationBaseline: null
        });
        if (session.liveGame?.recordId === record.id) store.updateLiveGame(session.id, null);
        acceptBoundary(session.id,game.mode,snapshot);
        reconcileSession(session.id, snapshot);
        const context = {
            mode: game.mode,
            roster: game.roster,
            opponents: game.opponents,
            teammates: game.teammates,
            metadata: game.metadata,
            events: game.events
        };
        const recap = recapFor(session.id, record, delta, context);
        if (!game.localModes?.length) emitRecap(recap);
        else if (typeof onGameVerified === 'function') {
            try { onGameVerified(recap); }
            catch (error) { logger.error?.('[Session] Verification handler failed:', error?.message || error); }
        }
        scheduleBoundaryClose();
        return record;
    }

    async function processPendingVerifications({ force = false, suppliedSnapshot } = {}) {
        if (!isApiAvailable()) return null;
        if (!isEnabled()) {
            schedulePendingVerification(30000);
            return null;
        }
        if (verificationBatch) return verificationBatch;
        const selected=pendingForAccount().filter(entry=>force || entry.game.nextVerificationAt<=now());
        const due=(selected.length || suppliedSnapshot || force) ? pendingForAccount(true).filter(entry=>
            entry.game.verificationStatus!=='pending' || selected.some(item=>item.game.id===entry.game.id && item.session.id===entry.session.id)) : [];
        if (!due.length) {
            schedulePendingVerification();
            return null;
        }
        const generation = snapshotGeneration;
        verificationBatch = (async () => {
            const snapshot = suppliedSnapshot===undefined ? await takeSnapshot() : suppliedSnapshot;
            if (generation !== snapshotGeneration || !isApiAvailable()) return null;
            let first = null;
            reconciliationQueue=new Map();
            try {
                for (const entry of due) {
                    if (generation !== snapshotGeneration) break;
                    const result = await verifyPendingEntry(entry, snapshot);
                    first ||= result;
                }
            } finally {
                const queue=reconciliationQueue;reconciliationQueue=null;
                if (generation===snapshotGeneration) for (const [id,reading] of queue) reconcileSession(id,reading);
            }
            return first;
        })();
        try { return await verificationBatch; }
        finally { verificationBatch = null; schedulePendingVerification(); }
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
        return captureApiBaseline();
    }

    // The actual end-of-game capture, run after `gameEndDelayMs`.
    async function captureGameEnd(context) {
        const generation = snapshotGeneration;
        const sessionId = context.sessionId || await context.sessionPromise || await ensureSession();
        if (!sessionId || generation !== snapshotGeneration || !observedEnds.has(context)) return null;

        const session = store.findSession(sessionId);
        const base = context.baseSnapshot || boundarySnapshot || session?.latest || session?.baseline;
        if (!isApiAvailable()) {
            observedEnds.delete(context);
            const saved=appendPendingGame(sessionId,context,base,true);
            scheduleBoundaryClose();return saved;
        }
        const snapshot = await takeSnapshot();
        if (generation !== snapshotGeneration || !observedEnds.has(context)) return null;
        if (!isApiAvailable()) {
            observedEnds.delete(context);
            const saved=appendPendingGame(sessionId,context,base,true);
            scheduleBoundaryClose();return saved;
        }
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
            boundarySnapshot = store.findSession(sessionId)?.latest || boundarySnapshot;
            if (context.localModes?.length) {
                const pending = appendPendingGame(sessionId, context, base);
                schedulePendingVerification();
                scheduleBoundaryClose();
                return pending;
            }
            return null;
        }

        const gameDelta = diffSessionSnapshots(base, snapshot);
        const game = gameForMode(context.mode);
        // Session-wide movement can be useful even when it cannot safely be
        // attributed to this one game (for example, kills published first).
        if (session && gameDelta && !deltaIsEmpty(gameDelta, game)) store.updateLatest(sessionId, snapshot);
        if (getIdentity && context.observation) {
            const saved=appendPendingGame(sessionId,context,base,true);
            const verified=await verifyPendingEntry({session:store.findSession(sessionId),game:saved},snapshot);
            schedulePendingVerification();scheduleBoundaryClose();
            return verified || store.findSession(sessionId)?.games.find(game=>game.id===saved.id);
        }
        if (!gameDelta || deltaIsEmpty(gameDelta, game)
            || !apiWindowMatchesGame(session, { ...context, result: resolveGameResult(null, context).result }, base, snapshot, gameDelta)) {
            const pending = appendPendingGame(sessionId, context, base);
            schedulePendingVerification();
            scheduleBoundaryClose();
            return pending;
        }

        store.updateLatest(sessionId, snapshot);
        lastRefreshAt = now();
        boundarySnapshot = snapshot;

        const outcome = resolveGameResult(deriveResult(gameDelta, context.mode), context);
        const patch = {
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
            localModes: context.localModes || null,
            observation: context.observation || null,
            delta: { stats: gameDelta.stats, achievements: gameDelta.achievements },
            verificationStatus: 'verified',
            verificationAttempts: 1,
            lastVerificationAt: now()
        };
        const record = (context.recordId && store.updateGame(sessionId, context.recordId, patch)) || store.appendGame(sessionId, patch);
        if (context.manualResult && session.liveGame?.observed.key === context.observation?.key) store.updateLiveGame(sessionId, null);
        acceptBoundary(sessionId,context.mode,snapshot);
        trailing.arm(sessionId, record);
        reconcileSession(sessionId, snapshot);

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
        immediate = false,
        force = false
    } = {}) {
        if (quiescing || !isEnabled() || currentGameExcluded) return null;
        if (pendingGame && mode && mode !== pendingGame.mode) return null;

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
        if (!immediate && !force && !pendingGame?.observed?.endObserved && measured !== null && measured < minGameDurationMs) {
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
            baseSnapshot: pendingGame?.baseSnapshot || boundarySnapshot,
            endedAt: now()
        };
        context.recordId = pendingGame?.recordId || null;
        let observed = pendingGame?.observed || null;
        if (observed?.result && !observed.resultConflict) {
            context.events = [...events, { type: observed.result === 'win' ? 'victory' : observed.result==='draw'?'draw':'defeat',
                at: observed.endedAt || now(), ...(observed.resultFromGameOver ? { cause: 'game_over' } : {}) }];
        }
        const outcome = resolveGameResult(null, context);
        if (['win', 'loss', 'draw'].includes(outcome.result)) {
            observed ||= createGame({ mode: context.mode, key: sessionKey,
                startedAt: now() - (measured || 0), ownName: getIdentity?.()?.name, observedFromStart: false });
            observeResult(observed, outcome.result === 'win' ? 'VICTORY!' : outcome.result==='draw'?'DRAW!':'DEFEAT!', { at: now() });
            // The end result is known even if we joined too late to cover all
            // combat stats. Unobserved counters keep their unavailable flags.
            observed.counts.games = { value: 1, available: true };
            observed.counts.wins = { value: outcome.result === 'win' ? 1 : 0, available: true };
            observed.counts.losses = { value: outcome.result === 'loss' ? 1 : 0, available: true };
        }
        // Preserve each match's own chat observations even when its API
        // snapshot is delayed or overlaps another game. A later cumulative
        // API delta cannot be split safely between matches, but these local
        // counters already belong to this game's observed instance.
        updateGameVariant(observed, metadata?.variant);
        updateIdentity(observed, { ownTeam: metadata?.team, serverId: metadata?.serverId });
        if (observed && !observed.endObserved) observed.leftAt = now();
        context.observation = observed;
        if (observed && !observed.variant.unknown) {
            context.metadata = { ...metadata, variant: observed.variant.label };
        }
        if (observed?.serverId) context.metadata = { ...context.metadata, serverId: observed.serverId };
        if (observed && gameForMode(context.mode)
            && FIELDS.some(field => observed.counts[field]?.available || observed.counts[field]?.value > 0)) {
            context.localModes = localModes({ totals: { [context.mode]: observed.counts } });
        }
        pendingGame = null;
        if (activeSessionId) store.updateLiveGame(activeSessionId, observed && !observed.endObserved
            ? { mode: context.mode, observed, baseSnapshot: context.baseSnapshot, recordId: context.recordId } : null);
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
                if (record.localModes?.length) emitRecap(recapFor(sessionId, record,
                    { local: true, modes: record.localModes, spanMs: record.durationMs }, context));
                schedulePendingVerification();
                scheduleBoundaryClose();
                return record;
            };
            // In normal play the queue/start baseline already exists, so this
            // writes immediately without waiting for another network request.
            if (activeSessionId) return save(activeSessionId);
            return Promise.resolve(context.sessionPromise || ensureSession()).then(save);
        }

        if (gameEndDelayMs <= 0) return captureGameEnd(context);

        const timer = setTimeoutImpl(() => {
            endTimers.delete(timer);
            return captureGameEnd(context).catch(error => {
                logger.error?.('[Session] Game-end capture failed:', error?.message || error);
            });
        }, gameEndDelayMs);
        endTimers.add(timer);
        if (typeof timer?.unref === 'function') timer.unref();
        return null;
    }

    // Close the current session and immediately open a new one from a fresh
    // snapshot (/session reset).
    async function reset() {
        trailing.clear();
        const generation = snapshotGeneration;
        await Promise.all([...observedEnds].map(context => context.sessionPromise));
        if (generation !== snapshotGeneration) return null;
        preserveObservedEnds();
        trailing.clear();
        clearEndTimers();
        snapshotGeneration++;
        observedEnds.clear();
        skipCurrentGameEnd = Boolean(pendingGame);
        pendingGame = null;
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
        const generation = snapshotGeneration;
        if (!activeSessionId) return null;
        await refresh({ force: true, reason: 'manual_finish' });
        if (generation !== snapshotGeneration) return null;
        return end();
    }

    function end() {
        trailing.clear();
        preserveObservedEnds();
        trailing.clear();
        snapshotGeneration++;
        observedEnds.clear();
        clearBoundaryTimer();
        clearEndTimers();
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
        clearEndTimers();
        clearBoundaryTimer(); clearVerificationTimer();
        const preserve = () => {
            // Reuse the existing pending-verification record, including account
            // identity and the baseline that was already being established.
            preserveObservedEnds();
            const missingBaseline = observedEnds.size > 0;
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
        trailing.clear();
        if (pendingGame?.observed && !pendingGame.observed.endObserved) pendingGame.observed.leftAt ||= now();
        saveLiveGame();
        preserveObservedEnds();
        trailing.clear();
        snapshotGeneration++;
        observedEnds.clear();
        clearEndTimers();
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
        getObservedGameState: () => ({ ended: Boolean(pendingGame?.observed?.endObserved),
            result: pendingGame?.observed?.resultConflict ? null : pendingGame?.observed?.result || null }),
        getHistory,
        refresh,
        onQueueStart,
        confirmPreviousGameResult,
        onGameStart,
        noteServerId,
        observeLocalChat,
        observeTrailingChat: trailing.accept,
        observeLocalResult,
        excludeCurrentGame,
        onGameEnd,
        captureGameEnd,
        attachLocalSession,
        captureLocalBaseline,
        queueLocalGame,
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
