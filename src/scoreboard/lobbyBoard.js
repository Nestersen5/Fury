'use strict';

// Pure layout for the custom Bed Wars lobby sidebar. Shared by the proxy (which
// draws it through vanilla 1.8.9 scoreboard packets) and the launcher preview,
// so both always show the same rows. Everything here respects the 1.8.9
// sidebar: 16 legacy colours, at most 15 rows, 16-character team prefixes and
// suffixes, and 40-character score entries.

const MAX_ROWS = 15;
const TEAM_TEXT_LIMIT = 16;
const ENTRY_TEXT_LIMIT = 40;
const HEX = '0123456789abcdef';
const entryName = index => `§${HEX[index]}§r§f§r`;
const BAR_SQUARES = 10;
// Each row starts one space in from the sidebar's left edge.
const ROW_INDENT = ' ';
const TITLE = '§e§lBED WARS';
const FOOTER = '§ewww.hypixel.net';
const DEFAULT_LOBBY_SCOREBOARD_STYLE = 'classic';
const DEFAULT_LOBBY_SCOREBOARD_DECIMALS = 4;

const base = { date: '§7', server: '§8', labels: null };
const LOBBY_SCOREBOARD_STYLES = Object.freeze([
    { id: 'grey', name: 'Grey labels', description: 'Values stand out, labels step back.',
        theme: { ...base, date: '§8', label: '§7', progress: ['§f', '§8', '§f'], bar: ['§a', '§8'], tokens: '§a', slumber: ['§f', '§8', '§f'], header: '§f§l', kills: '§f', wins: '§f', fkdr: '§6', winstreak: '§a' } },
    { id: 'classic', name: 'Classic', description: 'Hypixel-style colors.',
        theme: { ...base, label: '§f', progress: ['§b', '§7', '§a'], bar: ['§b', '§8'], tokens: '§2', slumber: ['§a', '§7', '§c'], header: '§7§l', kills: '§e', wins: '§e', fkdr: '§6', winstreak: '§a' } },
    { id: 'gold', name: 'Gold accent', description: 'One gold accent to match the yellow title.',
        theme: { ...base, label: '§f', progress: ['§6', '§7', '§6'], bar: ['§6', '§8'], tokens: '§6', slumber: ['§6', '§7', '§6'], header: '§6§l', kills: '§6', wins: '§6', fkdr: '§6', winstreak: '§6' } },
    { id: 'aqua', name: 'Aqua accent', description: 'Cool contrast with the yellow title.',
        theme: { ...base, date: '§8', label: '§7', progress: ['§b', '§8', '§3'], bar: ['§b', '§8'], tokens: '§b', slumber: ['§b', '§8', '§3'], header: '§3§l', kills: '§b', wins: '§b', fkdr: '§b', winstreak: '§b' } },
    { id: 'labels', name: 'Colored labels', description: 'Each label has its own color, values in white.',
        theme: { ...base, label: '§f', labels: { level: '§b', progress: '§b', tokens: '§2', slumber: '§a', kills: '§c', wins: '§e', fkdr: '§6', winstreak: '§d' },
            progress: ['§f', '§7', '§f'], bar: ['§b', '§8'], tokens: '§f', slumber: ['§f', '§7', '§f'], header: '§7§l', kills: '§f', wins: '§f', fkdr: '§f', winstreak: '§f' } },
    { id: 'category', name: 'By category', description: 'Progress aqua, currency green, combat red, wins yellow.',
        theme: { ...base, label: '§f', progress: ['§b', '§7', '§3'], bar: ['§b', '§8'], tokens: '§a', slumber: ['§a', '§7', '§2'], header: '§7§l', kills: '§c', wins: '§e', fkdr: '§c', winstreak: '§e' } }
]);
const STYLE_BY_ID = new Map(LOBBY_SCOREBOARD_STYLES.map(style => [style.id, style]));

function normalizeLobbyScoreboardStyle(value) {
    const id = String(value || '').trim().toLowerCase();
    return STYLE_BY_ID.has(id) ? id : DEFAULT_LOBBY_SCOREBOARD_STYLE;
}

function normalizeLobbyScoreboardDecimals(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return DEFAULT_LOBBY_SCOREBOARD_DECIMALS;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(4, Math.floor(number))) : DEFAULT_LOBBY_SCOREBOARD_DECIMALS;
}

const plain = value => String(value || '').replace(/§[0-9a-fk-or]/gi, '');
// Hypixel's sidebar entries are invisible emoji between a team prefix and
// suffix; the 1.8 font draws them as nothing.
const visible = value => String(value || '').replace(/[\u{10000}-\u{10FFFF}]/gu, '');
const isBlank = value => plain(value).trim() === '';

