'use strict';

const { stripAnsi } = require('../../features/minecraft_chat');
const { formatInt, formatRatio } = require('./format');
const { normalizeRecapFields } = require('../session/settings');

// Advances measured from the production assets/session-card-font.png atlas,
// including Minecraft's one-pixel glyph gap. Chat uses the client's font;
// the launcher draws that same default bitmap rather than a web-font substitute.
const NARROW_GLYPHS = { ' ': 4, '!': 2, '"': 5, "'": 3, '(': 5, ')': 5, '*': 5,
    ',': 2, '.': 2, ':': 2, ';': 2, '<': 5, '>': 5, '@': 7, I: 4, '[': 4, ']': 4,
    '`': 3, f: 5, i: 2, k: 5, l: 3, t: 4, '{': 5, '|': 2, '}': 5, '~': 7 };
const chatCharWidth = char => NARROW_GLYPHS[char] || 6;
const chatTextWidth = text => [...stripAnsi(String(text))].reduce((sum, char) => sum + chatCharWidth(char), 0);
const CHAT_WIDTH = 320;

// Shared by real Minecraft chat and the launcher's preview. Widths use Fury's
// existing Minecraft glyph metrics; no HTML-specific layout enters chat.
function scoreboardRecapLines({ game, result, duration = '', averageGameTime = '', variant = '', map = '', stats = [], gamesGoal = 0, games, session = null, fields } = {}) {
    const selected = new Set(normalizeRecapFields(fields));
    const title = { Bedwars: 'BED WARS', SkyWars: 'SKYWARS', Duels: 'DUELS' }[game] || 'GAME';
    const badge = result === 'win' ? '§aVICTORY' : result === 'loss' ? '§cDEFEAT' : '§fGAME OVER';
    const mode = stripAnsi(String(variant || '')).replace(/[\r\n]/g, ' ').slice(0, 24);
    let details = [selected.has('result') && badge, selected.has('duration') && duration && `§7${duration.replace(/m (\d)s$/, 'm 0$1s')}`, selected.has('mode') && mode && `§f${mode}`].filter(Boolean).join('   ');
    let mapName = selected.has('map') && game === 'Bedwars' && typeof map === 'string'
        ? stripAnsi(map).replace(/[\x00-\x20\x7f]+/g, ' ').trim().slice(0, 80) : '';
    if (mapName) {
        const prefix = (details ? '   ' : '') + '§7Map: ';
        const available = CHAT_WIDTH - chatTextWidth(details + prefix);
        if (chatTextWidth(mapName) > available) {
            while (mapName && chatTextWidth(mapName + '...') > available) mapName = mapName.slice(0, -1);
            mapName = mapName ? mapName.trimEnd() + '...' : '';
        }
        if (mapName) details += prefix + mapName;
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
    const header = `§6------ ${title} RECAP ------`;
    const lines = [selected.has('header') && header, details,
        ...wrap(stats.filter(stat => selected.has(stat.field || stat.label.toLowerCase()))
            .map(({ label, value, color }) => `${color}${stripAnsi(String(value))} ${label.toUpperCase()}`))];
    const summary = [];
    const count = value => Number.isFinite(value) && value >= 0 ? formatInt(value) : '?';
    if (session) {
        const results = [];
        if (selected.has('session_wins')) results.push(`§a${count(session.wins)}W`);
        if (selected.has('session_losses')) results.push(`§c${count(session.losses)}L`);
        if (results.length) summary.push(results.join(' §7/ '));
        if (selected.has('session_ratio') && game === 'Bedwars') {
            summary.push(`§7FKDR §f${Number.isFinite(session.fkdr) ? formatRatio(session.fkdr) : '?'}`);
        }
        if (selected.has('session_games')) summary.push(`§7PLAYED §f${count(session.games)}`);
        if (averageGameTime) summary.push(`§7AVG TIME §f${averageGameTime}`);
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
        let row = summary.join('   ');
        if (chatTextWidth(row) > CHAT_WIDTH) row = summary.join(' ');
        lines.push(...(chatTextWidth(row) <= CHAT_WIDTH ? [row] : wrap(summary)));
    }
    if (selected.has('header')) lines.push(`§6${'-'.repeat(Math.round(chatTextWidth(header) / chatCharWidth('-')))}`);
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
