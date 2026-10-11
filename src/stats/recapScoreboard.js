'use strict';

const { stripAnsi } = require('../../features/minecraft_chat');
const { formatInt, formatRatio } = require('./format');
const { getFkdrColor } = require('./colors');
const { normalizeRecapFields } = require('../session/settings');

// Advances measured from the production assets/session-card-font.png atlas,
// including Minecraft's one-pixel glyph gap. Chat uses the client's font;
// the launcher draws that same default bitmap rather than a web-font substitute.
const NARROW_GLYPHS = { ' ': 4, '!': 2, '"': 5, "'": 3, '(': 5, ')': 5, '*': 5,
    ',': 2, '.': 2, ':': 2, ';': 2, '<': 5, '>': 5, '@': 7, I: 4, '[': 4, ']': 4,
    '`': 3, f: 5, i: 2, k: 5, l: 3, t: 4, '{': 5, '|': 2, '}': 5, '~': 7 };
const chatCharWidth = char => NARROW_GLYPHS[char] || 6;
function chatTextWidth(text) {
    let width = 0, bold = false;
    const parts = String(text).split(/((?:\u00c2?\u00a7|\\u00a7)[0-9a-fk-or])/gi);
    for (const part of parts) {
        if (/^(?:\u00c2?\u00a7|\\u00a7)[0-9a-fk-or]$/i.test(part)) {
            const code = part.slice(-1).toLowerCase();
            if (code === 'l') bold = true;
            else if (/[0-9a-fr]/.test(code)) bold = false;
        } else {
            for (const char of stripAnsi(part)) width += chatCharWidth(char) + Number(bold);
        }
    }
    return width;
}
const CHAT_WIDTH = 320;

function averageTimeColor(duration) {
    let seconds = 0;
    for (const match of stripAnsi(String(duration)).matchAll(/(\d+)\s*([hms])/gi)) {
        seconds += Number(match[1]) * ({ h: 3600, m: 60, s: 1 }[match[2].toLowerCase()]);
    }
    if (seconds < 120) return '§a';
    if (seconds < 300) return '§e';
    if (seconds < 600) return '§c';
    if (seconds <= 1500) return '§4';
    return '§5';
}