const isBedwarsTitle = title => /^BED ?WARS$/i.test(plain(visible(title)).trim());

function isBedwarsLobbyBoard(title, lines = []) {
    if (!isBedwarsTitle(title)) return false;
    return lines.some(line => /^(?:Level|Progress):/i.test(plain(visible(line)).trim()));
}

// 1.8.9 default font advances (glyph width + 1 px spacing). Only used to centre
// short rows with spaces, so other characters fall back to the common 6 px.
const NARROW = { ' ': 4, '!': 2, "'": 3, ',': 2, '.': 2, ':': 2, ';': 2, i: 2, l: 3, '|': 2, '`': 3, I: 4, t: 4, '[': 4, ']': 4, f: 5, k: 5, '<': 5, '>': 5, '(': 5, ')': 5, '*': 5, '{': 5, '}': 5, '"': 5, '@': 7, '~': 7 };
function textWidth(text) {
    let width = 0, bold = false;
    const value = String(text || '');
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === '§' && i + 1 < value.length) {
            const code = value[++i].toLowerCase();
            if (code === 'l') bold = true;
            else if (/[0-9a-fr]/.test(code)) bold = false;
            continue;
        }
        width += (NARROW[ch] || 6) + (bold ? 1 : 0);
    }
    return width;
}

// Formatting still active at the end of `text`, to carry into a suffix.
function activeFormat(text) {
    let color = '', styles = '';
    for (let i = 0; i < text.length - 1; i++) {
        if (text[i] !== '§') continue;
        const code = text[++i].toLowerCase();
        if (/[0-9a-f]/.test(code)) { color = `§${code}`; styles = ''; }
        else if (code === 'r') { color = ''; styles = ''; }
        else if (/[k-o]/.test(code)) styles += `§${code}`;
    }
    return color + styles;
}

// Short rows keep an invisible, unique score entry between the team prefix
// and suffix. Long rows also use that entry for text, keeping full values and
// their colours instead of truncating at the team text limit.
function splitRow(text, index = 0) {
    const value = String(text || '');
    // Distinct from Hypixel's emoji entries; the marker resets formatting.
    const marker = entryName(index);
    if (value.length <= TEAM_TEXT_LIMIT) return { prefix: value, entry: marker, suffix: '' };
    const part = cut => {
        const prefix = value.slice(0, cut), rest = value.slice(cut);
        // A suffix that opens with its own colour or reset needs no carried formatting.
        const carry = /^§[0-9a-fr]/i.test(rest) ? '' : activeFormat(prefix);
        return { prefix, suffix: carry + rest };
    };
    // The latest split whose suffix fits; never inside a formatting code.
    for (let cut = TEAM_TEXT_LIMIT; cut > 0; cut--) {
        if (value[cut - 1] === '§') continue;
        const split = part(cut);
        if (split.suffix.length <= TEAM_TEXT_LIMIT) return { ...split, entry: marker };
    }
    const split = part(value[TEAM_TEXT_LIMIT - 1] === '§' ? TEAM_TEXT_LIMIT - 1 : TEAM_TEXT_LIMIT);
    let cut = Math.min(split.suffix.length, ENTRY_TEXT_LIMIT - marker.length);
    if (split.suffix[cut - 1] === '§') cut--;
    const middle = split.suffix.slice(0, cut), rest = split.suffix.slice(cut);
    const carry = !rest || /^§[0-9a-fr]/i.test(rest) ? '' : activeFormat(middle);
    let suffix = (carry + rest).slice(0, TEAM_TEXT_LIMIT);
    if (suffix.endsWith('§')) suffix = suffix.slice(0, -1);
    return { prefix: split.prefix, entry: marker + middle, suffix };
}

function quantity(raw) {
    let text = String(raw || '').trim().replace(/,/g, '').toLowerCase();
    const multiplier = text.endsWith('k') ? 1000 : text.endsWith('m') ? 1000000 : 1;
    if (multiplier !== 1) text = text.slice(0, -1);
    if (!/^\d+(?:\.\d+)?$/.test(text)) return NaN;
    return Number(text) * multiplier;
}

function fraction(value) {
    const parts = plain(value).split('/');
    if (parts.length !== 2) return null;
    const current = parts[0].trim(), max = parts[1].trim();
    const ratio = quantity(current) / quantity(max);
    return current && max ? { current, max, ratio: Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : null } : null;
}

const FIELDS = [
    ['level', /^Level$/i],
    ['progress', /^Progress$/i],
    ['tokens', /^Tokens$/i],
    ['slumber', /^(?:Slumber(?: Tickets)?|Tickets)$/i],
    ['kills', /^Total Kills$/i],
    ['wins', /^Total Wins$/i]
];

