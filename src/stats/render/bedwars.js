'use strict';

// BedWars stat rendering: the /stats card, its per-mode stat rows, and
// the session card used by /daily, /weekly, /monthly, /yearly bw.
//
// Direct module deps cover the chat primitives + format/color modules.
// The factory takes:
//   - `helpers` — the createRenderHelpers output (mini cards, urchin
//     sections, colored value formatters, etc.)
//   - `deps` — pieces that still live in proxy.js or come from sibling
//     factories: collectBedwarsStats (from createStatsCollector),
//     BEDWARS_MODE_DEFS, SESSION_PERIODS, and the four shared render
//     entry points (renderStatsMetaBlock, renderModeNav, renderPeriodNav,
//     sessionMiniCard) that the general/dashboard/nav carve will move
//     later.

const { sendChat, getRankedName } = require('../../../features/minecraft_chat.js');
const { titleCaseWords } = require('../../util/text.js');
const { formatInt, formatRatio } = require('../format.js');
const {
    getWlrColor,
    getFkdrColor,
    getKdrColor,
    getWsColor
} = require('../colors.js');

function createBedwarsRender({ helpers, deps } = {}) {
    if (!helpers) throw new Error('createBedwarsRender requires helpers');
    if (!deps) throw new Error('createBedwarsRender requires deps');

    const {
        coloredSigned,
        coloredInt,
        coloredRatio,
        coloredSignedFixed,
        sendUrchinSection,
        statPair,
        bedwarsLevelPrefix,
        avgPingBadge,
        formatBedwarsMiniCard
    } = helpers;

    const {
        collectBedwarsStats,
        sessionMiniCard,
        renderStatsMetaBlock,
        renderModeNav,
        renderPeriodNav,
        BEDWARS_MODE_DEFS,
        SESSION_PERIODS
    } = deps;

    function renderBedwarsModeStatRows(client, stats, {
        session = false,
        periodLabel = null,
        stars = null,
        sessionProgressStats = null,
        separateDetails = true,
        separatePerformance = true
    } = {}) {
        const good = value => session ? coloredSigned(value, '§a') : coloredInt(value, '§a');
        const bad = value => session ? coloredSigned(value, '§c') : coloredInt(value, '§c');
        const neutral = value => session ? coloredSigned(value, '§6') : coloredInt(value, '§e');
        const progressStats = sessionProgressStats || stats;

        sendUrchinSection(client, 'Ratios', [
            [['WLR', coloredRatio(stats.wlr, getWlrColor)], ['FKDR', coloredRatio(stats.fkdr, getFkdrColor)]],
            [['KDR', coloredRatio(stats.kdr, getKdrColor)], ['BBLR', `§e${formatRatio(stats.bblr)}`]]
        ]);

        const performanceRows = [
            [['Kills', good(stats.kills)], ['Deaths', bad(stats.deaths)]],
            [['Beds', good(stats.beds)], ['Beds Lost', bad(stats.bedsLost)]],
            [['Wins', good(stats.wins)], ['Losses', bad(stats.losses)]],
            [['Finals', good(stats.finals)], ['FDeaths', bad(stats.finalDeaths)]]
        ];

        if (separatePerformance) {
            sendUrchinSection(client, 'Performance', performanceRows);
        } else {
            sendChat(client, '§r ');
            performanceRows.forEach(row => {
                const cells = row.filter(Boolean);
                sendChat(client, statPair(cells[0], cells[1]));
            });
        }

        const details = [
            [['Games', neutral(stats.games)], ['WS', session ? coloredSigned(stats.ws, '§6') : `${getWsColor(stats.ws)}${formatInt(stats.ws)}`]]
        ];

        if (periodLabel) details.push([['Period', `§6${periodLabel}`]]);
        if (session && Number.isFinite(Number(progressStats.starsGained))) {
            details.push([['Stars', coloredSignedFixed(progressStats.starsGained, '§6', 2)]]);
        }

        if (separateDetails) {
            sendUrchinSection(client, 'Details', details);
        } else {
            sendChat(client, '§r ');
            details.forEach(row => {
                const cells = row.filter(Boolean);
                sendChat(client, statPair(cells[0], cells[1]));
            });
        }
    }

    function renderBedwarsStats(client, data, mode = BEDWARS_MODE_DEFS[0], { detailed = false, isCached = false } = {}) {
        const p = data.player;
        const bw = p.stats?.Bedwars || {};
        const stars = p.achievements?.bedwars_level || 0;
        const stats = collectBedwarsStats(bw, mode, data);
        const name = getRankedName(p);
        const line = '§8§m--------------------------------------------------';

        sendChat(client, `\n${line}`);
        sendChat(client, `${bedwarsLevelPrefix(stars)}${name}${avgPingBadge(data)}${isCached ? ' §8(Cached)' : ''}`);
        renderStatsMetaBlock(client, data, stars);
        sendChat(client, '§r ');
        renderModeNav(client, p.displayname, 'BEDWARS', mode, null, {
            hoverForMode: (previewMode) => {
                const previewStats = collectBedwarsStats(bw, previewMode, data);
                return formatBedwarsMiniCard(`Bedwars ${previewMode.label}`, previewStats);
            }
        });

        renderBedwarsModeStatRows(client, stats, { stars, separateDetails: false, separatePerformance: false });
        sendChat(client, '§r ');

        if (detailed) {
            sendChat(client, '§r ');
            sendChat(client, '§6§lDetailed Modes');
            BEDWARS_MODE_DEFS.filter(m => m.id !== 'overall').forEach(m => {
                const s = collectBedwarsStats(bw, m, data);
                sendChat(client, `§6§l${m.label}`);
                renderBedwarsModeStatRows(client, s, { separateDetails: false, separatePerformance: false });
            });
        }

        sendChat(client, `${line}\n`);
    }

    function renderBedwarsSession(client, player, displayName, period, mode, root, periodData = {}, profileData = null, options = {}) {
        const bw = root.delta?.stats?.Bedwars || {};
        const stats = collectBedwarsStats(bw, mode, root);
        const overallSessionStats = collectBedwarsStats(bw, BEDWARS_MODE_DEFS[0], root);
        const profilePlayer = profileData?.player;
        const profileStars = profilePlayer?.achievements?.bedwars_level;
        const periodLabel = SESSION_PERIODS[period]?.label || titleCaseWords(period);
        const line = '§8§m--------------------------------------------------';
        const headerName = Number.isFinite(Number(profileStars))
            ? `${bedwarsLevelPrefix(profileStars)}${displayName}${avgPingBadge(profileData)}`
            : `${displayName}${avgPingBadge(profileData)}`;

        sendChat(client, `\n${line}`);
        sendChat(client, headerName);
        if (options.showPeriodNav === false) sendChat(client, '§r ');
        if (options.showPeriodNav !== false) {
            renderPeriodNav(client, player, 'BEDWARS', mode, period, {
                hoverForPeriod: (previewPeriod) => sessionMiniCard('BEDWARS', mode, previewPeriod, periodData[previewPeriod])
            });
        }
        renderModeNav(client, player, 'BEDWARS', mode, period, {
            commandForMode: options.periodShortcut
                ? (previewMode) => `/${period} ${player} bw ${previewMode.short}`
                : undefined,
            hoverForMode: (previewMode) => {
                const previewStats = collectBedwarsStats(bw, previewMode, root);
                const previewLabel = SESSION_PERIODS[period]?.label || titleCaseWords(period);
                return formatBedwarsMiniCard(`Bedwars ${previewMode.label} - ${previewLabel}`, previewStats);
            }
        });
        if (options.showStats) {
            renderBedwarsModeStatRows(client, stats, {
                session: true,
                periodLabel,
                stars: Number.isFinite(Number(profileStars)) ? profileStars : null,
                sessionProgressStats: overallSessionStats
            });
        }
        sendChat(client, `${line}\n`);
    }

    return {
        renderBedwarsModeStatRows,
        renderBedwarsStats,
        renderBedwarsSession
    };
}

module.exports = { createBedwarsRender };
