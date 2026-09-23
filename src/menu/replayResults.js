'use strict';

// Adds a "Result: Victory/Defeat" lore line to the games in Hypixel's
// Recent Games (/replay) menu, matched against locally tracked games.
//
// Hypixel's lore carries the game server ("mini144AN"), the start time as US
// Eastern wall-clock ("2026-09-17 16:02") and the duration ("07:50"). Tracked
// games store the sidebar's short server id ("m144AN"), the end time and the
// duration, so a game matches when the servers agree and the start times line
// up under either Eastern offset (EDT/EST). BedWars games also get the
// player's kills/finals/beds and a teammates line, and any game with /clip
// moments (src/session/gameClips.js) lists them, tracked result or not.

const { simplifyNbt } = require('./menuMonitor');
const { resolveGameResult } = require('../session/gameResult');
const { formatClipTime } = require('../session/gameClips');

const EASTERN_OFFSETS_MS = [4 * 3600000, 5 * 3600000];
const MAX_START_DRIFT_MS = 3 * 60000;
const INDEX_TTL_MS = 5000;
const RESULT_LABELS = { win: '§7Result: §a§lVictory', loss: '§7Result: §c§lDefeat' };
const MAX_TEAMMATES_SHOWN = 3;
const MAX_CLIPS_SHOWN = 4;
const BEDWARS_STAT_KEYS = { kills: 'kills_bedwars', finals: 'final_kills_bedwars', beds: 'beds_broken_bedwars' };

function stripColors(value) {
    return String(value == null ? '' : value).replace(/§[0-9a-fk-or]/gi, '');
}

function normalizeServerId(value) {
    const id = String(value || '').trim();
    if (!/^[A-Za-z0-9]{2,20}$/.test(id)) return null;
    return id.replace(/^mini/i, 'm').replace(/^mega/i, 'M');
}

// Returns { serverId, startNaiveMs, durationMs } or null when the lore is not
// a Recent Games entry. startNaiveMs is the Eastern wall-clock read as UTC.
function parseReplayLore(lore) {
    const plain = (Array.isArray(lore) ? lore : []).map(stripColors);
    if (!plain.some(line => /view replay/i.test(line))) return null;
    let serverId = null;
    let startNaiveMs = null;
    let durationMs = null;
    for (const line of plain) {
        const server = line.match(/^\s*Server:\s*([A-Za-z0-9]+)/i);
        if (server) serverId = normalizeServerId(server[1]);
        const date = line.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
        if (date && startNaiveMs === null) {
            startNaiveMs = Date.UTC(+date[1], +date[2] - 1, +date[3], +date[4], +date[5]);
        }
        const duration = line.match(/^\s*Duration:\s*(?:(\d+):)?(\d{1,2}):(\d{2})/i);
        if (duration) durationMs = ((+(duration[1] || 0) * 60 + +duration[2]) * 60 + +duration[3]) * 1000;
    }
    if (!serverId || startNaiveMs === null) return null;
    return { serverId, startNaiveMs, durationMs };
}

// Stored result first; older records without one are re-inferred from their
// saved events, roster and team.
function gameResult(game) {
    return resolveGameResult(game?.result, game || {}).result;
}

function sameName(a, b) {
    return Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();
}

// The player's own BedWars kills/finals/beds: the verified API delta when
// present, otherwise counted from the chat events the proxy recorded.
function bedwarsCounts(game, selfName) {
    if (game?.mode !== 'BEDWARS') return null;
    const stats = game.delta?.stats?.Bedwars;
    if (stats && typeof stats === 'object') {
        const counts = {};
        for (const [label, key] of Object.entries(BEDWARS_STAT_KEYS)) {
            counts[label] = Math.max(0, Number(stats[key]) || 0);
        }
        return counts;
    }
    if (!selfName || !Array.isArray(game.events)) return null;
    const mine = game.events.filter(event => sameName(event?.actor, selfName));
    return {
        kills: mine.filter(event => event.type === 'kill').length,
        finals: mine.filter(event => event.type === 'final_kill').length,
        beds: mine.filter(event => event.type === 'bed_break').length
    };
}

function resolveLive(resolvePlayer, name) {
    try {
        return typeof resolvePlayer === 'function' ? resolvePlayer(name) : null;
    } catch (error) {
        return null;
    }
}

