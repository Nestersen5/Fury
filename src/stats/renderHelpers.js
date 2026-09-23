'use strict';

// Shared render-layer helpers extracted from proxy.js: nav buttons, chat
// component builders, stat-pair rows, mini-cards, BedWars progress bar,
// ping badge, etc. None of these have callers outside the render block,
// so they live together. The per-game renderers (render.bedwars/skywars/
// duels) consume them via DI.
//
// Only one external dependency is left to inject: `statValue` (for
// bedwarsProgressInfo, which reads `bw.Experience`). Everything else
// pulls from already-extracted modules — features/minecraft_chat (sendChat,
// stripAnsi) and the sibling stats/format + stats/colors modules.

const { sendChat, stripAnsi } = require('../../features/minecraft_chat.js');
const {
    formatInt,
    formatRatio,
    formatSigned,
    formatDuration,
    formatBedwarsPrestige
} = require('./format.js');
const {
    getFkdrColor,
    getWlrColor,
    getKdrColor,
    getWsColor,
    getPingColor,
    getDuelsRatioColor,
    getWinrateColor,
    getDuelsWinstreakColor
} = require('./colors.js');

const STAT_GAP = '   §8|   ';

function createRenderHelpers({ statValue } = {}) {
    if (typeof statValue !== 'function') throw new Error('createRenderHelpers requires statValue');

    function statComponent(label, value, hover, color = '§e') {
        return {
            text: `§f${label}: ${color}${value}`,
            hoverEvent: { action: 'show_text', value: hover }
        };
    }

    function ratioComponent(label, left, right, ratio, hover, ratioColor = '§e') {
        return {
            text: `§f${label}: §a${formatInt(left)}§8/§c${formatInt(right)} §8(${ratioColor}${formatRatio(ratio)}§8)`,
            hoverEvent: { action: 'show_text', value: hover }
        };
    }

    function navButton(text, command, hover, color = '§6') {
        return {
            text: `${color}[${text}]`,
            clickEvent: { action: 'run_command', value: command },
            hoverEvent: { action: 'show_text', value: hover || `§7Click: §e${command}` }
        };
    }

    function addComponents(base, components) {
        components.forEach(component => base.extra.push(typeof component === 'string' ? { text: component } : component));
    }

    function sendStatRow(client, components) {
        const row = { text: '', extra: [] };
        addComponents(row, components);
        sendChat(client, row);
    }

    function chatCharWidth(char) {
        if (char === ' ') return 4;
        if ("!.,:;i|".includes(char)) return 2;
        if ("'`l".includes(char)) return 3;
        if ('[](){}tfI'.includes(char)) return 4;
        if ('"*<>'.includes(char)) return 5;
        return 6;
    }

    function chatTextWidth(text) {
        return stripAnsi(String(text || '')).split('').reduce((sum, char) => sum + chatCharWidth(char), 0);
    }

    function padChatEnd(text, targetWidth) {
        const missing = targetWidth - chatTextWidth(text);
        return String(text || '') + ' '.repeat(Math.max(0, Math.ceil(missing / chatCharWidth(' '))));
    }

    function coloredInt(value, color = '§e') {
        return `${color}${formatInt(value)}`;
    }

    function coloredRatio(value, colorFn) {
        return `${colorFn(value)}${formatRatio(value)}`;
    }

    function coloredSigned(value, color = null, digits = 0) {
        const number = Number(value) || 0;
        const nextColor = color || (number > 0 ? '§a' : number < 0 ? '§c' : '§7');
        return `${nextColor}${formatSigned(number, digits)}`;
    }

    function formatDecimalIfNeeded(value, digits = 2) {
        const number = Number(value) || 0;
        return number.toFixed(digits).replace(/\.?0+$/, '');
    }

    function coloredSignedDecimal(value, color = null, digits = 2) {
        const number = Number(value) || 0;
        const nextColor = color || (number > 0 ? '§a' : number < 0 ? '§c' : '§7');
        const sign = number > 0 ? '+' : '';
        return `${nextColor}${sign}${formatDecimalIfNeeded(number, digits)}`;
    }

    function coloredSignedFixed(value, color = null, digits = 2) {
        const number = Number(value) || 0;
        const nextColor = color || (number > 0 ? '§a' : number < 0 ? '§c' : '§7');
        const sign = number > 0 ? '+' : '';
        return `${nextColor}${sign}${number.toFixed(digits)}`;
    }

    function statText(label, value) {
        return `§f${label}: ${value}`;
    }

    function statPair(left, right = null) {
        const first = statText(left[0], left[1]);
        if (!right) return first;
        return `${first}     ${statText(right[0], right[1])}`;
    }

    function cardDivider(color = '§8') {
        return `${color}§m--------------------------------`;
    }

    function sendUrchinSection(client, title, rows, color = '§6') {
        sendChat(client, cardDivider('§8'));
        rows.forEach(row => {
            const cells = row.filter(Boolean);
            sendChat(client, statPair(cells[0], cells[1]));
        });
    }

    function bedwarsProgressInfo(bw = {}, stars = 0) {
        const xp = statValue(bw, 'Experience');
        if (!Number.isFinite(Number(xp)) || xp <= 0) return null;

        const progress = Math.max(0, Math.min(1, (xp % 5000) / 5000));
        return {
            stars: Number(stars) || 0,
            nextStars: (Number(stars) || 0) + 1,
            progress
        };
    }

    function progressBar(progress, width = 20) {
        const filled = Math.max(0, Math.min(width, Math.round((Number(progress) || 0) * width)));
        return `§b${'¦'.repeat(filled)}§8${'¦'.repeat(width - filled)}`;
    }

    function sendBedwarsProgress(client, bw = {}, stars = 0) {
        const progress = bedwarsProgressInfo(bw, stars);
        if (!progress) return;
        sendChat(client, `§8${formatBedwarsPrestige(progress.stars)} ${progressBar(progress.progress)} §8${formatBedwarsPrestige(progress.nextStars)}`);
    }

    function bedwarsLevelPrefix(stars) {
        if (!Number.isFinite(Number(stars))) return '';
        return `${formatBedwarsPrestige(stars)} `;
    }

    function coloredPingValue(value) {
        const ping = Number(value);
        return ping > 0 ? `${getPingColor(ping)}${formatInt(ping)}ms` : '§7-1ms';
    }

    function avgPingBadge(data = {}) {
        return ` §8(${coloredPingValue(data?.ping?.avgPing)}§8)`;
    }

    function formatBedwarsMiniCard(title, stats) {
        const lines = [
            `§6§l${title}`,
            cardDivider('§8'),
            statPair(['WLR', coloredRatio(stats.wlr, getWlrColor)], ['FKDR', coloredRatio(stats.fkdr, getFkdrColor)]),
            statPair(['KDR', coloredRatio(stats.kdr, getKdrColor)], ['BBLR', `§e${formatRatio(stats.bblr)}`]),
            cardDivider('§8'),
            statPair(['Wins', coloredInt(stats.wins, '§a')], ['Losses', coloredInt(stats.losses, '§c')]),
            statPair(['Finals', coloredInt(stats.finals, '§a')], ['FDeaths', coloredInt(stats.finalDeaths, '§c')]),
            statPair(['Kills', coloredInt(stats.kills, '§a')], ['Deaths', coloredInt(stats.deaths, '§c')]),
            statPair(['Beds', coloredInt(stats.beds, '§a')], ['Beds Lost', coloredInt(stats.bedsLost, '§c')]),
            cardDivider('§8'),
            statPair(['Games', coloredInt(stats.games, '§e')], ['WS', `${getWsColor(stats.ws)}${formatInt(stats.ws)}`])
        ];

        return lines.join('\n');
    }

    function formatSkyWarsMiniCard(title, stats) {
        const lines = [
            `§b§l${title}`,
            cardDivider('§8'),
            statPair(['WLR', coloredRatio(stats.wlr, getWlrColor)], ['KDR', coloredRatio(stats.kdr, getKdrColor)]),
            cardDivider('§8'),
            statPair(['Wins', coloredInt(stats.wins, '§a')], ['Losses', coloredInt(stats.losses, '§c')]),
            statPair(['Kills', coloredInt(stats.kills, '§a')], ['Deaths', coloredInt(stats.deaths, '§c')]),
            statPair(['Assists', coloredInt(stats.assists, '§e')], ['Games', coloredInt(stats.games, '§e')]),
            cardDivider('§8'),
            statPair(['Playtime', `§b${formatDuration(stats.playtime)}`], ['Level', coloredSignedFixed(stats.levelGained, '§b', 2)])
        ];

        if (stats.topKit) {
            lines.push(statPair(['Top Kit', `§d${stats.topKit.label}`], ['Kit Games', coloredInt(stats.topKit.games, '§e')]));
        }

        return lines.join('\n');
    }

    function formatPercentValue(value, digits = 1) {
        return `${((Number(value) || 0) * 100).toFixed(digits)}%`;
    }

    function formatDuelsMiniCard(title, stats) {
        const lines = [
            `§d§l${title}`,
            cardDivider('§8'),
            statPair(['WLR', coloredRatio(stats.wlr, getDuelsRatioColor)], ['KDR', coloredRatio(stats.kdr, getDuelsRatioColor)]),
            statPair(['Winrate', `${getWinrateColor(stats.winrate)}${formatPercentValue(stats.winrate)}`], ['Best WS', `${getDuelsWinstreakColor(stats.bestWs)}${formatInt(stats.bestWs)}`]),
            cardDivider('§8'),
            statPair(['Wins', coloredInt(stats.wins, '§a')], ['Losses', coloredInt(stats.losses, '§c')]),
            statPair(['Kills', coloredInt(stats.kills, '§a')], ['Deaths', coloredInt(stats.deaths, '§c')]),
            statPair(['Games', coloredInt(stats.games, '§f')], ['Melee Acc', `§b${formatPercentValue(stats.meleeAccuracy)}`])
        ];

        return lines.join('\n');
    }

    return {
        STAT_GAP,
        statComponent,
        ratioComponent,
        navButton,
        addComponents,
        sendStatRow,
        chatCharWidth,
        chatTextWidth,
        padChatEnd,
        coloredInt,
        coloredRatio,
        coloredSigned,
        formatDecimalIfNeeded,
        coloredSignedDecimal,
        coloredSignedFixed,
        statText,
        statPair,
        cardDivider,
        sendUrchinSection,
        bedwarsProgressInfo,
        progressBar,
        sendBedwarsProgress,
        bedwarsLevelPrefix,
        avgPingBadge,
        coloredPingValue,
        formatBedwarsMiniCard,
        formatSkyWarsMiniCard,
        formatPercentValue,
        formatDuelsMiniCard
    };
}

module.exports = { createRenderHelpers, STAT_GAP };
