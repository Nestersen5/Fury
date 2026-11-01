'use strict';

const { formatBedwarsPrestige, formatSkyWarsLevel } = require('./format');
const { getFkdrColor, getKdrColor, getWlrColor, getWsColor } = require('./colors');

function getBedwarsScanStats(player = {}) {
    const bw = player.stats?.Bedwars || {};
    return {
        stars: player.achievements?.bedwars_level || 0,
        fkdr: (bw.final_kills_bedwars || 0) / Math.max(bw.final_deaths_bedwars || 1, 1),
        wlr: (bw.wins_bedwars || 0) / Math.max(bw.losses_bedwars || 1, 1),
        ws: bw.winstreak || 0
    };
}

// Keep automatic denick results and /scan on the same compact stat line.
function formatBedwarsScanLine({ stars = 0, fkdr = 0, wlr = 0, ws = 0 }, name, marker = '§a✔') {
    return `${formatBedwarsPrestige(stars)} ${name}§r ${marker}  §fFKDR: ${getFkdrColor(fkdr)}${fkdr.toFixed(2)}§r  §fWLR: ${getWlrColor(wlr)}${wlr.toFixed(2)}§r  §fWS: ${getWsColor(ws)}${ws}§r`;
}

function formatSkywarsScanLine({ skyLevel, kdr = 0, wlr = 0, ws = 0 }, name) {
    return `${skyLevel} ${name}§r §a✔  §fWLR: ${getWlrColor(wlr)}${wlr.toFixed(2)}§r  §fKDR: ${getKdrColor(kdr)}${kdr.toFixed(2)}§r  §fWS: ${getWsColor(ws)}${ws}§r`;
}

function formatDenickAnnouncement(name, realName, data = {}, { gameMode = 'BEDWARS', unavailable = false, getInteractiveTags }) {
    const identity = `§c${name} §a(${realName})`;
    let text = `${identity} §7| Stats unavailable right now.`;
    if (!unavailable) {
        const player = data.player;
        if (gameMode === 'SKYWARS') {
            const sw = player.stats?.SkyWars || {};
            text = formatSkywarsScanLine({
                skyLevel: formatSkyWarsLevel(sw, player),
                kdr: (sw.kills || 0) / Math.max(sw.deaths || 1, 1),
                wlr: (sw.wins || 0) / Math.max(sw.losses || 1, 1),
                ws: sw.win_streak || 0
            }, identity);
        } else {
            text = formatBedwarsScanLine(getBedwarsScanStats(player), identity);
        }
    }
    return { text: '§b[Denick] ', extra: [{ text }, ...getInteractiveTags(data.urchin, realName)] };
}

// Append only counts that were searched, using the verified candidate totals.
// A positive difference means the candidate has more than the observed count.
function formatDenickStatComparison(targets = {}, candidate = {}) {
    const parts = [];
    for (const [stat, label] of [['finals', 'Finals'], ['beds', 'Beds']]) {
        const detected = targets[stat];
        const actual = candidate[stat];
        if (!Number.isFinite(detected) || !Number.isFinite(actual)) continue;
        const difference = actual - detected;
        const signed = `${difference > 0 ? '+' : ''}${difference.toLocaleString('en-US')}`;
        const color = difference === 0 ? '§a' : '§e';
        parts.push(`§7${label}: §f${actual.toLocaleString('en-US')} §8(§7detected §f${detected.toLocaleString('en-US')}§7; diff ${color}${signed}§8)§r`);
    }
    return parts.length ? ` §8| ${parts.join(' §8| ')}` : '';
}

// Live and simulated matches use the same JSON component, including the
// existing interactive tag components and their provider-owned metadata.
function formatAutoDenickMatch(name, candidate, _targets, { confirmed = false, unavailable = false, getInteractiveTags }) {
    const realName = candidate.displayName || candidate.realName || candidate.name;
    const color = confirmed ? '§a' : '§e';
    const marker = confirmed ? '§a✔' : '§e?';
    const identity = `§c${name} §8(${color}${realName}§8)`;
    const message = {
        text: confirmed ? '§b[AutoDenick] §aConfirmed match: ' : '',
        extra: [
            { text: unavailable ? `${identity}§r ${marker}` : formatBedwarsScanLine(candidate.scanStats, identity, marker) },
            ...getInteractiveTags(candidate.urchin, realName)
        ]
    };
    if (unavailable) message.extra.push({ text: ' §7| Stats unavailable right now.' });
    return message;
}

function formatAutoDenickPossibleMatches(name, candidates, options) {
    if (!candidates.length) return [];
    return [{ text: '§b[AutoDenick] §ePossible matches:' },
        ...candidates.slice(0, 3).map(candidate => formatAutoDenickMatch(name, candidate, {}, options))];
}

function formatAutoDenickNotice(kind, name, stage) {
    if (kind === 'started') {
        const stats = { finals: 'finals', beds: 'beds', combined: 'finals and beds' }[stage];
        if (!stats) throw new Error(`Unknown AutoDenick stage: ${stage}`);
        return `§e[AutoDenick] §7Started denicking §e${name} §7using their §e${stats}§7.`;
    }
    const prefix = '§b[AutoDenick] §7';
    if (kind === 'unconfirmed') return `${prefix}Could not confidently denick §c${name} §7using their finals and beds.`;
    if (kind === 'error') return `${prefix}Could not check §c${name} §7right now.`;
    if (kind === 'keys') return `${prefix}Could not check §c${name}§7. Check your Hypixel and Aurora API keys.`;
    throw new Error(`Unknown AutoDenick notice: ${kind}`);
}

module.exports = { getBedwarsScanStats, formatBedwarsScanLine, formatSkywarsScanLine, formatDenickAnnouncement, formatDenickStatComparison, formatAutoDenickMatch,
    formatAutoDenickPossibleMatches, formatAutoDenickNotice };