// Shared by real Minecraft chat and the launcher's preview. Widths use Fury's
// existing Minecraft glyph metrics; no HTML-specific layout enters chat.
function scoreboardRecapLines({ game, result, duration = '', averageGameTime = '', averageGameTimeEnabled = true,
    variant = '', map = '', stats = [], gamesGoal = 0, games, session = null, fields } = {}) {
    const selected = new Set(normalizeRecapFields(fields));
    const title = { Bedwars: 'BED WARS', SkyWars: 'SKYWARS', Duels: 'DUELS' }[game] || 'GAME';
    const badge = result === 'win' ? '§aVICTORY' : result === 'loss' ? '§cDEFEAT' : '§fGAME OVER';
    const mode = stripAnsi(String(variant || '')).replace(/[\r\n]/g, ' ').slice(0, 24);
    let details = [selected.has('result') && badge, selected.has('duration') && duration && `${averageTimeColor(duration)}${duration.replace(/m (\d)s$/, 'm 0$1s')}`, selected.has('mode') && mode && `§f${mode}`].filter(Boolean).join('   ');
    let mapName = selected.has('map') && game === 'Bedwars' && typeof map === 'string'
        ? stripAnsi(map).replace(/[\x00-\x20\x7f]+/g, ' ').trim().slice(0, 80) : '';
    if (mapName) {
        const prefix = (details ? '   ' : '') + '§7Map: ';
        const available = CHAT_WIDTH - chatTextWidth(details + prefix);
        if (chatTextWidth(mapName) > available) {
            while (mapName && chatTextWidth(mapName + '...') > available) mapName = mapName.slice(0, -1);
            mapName = mapName ? mapName.trimEnd() + '...' : '';
        }
        if (mapName) details += prefix + '§f' + mapName;
    }
    // Wrap extra selected stats at field boundaries without stretching the font.
    const wrap = (parts, prefix = '') => {
        const rows = [];
        let row = prefix;
        for (const part of parts) {
            if (row && chatTextWidth(row + '   ' + part) > CHAT_WIDTH) {
                rows.push(row);
                row = prefix;
            }
            row += (row && row !== prefix ? '   ' : '') + part;
        }
        if (row && row !== prefix) rows.push(row);
        return rows;
    };
    const recapTitle = game === 'Bedwars' ? '§c§lBED §f§lWARS RECAP' : `§6${title} RECAP`;
    const header = `§8------ ${recapTitle}§8 ------`;
    const visibleStats = stats.filter(stat => selected.has(stat.field || stat.label.toLowerCase()));
    const kills = visibleStats.find(stat => stat.label.toLowerCase() === 'kills');
    const deaths = visibleStats.find(stat => stat.label.toLowerCase() === 'deaths');
    const finals = visibleStats.find(stat => stat.label.toLowerCase() === 'finals');
    const beds = visibleStats.find(stat => stat.label.toLowerCase() === 'beds');
    const statParts = visibleStats.flatMap(stat => {
        if (finals && beds) {
            if (stat === beds) return [];
            if (stat === finals) return [`§7Finals/Beds: §a${stripAnsi(String(finals.value))}§8/§e${stripAnsi(String(beds.value))}`];
        }
        if (kills && deaths) {
            if (stat === deaths) return [];
            if (stat === kills) return [`§7Kills/Deaths: §a${stripAnsi(String(kills.value))}§8/§c${stripAnsi(String(deaths.value))}`];
        }
        if (stat.field === 'stars' || stat.label.toLowerCase() === 'stars') {
            return [`§b${stripAnsi(String(stat.value))} §7STARS`];
        }
        return [`${stat.color}${stripAnsi(String(stat.value))} ${stat.label.toUpperCase()}`];
    });
    const lines = [selected.has('header') && header, details,
        ...wrap(statParts)];
    const summary = [];
    const count = value => Number.isFinite(value) && value >= 0 ? formatInt(value) : '?';
    if (session || (averageGameTimeEnabled && averageGameTime)) {
        if (session) {
            const results = [];
            if (selected.has('session_wins')) results.push(`§a${count(session.wins)}W`);
            if (selected.has('session_losses')) results.push(`§c${count(session.losses)}L`);
            if (results.length) summary.push(results.join(' §7/ '));
            if (selected.has('session_ratio') && game === 'Bedwars') {
                summary.push(`§7FKDR ${Number.isFinite(session.fkdr) ? getFkdrColor(session.fkdr) + formatRatio(session.fkdr) : '§f?'}`);
            }
            if (selected.has('session_games')) summary.push(`§7PLAYED §f${count(session.games)}`);
            if (game === 'Bedwars') {
                for (const average of [false, true]) {
                    const keys = ['finals', 'beds'].filter(key =>
                        selected.has(`session_${average ? 'avg_' : ''}${key}`));
                    if (!keys.length) continue;
                    const label = average ? `Avg. ${keys.join('/')}`
                        : keys.map(key => key[0].toUpperCase() + key.slice(1)).join('/');
                    const values = keys.map(key => {
                        if (!average) return `§f${count(session[key])}`;
                        const known = Number.isFinite(session[key]) && session[key] >= 0
                            && Number.isFinite(session.games) && session.games >= 0;
                        const value = known ? (session.games > 0 ? session[key] / session.games : 0).toFixed(2) : '?';
                        return `§a${value}`;
                    });
                    summary.push(`§7${label}: ${values.join('§8/')}`);
                }
            }
        }
        if (averageGameTimeEnabled && averageGameTime) summary.push(`§7AVG TIME ${averageTimeColor(averageGameTime)}${averageGameTime}`);
    }
    const hasSession = summary.length > 0;
    if (hasSession) summary[0] = '§7SESSION ' + summary[0];
    const target = Math.floor(Number(gamesGoal));
    if (selected.has('goals') && Number.isFinite(target) && target > 0) {
        const known = Number.isFinite(games) && games >= 0;
        const filled = known ? Math.min(10, Math.floor(games / target * 10)) : 0;
        const color = known && games >= target ? '§a' : '§e';
        summary.push(hasSession
            ? `§7GAMES ${color}${count(games)}/${formatInt(target)}`
            : `§7GAMES GOAL ${color}${count(games)}/${formatInt(target)} §7[§a${'|'.repeat(filled)}§8${'-'.repeat(10 - filled)}§7]`);
    }
    if (summary.length) {
        if (hasSession && statParts.length) lines.push('§r');
        let row = summary.join('   ');
        if (chatTextWidth(row) > CHAT_WIDTH) row = summary.join(' ');
        lines.push(...(chatTextWidth(row) <= CHAT_WIDTH ? [row] : wrap(summary)));
    }
    if (selected.has('header')) lines.push(`§8${'-'.repeat(Math.round(chatTextWidth(header) / chatCharWidth('-')))}`);
    return lines.filter(Boolean).map(line =>
        ' '.repeat(Math.max(0, Math.round((CHAT_WIDTH - chatTextWidth(line)) / (2 * chatCharWidth(' '))))) + line);
}

function scoreboardRecapMessages(options) {
    return scoreboardRecapLines(options).map(text => stripAnsi(text).trimStart().startsWith('SESSION ')
        ? { text, clickEvent: { action: 'run_command', value: '/session' },
            hoverEvent: { action: 'show_text', value: '§7Click to view your full session.' } }
        : { text });
}

module.exports = { scoreboardRecapLines, scoreboardRecapMessages, chatTextWidth, chatCharWidth, CHAT_WIDTH };
