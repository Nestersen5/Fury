'use strict';

const {FIELDS,LABELS,normalizeLocal,mergeTotals,localModes,createGame,observe,observeResult,invalidate,addVariant,nextStreak,leaveGame,settleGame,updateGameVariant,updateIdentity}=require('./localStats');
const { createTrailingStats } = require('./trailingStats');
function withLocalTracking(api, { store, getIdentity, isApiAvailable, isEnabled, now, getResumeWindowMs, resumeWindowMs, onGameRecap, setTimeoutImpl, clearTimeoutImpl }) {
    let source = null, id = null, ignored = false;
    let boundaryTimer = null;
    const trailing = createTrailingStats({ store, now, getIdentity, isEnabled });
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
    function save(local, at = now(), sessionId = id) { return sessionId ? store.updateLocalTracking(sessionId, local, at) : null; }
    function finishGame(partial = false, context = {}, sessionId = id) {
        const session = sessionId ? store.findSession(sessionId) : null; if (!session?.localTracking?.current) return;
        const local = normalizeLocal(session.localTracking), game = local.current;
        updateIdentity(game, { ownTeam: context.metadata?.team });
        updateGameVariant(game, context.metadata?.variant);
        if (context.immediate) game.endedAt = now();
        if (partial) { game.endedAt ||= game.leftAt; settleGame(game); }
        local.totals[game.mode] = mergeTotals(local.totals[game.mode], game.counts);
        addVariant(local,game);
        local.streaks[game.mode]=nextStreak(local.streaks[game.mode],game);
        const one={totals:{[game.mode]:game.counts},variants:{},streaks:{[game.mode]:local.streaks[game.mode]}};addVariant(one,game);
        local.lastGameKey = game.key; local.current = null; save(local, game.endedAt || now(), sessionId);
        let record = store.appendGame(sessionId, { mode: game.mode, at: game.endedAt||now(), durationMs: Math.max(0, (game.endedAt||now()) - game.startedAt),
            result:game.resultConflict?null:game.result,
            verificationStatus: 'local', delta: null, metadata: { ...context.metadata, serverId: game.serverId || context.metadata?.serverId || null,
                observedFromStart: game.observedFromStart,variant:game.variant.unknown?null:game.variant.label,disconnected:partial&&!game.endObserved },
            events: context.events || [], roster: context.roster || [],
            teammates: context.teammates || [], opponents: context.opponents || [],
            localModes: localModes(one), observation: game });
        record = api.queueLocalGame(sessionId,record);
        trailing.arm(sessionId, record);
        if (sessionId === id) scheduleBoundary();
        return record;
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
        invalidate(local.current,['finals','beds','bedsLost','finalDeaths','kills','deaths'],8);
        local.current.leftAt = 0; clearBoundary(); return true;
    }
    function close(partial = true) {
        const endedId = id; finishGame(partial);
        trailing.clear();
        clearBoundary();
        if (id) {
            if (api.getActiveSessionId()===id) api.end();
            else store.endSession(id, { endedAt: now() });
        }
        id = null;
        return endedId;
    }
    function localSource() {
        // API availability controls requests, not the owner of an existing game
        // or session. Both observers keep their existing persistence contracts.
        const account=identity();
        if (source===null && account) {
            const saved=store.findResumableSession(account.uuid,windowMs());
            if (saved?.trackingSource==='local') { source='local';return true; }
            if (saved?.trackingSource==='api') { source='api';return false; }
        }
        if (source==='local' && current() && !current().endedAt && current().uuid===account?.uuid) return true;
        const tracked=api.getActiveSession();
        if (source==='api' && tracked && !tracked.endedAt && tracked.uuid===account?.uuid) return false;
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
        api.attachLocalSession(id);
        return id;
    }
    function start(options = {}) {
        trailing.clear();
        if (!LABELS[options.mode] || !ensure()) return null;
        clearBoundary();
        ignored = false;
        const local = normalizeLocal(current().localTracking);
        const key = String(options.sessionKey || `${options.mode}:${now()}`);
        if (local.current?.key === key || (options.resume && local.current?.mode === options.mode
            && Number(options.startedAt) > 0 && local.current.startedAt === Number(options.startedAt))) {
            const modeChanged = updateGameVariant(local.current, options.variant);
            const identityChanged = updateIdentity(local.current, options);
            // A sidebar may arrive just before the actual start message.
            // Upgrade coverage only at that start, before any activity.
            if(!local.current.observedFromStart&&options.observedFromStart&&now()-local.current.startedAt<=5000&&!local.current.endObserved&&FIELDS.every(k=>local.current.counts[k].value===0)){
                local.current=createGame({...options,variant:local.current.variant,serverId:local.current.serverId,key,startedAt:local.current.startedAt,ownName:identity().name});save(local);
            } else {
                const resumed = resume(local);
                if (resumed || modeChanged || identityChanged) save(local);
            }
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
    facade.getResumableGame = ({ mode, serverId, startedAt } = {}) => {
        const account = identity();
        if (!account || (!serverId && !startedAt) || !isEnabled()) return null;
        const session = store.findResumableSession(account.uuid, windowMs());
        const raw = session?.trackingSource === 'local' ? session.localTracking?.current : session?.liveGame?.observed;
        const game = normalizeLocal({ current: raw }).current;
        if (!game || game.endObserved || game.mode !== mode) return null;
        if (game.serverId && serverId ? game.serverId !== serverId : !(startedAt > 0 && game.startedAt === startedAt)) return null;
        return { key: game.key, startedAt: game.startedAt, variant: game.variant?.unknown ? null : game.variant?.label,
            standardBedwars: game.standardBedwars };
    };
    facade.noteServerId = serverId => {
        if (!isEnabled()) return false;
        if (!localSource()) return api.noteServerId(serverId);
        const session = current();
        if (!session?.localTracking?.current || session.uuid !== identity()?.uuid) return false;
        const local = normalizeLocal(session.localTracking);
        if (!updateIdentity(local.current, { serverId })) return false;
        save(local); return true;
    };
    facade.ensureSession = async () => localSource() ? ensure() : api.ensureSession();
    facade.onQueueStart = options => {
        trailing.clear();
        if (!localSource()) return api.onQueueStart(options);
        if (!isEnabled() || options?.mode !== 'BEDWARS') return null;
        const session = current();
        if (!session?.localTracking?.current || session.localTracking.current.mode !== 'BEDWARS') return null;
        const local = normalizeLocal(session.localTracking), game = local.current;
        const previousStreak = local.streaks.BEDWARS || null;
        const previousCoverage = {
            wins: local.totals.BEDWARS?.wins.available !== false,
            losses: local.totals.BEDWARS?.losses.available !== false,
            games: local.totals.BEDWARS?.games.available !== false
        };
        const variantCoverage = local.variants.BEDWARS?.[game.variant.id]?.counts;
        const previousVariantCoverage = {
            wins: variantCoverage?.wins.available !== false,
            losses: variantCoverage?.losses.available !== false,
            games: variantCoverage?.games.available !== false
        };
        if (!game.endObserved) {
            settleGame(game);
            game.endObserved = true;
            game.endedAt = now();
            if (game.observedFromStart) game.counts.games = { value: 1, available: true };
        }
        save(local);
        const record = finishGame(false);
        trailing.clear();
        store.flush();
        return record && { sessionId: session.id, gameId: record.id, game,
            previousStreak, previousCoverage, previousVariantCoverage,
            needsResult: !game.result || game.resultConflict
                || !game.counts.wins.available || !game.counts.losses.available };
    };
    facade.confirmPreviousGameResult = ({ result, at, serverId, localTicket } = {}) => {
        if (!localSource()) return api.confirmPreviousGameResult({ result, at, serverId });
        if (!['win', 'loss'].includes(result) || !localTicket || localTicket.sessionId !== id) return null;
        const session = current();
        if (!session || session.uuid !== identity()?.uuid) return null;
        const record = session?.games?.[session.games.length - 1];
        if (!record || record.id !== localTicket.gameId || record.mode !== 'BEDWARS' || record.result) return null;
        const game = normalizeLocal({ current: record.observation || localTicket.game }).current;
        if (!game) return null;
        const fields = ['wins','losses','games'];
        const before = Object.fromEntries(fields.map(field => [field,game.counts[field].value]));
        game.result = result;
        game.resultConflict = false;
        game.resultFromGameOver = false;
        game.endObserved = true;
        const values = { wins: result === 'win' ? 1 : 0, losses: result === 'loss' ? 1 : 0, games: 1 };
        for (const field of fields) game.counts[field] = { value: values[field],
            available: true, observed: true, reasons: 0 };
        const local = normalizeLocal(session.localTracking);
        const totals = local.totals.BEDWARS;
        const variant = local.variants.BEDWARS?.[game.variant.id]?.counts;
        // Replace this saved game's contribution, including any provisional
        // win/loss, without touching the earlier games or the live next game.
        for (const [target,coverage] of [[totals,localTicket.previousCoverage],[variant,localTicket.previousVariantCoverage]]) {
            if (!target) continue;
            for (const field of fields) {
                target[field].value = Math.max(0,target[field].value + game.counts[field].value - before[field]);
                target[field].available = coverage[field] !== false;
                target[field].observed = true;
                if (target[field].available) target[field].reasons = 0;
            }
        }
        local.streaks.BEDWARS = nextStreak(localTicket.previousStreak, game);
        if (!save(local)) return null;
        const one = { totals: { BEDWARS: game.counts }, variants: {}, streaks: { BEDWARS: local.streaks.BEDWARS } };
        addVariant(one, game);
        return store.updateGame(session.id, record.id, {
            result, resultSource: 'manual', localModes: localModes(one), observation: game
        });
    };
    facade.excludeCurrentGame = () => {
        trailing.clear();
        // Discard before any source transition can settle the provisional game.
        ignored = true;
        clearBoundary();
        const session = current();
        if (session?.localTracking?.current) {
            const local = normalizeLocal(session.localTracking);
            local.lastGameKey = local.current.key;
            local.current = null;
            save(local);
            store.flush();
            scheduleBoundary();
        }
        api.excludeCurrentGame();
    };
    facade.onGameStart = options => {
        if (!localSource()) return api.onGameStart(options);
        const sessionId=start(options),game=current()?.localTracking?.current;
        return game ? api.captureLocalBaseline(sessionId,game.key).then(()=>sessionId) : sessionId;
    };
    facade.observeTrailingChat = (text, context = {}) => localSource() ? trailing.accept(text, context) : api.observeTrailingChat(text, context);
    facade.observeLocalChat = (text, context = {}) => {
        if (!localSource()) return api.observeLocalChat(text, context);
        if (!isEnabled() || ignored) return;
        // A new connection first reattaches to a paused game it may be rejoining.
        if (!current()?.localTracking?.current && ensure() && !current()?.localTracking?.current) start({ ...context, observedFromStart: false });
        const local = normalizeLocal(current()?.localTracking);
        // In-game chat after leaving means the player rejoined that game.
        const resumed = resume(local);
        const modeChanged = updateGameVariant(local.current, context.variant);
        const changed = observe(local.current, text, {...context,at:now()});
        if (resumed || modeChanged || changed || (local.current && context.identityKnown === false)) save(local);
    };
    facade.observeLocalResult = text => {
        if (!localSource()) return api.observeLocalResult(text);
        if (!isEnabled() || ignored || !current()?.localTracking?.current) return;
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
        let record;
        if (current().localTracking.current.endObserved) record = finishGame(false, options);
        else if (leave(options) === 'paused') { store.flush(); return id; }
        // Unconfirmed departures remain in history but do not announce a
        // completed game. Recaps carry this game's counters, not session totals.
        if (record && onGameRecap) onGameRecap({
            delta: { local: true, modes: record.localModes, spanMs: record.durationMs },
            sessionDelta: delta(), mode: record.mode,
            game: { BEDWARS: 'Bedwars', SKYWARS: 'SkyWars', DUELS: 'Duels' }[record.mode], record
        });
        store.flush(); return id;
    };
    facade.getActiveSession = () => localSource() ? current() : api.getActiveSession();
    facade.getObservedGameState = () => {
        if (!localSource()) return api.getObservedGameState();
        const game = current()?.localTracking?.current;
        return { ended: Boolean(game?.endObserved), result: game?.resultConflict ? null : game?.result || null };
    };
    facade.getActiveSessionId = () => facade.getActiveSession()?.id || null;
    facade.getSessionDelta = () => localSource() ? delta() : api.getSessionDelta();
    facade.getHistory = () => identity() ? store.getHistory(identity().uuid) : [];
    facade.refresh = async options => {
        if (!localSource()) return api.refresh(options);
        ensure();
        const game=current()?.localTracking?.current;
        if (game && !game.apiBaseline) await api.captureLocalBaseline(id,game.key);
        else if (isApiAvailable()) await api.refresh(options);
        return delta();
    };
    facade.reset = async () => { if (!localSource()) return api.reset(); close(); ignored = true; return ensure(); };
    facade.finish = async () => { if (!localSource()) return api.finish(); ignored = true; const endedId = close(); store.flush(); return endedId; };
    facade.end = () => { if (!localSource()) return api.end(); ignored = true; return close(); };
    // Disconnecting is leaving: a rejoinable game stays paused for the next
    // connection, which resumes or settles it.
    facade.quiesce = () => { trailing.clear(); if (source === 'local') { leave(); clearBoundary(); id = null; store.flush(); } return api.quiesce(); };
    facade.detach = () => { trailing.clear(); if (source === 'local') { leave(); clearBoundary(); id = null; store.flush(); } api.detach(); };
    facade.refreshSettings = () => {
        if (!localSource()) return api.refreshSettings();
        if (!isEnabled()) { close();api.detach();return; }
        scheduleBoundary();api.refreshSettings();
        const game=current()?.localTracking?.current;
        return api.captureLocalBaseline(id,game?.key||null);
    };
    facade.resumePendingRetries = () => api.resumePendingRetries();
    facade.processPendingVerifications = options => api.processPendingVerifications(options);
    return facade;
}
module.exports = { FIELDS, normalizeLocal, localModes, createGame, observe, invalidate, withLocalTracking };
