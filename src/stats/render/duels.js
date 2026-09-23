'use strict';

// Duels stat rendering: /duels card, per-mode stat rows, and the mode-nav.
//
// Overhauled for a scannable, single-glance layout: labeled §d▎ sections
// (Performance / Combat / Precision), receding §7 labels so the colored
// values carry each row, a winrate bar, and a Duels-specific ratio gradient
// that climbs toward the mode accent instead of "error"-red. The nav collapses
// the previous 17-line family wall to the current family expanded plus a single
// "More" row of family buttons.
//
// Mirrors src/stats/render/bedwars.js + skywars.js. The factory takes:
//   - `helpers` — createRenderHelpers output (nav button, mini card, ping badge,
//     percent formatter)
//   - `deps` — collectDuelsStats, visibleDuelsModeDefs, findDuelsModeDef,
//     bestDuelsMode, duelsModeRating, DUELS_MODE_DEFS, renderStatsMetaBlock.

const { sendChat, getRankedName } = require('../../../features/minecraft_chat.js');
const { formatInt, formatRatio } = require('../format.js');
const { getDuelsRatioColor, getWinrateColor, getDuelsWinstreakColor } = require('../colors.js');

const THIN_RULE = `§8§m${'-'.repeat(46)}`;

function compactNumber(value) {
    const n = Math.max(0, Number(value) || 0);
    if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
    return String(n);
}

function winrateBar(ratio, width = 10) {
    const r = Math.max(0, Math.min(1, Number(ratio) || 0));
    const filled = Math.round(r * width);
    return `${getWinrateColor(r)}${'█'.repeat(filled)}§8${'█'.repeat(width - filled)}`;
}

