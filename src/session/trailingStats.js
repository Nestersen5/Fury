'use strict';

const { normalizeLocal, observe } = require('./localStats');
const { parseGameEvents } = require('./gameEvents');
const TRAILING_WINDOW_MS = 2000;

// One completed match per connection, no polling or timer. Queue/start/reset
// boundaries clear ownership; elapsed time is checked only when chat arrives.
function createTrailingStats({ store, now, getIdentity, isEnabled }) {
    let tail = null;
    const clear = () => {
        const previous = tail; tail = null;
        if (!previous) return;
        const record = store.findSession(previous.sessionId)?.games.find(game => game.id === previous.gameId);
        if (record?.observation?.endObserved && (record.observation.unresolved?.length || record.observation.recent?.length)) {
            store.updateGame(previous.sessionId, previous.gameId, { observation: { ...record.observation, unresolved: [], recent: [] } });
        }
    };
    function arm(sessionId, record) {
        if (!record?.observation?.endObserved) return;
        const expiresAt = (record.observation.endedAt || record.at) + TRAILING_WINDOW_MS;
        if (expiresAt < now() || (tail && tail.expiresAt > expiresAt)) return;
        clear();
        tail = { sessionId, gameId: record.id, key: record.observation.key, mode: record.mode,
            serverId: record.metadata?.serverId, expiresAt };
    }
    function accept(text, context = {}) {
        if (!tail || !isEnabled()) return false;
        if (now() > tail.expiresAt) { clear(); return false; }
        if ((context.mode && context.mode !== tail.mode) || (context.sessionKey && String(context.sessionKey) !== tail.key)
            || (context.serverId && tail.serverId && context.serverId !== tail.serverId)) return false;
        const session = store.findSession(tail.sessionId);
        const uuid = String(getIdentity?.()?.uuid || '').replace(/-/g, '').toLowerCase();
        if (!session || session.uuid !== uuid) { clear(); return false; }
        const record = session.games.find(game => game.id === tail.gameId);
        if (!record?.observation) { clear(); return false; }
        const game = normalizeLocal({ current: record.observation }).current;
        if (!observe(game, text, { ...context, at: now() })) return false;
        const events = parseGameEvents(text, { at: now(), startedAt: game.startedAt, ownTeam: game.ownTeam,
            resolveKillOwner: line => context.detectKnownKillMessageForStats?.(line)?.killer || null });
        return Boolean(store.updateGameObservation(session.id, record.id, game, events));
    }
    return { arm, accept, clear };
}

module.exports = { createTrailingStats, TRAILING_WINDOW_MS };