// Reads Hypixel's lobby rows. Rows the layout does not know are kept as sent.
function parseLobbyLines(lines = []) {
    const parsed = { date: null, fields: {}, other: [] };
    for (const source of lines) {
        const line = visible(source);
        const clean = plain(line).trim();
        if (!clean) continue;
        if (!parsed.date && /^\d{2}\/\d{2}\/\d{2,4}(?:\s+\S+)?$/.test(clean)) { parsed.date = clean; continue; }
        if (/^www\.hypixel\.net$/i.test(clean)) continue;
        // Hypixel's own progress bar is redrawn from the Progress value.
        if (/^\[?[■█\s]+\]?$/.test(clean)) continue;
        const colon = line.indexOf(':');
        const label = colon > 0 ? plain(line.slice(0, colon)).trim() : '';
        const field = label ? FIELDS.find(([, pattern]) => pattern.test(label)) : null;
        if (field && !parsed.fields[field[0]]) {
            parsed.fields[field[0]] = { formatted: line.slice(colon + 1).trim(), value: plain(line.slice(colon + 1)).trim() };
            continue;
        }
        parsed.other.push(line.trim());
    }
    return parsed;
}

const finite = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const ratioOf = (finals, deaths) => (deaths > 0 ? finals / deaths : finals);

// Lifetime FKDR now and how far it moved today. The change is hidden when
// today's numbers are missing, inconsistent, or round to zero.
function fkdrSummary(stats = null, decimals = DEFAULT_LOBBY_SCOREBOARD_DECIMALS) {
    decimals = normalizeLobbyScoreboardDecimals(decimals);
    const finals = finite(stats?.finals), deaths = finite(stats?.deaths);
    if (finals === null || deaths === null) return null;
    const current = ratioOf(finals, deaths);
    const dailyFinals = finite(stats?.dailyFinals), dailyDeaths = finite(stats?.dailyDeaths);
    let change = null;
    if (dailyFinals !== null && dailyDeaths !== null && dailyFinals <= finals && dailyDeaths <= deaths
        && (dailyFinals > 0 || dailyDeaths > 0)) {
        const diff = current - ratioOf(finals - dailyFinals, deaths - dailyDeaths);
        if (Math.abs(diff) >= 0.5 * 10 ** -decimals) change = diff;
    }
    return { value: current.toFixed(decimals), change: change === null ? null : (change > 0 ? '§a▲' : '§c▼') + Math.abs(change).toFixed(decimals) };
}

// Urchin's daily session delta: each stat is either today's change or its
// lifetime value at the start of today ("old") and now ("new").
function readDailyBedwarsDelta(session) {
    if (!session || session.error) return null;
    const bw = session?.delta?.stats?.Bedwars;
    if (!bw || typeof bw !== 'object') return null;
    const read = value => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (value && typeof value === 'object') {
            const next = Number(value.new), prev = Number(value.old);
            if (Number.isFinite(next) && Number.isFinite(prev)) return next - prev;
        }
        return value === undefined ? 0 : null;
    };
    const finals = read(bw.final_kills_bedwars), deaths = read(bw.final_deaths_bedwars);
    return finals === null || deaths === null ? null : { finals: Math.max(0, finals), deaths: Math.max(0, deaths) };
}

function readOwnBedwarsStats(player) {
    const bw = player?.stats?.Bedwars;
    if (!bw || typeof bw !== 'object') return null;
    const number = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    return {
        finals: number(bw.final_kills_bedwars) ?? 0,
        deaths: number(bw.final_deaths_bedwars) ?? 0,
        // Hypixel hides winstreak for players who turned it off in the API.
        winstreak: number(bw.winstreak)
    };
}

function centered(text, width) {
    const pad = Math.max(0, Math.floor((width - textWidth(text)) / 2 / 4));
    return ' '.repeat(pad) + text;
}