// Rank-coloured teammate names, nicks shown as their real IGN when known.
// Teammates are the recorded list or, for older records whose roster
// relations were never resolved, the roster players on the game's own team.
// A denick or cached profile available now beats what was saved at game end.
// Returns { shown, missing }: `missing` are real IGNs whose rank is unknown
// or stale and that are safe to look up (never an undenicked nick).
function teammatesOf(game, selfName, resolvePlayer = null) {
    const roster = Array.isArray(game?.roster) ? game.roster : [];
    let names = Array.isArray(game?.teammates) ? game.teammates : [];
    const ownTeam = game?.metadata?.team;
    if (!names.length && ownTeam) {
        names = roster.filter(player => sameName(player?.team, ownTeam)).map(player => player?.name);
    }
    const seen = new Set();
    const shown = [];
    const missing = [];
    for (const name of names) {
        if (typeof name !== 'string' || !name || sameName(name, selfName)) continue;
        const saved = roster.find(player => sameName(player?.name, name)) || {};
        const live = resolveLive(resolvePlayer, name);
        const liveReal = live?.realName && !sameName(live.realName, name) ? live.realName : null;
        const realName = liveReal || saved.realName || name;
        if (sameName(realName, selfName) || seen.has(realName.toLowerCase())) continue;
        seen.add(realName.toLowerCase());
        const savedDisplay = sameName(saved.realName || name, realName) ? saved.display : null;
        const display = live?.display || savedDisplay || null;
        shown.push(display || `§f${realName}`);
        const denicked = !sameName(realName, name);
        const nicked = !denicked && Boolean(live?.nicked || saved.nicked);
        if (!nicked && (!display || live?.stale)) missing.push(realName);
    }
    return { shown, missing };
}

function statsLine(counts) {
    if (!counts) return null;
    return `§7Kills §a${counts.kills} §8· §7Finals §a${counts.finals} §8· §7Beds §a${counts.beds}`;
}

function teammateLines(names) {
    if (!Array.isArray(names) || !names.length) return [];
    const lines = ['§7With:', ...names.slice(0, MAX_TEAMMATES_SHOWN).map(name => `§8- ${name}`)];
    if (names.length > MAX_TEAMMATES_SHOWN) lines.push(`§8+${names.length - MAX_TEAMMATES_SHOWN} more`);
    return lines;
}

function clipLines(clips) {
    if (!Array.isArray(clips) || !clips.length) return [];
    const sorted = clips.slice().sort((a, b) => a.offsetMs - b.offsetMs);
    const lines = ['§7Clips:', ...sorted.slice(0, MAX_CLIPS_SHOWN)
        .map(clip => `§8- §e${formatClipTime(clip.offsetMs)} §f${clip.label}`)];
    if (sorted.length > MAX_CLIPS_SHOWN) lines.push(`§8+${sorted.length - MAX_CLIPS_SHOWN} more`);
    return lines;
}

function addToServer(byServer, serverId, entry) {
    if (!byServer.has(serverId)) byServer.set(serverId, []);
    byServer.get(serverId).push(entry);
}

// Clip games carry their start directly and no duration.
function buildClipIndex(clipGames) {
    const byServer = new Map();
    for (const game of clipGames || []) {
        const serverId = normalizeServerId(game?.serverId);
        if (!serverId || !game.startedAt || !Array.isArray(game.clips) || !game.clips.length) continue;
        addToServer(byServer, serverId, { startMs: game.startedAt, durationMs: 0, clips: game.clips });
    }
    return byServer;
}

function buildIndex(games, selfName = null, resolvePlayer = null) {
    const byServer = new Map();
    for (const game of games || []) {
        const serverId = normalizeServerId(game?.metadata?.serverId);
        const result = gameResult(game);
        if (!serverId || !result || !game.at) continue;
        const durationMs = Math.max(0, Number(game.durationMs) || 0);
        const teammates = teammatesOf(game, selfName, resolvePlayer);
        const entry = {
            startMs: game.at - durationMs,
            durationMs,
            result,
            counts: bedwarsCounts(game, selfName),
            teammates: teammates.shown,
            missingRanks: teammates.missing
        };
        addToServer(byServer, serverId, entry);
    }
    return byServer;
}

function findMatch(index, parsed) {
    let best = null;
    for (const game of index.get(parsed.serverId) || []) {
        const drift = Math.min(...EASTERN_OFFSETS_MS.map(offset => (
            Math.abs(game.startMs - (parsed.startNaiveMs + offset))
        )));
        if (drift > MAX_START_DRIFT_MS) continue;
        const durationGap = parsed.durationMs !== null && game.durationMs
            ? Math.abs(parsed.durationMs - game.durationMs)
            : 0;
        const score = drift + durationGap;
        if (!best || score < best.score) best = { score, game };
    }
    return best ? best.game : null;
}

