'use strict';

// SkyWars stat rendering: the /sw card (renderSkyWarsDashboard), its
// per-mode stat rows, and the session card used by /daily, /weekly,
// /monthly, /yearly sw.
//
// Mirrors src/stats/render/bedwars.js. The factory takes:
//   - `helpers` — createRenderHelpers output (urchin sections, mini
//     cards, colored value formatters)
//   - `deps` — collectSkyWarsStats, findModeDef, SKYWARS_MODE_DEFS,
//     SESSION_PERIODS, and the still-in-proxy shared render entry points
//     (sessionMiniCard, renderStatsMetaBlock, renderModeNav,
//     renderPeriodNav).

const { sendChat, getRankedName } = require('../../../features/minecraft_chat.js');
const { titleCaseWords } = require('../../util/text.js');
const { formatInt, formatRatio, formatDuration, formatSkyWarsLevel } = require('../format.js');
const { getWlrColor, getKdrColor } = require('../colors.js');

function createSkywarsRender({ helpers, deps } = {}) {
    if (!helpers) throw new Error('createSkywarsRender requires helpers');
    if (!deps) throw new Error('createSkywarsRender requires deps');

    const {
        coloredSigned,
        coloredInt,
        coloredRatio,
        coloredSignedFixed,
        formatDecimalIfNeeded,
        sendUrchinSection,
        avgPingBadge,
        formatSkyWarsMiniCard
    } = helpers;

    const {
        collectSkyWarsStats,
        findModeDef,
        sessionMiniCard,
        renderStatsMetaBlock,
        renderModeNav,
        renderPeriodNav,
        SKYWARS_MODE_DEFS,
        SESSION_PERIODS
    } = deps;

    function renderSkyWarsModeStatRows(client, stats, { periodLabel = null, session = false } = {}) {
        const good = value => session ? coloredSigned(value, '§a') : coloredInt(value, '§a');
        const bad = value => session ? coloredSigned(value, '§c') : coloredInt(value, '§c');
        const neutral = value => session ? coloredSigned(value, '§e') : coloredInt(value, '§e');
        const levelValue = session
            ? coloredSignedFixed(stats.levelGained, '§b', 2)
            : `§b${formatDecimalIfNeeded(stats.levelGained, 2)}`;

        sendUrchinSection(client, 'Ratios', [
            [['WLR', coloredRatio(stats.wlr, getWlrColor)], ['KDR', coloredRatio(stats.kdr, getKdrColor)]]
        ], '§b');

        sendUrchinSection(client, 'Performance', [
            [['Kills', good(stats.kills)], ['Deaths', bad(stats.deaths)]],
            [['Wins', good(stats.wins)], ['Losses', bad(stats.losses)]],
            [['Assists', neutral(stats.assists)]]
        ], '§b');

        const details = [
            [['Games', session ? coloredSigned(stats.games, '§6') : coloredInt(stats.games, '§6')], ['Playtime', `§b${formatDuration(stats.playtime)}`]],
            [['Level', levelValue]]
        ];
        if (periodLabel) details.push([['Period', `§6${periodLabel}`]]);
        if (stats.topKit) details.push([['Top Kit', `§d${stats.topKit.label}`]]);

        sendUrchinSection(client, 'Details', details, '§b');
    }

    function renderSkyWarsDashboard(client, data, isCached, mode = SKYWARS_MODE_DEFS[0]) {
        const p = data.player;
        const sw = p.stats?.SkyWars || {};
        const activeMode = findModeDef('SKYWARS', mode?.id || mode?.short || 'overall');
        const stats = collectSkyWarsStats(sw, activeMode, data);
        const level = formatSkyWarsLevel(sw, p);
        const name = getRankedName(p);
        const line = '§b§m--------------------------------------------------';

        sendChat(client, `\n${line}`);
        sendChat(client, `§b§lSkyWars §8| ${level} ${name}${avgPingBadge(data)}${isCached ? ' §8(Cached)' : ''}`);
        renderStatsMetaBlock(client, data);
        sendChat(client, '§r ');
        renderModeNav(client, p.displayname, 'SKYWARS', activeMode, null, {
            hoverForMode: (previewMode) => {
                const previewStats = collectSkyWarsStats(sw, previewMode, data);
                return formatSkyWarsMiniCard(`SkyWars ${previewMode.label}`, previewStats);
            },
            commandForMode: (previewMode) => `/sw ${p.displayname} ${previewMode.short || previewMode.id}`
        });
        renderSkyWarsModeStatRows(client, stats);
        sendChat(client, `${line}\n`);
    }

    function renderSkyWarsSession(client, player, displayName, period, mode, root, periodData = {}, profileData = null, options = {}) {
        const sw = root.delta?.stats?.SkyWars || {};
        const stats = collectSkyWarsStats(sw, mode, root);
        const periodLabel = SESSION_PERIODS[period]?.label || titleCaseWords(period);
        const line = '§8§m--------------------------------------------------';
        const profilePlayer = profileData?.player;
        const profileSw = profilePlayer?.stats?.SkyWars || {};
        const headerName = profilePlayer
            ? `${formatSkyWarsLevel(profileSw, profilePlayer)} ${displayName}${avgPingBadge(profileData)}`
            : `${displayName}${avgPingBadge(profileData)}`;

        sendChat(client, `\n${line}`);
        sendChat(client, headerName);
        if (options.showPeriodNav === false) sendChat(client, '§r ');
        if (options.showPeriodNav !== false) {
            renderPeriodNav(client, player, 'SKYWARS', mode, period, {
                hoverForPeriod: (previewPeriod) => sessionMiniCard('SKYWARS', mode, previewPeriod, periodData[previewPeriod])
            });
        }
        renderModeNav(client, player, 'SKYWARS', mode, period, {
            commandForMode: options.periodShortcut
                ? (previewMode) => `/${period} ${player} sw ${previewMode.short}`
                : undefined,
            hoverForMode: (previewMode) => {
                const previewStats = collectSkyWarsStats(sw, previewMode, root);
                const previewLabel = SESSION_PERIODS[period]?.label || titleCaseWords(period);
                return formatSkyWarsMiniCard(`SkyWars ${previewMode.label} - ${previewLabel}`, previewStats);
            }
        });
        if (options.showStats) {
            renderSkyWarsModeStatRows(client, stats, { periodLabel, session: true });
        }
        sendChat(client, `${line}\n`);
    }

    return {
        renderSkyWarsModeStatRows,
        renderSkyWarsDashboard,
        renderSkyWarsSession
    };
}

module.exports = { createSkywarsRender };