function createDuelsRender({ helpers, deps } = {}) {
    if (!helpers) throw new Error('createDuelsRender requires helpers');
    if (!deps) throw new Error('createDuelsRender requires deps');

    const {
        navButton,
        avgPingBadge,
        formatDuelsMiniCard,
        formatPercentValue
    } = helpers;

    const {
        collectDuelsStats,
        visibleDuelsModeDefs,
        findDuelsModeDef,
        bestDuelsMode,
        duelsModeRating,
        renderStatsMetaBlock,
        DUELS_MODE_DEFS
    } = deps;

    function familyGroups(duels) {
        const groups = new Map();
        visibleDuelsModeDefs(duels)
            .filter(mode => mode.id !== 'overall')
            .forEach((mode) => {
                const family = mode.family || 'Other';
                if (!groups.has(family)) groups.set(family, []);
                groups.get(family).push(mode);
            });
        return groups;
    }

    function renderDuelsModeNav(client, player, duels, activeMode) {
        const groups = familyGroups(duels);
        const currentFamily = activeMode.id === 'overall' ? null : activeMode.family;

        // Line 1: Overview + the family you're currently viewing, expanded.
        const overviewStats = collectDuelsStats(duels, DUELS_MODE_DEFS[0]);
        const line1 = { text: '', extra: [{ text: '§fModes:  ' }] };
        line1.extra.push(navButton(
            'Overview',
            `/duels ${player}`,
            formatDuelsMiniCard('Duels Overall', overviewStats),
            activeMode.id === 'overall' ? '§a' : '§8'
        ));
        if (currentFamily && groups.has(currentFamily)) {
            line1.extra.push({ text: `   §d${currentFamily}:  ` });
            groups.get(currentFamily).forEach((mode, index) => {
                if (index > 0) line1.extra.push({ text: ' ' });
                const stats = collectDuelsStats(duels, mode);
                line1.extra.push(navButton(
                    mode.option || mode.label,
                    `/duels ${player} ${mode.short || mode.id}`,
                    formatDuelsMiniCard(`Duels ${mode.label}`, stats),
                    mode.id === activeMode.id ? '§a' : '§8'
                ));
            });
        }
        sendChat(client, line1);

        // Line 2: every other family as one button -> its primary mode.
        const others = Array.from(groups.entries()).filter(([family]) => family !== currentFamily);
        if (others.length > 0) {
            const line2 = { text: '', extra: [{ text: '§8More:  ' }] };
            others.forEach(([family, modes], index) => {
                if (index > 0) line2.extra.push({ text: ' ' });
                const primary = modes[0];
                const stats = collectDuelsStats(duels, primary);
                line2.extra.push(navButton(
                    family,
                    `/duels ${player} ${primary.short || primary.id}`,
                    formatDuelsMiniCard(`Duels ${primary.label}`, stats),
                    '§8'
                ));
            });
            sendChat(client, line2);
        }
    }

    function renderDuelsModeStatRows(client, stats, mode) {
        const isBridge = Boolean(mode && mode.family === 'The Bridge');
        const wlrColor = getDuelsRatioColor(stats.wlr);
        const kdrColor = getDuelsRatioColor(stats.kdr);
        const wrColor = getWinrateColor(stats.winrate);
        const wl = stats.losses > 0 ? stats.wins / stats.losses : stats.wins;
        const kd = stats.deaths > 0 ? stats.kills / stats.deaths : stats.kills;
        const bestColor = getDuelsWinstreakColor(stats.bestWs);

        sendChat(client, '§d▎ §f§lPerformance');
        sendChat(client, `  §7WLR ${wlrColor}${formatRatio(stats.wlr)}    §7KDR ${kdrColor}${formatRatio(stats.kdr)}    §7Winrate ${wrColor}${formatPercentValue(stats.winrate)}`);
        sendChat(client, `  ${winrateBar(stats.winrate)}  §7W/L §f${formatRatio(wl)}`);
        sendChat(client, `  §7Streak  §enow ${formatInt(stats.currentWs)}  §8·  ${bestColor}best ${formatInt(stats.bestWs)}`);

        sendChat(client, '§d▎ §f§lCombat');
        sendChat(client, `  §7Wins §a${formatInt(stats.wins)}    §7Losses §c${formatInt(stats.losses)}    §7Games §f${formatInt(stats.games)}`);
        sendChat(client, `  §7Kills §a${formatInt(stats.kills)}    §7Deaths §c${formatInt(stats.deaths)}    §8(§f${formatRatio(kd)} K/D§8)`);
        if (isBridge) {
            sendChat(client, `  §7Goals §b${formatInt(stats.goals)}    §7Bridge Kills §a${formatInt(stats.bridgeKills)}    §7Bridge Deaths §c${formatInt(stats.bridgeDeaths)}`);
        }

        sendChat(client, '§d▎ §f§lPrecision');
        sendChat(client, `  §7Melee §b${formatPercentValue(stats.meleeAccuracy)}    §7Bow §b${formatPercentValue(stats.bowAccuracy)}    §7Coins §6${formatInt(stats.coins)}`);
        sendChat(client, `  §8Damage ${compactNumber(stats.damage)} · Blocks ${compactNumber(stats.blocksPlaced + stats.blocksBroken)}`);
    }

    function renderDuelsStats(client, data, mode = DUELS_MODE_DEFS[0], { isCached = false } = {}) {
        const p = data.player;
        const duels = p.stats?.Duels || {};
        const activeMode = mode?.id === 'overall' ? mode : findDuelsModeDef(mode?.id || mode?.short, duels);
        const stats = collectDuelsStats(duels, activeMode);
        const name = getRankedName(p);
        const modeLabel = activeMode.id === 'overall' ? 'Overall' : activeMode.label;
        const mostPlayed = bestDuelsMode(duels, s => s.games);
        const bestStats = bestDuelsMode(duels, duelsModeRating);

        sendChat(client, '§r ');
        sendChat(client, `§d✦ §lDUELS  §r§7${modeLabel}  §8·  ${name}${avgPingBadge(data)}${isCached ? '  §8(Cached)' : ''}`);
        renderStatsMetaBlock(client, data);
        renderDuelsModeNav(client, p.displayname, duels, activeMode);
        sendChat(client, THIN_RULE);

        if (activeMode.id === 'overall') {
            const highlight = { text: '', extra: [{ text: '§7Highlights:  ' }] };
            if (mostPlayed) {
                highlight.extra.push(navButton(
                    `Most Played: ${mostPlayed.mode.label}`,
                    `/duels ${p.displayname} ${mostPlayed.mode.short}`,
                    formatDuelsMiniCard(`Duels ${mostPlayed.mode.label}`, mostPlayed.stats),
                    '§d'
                ));
            }
            if (mostPlayed && bestStats) highlight.extra.push({ text: '  ' });
            if (bestStats) {
                highlight.extra.push(navButton(
                    `Best: ${bestStats.mode.label}`,
                    `/duels ${p.displayname} ${bestStats.mode.short}`,
                    formatDuelsMiniCard(`Duels ${bestStats.mode.label}`, bestStats.stats),
                    '§b'
                ));
            }
            if (highlight.extra.length > 1) {
                sendChat(client, highlight);
                sendChat(client, THIN_RULE);
            }
        }

        renderDuelsModeStatRows(client, stats, activeMode);
        sendChat(client, `${THIN_RULE}`);
        sendChat(client, '§r ');
    }

    return {
        renderDuelsModeNav,
        renderDuelsModeStatRows,
        renderDuelsStats
    };
}

module.exports = { createDuelsRender };
