'use strict';

// Render layer for the LOCAL session tracker and the post-game recap.
//
// Distinct from renderBedwarsSession/renderSkyWarsSession, which draw the
// Urchin-backed /daily|/weekly cards. Those fetch a remote period delta; this
// one draws a delta the proxy computed itself from two Hypixel snapshots.
// Both end up feeding the same collectors, so the numbers are directly
// comparable — the header wording is what tells the user which is which.
//
// Every value shown is a delta, so counts render signed (+4 / -1) and ratios
// render as plain session ratios (Δfinals / Δfinal_deaths), never as a
// difference of two lifetime ratios.

const { sendChat } = require('../../../features/minecraft_chat.js');
const { formatInt, formatRatio, formatDuration } = require('../format.js');
const { scoreboardRecapMessages, chatTextWidth, CHAT_WIDTH } = require('../recapScoreboard.js');
const { normalizeRecapFields } = require('../../session/settings.js');
const { gameModes } = require('../../session/observedStats.js');
const {
    getWlrColor,
    getFkdrColor,
    getKdrColor
} = require('../colors.js');

const GAME_LABELS = {
    Bedwars: 'BedWars',
    SkyWars: 'SkyWars',
    Duels: 'Duels'
};

const MODE_LABELS = {
    BEDWARS: 'BedWars',
    SKYWARS: 'SkyWars',
    DUELS: 'Duels'
};

