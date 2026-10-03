'use strict';

const { isOwnTeamElimination } = require('./gameResult');

// Automatic chat is deliberately stricter than stored history. A stat change
// or an observed departure alone does not prove one completed game.
function isCompletedGameRecap(recap) {
    const record = recap?.record;
    if (!record || record.metadata?.privateGame || !(record.durationMs >= 1000)
        || !['win', 'loss'].includes(record.result)) return false;
    let wins, losses;
    if (record.verificationStatus === 'local' || (recap.delta?.local && record.localModes?.length)) {
        const mode = record.localModes?.find(entry => entry.mode === record.mode);
        if (!mode || mode.games !== 1) return false;
        ({ wins, losses } = mode);
    } else if (record.verificationStatus === 'verified') {
        if (record.durationMs < 30000 && !(record.events || []).some(event =>
            ['victory', 'defeat'].includes(event.type)
            || isOwnTeamElimination(event, record.mode, record.metadata?.team))) return false;
        const keys = {
            BEDWARS: ['Bedwars', 'wins_bedwars', 'losses_bedwars'],
            SKYWARS: ['SkyWars', 'wins', 'losses'],
            DUELS: ['Duels', 'wins', 'losses']
        }[record.mode];
        if (!keys) return false;
        const stats = recap.delta?.stats?.[keys[0]];
        wins = stats?.[keys[1]] ?? 0;
        losses = stats?.[keys[2]] ?? 0;
    } else return false;
    return wins === (record.result === 'win' ? 1 : 0)
        && losses === (record.result === 'loss' ? 1 : 0);
}

function createAutomaticRecapGuard({ now = Date.now } = {}) {
    const connectedAt = now();
    let latestEndAt = connectedAt;
    let latestApiSnapshotAt = 0;
    const seen = new Set();
    return (recap, { enabled = true, playing = false } = {}) => {
        const record = recap?.record;
        if (!record?.id || seen.has(record.id)) return false;
        // A suppressed notification is consumed too: later retries must not
        // replay it after settings change or the next match ends.
        seen.add(record.id);
        if (seen.size > 128) seen.delete(seen.values().next().value);
        const at = Number(record.at);
        if (!Number.isFinite(at) || at < latestEndAt) return false;
        latestEndAt = at;
        if (record.verificationStatus === 'verified') {
            const from = Number(recap.delta?.from), to = Number(recap.delta?.to);
            if (!Number.isFinite(from) || !Number.isFinite(to) || from < latestApiSnapshotAt) return false;
            latestApiSnapshotAt = Math.max(latestApiSnapshotAt, to);
        }
        return enabled && !playing && isCompletedGameRecap(recap);
    };
}

// Game completion is persisted immediately. Chat waits for Hypixel's result
// and rewards block, independently of API publication and session counters.
function createRecapDelivery({ send, getState, now = Date.now, setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout, delayMs = 3000, quietMs = 1250, maxWaitMs = 10000 } = {}) {
    const allow = createAutomaticRecapGuard({ now });
    let pending = null, timer = null;
    function clear() {
        if (timer !== null) clearTimeoutImpl(timer);
        timer = null;
        pending = null;
    }
    function schedule() {
        if (timer !== null) clearTimeoutImpl(timer);
        const due = Math.min(pending.at + maxWaitMs, Math.max(pending.at + delayMs, pending.lastChat + quietMs));
        timer = setTimeoutImpl(() => {
            timer = null;
            const entry = pending;
            pending = null;
            if (!entry) return;
            const state = getState();
            if (!state.enabled || state.playing || state.gameGeneration !== entry.gameGeneration
                || state.sessionId !== entry.sessionId || now() - entry.lastChat < quietMs) return;
            send(entry.recap);
        }, Math.max(0, due - now()));
        timer?.unref?.();
    }
    function enqueue(recap) {
        const state = getState();
        if (!allow(recap, state)) return false;
        clear();
        pending = { recap, at: now(), lastChat: now(), gameGeneration: state.gameGeneration, sessionId: state.sessionId };
        schedule();
        return true;
    }
    function observeChat(text) {
        if (!pending) return;
        const lines = String(text || '').replace(/(?:\u00c2)?\u00a7[0-9a-fk-or]/gi, '').split(/[\r\n]+/);
        const resultLine = /^(?:TEAM ELIMINATED\s*>|VICTORY!?$|DEFEAT!?$|GAME OVER!?$|(?:1st|2nd|3rd) Killer\b|BED WARS\b|\+[\d,.]+(?:\s|$)|(?:Daily|Weekly) Quest\b|You (?:completed|failed)\b.*challenge|(?:Final Kills|Kills|Beds Broken|Coins|Experience|Tokens|Slumber Tickets)\s*:)/i;
        if (!lines.some(line => resultLine.test(line.trim()))) return;
        pending.lastChat = now();
        schedule();
    }
    return { enqueue, observeChat, clear };
}

module.exports = { isCompletedGameRecap, createAutomaticRecapGuard, createRecapDelivery };
