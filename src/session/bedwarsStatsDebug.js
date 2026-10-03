'use strict';

const { createGame, observe, observeResult, settleGame, localModes } = require('./localStats');
const { MODE_DEFINITIONS } = require('./launcherSessionHistory');

const FIELDS = [
    ['kills', 'Kills'], ['deaths', 'Deaths'], ['finals', 'Final kills'],
    ['finalDeaths', 'Final deaths'], ['beds', 'Beds broken'], ['bedsLost', 'Beds lost'],
    ['wins', 'Wins'], ['losses', 'Losses'], ['games', 'Games']
];
const API_FIELDS = MODE_DEFINITIONS.find(mode => mode.mode === 'BEDWARS').fields;
const PREFIX = '§8[§bStats Debug§8] ';

function createBedwarsStatsDebug({ send, detectKnownKillMessageForStats, isApiAvailable, now = Date.now }) {
    let enabled = false;
    let current = null;
    let pending = [];

    const say = message => send(`${PREFIX}${message}`);
    const cleanLine = text => String(text || '').replace(/(?:\u00c2)?\u00a7[0-9a-fk-or]/gi, '')
        .replace(/[\r\n\t]/g, ' ').trim().slice(0, 100);
    const values = game => Object.fromEntries(FIELDS.map(([key]) =>
        [key, { value: game.counts[key].value, available: game.counts[key].available }]));

    function setEnabled(next) {
        enabled = Boolean(next);
        if (!enabled) { current = null; pending = []; }
        return enabled;
    }

    function status() {
        return { enabled, active: Boolean(current), paused: Boolean(current?.pausedAt), awaitingApi: pending.length };
    }

    function closeCurrent(at = now()) {
        if (!current) return null;
        const entry = current;
        current = null;
        if (!entry.game.endObserved) settleGame(entry.game);
        const local = localModes({ current: entry.game })[0];
        say('§7Game observed (? means incomplete coverage):');
        for (let i = 0; i < FIELDS.length; i += 3) {
            const summary = FIELDS.slice(i, i + 3)
                .map(([key, label]) => `${label} ${local[key] ?? `? (seen ${entry.game.counts[key].value})`}`).join(' §8· §7');
            say(`§7${summary}`);
        }
        if (entry.apiAtStart && isApiAvailable()) {
            pending.push({ at, serverId: entry.serverId, local,
                observed: Object.fromEntries(FIELDS.map(([key]) => [key, entry.game.counts[key].value])) });
            pending = pending.slice(-8);
            say('§7Waiting for Hypixel to publish this game for API comparison.');
        } else {
            say('§7API comparison unavailable: no usable baseline or API is off.');
        }
        return local;
    }

    function start({ startedAt = now(), serverId = null, ownName, ownNames, ownTeam,
        observedFromStart = false, standardBedwars = false, identityKnown = false,
        apiComparable = true, variant = null } = {}) {
        if (!enabled) return;
        if (current?.startedAt === startedAt) {
            if (current.pausedAt) {
                current.pausedAt = 0;
                current.game.leftAt = 0;
                current.apiAtStart = current.apiAtStart && apiComparable;
                say('§7Rejoined the tracked BedWars game.');
            }
            return;
        }
        if (current) closeCurrent(current.pausedAt || now());
        current = {
            startedAt, serverId, pausedAt: 0, apiAtStart: Boolean(isApiAvailable() && apiComparable),
            game: createGame({ key: String(startedAt), mode: 'BEDWARS', startedAt,
                ownName, ownNames, ownTeam, observedFromStart, standardBedwars, identityKnown, variant })
        };
        say(`§7Tracking BedWars §8(§f${observedFromStart ? 'full start' : 'joined midgame'}§8).`);
    }

    function reportChanges(before, text) {
        const after = values(current.game);
        const reason = cleanLine(text);
        FIELDS.forEach(([key, label]) => {
            if (before[key].available && !after[key].available) {
                say(`§e${label} unknown §8| §7${reason}`);
            }
            if (after[key].value !== before[key].value) {
                const change = after[key].value - before[key].value;
                const coverage = after[key].available ? '' : ' §e(incomplete)';
                say(`${change > 0 ? '§a' : '§e'}${label} ${change > 0 ? '+' : ''}${change} §8(§f${after[key].value}§8)${coverage} §8| §7${reason}`);
            }
        });
    }

    function observeChat(text, context = {}) {
        if (!enabled || !current || current.pausedAt) return;
        const before = values(current.game);
        observeResult(current.game, text, { at: now() });
        observe(current.game, text, { ...context, at: now(), detectKnownKillMessageForStats });
        reportChanges(before, text);
    }

    function observeTitle(text) {
        if (!enabled || !current || current.pausedAt) return;
        const before = values(current.game);
        if (observeResult(current.game, text, { at: now() })) reportChanges(before, text);
    }

    function end({ at = now(), serverId = null, confirmed = false } = {}) {
        if (!enabled || !current) return;
        if (serverId) current.serverId = serverId;
        if (confirmed || current.game.endObserved) closeCurrent(at);
        else if (!current.pausedAt) {
            current.pausedAt = at;
            current.game.leftAt = at;
            say('§7Left the game; waiting for a rejoin or confirmed end.');
        }
    }

    function onNewQueue(at = now()) {
        if (!enabled || !current) return null;
        const needsResult = !current.game.result || current.game.resultConflict
            || !current.game.counts.wins.available || !current.game.counts.losses.available;
        const endedAt = current.pausedAt || at;
        const serverId = current.serverId;
        if (!current.game.endObserved) {
            settleGame(current.game);
            current.game.endObserved = true;
            current.game.endedAt = at;
            if (current.game.observedFromStart) current.game.counts.games = { value: 1, available: true };
        }
        say('§7New BedWars queue detected; previous game closed.');
        closeCurrent(endedAt);
        return { needsResult, at: endedAt, serverId };
    }

    function confirmQueuedResult({ result, at, serverId = null } = {}) {
        if (!enabled || !['win', 'loss'].includes(result)) return;
        const entry = pending.find(item => Math.abs(item.at - at) < 30000
            && (!serverId || !item.serverId || item.serverId === serverId));
        if (entry) {
            entry.local.wins = result === 'win' ? 1 : 0;
            entry.local.losses = result === 'loss' ? 1 : 0;
        }
        say(`§7Previous game manually marked as §f${result}§7.`);
    }

    function onRecap(recap) {
        if (!enabled || recap?.mode !== 'BEDWARS' || recap.record?.verificationStatus !== 'verified') return;
        const record = recap.record;
        const serverId = record.metadata?.serverId || null;
        const api = recap.delta?.stats?.Bedwars || record.delta?.stats?.Bedwars;
        const publishedResult = Number(api?.wins_bedwars) > 0 || Number(api?.losses_bedwars) > 0;
        if (current?.pausedAt && publishedResult && Math.abs(record.at - current.pausedAt) < 30000
            && (!serverId || !current.serverId || serverId === current.serverId)) {
            closeCurrent(current.pausedAt);
        }
        let best = -1;
        for (let i = 0; i < pending.length; i += 1) {
            const entry = pending[i];
            if (Math.abs(record.at - entry.at) >= 30000) continue;
            if (serverId && entry.serverId && serverId !== entry.serverId) continue;
            if (best < 0 || Math.abs(record.at - entry.at) < Math.abs(record.at - pending[best].at)) best = i;
        }
        if (best < 0) return;
        const entry = pending.splice(best, 1)[0];
        if (!api) return say('§eHypixel returned no BedWars stats for comparison.');
        if (!publishedResult) return say('§eHypixel has not published a win or loss for this game; API comparison is unavailable.');
        let matched = 0, compared = 0;
        let incomplete = 0;
        FIELDS.forEach(([key, label]) => {
            const expected = Number(api[API_FIELDS[key]]) || 0;
            if (!Number.isFinite(entry.local[key])) {
                incomplete += 1;
                say(`§7${label}: §eLocal ? (seen ${entry.observed[key]}) §8| §bAPI ${expected} §8(incomplete)`);
                return;
            }
            compared += 1;
            if (entry.local[key] === expected) matched += 1;
            say(`§7${label}: §fLocal ${entry.local[key]} §8| §bAPI ${expected} ${entry.local[key] === expected ? '§a✓' : '§cDIFF'}`);
        });
        say(`§7Hypixel API check: §f${matched}/${compared} §7available stats match.`);
        if (incomplete) say(`§e${incomplete} stats had incomplete local coverage and cannot be confirmed.`);
    }

    function discardCurrentGame() { current = null; }

    return { setEnabled, status, start, observeChat, observeTitle, end, onNewQueue, confirmQueuedResult, onRecap, discardCurrentGame };
}

module.exports = { createBedwarsStatsDebug };