// "1h 23m" / "6m 12s" / "48s" — finer grained than stats/format's
// formatDuration, which is minute-resolution and takes seconds.
function formatShortDuration(ms) {
    const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

// A game block is drawn only when a GAMEPLAY counter moved — not when any
// key in the blob happened to change. SkyWars carries coins, souls, and
// cosmetic counters that tick from lobby activity and daily rewards; treating
// those as "you played SkyWars" put a whole SkyWars section on the card of
// someone who only played BedWars.
const { hasGameplayMovement } = require('../../session/sessionSnapshot.js');

function hasMovement(stats) {
    return hasGameplayMovement(stats);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(value) {
    return String(value).padStart(2, '0');
}

// "Today 14:32" / "Yesterday 09:05" / "Aug 2, 21:40" — short enough for a
// history row, unambiguous across a long history.
function formatSessionStamp(timestamp, now = Date.now()) {
    const stamp = Number(timestamp) || 0;
    if (!stamp) return 'unknown';
    const date = new Date(stamp);
    const today = new Date(now);
    const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

    const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();

    if (sameDay(date, today)) return `Today ${clock}`;
    const yesterday = new Date(now - 86400000);
    if (sameDay(date, yesterday)) return `Yesterday ${clock}`;
    if (date.getFullYear() !== today.getFullYear()) {
        return `${MONTHS[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`;
    }
    return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${clock}`;
}

function createSessionRender({ helpers, deps } = {}) {
    if (!helpers) throw new Error('createSessionRender requires helpers');
    if (!deps) throw new Error('createSessionRender requires deps');

    const {
        coloredSigned,
        coloredSignedFixed,
        coloredRatio,
        statPair,
        cardDivider,
        navButton,
        sendStatRow,
        sendUrchinSection
    } = helpers;

    const {
        collectBedwarsStats,
        collectSkyWarsStats,
        collectDuelsStats,
        BEDWARS_MODE_DEFS,
        SKYWARS_MODE_DEFS,
        DUELS_MODE_DEFS
    } = deps;

    const wideLine = '§8§m--------------------------------------------------';

    // Keep focused /session views non-fatal if a host embeds this renderer
    // without the optional navigation helpers. proxy.js supplies the shared
    // implementations; these equivalents are a last-resort compatibility
    // path for older or partial integrations.
    const modeNavButton = typeof navButton === 'function'
        ? navButton
        : (text, command, hover, color = '§6') => ({
            text: `${color}[${text}]`,
            clickEvent: { action: 'run_command', value: command },
            hoverEvent: { action: 'show_text', value: hover || `§7Click: §e${command}` }
        });
    const sendModeNavRow = typeof sendStatRow === 'function'
        ? sendStatRow
        : (client, components) => sendChat(client, {
            text: '',
            extra: components.map(component => typeof component === 'string' ? { text: component } : component)
        });

    function good(value) {
        return coloredSigned(value, '§a');
    }

    function bad(value) {
        return coloredSigned(value, '§c');
    }

    function neutral(value) {
        return coloredSigned(value, '§e');
    }

    // Each block returns the rows it wants drawn, or null when that game saw
    // no movement — so a pure BedWars session never prints empty SkyWars.
    //
    // `mode` defaults to the overall def. Per-mode session views work for free
    // because the delta blob carries every per-mode key Hypixel does
    // (`eight_one_wins_bedwars` and friends), so the collector just needs a
    // different mode def — no extra data and no extra API call.
    function bedwarsRows(delta, mode = BEDWARS_MODE_DEFS[0]) {
        const bw = delta?.stats?.Bedwars;
        if (!hasMovement(bw)) return null;
        const stats = collectBedwarsStats(bw, mode, delta.root);
        return [
            [['Wins', good(stats.wins)], ['Losses', bad(stats.losses)]],
            [['Finals', good(stats.finals)], ['FDeaths', bad(stats.finalDeaths)]],
            [['Beds', good(stats.beds)], ['Beds Lost', bad(stats.bedsLost)]],
            [['Kills', good(stats.kills)], ['Deaths', bad(stats.deaths)]],
            [['WLR', coloredRatio(stats.wlr, getWlrColor)], ['FKDR', coloredRatio(stats.fkdr, getFkdrColor)]],
            [['KDR', coloredRatio(stats.kdr, getKdrColor)], ['BBLR', `§e${formatRatio(stats.bblr)}`]],
            [['Win rate', `§a${(stats.wins / Math.max(1, stats.games || stats.wins + stats.losses) * 100).toFixed(1)}%`]],
            [['Games', neutral(stats.games)], ['Stars', coloredSignedFixed(stats.starsGained, '§b', 2)]],
            [['Avg. finals', `§a${(stats.games ? stats.finals / stats.games : 0).toFixed(2)}`],
                ['Avg. beds', `§a${(stats.games ? stats.beds / stats.games : 0).toFixed(2)}`]]
        ];
    }

    function skywarsRows(delta, mode = SKYWARS_MODE_DEFS[0]) {
        const sw = delta?.stats?.SkyWars;
        if (!hasMovement(sw)) return null;
        const stats = collectSkyWarsStats(sw, mode, delta.root);
        return [
            [['Wins', good(stats.wins)], ['Losses', bad(stats.losses)]],
            [['Kills', good(stats.kills)], ['Deaths', bad(stats.deaths)]],
            [['WLR', coloredRatio(stats.wlr, getWlrColor)], ['KDR', coloredRatio(stats.kdr, getKdrColor)]],
            [['Win rate', `§a${(stats.wins / Math.max(1, stats.games || stats.wins + stats.losses) * 100).toFixed(1)}%`]],
            [['Games', neutral(stats.games)], ['Assists', neutral(stats.assists)]],
            [['Playtime', `§b${formatDuration(stats.playtime)}`], ['Level', coloredSignedFixed(stats.levelGained, '§b', 2)]]
        ];
    }

    function duelsRows(delta, mode = DUELS_MODE_DEFS[0]) {
        const duels = delta?.stats?.Duels;
        if (!hasMovement(duels)) return null;
        const stats = collectDuelsStats(duels, mode);
        return [
            [['Wins', good(stats.wins)], ['Losses', bad(stats.losses)]],
            [['Kills', good(stats.kills)], ['Deaths', bad(stats.deaths)]],
            [['WLR', coloredRatio(stats.wlr, getWlrColor)], ['KDR', coloredRatio(stats.kdr, getKdrColor)]],
            [['Games', neutral(stats.games)], ['Goals', good(stats.goals)]],
            [['Win rate', `§a${(stats.winrate * 100).toFixed(1)}%`]],
            [['Melee', `§b${(stats.meleeAccuracy * 100).toFixed(1)}%`], ['Bow', `§b${(stats.bowAccuracy * 100).toFixed(1)}%`]],
            [['Damage', neutral(stats.damage)], ['Blocks', neutral(stats.blocksPlaced + stats.blocksBroken)]]
        ];
    }

    const GAME_BLOCKS = [
        ['Bedwars', bedwarsRows],
        ['SkyWars', skywarsRows],
        ['Duels', duelsRows]
    ];

    // --- per-game recap rows -------------------------------------------------
    //
    // A single game is not a session, so it does not get session rows. Over one
    // game a ratio is noise (WLR is 1/0, FKDR is 3/1), "Games: +1" is always
    // true, and win/loss is already the header badge. What actually varies is:
    // how many finals/kills you got, and the handful of things that either
    // happened or didn't — did you lose your bed, did you get final killed.
    // Those render as Yes/No, not as "+1".

    // Colours the answer by whether it is good news, not by its truth value.
    function didHappen(value, { badWhenYes = true } = {}) {
        const happened = (Number(value) || 0) > 0;
        if (badWhenYes) return happened ? '§cYes' : '§aNo';
        return happened ? '§aYes' : '§7No';
    }

    function count(value, color = '§a') {
        return `${color}${formatInt(value)}`;
    }

    function bedwarsRecapRows(delta) {
        const bw = delta?.stats?.Bedwars;
        if (!hasMovement(bw)) return null;
        const stats = collectBedwarsStats(bw, BEDWARS_MODE_DEFS[0], delta.root);
        const rows = [
            [['Finals', count(stats.finals)], ['Kills', count(stats.kills)]],
            [['Beds', count(stats.beds)], ['Deaths', count(stats.deaths, '§c')]],
            [['Bed lost', didHappen(stats.bedsLost)], ['Final killed', didHappen(stats.finalDeaths)]]
        ];
        rows.push([['Stars', `§b+${Math.max(0, Number(stats.starsGained) || 0).toFixed(2)}`]]);
        return rows;
    }

    function skywarsRecapRows(delta) {
        const sw = delta?.stats?.SkyWars;
        if (!hasMovement(sw)) return null;
        const stats = collectSkyWarsStats(sw, SKYWARS_MODE_DEFS[0], delta.root);
        return [
            [['Kills', count(stats.kills)], ['Assists', count(stats.assists, '§e')]],
            [['Died', didHappen(stats.deaths)]]
        ];
    }

    function duelsRecapRows(delta) {
        const duels = delta?.stats?.Duels;
        if (!hasMovement(duels)) return null;
        const stats = collectDuelsStats(duels, DUELS_MODE_DEFS[0]);
        const rows = [
            [['Kills', count(stats.kills)], ['Deaths', count(stats.deaths, '§c')]]
        ];
        // Only worth showing for multi-round modes; a 1v1 is always 1.
        if ((Number(stats.games) || 0) > 1) {
            rows.push([['Rounds', count(stats.games, '§e')]]);
        }
        return rows;
    }

    function localRecapRows(recap) {
        const stats = recap.delta.modes?.find(entry => entry.mode === recap.mode);
        if (!stats) return null;
        const value = (key, color = '§a') => Number.isFinite(stats[key]) ? count(stats[key], color)
            : ['finals', 'beds'].includes(key) ? count(0, color) : '§8?';
        const happened = key => Number.isFinite(stats[key]) ? didHappen(stats[key]) : '§8?';
        if (recap.mode === 'BEDWARS') return [
            [['Finals', value('finals')], ['Kills', value('kills')]],
            [['Beds', value('beds')], ['Deaths', value('deaths', '§c')]],
            [['Bed lost', happened('bedsLost')], ['Final killed', happened('finalDeaths')]],
            [['Stars', Number.isFinite(stats.experience)
                ? `§b+${Math.max(0, stats.experience / 5000).toFixed(2)}` : '§b?']]
        ];
        return [[['Kills', value('kills')], ['Deaths', value('deaths', '§c')]]];
    }

    const RECAP_BLOCKS = [
        ['Bedwars', bedwarsRecapRows],
        ['SkyWars', skywarsRecapRows],
        ['Duels', duelsRecapRows]
    ];

    function sendRows(client, rows) {
        rows.forEach((row) => {
            const cells = row.filter(Boolean);
            sendChat(client, statPair(cells[0], cells[1]));
        });
    }

    // Clickable mode switcher for a focused game: [Overall] [Solo] [Doubles]…
    // Each button re-runs /session for the same game with a different mode.
    function sendModeNav(client, focus) {
        const modes = focus?.modes || [];
        if (modes.length < 2 || !focus.commandToken) return;
        const activeId = focus.mode?.id;
        const components = [];
        modes.forEach((mode, index) => {
            if (index > 0) components.push('§8 ');
            const label = mode.label || mode.id;
            const token = mode.short || mode.id;
            components.push(activeId === mode.id
                ? { text: `§a[${label}]`, hoverEvent: { action: 'show_text', value: '§7Currently shown.' } }
                : modeNavButton(label, `/session ${focus.commandToken} ${token}`, `§7Session stats for §f${label}§7.`, '§8'));
        });
        sendModeNavRow(client, components);
    }

    // The /session card. `focus` narrows the card to one game + mode
    // ({ game, mode, modes, commandToken }); omit it for the all-games overall
    // view. `title` overrides the header for history playback.
    function renderLocalSession(client, delta, {
        name = null,
        gamesPlayed = 0,
        focus = null,
        title = null,
        subtitle = null
    } = {}) {
        if (!delta) {
            sendChat(client, '§8[§bSession§8] §7No session data yet — play a game or run §f/session refresh§7.');
            return false;
        }

        const builderFor = game => GAME_BLOCKS.find(([blockGame]) => blockGame === game)?.[1] || null;
        const blocks = delta.local
            ? (delta.modes || []).filter(mode => !focus?.game || mode.mode === String(focus.game).toUpperCase())
                .map(overall => {
                    let mode = focus?.mode?.id && focus.mode.id !== 'overall'
                        ? overall.submodes?.find(entry => entry.id === focus.mode.id) : overall;
                    if (mode?.mode === 'BEDWARS' && (!focus?.mode?.id || focus.mode.id === 'overall')) {
                        const known = knownSessionRecapTotals(delta, 'BEDWARS');
                        mode = { ...mode };
                        for (const key of ['finals', 'beds']) {
                            if (!Number.isFinite(mode[key])) mode[key] = known?.[key] || 0;
                        }
                    }
                    const rows = mode ? localSessionRows(mode, delta) : [];
                    const game = GAME_BLOCKS.find(([name]) => name.toUpperCase() === overall.mode)?.[0];
                    if (mode && game && !delta.unmeasurable?.includes(game)) {
                        // API-only progress/precision counters can coexist with
                        // the immediate local combat totals; never replace them.
                        const extraLabels = ['Stars', 'Playtime', 'Level', 'Goals', 'Melee', 'Bow', 'Damage', 'Blocks'];
                        const existingLabels = new Set(rows.flat().map(([label]) => label));
                        const extras = (builderFor(game)?.(delta, focus?.mode) || []).flat()
                            .filter(([label]) => extraLabels.includes(label) && !existingLabels.has(label));
                        extras.forEach(cell => rows.push([cell]));
                    }
                    return [overall.label, rows, mode?.unavailable?.length];
                })
            : focus
                ? [[focus.game, builderFor(focus.game)?.(delta, focus.mode) || null]].filter(([, rows]) => Boolean(rows))
                : GAME_BLOCKS.map(([game, builder]) => [game, builder(delta)]).filter(([, rows]) => Boolean(rows));

        const modeSuffix = focus?.mode && focus.mode.id !== 'overall'
            ? ` §8» §7${focus.mode.label || focus.mode.id}`
            : '';

        sendChat(client, `\n${wideLine}`);
        sendChat(client, title
            ? `§b§lSession §8» §f${title} §8(§7${formatShortDuration(delta.spanMs)}§8)${modeSuffix}`
            : `§b§lSession §8» §f${name || 'You'} §8(§7${formatShortDuration(delta.spanMs)}§8)${modeSuffix}`);
        if (subtitle) sendChat(client, subtitle);
        if (delta.local) sendChat(client, '§8Local tracking — observed session counters.');

        if (focus) sendModeNav(client, focus);

        if (!blocks.length) {
            sendChat(client, cardDivider('§8'));
            sendChat(client, focus
                ? `§7No §f${GAME_LABELS[focus.game] || focus.game}§7 games tracked this session.`
                : '§7Nothing tracked yet this session.');
            sendChat(client, `${wideLine}\n`);
            return true;
        }

        blocks.forEach(([game, rows, incomplete]) => {
            sendChat(client, cardDivider('§8'));
            sendChat(client, `§6§l${GAME_LABELS[game] || game}`);
            if (rows.length) sendSessionRows(client, rows);
            else sendChat(client, '§7No observed counters for this mode.');
            if (incomplete) sendChat(client, '§8Incomplete coverage — uncertain stats hidden.');
        });

        sendChat(client, `${wideLine}\n`);
        return true;
    }

    function resultBadge(result) {
        if (result === 'win') return ' §a§lWIN';
        if (result === 'loss') return ' §c§lLOSS';
        return '';
    }

    // Session-so-far footer on the recap card: the running totals for the
    // game that just finished, so one line answers "how is today going".
    function sessionFooter(sessionDelta, game) {
        if (!sessionDelta || !game) return null;
        if (sessionDelta.local) {
            const totals = sessionDelta.modes?.find(entry => MODE_LABELS[entry.mode] === GAME_LABELS[game]);
            if (!Number.isFinite(totals?.wins) || !Number.isFinite(totals?.losses)) return null;
            return `§7Session: §a${formatInt(totals.wins)}W§8/§c${formatInt(totals.losses)}L`;
        }
        const stats = sessionDelta.stats?.[game];
        if (!hasMovement(stats)) return null;

        if (game === 'Bedwars') {
            const totals = collectBedwarsStats(stats, BEDWARS_MODE_DEFS[0], sessionDelta.root);
            return `§7Session: §a+${formatInt(totals.wins)}W§8/§c+${formatInt(totals.losses)}L §8| §7FKDR §f${formatRatio(totals.fkdr)} §8| §7Beds §f${formatInt(totals.beds)}`;
        }
        if (game === 'SkyWars') {
            const totals = collectSkyWarsStats(stats, SKYWARS_MODE_DEFS[0], sessionDelta.root);
            return `§7Session: §a+${formatInt(totals.wins)}W§8/§c+${formatInt(totals.losses)}L §8| §7KDR §f${formatRatio(totals.kdr)}`;
        }
        const totals = collectDuelsStats(stats, DUELS_MODE_DEFS[0]);
        return `§7Session: §a+${formatInt(totals.wins)}W§8/§c+${formatInt(totals.losses)}L §8| §7KDR §f${formatRatio(totals.kdr)}`;
    }

    // The post-game recap card. Deliberately says nothing about encounter
    // history — opponent names remain part of the ordinary session recap.
    function sessionGoalValues(sessionDelta) {
        const values = { wins: 0, finals: 0, games: 0, minutes: Math.max(0, Math.round((Number(sessionDelta?.spanMs) || 0) / 60000)) };
        if (!sessionDelta) return values;
        if (sessionDelta.local) {
            for (const key of ['wins', 'finals', 'games']) {
                const modes = (sessionDelta.modes || []).filter(mode => key !== 'finals' || mode.mode === 'BEDWARS');
                if (modes.some(mode => !Number.isFinite(mode[key]))) delete values[key];
                else values[key] = modes.reduce((sum, mode) => sum + mode[key], 0);
            }
            return values;
        }
        if (hasMovement(sessionDelta.stats?.Bedwars)) {
            const stats = collectBedwarsStats(sessionDelta.stats.Bedwars, BEDWARS_MODE_DEFS[0], sessionDelta.root);
            values.wins += Number(stats.wins) || 0;
            values.finals += Number(stats.finals) || 0;
            values.games += Number(stats.games) || 0;
        }
        if (hasMovement(sessionDelta.stats?.SkyWars)) {
            const stats = collectSkyWarsStats(sessionDelta.stats.SkyWars, SKYWARS_MODE_DEFS[0], sessionDelta.root);
            values.wins += Number(stats.wins) || 0;
            values.games += Number(stats.games) || 0;
        }
        if (hasMovement(sessionDelta.stats?.Duels)) {
            const stats = collectDuelsStats(sessionDelta.stats.Duels, DUELS_MODE_DEFS[0]);
            values.wins += Number(stats.wins) || 0;
            values.games += Number(stats.games) || Number(stats.wins) + Number(stats.losses) || 0;
        }
        return values;
    }

    function sendGoalProgress(client, sessionDelta, goals = {}) {
        const values = sessionGoalValues(sessionDelta);
        const definitions = [
            ['wins', 'Wins'],
            ['finals', 'Finals'],
            ['games', 'Games'],
            ['minutes', 'Minutes']
        ].filter(([key]) => Number(goals[key]) > 0);
        if (!definitions.length) return false;
        sendChat(client, cardDivider('§8'));
        definitions.forEach(([key, label]) => {
            const target = Math.max(1, Number(goals[key]) || 1);
            const value = Math.max(0, Number(values[key]) || 0);
            const complete = value >= target;
            sendChat(client, `§7Goal ${label}: ${complete ? '§a' : '§e'}${formatInt(value)}§8/§f${formatInt(target)}${complete ? ' §a✓' : ''}`);
        });
        return true;
    }

    // Same paired stat rows and section primitive used by /stats.
    function sendSessionRows(client, rows) {
        const cells = rows.flat();
        const groups = [
            ['Ratios', ['WLR', 'FKDR', 'KDR', 'BBLR', 'Win rate']],
            ['Performance', ['Kills', 'Deaths', 'Beds', 'Beds Lost', 'Wins', 'Losses', 'Finals', 'FDeaths', 'Assists', 'Goals']],
            ['Details', ['Games', 'Stars', 'Avg. finals', 'Avg. beds', 'Local streak', 'Playtime', 'Level', 'Melee', 'Bow', 'Damage', 'Blocks']]
        ];
        for (const [title, labels] of groups) {
            const values = labels.map(label => cells.find(cell => cell[0] === label)).filter(Boolean);
            if (!values.length) continue;
            const pairs = [];
            for (let i = 0; i < values.length; i += 2) pairs.push(values.slice(i, i + 2));
            if (typeof sendUrchinSection === 'function') sendUrchinSection(client, title, pairs);
            else { sendChat(client, cardDivider('§8')); sendRows(client, pairs); }
        }
    }

    function localSessionRows(mode, delta) {
        const definitions = [
            ['wins', 'Wins', good], ['losses', 'Losses', bad], ['games', 'Games', neutral],
            ['finals', 'Finals', good], ['finalDeaths', 'FDeaths', bad],
            ['kills', 'Kills', good], ['deaths', 'Deaths', bad], ['beds', 'Beds', good], ['bedsLost', 'Beds Lost', bad],
            ['assists', 'Assists', neutral], ['goals', 'Goals', good],
            ['wlr', 'WLR', value => coloredRatio(value, getWlrColor)],
            ['fkdr', 'FKDR', value => coloredRatio(value, getFkdrColor)],
            ['kdr', 'KDR', value => coloredRatio(value, getKdrColor)],
            ['bblr', 'BBLR', value => `§e${formatRatio(value)}`],
            ['winRate', 'Win rate', value => `§a${value.toFixed(1)}%`],
            ['localStreak', 'Local streak', neutral]
        ];
        const rows = definitions.filter(([key]) => Number.isFinite(mode[key]))
            .map(([key, label, format]) => [[label, format(mode[key])]]);
        if (mode.mode === 'BEDWARS' && Number.isFinite(mode.games)) {
            for (const key of ['finals', 'beds']) {
                if (Number.isFinite(mode[key])) rows.push([[`Avg. ${key}`, `§a${(mode.games ? mode[key] / mode.games : 0).toFixed(2)}`]]);
            }
        }
        const bw = delta?.stats?.Bedwars;
        if (mode.mode === 'BEDWARS' && Object.hasOwn(bw || {}, 'Experience')
            && !delta.unmeasurable?.includes('Bedwars')) {
            const stats = collectBedwarsStats(bw, BEDWARS_MODE_DEFS[0], delta.root);
            rows.push([['Stars', coloredSignedFixed(stats.starsGained, '§b', 2)]]);
        }
        return rows;
    }

    function averageGameTime(sessionDelta, mode) {
        const durations = (sessionDelta?.session?.games || [])
            .filter(game => game?.mode === mode && !game.metadata?.privateGame
                && Number.isFinite(game.durationMs) && game.durationMs >= 1000)
            .map(game => game.durationMs);
        if (!durations.length) return '';
        return formatShortDuration(durations.reduce((sum, duration) => sum + duration, 0) / durations.length);
    }

    function knownSessionRecapTotals(sessionDelta, mode) {
        let games = 0;
        let wins = 0;
        let losses = 0;
        let finals = 0;
        let beds = 0;
        let ratioFinals = 0;
        let finalDeaths = 0;
        for (const game of sessionDelta?.session?.games || []) {
            if (game?.mode !== mode || game.metadata?.privateGame || !(game.durationMs >= 1000)) continue;
            games++;
            const stats = gameModes(game)?.find(entry => entry.mode === mode);
            // Missing counters contribute zero without erasing earlier games.
            finals += Number.isFinite(stats?.finals) ? Math.max(0, stats.finals) : 0;
            beds += Number.isFinite(stats?.beds) ? Math.max(0, stats.beds) : 0;
            if (game.result === 'win') wins++;
            else if (game.result === 'loss') losses++;
            else {
                wins += Number.isFinite(stats?.wins) ? stats.wins : 0;
                losses += Number.isFinite(stats?.losses) ? stats.losses : 0;
            }
            // FKDR needs both counters from a match. If either is unknown,
            // treat that match as zero finals and zero final deaths while
            // retaining its known game result and played count above.
            if (Number.isFinite(stats?.finals) && Number.isFinite(stats?.finalDeaths)) {
                ratioFinals += stats.finals;
                finalDeaths += stats.finalDeaths;
            }
        }
        // Local totals include retained games; observed/API totals archive only
        // evicted games. Reuse these persisted values without counting twice.
        const saved = sessionDelta?.session?.localTracking?.totals?.[mode];
        const savedCount = key => Number.isFinite(saved?.[key]?.value) ? Math.max(0, saved[key].value) : 0;
        const local = sessionDelta?.session?.trackingSource === 'local';
        finals = local ? Math.max(finals, savedCount('finals')) : finals + savedCount('finals');
        beds = local ? Math.max(beds, savedCount('beds')) : beds + savedCount('beds');
        const trackedGames = local ? Math.max(games, savedCount('games')) : games + savedCount('games');
        return games || trackedGames || finals || beds ? {
            games,
            trackedGames,
            wins,
            losses,
            finals,
            beds,
            fkdr: ratioFinals / Math.max(finalDeaths, 1)
        } : null;
    }

    function renderGameRecap(client, recap, options = {}) {
        if (!recap?.delta) return false;
        const game = recap.game;
        const builder = RECAP_BLOCKS.find(([name]) => name === game)?.[1];
        const rows = recap.delta.local ? localRecapRows(recap) : builder ? builder(recap.delta) : null;
        if (!rows) return false;

        const pairs = rows.flat();
        const definitions = [
            ['finals', 'Finals', '§a'], ['beds', 'Beds', '§e'], ['kills', 'Kills', '§b'],
            ['deaths', 'Deaths', '§c'], ['deaths', 'Died', '§c'], ['stars', 'Stars', '§b']
        ];
        const stats = definitions.map(([field, label, color]) => {
            const pair = pairs.find(([name]) => name === label);
            return pair && { field, label, value: pair[1],
                color: label === 'Died' ? pair[1].slice(0, 2) : color };
        }).filter(Boolean);
        const fields = normalizeRecapFields(options.fields);
        let session = null;
        if (fields.some(field => field.startsWith('session_')) && recap.sessionDelta) {
            if (recap.sessionDelta.local) {
                session = recap.sessionDelta.modes?.find(entry => entry.mode === recap.mode) || null;
            } else {
                const stats = recap.sessionDelta.stats?.[game];
                if (stats && !recap.sessionDelta.unmeasurable?.includes(game)) {
                    session = game === 'Bedwars' ? collectBedwarsStats(stats, BEDWARS_MODE_DEFS[0], recap.sessionDelta.root)
                        : game === 'SkyWars' ? collectSkyWarsStats(stats, SKYWARS_MODE_DEFS[0], recap.sessionDelta.root)
                            : collectDuelsStats(stats, DUELS_MODE_DEFS[0]);
                }
            }
        }
        const needsAverageGames = game === 'Bedwars'
            && fields.some(field => ['session_avg_finals', 'session_avg_beds'].includes(field));
        const needsBedwarsCounts = needsAverageGames || (game === 'Bedwars'
            && fields.some(field => ['session_finals', 'session_beds'].includes(field)));
        if (needsBedwarsCounts || fields.some(field => ['session_wins', 'session_losses', 'session_games', 'session_ratio'].includes(field))) {
            const observed = knownSessionRecapTotals(recap.sessionDelta, recap.mode);
            if (observed) {
                session = { ...(session || {}) };
                if (fields.includes('session_wins') && !Number.isFinite(session.wins)) session.wins = observed.wins;
                if (fields.includes('session_losses') && !Number.isFinite(session.losses)) session.losses = observed.losses;
                if (fields.includes('session_games') || needsAverageGames) {
                    session.games = Math.max(Number.isFinite(session.games) ? session.games : 0,
                        needsAverageGames ? observed.trackedGames : observed.games);
                }
                if (fields.includes('session_ratio') && game === 'Bedwars' && !Number.isFinite(session.fkdr)) {
                    session.fkdr = observed.fkdr;
                }
            }
            if (needsBedwarsCounts && recap.sessionDelta) {
                session = { ...(session || {}) };
                for (const key of ['finals', 'beds']) {
                    if (!Number.isFinite(session[key])) session[key] = observed?.[key] || 0;
                }
                if (needsAverageGames && !Number.isFinite(session.games)) session.games = observed?.trackedGames || 0;
            }
        }
        scoreboardRecapMessages({
            game, result: recap.record?.result,
            duration: recap.record?.durationMs ? formatShortDuration(recap.record.durationMs) : '',
            averageGameTime: averageGameTime(recap.sessionDelta, recap.mode),
            averageGameTimeEnabled: options.averageGameTimeEnabled !== false,
            variant: recap.record?.metadata?.variant,
            map: recap.record?.metadata?.map,
            stats, session, fields, gamesGoal: options.goals?.games,
            games: recap.sessionDelta ? sessionGoalValues(recap.sessionDelta).games : undefined
        }).forEach(message => sendChat(client, message));
        return true;
    }

    // One-line summary of a session for the history list: the game that saw
    // the most movement, with its W/L and headline ratio.
    function historyHeadline(delta) {
        if (!delta) return null;
        if (delta.local) return '§eLocal tracking §8· §7verified counters only';
        const game = GAME_BLOCKS
            .map(([name]) => name)
            .filter(name => hasMovement(delta.stats?.[name]))
            .sort((a, b) => Object.keys(delta.stats[b]).length - Object.keys(delta.stats[a]).length)[0];
        if (!game) return null;

        if (game === 'Bedwars') {
            const stats = collectBedwarsStats(delta.stats.Bedwars, BEDWARS_MODE_DEFS[0], delta.root);
            return `§a+${formatInt(stats.wins)}W§8/§c+${formatInt(stats.losses)}L §8| §7FKDR §f${formatRatio(stats.fkdr)}`;
        }
        if (game === 'SkyWars') {
            const stats = collectSkyWarsStats(delta.stats.SkyWars, SKYWARS_MODE_DEFS[0], delta.root);
            return `§a+${formatInt(stats.wins)}W§8/§c+${formatInt(stats.losses)}L §8| §7KDR §f${formatRatio(stats.kdr)}`;
        }
        const stats = collectDuelsStats(delta.stats.Duels, DUELS_MODE_DEFS[0]);
        return `§a+${formatInt(stats.wins)}W§8/§c+${formatInt(stats.losses)}L §8| §7KDR §f${formatRatio(stats.kdr)}`;
    }

    // The /session history list. Entries are { session, delta, active },
    // newest first; index 1 is the most recent.
    function renderSessionHistory(client, entries = [], { now = Date.now(), limit = 12 } = {}) {
        sendChat(client, `\n${wideLine}`);
        sendChat(client, '§b§lSession History');
        sendChat(client, cardDivider('§8'));

        if (!entries.length) {
            sendChat(client, '§7No sessions recorded yet.');
            sendChat(client, `${wideLine}\n`);
            return false;
        }

        entries.slice(0, limit).forEach((entry, index) => {
            const position = index + 1;
            const games = entry.delta.local ? null : (entry.session.games?.length || 0);
            const headline = historyHeadline(entry.delta) || '§8no tracked games';
            const stamp = formatSessionStamp(entry.session.startedAt, now);
            const live = entry.active ? ' §a•' : '';
            sendChat(client, {
                text: `§8${String(position).padStart(2, ' ')}. §f${stamp}${live} §8· §7${formatShortDuration(entry.delta.spanMs)}${games === null ? '' : ` §8· §f${games}g`} §8— ${headline}`,
                clickEvent: { action: 'run_command', value: `/session history ${position}` },
                hoverEvent: {
                    action: 'show_text',
                    value: `§7Click for the full card.\n§8${entry.active ? 'Current session' : 'Finished session'}`
                }
            });
        });

        if (entries.length > limit) {
            sendChat(client, `§8…and ${entries.length - limit} older`);
        }
        sendChat(client, cardDivider('§8'));
        sendChat(client, '§8/session history <n> §7for one session · §a• §7= current');
        sendChat(client, `${wideLine}\n`);
        return true;
    }

    function renderSessionGames(client, session, { page = 1 } = {}) {
        const games = (session?.games || []).slice().sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
        const pageCount = Math.max(1, Math.ceil(games.length / 10));
        const requested = Number(page);
        const currentPage = Math.min(pageCount, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 1));
        sendChat(client, `\n${wideLine}`);
        sendChat(client, `§b§lSession Games §8» §f${formatSessionStamp(session?.startedAt)} §8· §7Page ${currentPage}/${pageCount} §8· §f${games.length} games`);
        sendChat(client, cardDivider('§8'));
        if (!games.length) sendChat(client, '§7No games recorded in this session yet.');
        const start = (currentPage - 1) * 10;
        games.slice(start, start + 10).forEach((record, offset) => {
            const stats = gameModes(record)?.find(mode => mode.mode === record.mode);
            const value = key => Number.isFinite(stats?.[key]) ? formatInt(stats[key])
                : ['finals', 'beds'].includes(key) ? '0' : '?';
            let map = String(record.metadata?.map || 'Unknown map').replace(/§./g, '').replace(/[\r\n\x00-\x1f]/g, ' ').trim().slice(0, 40);
            const result = record.result === 'win' ? '§aWIN' : record.result === 'loss' ? '§cLOSS' : '§7UNKNOWN';
            const counts = record.mode === 'BEDWARS'
                ? `§7F/B/K §a${value('finals')}§8/§e${value('beds')}§8/§b${value('kills')}`
                : `§7Kills §b${value('kills')}`;
            const game = MODE_LABELS[record.mode] || record.mode || 'Game';
            const row = mapName => `§8${start + offset + 1}. §f${mapName} §8· §7${game} §8· ${result} §8· ${counts}`;
            if (chatTextWidth(row(map)) > CHAT_WIDTH) {
                while (map && chatTextWidth(row(map + '...')) > CHAT_WIDTH) map = map.slice(0, -1);
                map = map.trimEnd() + '...';
            }
            sendChat(client, row(map));
        });
        if (pageCount > 1) {
            const buttons = [];
            const sessionToken = /^[A-Za-z0-9_-]+$/.test(session?.id || '') ? ` ${session.id}` : '';
            if (currentPage > 1) buttons.push(modeNavButton('Previous', `/session games ${currentPage - 1}${sessionToken}`, '§7Previous 10 games'));
            if (currentPage < pageCount) buttons.push(modeNavButton('Next', `/session games ${currentPage + 1}${sessionToken}`, '§7Next 10 games'));
            sendModeNavRow(client, buttons);
        }
        sendChat(client, `${wideLine}\n`);
        return true;
    }

    return {
        renderLocalSession,
        renderSessionGames,
        renderGameRecap,
        bedwarsRecapRows,
        renderSessionHistory,
        historyHeadline,
        formatShortDuration,
        formatSessionStamp,
        sessionFooter
    };
}

module.exports = {
    createSessionRender,
    formatShortDuration,
    formatSessionStamp,
    GAME_LABELS,
    MODE_LABELS
};
