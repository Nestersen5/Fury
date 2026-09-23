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
const { formatInt, formatRatio } = require('../format.js');
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
        sendStatRow
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
            [['Games', neutral(stats.games)], ['Stars', coloredSignedFixed(stats.starsGained, '§6', 2)]]
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
            [['Games', neutral(stats.games)], ['Assists', neutral(stats.assists)]]
        ];
    }

    function duelsRows(delta, mode = DUELS_MODE_DEFS[0]) {
        const duels = delta?.stats?.Duels;
        if (!hasMovement(duels)) return null;
        const stats = collectDuelsStats(duels, mode);
        return [
            [['Wins', good(stats.wins)], ['Losses', bad(stats.losses)]],
            [['Kills', good(stats.kills)], ['Deaths', bad(stats.deaths)]],
            [['WLR', coloredRatio(stats.wlr, getWlrColor)], ['KDR', coloredRatio(stats.kdr, getKdrColor)]]
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
        if ((Number(stats.starsGained) || 0) > 0) {
            rows.push([['Stars', coloredSignedFixed(stats.starsGained, '§6', 2)]]);
        }
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

        if (delta.local) {
            sendChat(client, `§6[FURY] §f${name || 'Session'} §8· §7${formatShortDuration(delta.spanMs)} §8· §eLocal tracking`);
            for (const mode of delta.modes || []) {
                const fields = [['wins','Wins'],['losses','Losses'],['games','Completed games'],['finals', 'Final kills'],['finalDeaths','Final deaths'],['kills','Kills'],['deaths','Deaths'], ['beds', 'Beds broken'], ['bedsLost', 'Beds lost'],['wlr','WLR'],['fkdr','FKDR'],['kdr','KDR'],['bblr','BBLR'],['winRate','Win rate'],['localStreak','Local streak']]
                    .filter(([key]) => Number.isFinite(mode[key]));
                if(!fields.length)sendChat(client,`§6${mode.label} §8» §7No verified counters available`);
                for(let i=0;i<fields.length;i+=4)sendChat(client,`§6${i?'':mode.label} §8» §7${fields.slice(i,i+4).map(([key,label])=>`${label}: §f${['wlr','fkdr','kdr','bblr'].includes(key)?formatRatio(mode[key]):key==='winRate'?mode[key].toFixed(1)+'%':formatInt(mode[key])}§7`).join(' §8· §7')}`);
                if (mode.unavailable?.length) sendChat(client, '§8Incomplete coverage — uncertain stats hidden.');
            }
            return true;
        }

        const builderFor = game => GAME_BLOCKS.find(([blockGame]) => blockGame === game)?.[1] || null;
        const blocks = focus
            ? [[focus.game, builderFor(focus.game)?.(delta, focus.mode) || null]].filter(([, rows]) => Boolean(rows))
            : GAME_BLOCKS
                .map(([game, builder]) => [game, builder(delta)])
                .filter(([, rows]) => Boolean(rows));

        const modeSuffix = focus?.mode && focus.mode.id !== 'overall'
            ? ` §8» §7${focus.mode.label || focus.mode.id}`
            : '';

        sendChat(client, `\n${wideLine}`);
        sendChat(client, title
            ? `§b§lSession §8» §f${title} §8(§7${formatShortDuration(delta.spanMs)}§8)${modeSuffix}`
            : `§b§lSession §8» §f${name || 'You'} §8(§7${formatShortDuration(delta.spanMs)}§8)${modeSuffix}`);
        if (subtitle) sendChat(client, subtitle);

        if (focus) sendModeNav(client, focus);

        if (!blocks.length) {
            sendChat(client, cardDivider('§8'));
            sendChat(client, focus
                ? `§7No §f${GAME_LABELS[focus.game] || focus.game}§7 games tracked this session.`
                : '§7Nothing tracked yet this session.');
            sendChat(client, `${wideLine}\n`);
            return true;
        }

        blocks.forEach(([game, rows]) => {
            sendChat(client, cardDivider('§8'));
            sendChat(client, `§6§l${GAME_LABELS[game] || game}`);
            sendRows(client, rows);
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

    function renderGameRecap(client, recap, options = {}) {
        if (!recap?.delta) return false;
        if (recap.delta.local) return renderLocalSession(client, recap.delta, { name: 'Session totals' });
        const game = recap.game;
        const builder = RECAP_BLOCKS.find(([name]) => name === game)?.[1];
        const rows = builder ? builder(recap.delta) : null;
        if (!rows) return false;

        const style = ['compact', 'detailed', 'custom'].includes(options.style) ? options.style : 'compact';
        const fields = style === 'custom' ? new Set(Array.isArray(options.fields) ? options.fields : [])
            : new Set(['result', 'duration', 'game_stats', 'session_totals', 'goals']);
        const modeLabel = MODE_LABELS[String(recap.mode || '').toUpperCase()] || GAME_LABELS[game] || 'Game';
        const result = recap.record?.result;
        const badge = fields.has('result') ? (result === 'win' ? '§aVICTORY' : result === 'loss' ? '§cDEFEAT' : '§fGAME OVER') : '';
        const duration = fields.has('duration') && recap.record?.durationMs ? ` §8· §7${formatShortDuration(recap.record.durationMs)}` : '';
        sendChat(client, `§6[FURY] ${badge}${badge ? ' §8· ' : ''}§f${modeLabel}${duration}`);
        if (fields.has('game_stats')) {
            const pairs = rows.flat();
            const prominent = game === 'Bedwars' ? ['Finals', 'Beds', 'Kills'] : game === 'SkyWars' ? ['Kills', 'Assists'] : ['Kills', 'Deaths'];
            const line = prominent.map(label => pairs.find(pair => pair[0] === label)).filter(Boolean)
                .map(([label, value]) => `§7${label}: ${value}`).join(' §8· ');
            if (line) sendChat(client, line);
            if (style === 'detailed') {
                const extra = pairs.filter(([label]) => !prominent.includes(label)).map(([label,value]) => `§7${label}: ${value}`).join(' §8· ');
                if (extra) sendChat(client, extra);
            }
        }
        const footer = fields.has('session_totals') ? sessionFooter(recap.sessionDelta, game) : null;
        if (footer) sendChat(client, footer.replace(/§a\+/g, '§a').replace(/§c\+/g, '§c').replace(/ §8\| /g, ' §8· '));
        if (fields.has('goals')) {
            const values = sessionGoalValues(recap.sessionDelta);
            const goals = Object.entries(options.goals || {}).filter(([key,target]) => Number(target) > 0 && key in values)
                .slice(0,4).map(([key,target]) => `§7${key}: ${values[key] >= target ? '§a' : '§e'}${formatInt(values[key])}§7/${formatInt(target)}${values[key] >= target ? ' §a✓' : ''}`);
            if (goals.length) sendChat(client, `§7Goal ${goals.join(' §8· ')}`);
        }
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

    return {
        renderLocalSession,
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