// `index` is { games, clips } (or a function returning it). Returns a copy of
// the item with the tracked lines inserted, or null. Teammates whose rank is
// unknown are added to `missing` (a Set) when one is given.
function annotateItem(item, index, missing = null) {
    if (!item || item.blockId === undefined || item.blockId < 0 || !item.nbtData) return null;
    const lore = simplifyNbt(item.nbtData)?.display?.Lore;
    if (!Array.isArray(lore) || lore.some(line => /^(?:Result|Clips):/i.test(stripColors(line)))) return null;
    const parsed = parseReplayLore(lore);
    if (!parsed) return null;
    const indexes = typeof index === 'function' ? index() : index;
    const game = findMatch(indexes?.games || new Map(), parsed);
    const clipGame = findMatch(indexes?.clips || new Map(), parsed);
    if (!game && !clipGame) return null;
    if (missing && game?.missingRanks) game.missingRanks.forEach(name => missing.add(name));

    const nbtData = JSON.parse(JSON.stringify(item.nbtData));
    const loreNode = nbtData?.value?.display?.value?.Lore?.value;
    if (!loreNode || !Array.isArray(loreNode.value)) return null;
    const lines = loreNode.value;
    const plain = lines.map(stripColors);
    let insertAt = plain.findIndex(line => /^\s*Players:/i.test(line)) + 1;
    if (insertAt === 0) insertAt = plain.findIndex(line => /^\s*Server:/i.test(line)) + 1;
    // Blocks (result + K/F/B, teammates, clips), each preceded by a blank
    // line. Hypixel's own blank line then separates the last one from
    // "Click to view replay!".
    const blocks = [
        [game && RESULT_LABELS[game.result], game && statsLine(game.counts)].filter(Boolean),
        game ? teammateLines(game.teammates) : [],
        clipLines(clipGame?.clips)
    ].filter(block => block.length);
    const added = blocks.flatMap(block => ['', ...block]);
    lines.splice(insertAt, 0, ...added);
    return { ...item, nbtData };
}

function createReplayResultAnnotator({
    getGames = () => [],
    getClipGames = () => [],
    getSelfName = () => null,
    resolvePlayer = null,
    onMissingPlayers = null,
    isEnabled = () => true,
    now = Date.now
} = {}) {
    let index = null;
    let indexBuiltAt = 0;

    function invalidate() {
        index = null;
    }

    function reportMissing(missing) {
        if (!missing.size || typeof onMissingPlayers !== 'function') return;
        try {
            onMissingPlayers(Array.from(missing));
        } catch (error) {}
    }

    // Annotated copy of one server-side item, or null. Used to redraw an open
    // menu once missing ranks have been looked up.
    function annotate(item) {
        try {
            return isEnabled() ? annotateItem(item, currentIndex) : null;
        } catch (error) {
            return null;
        }
    }

    function currentIndex() {
        if (!index || now() - indexBuiltAt > INDEX_TTL_MS) {
            index = { games: new Map(), clips: new Map() };
            try {
                index.games = buildIndex(getGames(), getSelfName(), resolvePlayer);
            } catch (error) {}
            try {
                index.clips = buildClipIndex(getClipGames());
            } catch (error) {}
            indexBuiltAt = now();
        }
        return index;
    }

    // Returns the packet data to send to the client (the same object when
    // nothing changed). The server-side view is never modified.
    function rewriteClientbound(name, data) {
        try {
            if (!isEnabled()) return data;
            if (name === 'window_items' && data?.windowId !== 0 && Array.isArray(data.items)) {
                let changed = false;
                const missing = new Set();
                const items = data.items.map(item => {
                    const annotated = annotateItem(item, currentIndex, missing);
                    if (annotated) changed = true;
                    return annotated || item;
                });
                reportMissing(missing);
                return changed ? { ...data, items } : data;
            }
            if (name === 'set_slot' && data?.windowId > 0) {
                const missing = new Set();
                const annotated = annotateItem(data.item, currentIndex, missing);
                reportMissing(missing);
                return annotated ? { ...data, item: annotated } : data;
            }
        } catch (error) {
            // Never break menu traffic over an annotation.
        }
        return data;
    }

    return { rewriteClientbound, annotate, invalidate };
}

// Clips of the game a replay shows, oldest first, or [] when none match.
// `startNaiveMs` is the replay's Eastern wall-clock start read as UTC, the
// same way the Recent Games lore time is read.
function findReplayClips(clipGames, { serverId, startNaiveMs } = {}) {
    const server = normalizeServerId(serverId);
    if (!server || !Number.isFinite(startNaiveMs)) return [];
    const match = findMatch(buildClipIndex(clipGames), { serverId: server, startNaiveMs, durationMs: null });
    return (match?.clips || []).slice().sort((a, b) => a.offsetMs - b.offsetMs);
}

module.exports = {
    createReplayResultAnnotator,
    findReplayClips,
    parseReplayLore,
    normalizeServerId,
    annotateItem,
    buildIndex,
    buildClipIndex
};
