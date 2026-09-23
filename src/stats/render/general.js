'use strict';

// Shared render plumbing + general-stats rendering: the mode/period nav
// builders consumed by all per-game cards, the meta block, the
// /general card with its network/account/guild sections, /playerinfo,
// /ping details, and the session mini-card preview.
//
// renderDashboard intentionally stays in proxy.js for now — its inline
// urchin/seraph tag parser is overlay-tag territory and will move when
// the overlay/tags carve happens. buildPlayerInfoTagComponents is in the
// same boat and is injected via deps so the meta block can keep working.

const { sendChat, getRankedName, getHypixelRankLabel } = require('../../../features/minecraft_chat.js');
const { normalizeUuidText } = require('../../util/uuid.js');
const { titleCaseWords } = require('../../util/text.js');

function createGeneralRender({ helpers, deps } = {}) {
    if (!helpers) throw new Error('createGeneralRender requires helpers');
    if (!deps) throw new Error('createGeneralRender requires deps');

    const {
        navButton,
        addComponents,
        sendStatRow,
        statComponent,
        STAT_GAP,
        sendUrchinSection,
        coloredInt,
        coloredPingValue,
        avgPingBadge,
        formatDecimalIfNeeded,
        formatPercentValue,
        formatBedwarsMiniCard,
        formatSkyWarsMiniCard
    } = helpers;

    const {
        collectBedwarsStats,
        collectSkyWarsStats,
        buildPlayerInfoTagComponents,
        getPingColor,
        makePingData,
        SESSION_PERIODS
    } = deps;

    function sessionMiniCard(game, mode, period, root) {
        const periodLabel = SESSION_PERIODS[period]?.label || titleCaseWords(period);
        if (!root || root.error) return `§c${periodLabel} preview unavailable\n§7${root?.error || 'No data loaded.'}`;

        if (game === 'SKYWARS') {
            const stats = collectSkyWarsStats(root.delta?.stats?.SkyWars || {}, mode, root);
            return formatSkyWarsMiniCard(`SkyWars ${mode.label} - ${periodLabel}`, stats);
        }

        const stats = collectBedwarsStats(root.delta?.stats?.Bedwars || {}, mode, root);
        return formatBedwarsMiniCard(`Bedwars ${mode.label} - ${periodLabel}`, stats);
    }

    function renderModeNav(client, player, game, activeMode, activePeriod = null, options = {}) {
        const defs = deps.visibleModeDefs(game);
        const commandBase = options.commandForMode || (activePeriod
            ? (mode) => `/${activePeriod} ${player} ${game === 'SKYWARS' ? 'sw' : 'bw'} ${mode.short}`
            : (mode) => `/stats ${player} ${mode.short}`);
        const msg = { text: '', extra: options.showLabel === false ? [] : [{ text: '§fModes:  ' }] };
        defs.forEach((mode, index) => {
            if (index > 0) msg.extra.push({ text: '  ' });
            const hover = options.hoverForMode ? options.hoverForMode(mode) : `§7View ${mode.label}`;
            msg.extra.push(navButton(mode.label, commandBase(mode), hover, mode.id === activeMode.id ? '§a' : '§8'));
        });
        sendChat(client, msg);
    }

    function renderPeriodNav(client, player, game, mode, activePeriod, options = {}) {
        const msg = { text: '', extra: options.showLabel === false ? [] : [{ text: '§8Periods:  ' }] };
        Object.entries(SESSION_PERIODS).forEach(([period, def], index) => {
            if (index > 0) msg.extra.push({ text: '  ' });
            const hover = options.hoverForPeriod ? options.hoverForPeriod(period) : `§7View ${def.label}`;
            msg.extra.push(navButton(def.label, `/${period} ${player} ${game === 'SKYWARS' ? 'sw' : 'bw'} ${mode.short}`, hover, period === activePeriod ? '§a' : '§8'));
        });
        sendChat(client, msg);
    }

    function renderStatsMetaBlock(client, data, stars) {
        const tagsLine = { text: '', extra: [{ text: '§fTags: ' }] };
        addComponents(tagsLine, buildPlayerInfoTagComponents(data));
        sendChat(client, tagsLine);
    }

    function networkLevelExact(exp) {
        const value = Math.max(0, Number(exp) || 0);
        return Math.max(1, (Math.sqrt((2 * value) + 30625) / 50) - 2.5);
    }

    function networkXpForLevel(level) {
        const safeLevel = Math.max(1, Number(level) || 1);
        return Math.max(0, Math.ceil((1250 * Math.pow(safeLevel + 2.5, 2)) - 15312.5));
    }

    function networkLevelProgress(exp) {
        const exact = networkLevelExact(exp);
        const level = Math.max(1, Math.floor(exact));
        const currentXp = networkXpForLevel(level);
        const nextXp = networkXpForLevel(level + 1);
        const total = Math.max(1, nextXp - currentXp);
        const earned = Math.max(0, Math.min(total, (Number(exp) || 0) - currentXp));
        return {
            exact,
            level,
            nextLevel: level + 1,
            earned,
            total,
            remaining: Math.max(0, nextXp - (Number(exp) || 0)),
            ratio: earned / total
        };
    }

    function formatDateShort(timestamp) {
        const value = Number(timestamp);
        if (!Number.isFinite(value) || value <= 0) return 'Unknown';
        return new Date(value).toISOString().slice(0, 10);
    }

    function ageDaysSince(timestamp) {
        const value = Number(timestamp);
        if (!Number.isFinite(value) || value <= 0) return null;
        return Math.max(0, (Date.now() - value) / 86400000);
    }

    function formatDays(value) {
        const days = Number(value);
        if (!Number.isFinite(days)) return 'Unknown';
        if (days >= 365) return `${formatDecimalIfNeeded(days / 365, 1)}y`;
        if (days >= 30) return `${formatDecimalIfNeeded(days / 30, 1)}mo`;
        return `${formatDecimalIfNeeded(days, 1)}d`;
    }

    function generalRankLabel(player = {}) {
        // Ask the resolver for the rank on its own rather than subtracting the
        // name out of the rendered one: a custom prefix that happens to
        // contain the player's name used to lose a chunk of the label.
        return getHypixelRankLabel(player);
    }

    function guildMemberInfo(guild = {}, uuid = '') {
        const clean = normalizeUuidText(uuid);
        return (guild.members || []).find(member => normalizeUuidText(member.uuid) === clean) || null;
    }

    function renderGeneralStats(client, data, guild = null, { isCached = false } = {}) {
        const p = data.player;
        const name = getRankedName(p);
        const exp = Number(p.networkExp) || 0;
        const progress = networkLevelProgress(exp);
        const accountAgeDays = ageDaysSince(p.firstLogin);
        const xpPerDay = accountAgeDays && accountAgeDays > 0 ? exp / accountAgeDays : 0;
        const levelsPerMonth = accountAgeDays && accountAgeDays > 0 ? (progress.exact - 1) / accountAgeDays * 30 : 0;
        const guildMember = guildMemberInfo(guild || {}, p.uuid);
        const line = '§a§m--------------------------------------------------';

        sendChat(client, `\n${line}`);
        sendChat(client, `§a§lGeneral §8| ${name}${avgPingBadge(data)}${isCached ? ' §8(Cached)' : ''}`);
        renderStatsMetaBlock(client, data);
        sendChat(client, '§r ');

        const nav = { text: '', extra: [{ text: '§fCards:  ' }] };
        [
            ['BedWars', `/stats ${p.displayname}`, '§6View BedWars card'],
            ['SkyWars', `/sw ${p.displayname}`, '§bView SkyWars card'],
            ['Duels', `/duels ${p.displayname}`, '§dView Duels card'],
            ['Ping', `/ping ${p.displayname}`, '§eView Aurora ping history'],
        ].forEach(([label, command, hover], index) => {
            if (index > 0) nav.extra.push({ text: '  ' });
            nav.extra.push(navButton(label, command, hover, '§8'));
        });
        sendChat(client, nav);

        sendUrchinSection(client, 'Network', [
            [['Level', `§a${formatDecimalIfNeeded(progress.exact, 2)}`], ['Progress', `§b${formatPercentValue(progress.ratio)}`]],
            [['XP Total', coloredInt(exp, '§e')], ['XP Left', coloredInt(progress.remaining, '§6')]],
            [['XP / Day', coloredInt(xpPerDay, '§b')], ['Levels / Month', `§b${formatDecimalIfNeeded(levelsPerMonth, 2)}`]]
        ], '§a');

        sendUrchinSection(client, 'Account', [
            [['Rank', `§f${generalRankLabel(p)}`], ['AP', coloredInt(p.achievementPoints, '§e')]],
            [['Karma', coloredInt(p.karma, '§d')], ['Recent Game', `§b${titleCaseWords(p.mostRecentGameType || 'Unknown')}`]],
            [['First Login', `§7${formatDateShort(p.firstLogin)}`], ['Age', `§7${formatDays(accountAgeDays)}`]],
            [['Last Login', `§7${formatDateShort(p.lastLogin)}`], ['Last Logout', `§7${formatDateShort(p.lastLogout)}`]]
        ], '§a');

        if (guild) {
            sendUrchinSection(client, 'Guild', [
                [['Name', `§a${guild.name || 'Unknown'}`], ['Tag', guild.tag ? `§6[${guild.tag}]` : '§8None']],
                [['Rank', `§f${guildMember?.rank || 'Member'}`], ['Members', coloredInt((guild.members || []).length, '§e')]],
                [['Guild XP', coloredInt(guild.exp, '§b')], ['Joined', `§7${formatDateShort(guildMember?.joined)}`]]
            ], '§a');
        } else {
            sendUrchinSection(client, 'Guild', [
                [['Guild', '§8None or private'], ['Members', '§80']]
            ], '§a');
        }

        sendChat(client, `${line}\n`);
    }

    function renderPlayerInfo(client, data, isCached = false) {
        const p = data.player;
        const name = getRankedName(p);
        const line = '§8§m--------------------------------------------------';
        const ping = Number(data.ping?.ping);
        const avgPing = Number(data.ping?.avgPing);
        const pingText = ping > 0 ? `${ping}ms` : '-1ms';
        const avgText = avgPing > 0 ? `${avgPing}ms` : '-1ms';
        const pingColor = ping > 0 ? getPingColor(ping) : '§7';
        const avgColor = avgPing > 0 ? getPingColor(avgPing) : '§7';

        sendChat(client, `\n${line}`);
        sendChat(client, `${name}${isCached ? ' §8(Cached)' : ''}`);
        sendChat(client, '§r ');

        sendStatRow(client, [
            statComponent('Ping', pingText, '§7Today average ping from Aurora, or latest available day', pingColor),
            STAT_GAP,
            statComponent('Avg Ping', avgText, '§7Last 7 days average ping from Aurora', avgColor)
        ]);

        sendChat(client, `§fServer: ${data.status || '§7Unknown'}`);

        const tagsLine = { text: '', extra: [{ text: '§fTags: ' }] };
        addComponents(tagsLine, buildPlayerInfoTagComponents(data));
        sendChat(client, tagsLine);

        sendChat(client, `${line}\n`);
    }

    function pingRangeText(min, avg, max) {
        return `§7Min: ${coloredPingValue(min)} §8| §fAvg: ${coloredPingValue(avg)} §8| §7Max: ${coloredPingValue(max)}`;
    }

    function renderPingDetails(client, player, ping = makePingData()) {
        const line = '§8§m--------------------------------------------------';
        const status = ping.ok === false
            ? `§c${ping.error || 'Aurora ping lookup failed.'}`
            : (ping.totalDays > 0 ? '§aAurora data found' : '§7No ping history found');

        sendChat(client, `\n${line}`);
        sendChat(client, `§b§lPing §8| §f${player}`);
        sendChat(client, `§fStatus: ${status}`);
        sendChat(client, '§r ');
        sendChat(client, `§fDisplay Ping: ${coloredPingValue(ping.ping)} §8(today avg or latest)`);
        sendChat(client, `§fWeekly Avg: ${coloredPingValue(ping.avgPing)} §8(last 7 days if available)`);
        sendChat(client, '§r ');
        sendChat(client, `§eToday: §f${pingRangeText(ping.todayMin, ping.todayAvg, ping.todayMax)}`);
        sendChat(client, `§6Latest${ping.latestDay ? ` §8(${ping.latestDay})` : ''}: §f${pingRangeText(ping.latestMin, ping.latestAvg, ping.latestMax)}`);
        sendChat(client, `§aWeekly §8(${ping.weeklyDays || 0}d): §f${pingRangeText(ping.weeklyMin, ping.weeklyAvg, ping.weeklyMax)}`);
        sendChat(client, `§dMonthly §8(${ping.monthlyDays || 0}d): §f${pingRangeText(ping.monthlyMin, ping.monthlyAvg, ping.monthlyMax)}`);
        sendChat(client, `§7Records: §f${ping.totalDays || 0} §8| §7Source: §bAurora`);
        sendChat(client, `${line}\n`);
    }

    return {
        sessionMiniCard,
        renderModeNav,
        renderPeriodNav,
        renderStatsMetaBlock,
        networkLevelExact,
        networkXpForLevel,
        networkLevelProgress,
        formatDateShort,
        ageDaysSince,
        formatDays,
        generalRankLabel,
        guildMemberInfo,
        renderGeneralStats,
        renderPlayerInfo,
        pingRangeText,
        renderPingDetails
    };
}

module.exports = { createGeneralRender };