// Builds the custom board, or null when the rows are not a Bed Wars lobby.
// `stats`: { finals, deaths, winstreak, dailyFinals, dailyDeaths } or null.
// Returns the title and up to 15 row texts, top row first.
function buildLobbyBoard({ title = '', lines = [], style, decimals, stats = null } = {}) {
    if (!isBedwarsLobbyBoard(title, lines)) return null;
    const theme = STYLE_BY_ID.get(normalizeLobbyScoreboardStyle(style)).theme;
    const { date, fields, other } = parseLobbyLines(lines);
    const label = (key, text) => `${theme.labels?.[key] || theme.label}${text}: `;
    const rows = [];
    const add = (text, center = false, keepGap = false) => rows.push({ text, center, keepGap });
    const blank = (keepGap = false) => {
        if (!rows.length) return;
        if (rows[rows.length - 1].text !== '') add('', false, keepGap);
        else if (keepGap) rows[rows.length - 1].keepGap = true;
    };

    if (date) {
        const [day, server] = date.split(/\s+/);
        add(`${theme.date}${day}${server ? ` ${theme.server}${server}` : ''}`, true);
        // Keep the date/server row separated from Level, even with stats.
        add('', false, true);
    }
    if (fields.level) {
        add(label('level', 'Level') + fields.level.formatted);
        if (fields.progress) blank();
    }
    if (fields.progress) {
        const parts = fraction(fields.progress.value);
        if (parts) {
            const [current, slash, max] = theme.progress;
            add(`${label('progress', 'Progress')}${current}${parts.current}${slash}/${max}${parts.max}`);
            if (parts.ratio !== null) {
                const filled = Math.round(parts.ratio * BAR_SQUARES);
                add(`${theme.bar[0]}${'■'.repeat(filled)}${theme.bar[1]}${'■'.repeat(BAR_SQUARES - filled)}`);
            }
        } else add(label('progress', 'Progress') + fields.progress.formatted);
    }
    blank();
    if (fields.tokens) add(`${label('tokens', 'Tokens')}${theme.tokens}${fields.tokens.value}`);
    if (fields.slumber) {
        const parts = fraction(fields.slumber.value);
        const [current, slash, max] = theme.slumber;
        add(label('slumber', 'Slumber') + (parts ? `${current}${parts.current}${slash}/${max}${parts.max}` : `${current}${fields.slumber.value}`));
    }
    other.forEach(line => add(line));
    blank();
    if (fields.kills || fields.wins) {
        if (fields.kills) add(`${label('kills', 'Total Kills')}${theme.kills}${fields.kills.value}`);
        if (fields.wins) add(`${label('wins', 'Total Wins')}${theme.wins}${fields.wins.value}`);
    }
    const fkdr = fkdrSummary(stats, decimals);
    const winstreak = finite(stats?.winstreak);
    if (fkdr) add(`${label('fkdr', 'FKDR')}${theme.fkdr}${fkdr.value}${fkdr.change ? ` ${fkdr.change}` : ''}`);
    if (winstreak !== null) add(`${label('winstreak', 'Winstreak')}${theme.winstreak}${Math.floor(winstreak)}`);

    while (rows.length && rows[rows.length - 1].text === '') rows.pop();
    if (winstreak !== null) add('', false, true);
    // The footer returns only when there is room for it below a gap.
    const footerRows = rows[rows.length - 1]?.text === '' ? 1 : 2;
    if (rows.length + footerRows <= MAX_ROWS) { blank(); add(FOOTER, true); }
    // Keep the date and Winstreak gaps; give up other gaps from the bottom
    // before truncating content on unusually crowded server boards.
    for (let i = rows.length - 1; rows.length > MAX_ROWS && i > 0; i--) {
        if (rows[i].text === '' && !rows[i].keepGap) rows.splice(i, 1);
    }
    const kept = rows.slice(0, MAX_ROWS).map(row => (row.text && !row.center ? { ...row, text: ROW_INDENT + row.text } : row));
    const width = Math.max(textWidth(TITLE), ...kept.filter(row => !row.center).map(row => textWidth(row.text)));
    return { title: TITLE, rows: kept.map(row => (row.center ? centered(row.text, width) : row.text)) };
}

// Hypixel's other Bed Wars boards (pregame, in game) exactly as sent, each
// line one space in from the edge.
function buildIndentedBoard({ title = '', lines = [] } = {}) {
    if (!isBedwarsTitle(title) || !lines.length) return null;
    const rows = lines.slice(0, MAX_ROWS).map(line => {
        const text = visible(line);
        return isBlank(text) ? '' : ROW_INDENT + text;
    });
    return { title: visible(title), rows };
}

// The board Fury shows for a Bed Wars sidebar, or null to leave Hypixel's.
function buildBedwarsSidebar(input = {}) {
    return buildLobbyBoard(input) || buildIndentedBoard(input);
}

module.exports = {
    buildIndentedBoard,
    buildBedwarsSidebar,
    MAX_ROWS,
    TITLE,
    LOBBY_SCOREBOARD_STYLES,
    DEFAULT_LOBBY_SCOREBOARD_STYLE,
    DEFAULT_LOBBY_SCOREBOARD_DECIMALS,
    normalizeLobbyScoreboardStyle,
    normalizeLobbyScoreboardDecimals,
    isBedwarsLobbyBoard,
    parseLobbyLines,
    buildLobbyBoard,
    splitRow,
    entryName,
    activeFormat,
    textWidth,
    fkdrSummary,
    readDailyBedwarsDelta,
    readOwnBedwarsStats,
    plain,
    isBlank
};
