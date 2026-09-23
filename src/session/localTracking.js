'use strict';

const {FIELDS,LABELS,normalizeLocal,mergeTotals,localModes,createGame,observe,observeResult,invalidate,addVariant,nextStreak,leaveGame,settleGame}=require('./localStats');
function withLocalTracking(api, { store, getIdentity, isApiAvailable, isEnabled, now, getResumeWindowMs, resumeWindowMs, onGameRecap, setTimeoutImpl, clearTimeoutImpl }) {
    let source = null, id = null, ignored = false;
    let boundaryTimer = null;
    function clearBoundary() { if (boundaryTimer) clearTimeoutImpl(boundaryTimer); boundaryTimer = null; }
    // A live game holds the session open; a paused one (left, not yet
    // rejoined) only for the resume window after leaving.
    const live = session => Boolean(session?.localTracking?.current && !session.localTracking.current.leftAt);
    function scheduleBoundary() {
        clearBoundary(); const session = current();
        if (!session || live(session)) return;
        boundaryTimer = setTimeoutImpl(() => { boundaryTimer = null; const ending = current(); if (live(ending)) return;
            if (ending) { const endedAt = ending.lastSeen; finishGame(true); store.endSession(id, { endedAt }); } id = null;
        }, Math.max(0, session.lastSeen + windowMs() - now()));
        boundaryTimer?.unref?.();
    }
    const identity = () => {
        const account = getIdentity?.(), uuid = String(account?.uuid || '').replace(/-/g, '').toLowerCase();
        return /^[a-f0-9]{32}$/.test(uuid) && /^[A-Za-z0-9_]{2,16}$/.test(account?.name || '') ? { uuid, name: account.name } : null;
    };
    const windowMs = () => Math.max(60000, Number(getResumeWindowMs?.()) || resumeWindowMs);
    const current = () => id ? store.findSession(id) : null;
    function save(local, at = now(), sessionId = id) { if (sessionId) store.updateLocalTracking(sessionId, local, at); }
    function finishGame(partial = false, context = {}, sessionId = id) {
        const session = sessionId ? store.findSession(sessionId) : null; if (!session?.localTracking?.current) return;
        const local = normalizeLocal(session.localTracking), game = local.current;
        if (context.immediate) game.endedAt = now();
        if (partial) { game.endedAt ||= game.leftAt; settleGame(game); }
        local.totals[game.mode] = mergeTotals(local.totals[game.mode], game.counts);
        addVariant(local,game);
        local.streaks[game.mode]=nextStreak(local.streaks[game.mode],game);
        const one={totals:{[game.mode]:game.counts},variants:{},streaks:{[game.mode]:local.streaks[game.mode]}};addVariant(one,game);
        local.lastGameKey = game.key; local.current = null; save(local, game.endedAt || now(), sessionId);
        store.appendGame(sessionId, { mode: game.mode, at: game.endedAt||now(), durationMs: Math.max(0, (game.endedAt||now()) - game.startedAt),
            result:game.resultConflict||!game.counts.wins.available||!game.counts.losses.available?null:game.result,
            verificationStatus: 'local', delta: null, metadata: { ...context.metadata, observedFromStart: game.observedFromStart,variant:game.variant.label,disconnected:partial&&!game.endObserved },
            events: context.events || [], roster: context.roster || [],
            teammates: context.teammates || [], opponents: context.opponents || [],
            localModes: localModes(one) });
        if (sessionId === id) scheduleBoundary();
    }
    // Leaving mid-game: pause what can be rejoined, finish the rest.
    function leave(context = {}) {
        const session = current(); if (!session?.localTracking?.current) return null;
        const local = normalizeLocal(session.localTracking), game = local.current;
        if (leaveGame(game) === 'pause') { game.leftAt ||= now(); save(local); scheduleBoundary(); return 'paused'; }
        save(local); finishGame(true, context); return 'finished';
    }
    function resume(local) {
        if (!local.current?.leftAt) return false;
        local.current.leftAt = 0; clearBoundary(); return true;
    }
    function close(partial = true) {
        const endedId = id; finishGame(partial);
        clearBoundary();
        if (id) store.endSession(id, { endedAt: now() }); id = null;
        return endedId;
    }
    function localSource() {
        const next = !isApiAvailable() && identity() ? 'local' : 'api';
        if (source !== next) {
            if (source === 'api') { api.end(); api.detach(); }
            if (source === 'local') close();
            source = next;
        }
        return next === 'local';
    }
    function ensure() {
        if (!isEnabled()) return null;
        const account = identity(); if (!account) return null;
        let session = current();
        if (session && (session.endedAt || session.uuid !== account.uuid || (!live(session) && now() - session.lastSeen >= windowMs()))) {
            close(); session = null;
        }
        if (session) return id;
        // Sessions closed by the store never saw their last game; settle it
        // first so an abandoned game is counted, not left raw.
        const settleOpen = (keep, expiredOnly) => store.getSessions(account.uuid).filter(item => item.id !== keep && !item.endedAt
            && item.localTracking?.current && (!expiredOnly || now() - item.lastSeen >= windowMs())).forEach(item => finishGame(true, {}, item.id));
        settleOpen(null, true);
        store.closeExpiredSessions(windowMs(), account.uuid);
        session = store.findResumableSession(account.uuid, windowMs());
        if (session?.trackingSource !== 'local') { if (session) store.endSession(session.id); session = null; }
        if (session) {
            id = session.id;
            // A saved live game means the connection dropped mid-game. Keep it
            // paused so rejoining continues it; otherwise it settles later.
            const local = normalizeLocal(session.localTracking);
            if (local.current && !local.current.leftAt) {
                const paused = leaveGame(local.current) === 'pause';
                if (paused) local.current.leftAt = session.lastSeen; else local.current.endedAt ||= session.lastSeen;
                save(local, session.lastSeen); if (!paused) finishGame(true);
            }
        } else {
            settleOpen(null, false);
            store.closeStaleSessions(account.uuid);
            id = store.startSession({ ...account, at: now(), trackingSource: 'local' }).id;
        }
        scheduleBoundary();
        return id;
    }
    function start(options = {}) {
        if (!LABELS[options.mode] || !ensure()) return null;
        clearBoundary();
        ignored = false;
        const local = normalizeLocal(current().localTracking);
        const key = String(options.sessionKey || `${options.mode}:${now()}`);
        if (local.current?.key === key) {
            // A sidebar may arrive just before the actual start message.
            // Upgrade coverage only at that start, before any activity.
            if(!local.current.observedFromStart&&options.observedFromStart&&now()-local.current.startedAt<=5000&&!local.current.endObserved&&FIELDS.every(k=>local.current.counts[k].value===0)){
                local.current=createGame({...options,key,startedAt:local.current.startedAt,ownName:identity().name});save(local);
            } else if (resume(local)) save(local);
            return id;
        }
        if (local.lastGameKey === key) return id;
        if (local.current) finishGame(true);
        const next = normalizeLocal(current().localTracking);
        clearBoundary();
        next.current = createGame({ ...options, key, startedAt: now(), ownName: identity().name }); save(next);
        return id;
    }
    function delta() {
        const session = current(); if (!session) return null;
        return { ...require('./sessionStore').sessionDeltaFor(session), spanMs: Math.max(0, now() - session.startedAt), session };
    }
    const facade = { ...api };
    facade.ensureSession = async () => localSource() ? ensure() : api.ensureSession();
    facade.onQueueStart = options => localSource() ? null : api.onQueueStart(options);
    facade.onGameStart = options => localSource() ? start(options) : api.onGameStart(options);
    facade.observeLocalChat = (text, context = {}) => {
        if (!localSource() || !isEnabled() || ignored) return;
        // A new connection first reattaches to a paused game it may be rejoining.
        if (!current()?.localTracking?.current && ensure() && !current()?.localTracking?.current) start({ ...context, observedFromStart: false });
        const local = normalizeLocal(current()?.localTracking);
        // In-game chat after leaving means the player rejoined that game.
        const resumed = resume(local);
        const changed = observe(local.current, text, {...context,at:now()});
        if (resumed || changed || (local.current && context.identityKnown === false)) save(local);
    };
    facade.observeLocalResult = text => {
        if (!localSource() || !isEnabled() || ignored || !current()?.localTracking?.current) return;
        const local = normalizeLocal(current().localTracking);
        if(!observeResult(local.current,text,{at:now()}))return false;
        resume(local);save(local);return true;
    };
    facade.onGameEnd = (options = {}) => {
        if (!localSource()) return api.onGameEnd(options);
        if (ignored || !current()?.localTracking?.current) return null;
        if(options.mode&&options.mode!==current().localTracking.current.mode)return null;
        // Match-state flicker cannot create another game or discard counters.
        if (Number(options.durationMs) < 30000 && !options.force && !current().localTracking.current.endObserved) return null;
        if (current().localTracking.current.endObserved) finishGame(false, options);
        else if (leave(options) === 'paused') { store.flush(); return id; }
        if (onGameRecap) onGameRecap({ delta: delta(), sessionDelta: delta(), mode: options.mode, game: {BEDWARS:'Bedwars',SKYWARS:'SkyWars',DUELS:'Duels'}[options.mode], record: { durationMs: options.durationMs } });
        store.flush(); return id;
    };
    facade.getActiveSession = () => localSource() ? current() : api.getActiveSession();
    facade.getActiveSessionId = () => facade.getActiveSession()?.id || null;
    facade.getSessionDelta = () => localSource() ? delta() : api.getSessionDelta();
    facade.getHistory = () => identity() ? store.getHistory(identity().uuid) : [];
    facade.refresh = async options => localSource() ? (ensure(), delta()) : api.refresh(options);
    facade.reset = async () => { if (!localSource()) return api.reset(); close(); ignored = true; return ensure(); };
    facade.finish = async () => { if (!localSource()) return api.finish(); ignored = true; const endedId = close(); store.flush(); return endedId; };
    facade.end = () => { if (!localSource()) return api.end(); ignored = true; return close(); };
    // Disconnecting is leaving: a rejoinable game stays paused for the next
    // connection, which resumes or settles it.
    facade.quiesce = () => { if (source === 'local') { leave(); clearBoundary(); id = null; store.flush(); } return api.quiesce(); };
    facade.detach = () => { if (source === 'local') { leave(); clearBoundary(); id = null; store.flush(); } api.detach(); };
    facade.refreshSettings = () => { if (!localSource()) return api.refreshSettings(); if (!isEnabled()) close(); else scheduleBoundary(); };
    facade.resumePendingRetries = () => { if (!localSource()) api.resumePendingRetries(); };
    facade.processPendingVerifications = options => localSource() ? null : api.processPendingVerifications(options);
    return facade;
}
module.exports = { FIELDS, normalizeLocal, localModes, createGame, observe, invalidate, withLocalTracking };
