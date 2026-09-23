'use strict';

// Transport projection only: history normalization and calendar/card calculations
// remain owned by launcherSessionHistory. Adding a consumer requires updating
// this allowlist, rather than silently growing every state:get reply.
const VERSION = 1;
const SESSION_FIELDS = Object.freeze(['id', 'uuid', 'name', 'startedAt', 'lastSeen', 'endedAt', 'active', 'durationMs', 'modes']);
const GAME_FIELDS = Object.freeze(['id', 'mode', 'verificationStatus', 'result', 'opponents']);
const pick = (source, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));

function compactHistory(history, revision) {
    return {
        version: VERSION,
        revision,
        history: {
            // Identity, dates and modes feed session cards; games feed filters.
            sessions: (history.sessions || []).map(session => ({
                ...pick(session, SESSION_FIELDS),
                games: (session.games || []).map(game => pick(game, GAME_FIELDS))
            })),
            // This is already the existing calendar projection. Preserve it
            // intact, including sessions outside the detail retention limit.
            calendarSessions: history.calendarSessions || []
        }
    };
}

function sameRevision(a, b) {
    return Boolean(a && b && a.epoch === b.epoch && a.generation === b.generation && a.accountKey === b.accountKey);
}

class HistoryResponses {
    constructor() {
        this.epoch = require('node:crypto').randomUUID();
        this.generation = 0;
        this.mutations = 0;
        this.scopes = new Map();
    }

    begin(id) {
        const ticket = ++this.generation;
        const scope = this.scopes.get(id) || { latest: null };
        scope.ticket = ticket;
        this.scopes.set(id, scope);
        return ticket;
    }

    invalidate() {
        const generation = ++this.generation;
        for (const scope of this.scopes.values()) {
            scope.ticket = generation;
            scope.latest = null;
        }
        return { epoch: this.epoch, generation };
    }

    async mutate(action, notify = () => {}) {
        this.mutations++;
        try {
            notify(this.invalidate());
            return await action();
        }
        finally {
            this.mutations--;
            notify(this.invalidate());
        }
    }

    publish(id, ticket, accountKey, history) {
        const scope = this.scopes.get(id);
        if (!scope || scope.ticket !== ticket || this.mutations) return null;
        const revision = { epoch: this.epoch, generation: ticket, accountKey: accountKey || null };
        // At most one snapshot per live renderer. No accumulation across polls,
        // accounts or revisions; release the scope when its webContents dies.
        scope.latest = { revision, history };
        return compactHistory(history, revision);
    }

    respond(id, ticket, state, capability) {
        if (capability !== VERSION) return state;
        if (this.scopes.get(id)?.ticket !== ticket || this.mutations) return { historyStale: true };
        if (!state.sessionHistory) return state;
        const envelope = this.publish(id, ticket, state.accountKey, state.sessionHistory);
        if (!envelope) return { historyStale: true };
        return {
            ...state,
            sessionHistory: envelope,
            // A live health reply contains a second reference to the full graph.
            proxyHealth: state.proxyHealth?.sessionHistory
                ? { ...state.proxyHealth, sessionHistory: null } : state.proxyHealth
        };
    }

    detail(id, request = {}) {
        const latest = this.scopes.get(id)?.latest;
        if (!latest || !sameRevision(request?.revision, latest.revision)) return { ok: false, error: 'STALE_REVISION' };
        const session = latest.history.sessions?.find(item => item.id === request.sessionId);
        const game = session?.games?.find(item => item.id === request.gameId);
        return game
            ? { ok: true, revision: latest.revision, sessionId: session.id, game }
            : { ok: false, error: 'NOT_FOUND', revision: latest.revision };
    }

    release(id) { this.scopes.delete(id); }
}

// No detail UI or detail cache is mounted by this adapter. The full contract
// remains available to consumers which still need legacy game-detail fields.
class HistoryResponseClient {
    constructor() {
        this.scope = 0;
        this.revision = null;
        this.floor = null;
        this.detailSelection = 0;
    }

    invalidate(revision) {
        this.scope++;
        this.revision = null;
        if (revision && (!this.floor || revision.epoch !== this.floor.epoch || revision.generation > this.floor.generation)) this.floor = revision;
    }

    accept(state, scope) {
        if (scope !== this.scope || state.historyStale) return null;
        const envelope = state.sessionHistory;
        // A main process without this capability still returns the full shape.
        if (!envelope || !Object.hasOwn(envelope, 'version')) return state;
        const revision = envelope.revision;
        if (envelope.version !== VERSION || !revision || typeof revision.epoch !== 'string'
            || !Number.isSafeInteger(revision.generation) || revision.generation < 1
            || !Array.isArray(envelope.history?.sessions) || !Array.isArray(envelope.history?.calendarSessions)) {
            throw new Error('Unsupported history response contract');
        }
        if (revision.accountKey !== (state.accountKey || null)) return null;
        for (const previous of [this.floor, this.revision]) {
            if (previous?.epoch === revision.epoch && revision.generation <= previous.generation) return null;
        }
        this.revision = revision;
        return { ...state, sessionHistory: envelope.history };
    }

    closeDetail() { this.detailSelection++; }

    async detail(invoke, sessionId, gameId) {
        const revision = this.revision, scope = this.scope, selection = ++this.detailSelection;
        if (!revision) return { ok: false, error: 'STALE_REVISION' };
        const result = await invoke('history:detail', { revision, sessionId, gameId });
        if (scope !== this.scope || selection !== this.detailSelection || !sameRevision(revision, this.revision)) {
            return { ok: false, error: 'STALE_SELECTION' };
        }
        if (result.ok && !sameRevision(result.revision, revision)) return { ok: false, error: 'STALE_REVISION' };
        return result;
    }
}

module.exports = { VERSION, SESSION_FIELDS, GAME_FIELDS, compactHistory, sameRevision, HistoryResponses, HistoryResponseClient };
