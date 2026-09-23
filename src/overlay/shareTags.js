'use strict';

// /share broadcaster.
//
// Takes the results array produced by performFullScan (cached on
// state.lastScanResults) and posts one /pc line per eligible player so
// party teammates see what tags, nicks, and stat threats are around.

const { stripAnsi, extractText, LEGACY_COLOR_NAMES } = require('../../features/minecraft_chat.js');
const { getFkdrColor, getKdrColor } = require('../stats/colors.js');
const { formatNametagTagValue, nametagTagCategory, stripNametagIconGlyphs } = require('./nametags.js');

const STALE_RESULTS_MS = 60 * 1000;
const MAX_LINES_PER_BROADCAST = 12;
const SEND_INTERVAL_MS = 400;
// Cap on the full outgoing chat command including the "/pc " or "/ac "
// prefix, so formatLine truncates to MAX_PC_LENGTH - CHAT_PREFIX_LENGTH.
const MAX_PC_LENGTH = 240;
const CHAT_PREFIX_LENGTH = '/pc '.length;
const SHARE_CATEGORIES = ['tagged', 'nicks', 'threats'];
const CAUTION_WARNING_PATTERN = /THIS TAG DOES NOT MEAN THE PLAYER IS CHEATING!?/i;
const CAUTION_REASON_MAX_WORDS = 7;
const CAUTION_REASON_MAX_CHARS = 60;

const BEDWARS_TEAM_ORDER = ['RED', 'BLUE', 'GREEN', 'YELLOW', 'AQUA', 'WHITE', 'PINK', 'GRAY'];

const TAG_LABELS = [
    { pattern: /\blegit\b/i, label: 'Legit Sniper' },
    { pattern: /\bcloset\b/i, label: 'Closet Cheater' },
    { pattern: /\bblatant\b/i, label: 'Blatant Cheater' },
    { pattern: /\bsniper\b/i, label: 'Sniper' },
    { pattern: /\bblacklist(?:ed)?\b/i, label: 'Blacklisted' }
];

const CHEAT_PATTERNS = [
    { pattern: /\b(?:legit)?\s*scaf+(?:old|olding)?\b/i, label: 'Scaffold' },
    { pattern: /\bdouble\s*shift(?:ing)?\b/i, label: 'Scaffold (Doubleshifting)' },
    { pattern: /\bauto[\s-]*block(?:ing)?\b/i, label: 'Auto Block' },
    { pattern: /\bab(?:ing)?\b/i, label: 'Auto Block' },
    { pattern: /\b(?:lag\s*range|lagrange|range\s*lag)\b/i, label: 'Lag Range' },
    { pattern: /\bblink(?:ing)?\b/i, label: 'Blink' },
    { pattern: /\b(?:auto\s*click(?:er|ing)?|autoclicker)\b/i, label: 'Auto Clicker' },
    { pattern: /\bac(?:ing)?\b/i, label: 'Auto Clicker' },
    { pattern: /\b(?:esp|x-?ray|full\s*bright|wall\s*hack|tracers?|chams?|visuals?|no\s*fog)\b/i, label: 'Visuals' },
    { pattern: /\bfast\s*place(?:ing)?\b/i, label: 'Fast Place' },
    { pattern: /\bsafe\s*walk(?:ing)?\b/i, label: 'Safewalk' },
    { pattern: /\bvelo(?:city)?\b/i, label: 'Velocity' },
    { pattern: /\bnuk(?:e|ing|er)\b/i, label: 'Nuking' },
    { pattern: /\bpierc(?:e|ing)\b/i, label: 'Piercing' }
];

function cleanText(value = '') {
    return stripNametagIconGlyphs(stripAnsi(value))
        .replace(/\r/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeTeamLabel(team) {
    if (!team) return 'UNKNOWN';
    const upper = cleanText(team).toUpperCase();
    if (BEDWARS_TEAM_ORDER.includes(upper)) return upper;
    return upper || 'UNKNOWN';
}

function teamSortIndex(team) {
    const idx = BEDWARS_TEAM_ORDER.indexOf(team);
    return idx === -1 ? 99 : idx;
}

function normalizeIncludeName(name) {
    const clean = String(name || '').toLowerCase().trim();
    if (['tag', 'tags', 'tagged'].includes(clean)) return 'tagged';
    if (['nick', 'nicks', 'nicked'].includes(clean)) return 'nicks';
    if (['threat', 'threats', 'stat', 'stats'].includes(clean)) return 'threats';
    if (['all', 'everything'].includes(clean)) return 'all';
    return '';
}

function includeSetFromList(list, fallback = null) {
    const raw = Array.isArray(list)
        ? list
        : (list instanceof Set ? Array.from(list) : [list]);
    const normalized = raw
        .map(normalizeIncludeName)
        .filter(Boolean);
    if (normalized.includes('all')) return new Set(SHARE_CATEGORIES);
    const includeSet = new Set(normalized);
    return includeSet.size > 0 ? includeSet : fallback;
}

function titleCaseWords(value = '') {
    return cleanText(value)
        .toLowerCase()
        .replace(/\b[a-z]/g, char => char.toUpperCase());
}

function baseTagName(value = '') {
    const clean = cleanText(value)
        .replace(/^[\[\s]+|[\]\s]+$/g, '');
    const addedByIndex = clean.search(/\(\s*added by\b/i);
    const withoutMeta = addedByIndex >= 0 ? clean.slice(0, addedByIndex) : clean;
    return withoutMeta
        .split(/\s+-\s+/)[0]
        .split(':')[0]
        .trim();
}

function labelForTagText(value = '') {
    const category = nametagTagCategory(value);
    if (category) return stripAnsi(formatNametagTagValue(value, { tagDisplayMode: 'full' }));
    const base = baseTagName(value);
    if (!base) return '';
    const match = TAG_LABELS.find(entry => entry.pattern.test(base));
    if (match) return match.label;
    if (/\bcheat(?:er|ing)?\b/i.test(base)) return titleCaseWords(base.replace(/\bcheating\b/i, 'Cheater'));
    return titleCaseWords(base);
}

function collectUrchinTagTexts(row = {}) {
    const texts = [];
    const add = (value) => {
        const clean = cleanText(value);
        if (clean) texts.push(clean);
    };

    add(row.uTag);
    (row.urchinRaw?.rawTags || []).forEach((tag = {}) => {
        add(tag.text);
        add(tag.tooltip);
        add(tag.raw?.type || tag.raw?.tag_type || tag.raw?.tag || tag.raw?.name || tag.raw?.category);
        add(tag.raw?.reason || tag.raw?.notes || tag.raw?.description);
    });
    return texts;
}

function collectSeraphTagTexts(row = {}) {
    const texts = [];
    const add = (value) => {
        const clean = cleanText(value);
        if (clean) texts.push(clean);
    };

    add(row.sTag);
    add(row.seraphRaw?.report_type);
    add(row.seraphRaw?.tooltip);
    add(row.seraphRaw?.notes);
    return texts;
}

function tagTexts(row = {}) {
    return [
        ...collectUrchinTagTexts(row),
        ...collectSeraphTagTexts(row)
    ];
}

function preferredTagTexts(row = {}) {
    const urchinTexts = collectUrchinTagTexts(row);
    if (urchinTexts.length > 0) return urchinTexts;
    const seraphTexts = collectSeraphTagTexts(row);
    if (seraphTexts.length > 0) return seraphTexts;
    return [];
}

function preferredTagSource(row = {}) {
    if (collectUrchinTagTexts(row).length > 0) return 'Urchin';
    if (collectSeraphTagTexts(row).length > 0) return 'Seraph';
    return '';
}

function tagLabels(row = {}) {
    const seen = new Set();
    const labels = [];
    preferredTagTexts(row).forEach((text) => {
        const label = labelForTagText(text);
        const key = label.toLowerCase();
        if (!label || seen.has(key)) return;
        seen.add(key);
        labels.push(label);
    });
    return labels.length ? [labels[0]] : ['Tagged'];
}

function detectedCheats(row = {}) {
    const haystack = preferredTagTexts(row).join('\n');
    if (!haystack) return [];
    const labels = [];
    for (const entry of CHEAT_PATTERNS) {
        if (entry.pattern.test(haystack) && !labels.includes(entry.label)) labels.push(entry.label);
    }
    // Doubleshifting is a scaffold technique, so the plain Scaffold label
    // folds into the more specific one instead of appearing twice.
    if (labels.includes('Scaffold (Doubleshifting)')) {
        return labels.filter(label => label !== 'Scaffold');
    }
    return labels;
}

function hasTag(row = {}) {
    return preferredTagTexts(row).length > 0;
}

// The free-text part of a tag tooltip: whatever follows the
// "(Added by user date)" metadata, minus the caution boilerplate.
function tagReasonText(value = '') {
    const clean = cleanText(value).replace(CAUTION_WARNING_PATTERN, ' ');
    const metaMatch = clean.match(/\(\s*added by\b[^)]*\)/i);
    if (!metaMatch) return '';
    return clean
        .slice(clean.indexOf(metaMatch[0]) + metaMatch[0].length)
        .replace(/^[\s:\-–]+/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function cautionReasonSnippet(row = {}) {
    for (const text of preferredTagTexts(row)) {
        const isCaution = CAUTION_WARNING_PATTERN.test(cleanText(text))
            || /\bcaution\b/i.test(baseTagName(text));
        if (!isCaution) continue;
        const reason = tagReasonText(text);
        if (!reason) continue;
        let snippet = reason.split(' ').slice(0, CAUTION_REASON_MAX_WORDS).join(' ');
        if (snippet.length > CAUTION_REASON_MAX_CHARS) {
            snippet = snippet.slice(0, CAUTION_REASON_MAX_CHARS).trimEnd();
        }
        return snippet.length < reason.length ? `${snippet}...` : snippet;
    }
    return '';
}

function numberText(value, digits = 2) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : (0).toFixed(digits);
}

function statText(row = {}, gameMode = 'BEDWARS', fancy = false) {
    if (fancy) {
        return gameMode === 'SKYWARS'
            ? `KDR ${numberText(row.kdr)}`
            : `FKDR ${numberText(row.fkdr)}`;
    }
    return gameMode === 'SKYWARS'
        ? `KDR: ${numberText(row.kdr)}`
        : `FKDR: ${numberText(row.fkdr)}`;
}

function monthlyFkdrText(row = {}, gameMode = 'BEDWARS') {
    if (gameMode !== 'BEDWARS') return '';
    const monthlyFkdr = Number(row.monthlyFkdr);
    return Number.isFinite(monthlyFkdr) ? `MFKDR: ${numberText(monthlyFkdr)}` : '';
}

function statTextWithMonthly(row = {}, gameMode = 'BEDWARS', fancy = false) {
    const monthly = monthlyFkdrText(row, gameMode);
    if (!monthly) return statText(row, gameMode, fancy);
    return fancy
        ? `${statText(row, gameMode, fancy)} | ${monthly}`
        : `${statText(row, gameMode, fancy)} ${monthly}`;
}

function denickedRealName(row = {}) {
    row = row || {};
    const realName = cleanText(row.realName || row.denickedAs || row.denickResult?.realName || '');
    const nick = cleanText(row.name || '');
    if (!realName || realName.toLowerCase() === nick.toLowerCase()) return '';
    return realName;
}

function playerShareName(row = {}) {
    row = row || {};
    const nick = cleanText(row.name || 'Unknown');
    const realName = denickedRealName(row);
    return realName ? `${nick} -> ${realName}` : nick;
}

function hasPrimaryStat(row = {}, gameMode = 'BEDWARS') {
    row = row || {};
    const value = gameMode === 'SKYWARS' ? row.kdr : row.fkdr;
    return Number.isFinite(Number(value));
}

function nickStatText(row = {}, gameMode = 'BEDWARS', fancy = false) {
    if (!denickedRealName(row) || !hasPrimaryStat(row, gameMode)) return '';
    return statTextWithMonthly(row, gameMode, fancy);
}

function shareStatsFromProfile(profile, gameMode = 'BEDWARS') {
    const data = profile?.data || profile || {};
    const player = data.player || {};
    const stats = player.stats || {};
    if (!player.stats) return {};

    if (gameMode === 'SKYWARS') {
        const sw = stats.SkyWars || {};
        if (!stats.SkyWars) return {};
        const kills = Number(sw.kills) || 0;
        const deaths = Number(sw.deaths) || 0;
        const wins = Number(sw.wins) || 0;
        const losses = Number(sw.losses) || 0;
        const kdr = kills / Math.max(deaths, 1);
        return {
            kdr,
            wlr: wins / Math.max(losses, 1),
            ws: Number(sw.win_streak) || 0,
            sortValue: kdr
        };
    }

    const bw = stats.Bedwars || {};
    if (!stats.Bedwars) return {};
    const finals = Number(bw.final_kills_bedwars) || 0;
    const finalDeaths = Number(bw.final_deaths_bedwars) || 0;
    const wins = Number(bw.wins_bedwars) || 0;
    const losses = Number(bw.losses_bedwars) || 0;
    const fkdr = finals / Math.max(finalDeaths, 1);
    return {
        stars: Number(player.achievements?.bedwars_level) || 0,
        fkdr,
        wlr: wins / Math.max(losses, 1),
        ws: Number(bw.winstreak) || 0,
        sortValue: fkdr
    };
}

function monthlyFkdrFromSessionData(data = {}) {
    if (data?.error) return null;
    const bw = data?.delta?.stats?.Bedwars || {};
    const finals = Number(bw.final_kills_bedwars);
    const finalDeaths = Number(bw.final_deaths_bedwars);
    if (!Number.isFinite(finals) && !Number.isFinite(finalDeaths)) return null;
    return (Number.isFinite(finals) ? finals : 0) / Math.max(Number.isFinite(finalDeaths) ? finalDeaths : 0, 1);
}

function prestigeText(row = {}, gameMode = 'BEDWARS') {
    if (gameMode === 'SKYWARS') {
        const level = cleanText(row.skyLevel || '');
        return level ? `[${level}]` : '';
    }
    const stars = Number(row.stars);
    if (!Number.isFinite(stars)) return '';
    return `[${Math.round(stars)}✫]`;
}

function playerIdentity(row = {}, gameMode = 'BEDWARS') {
    const prestige = prestigeText(row, gameMode);
    const cleanName = cleanText(row.name || 'Unknown');
    return `${prestige ? `${prestige} ` : ''}${cleanName} ✔`;
}

function rowKind(row = {}, includeSet = new Set()) {
    if (includeSet.size === 1) {
        if (includeSet.has('tagged') && hasTag(row)) return 'tagged';
        if (includeSet.has('nicks') && row.isNicked) return 'nicks';
        if (includeSet.has('threats') && row.isThreat) return 'threats';
        return '';
    }
    if (includeSet.has('nicks') && row.isNicked) return 'nicks';
    if (includeSet.has('tagged') && hasTag(row)) return 'tagged';
    if (includeSet.has('threats') && row.isThreat) return 'threats';
    return '';
}

function formatTagDescriptor(row = {}) {
    const labels = tagLabels(row).join(' / ');
    const cheats = detectedCheats(row);
    if (cheats.length) return `${labels} (${cheats.join(', ')})`;
    if (/\bcaution\b/i.test(labels)) {
        const reason = cautionReasonSnippet(row);
        if (reason) return `${labels} (${reason})`;
    }
    return labels;
}

// fancy=false (default): plain lines with no star level or icon glyphs.
// fancy=true: star level + checkmark + pipe separators, launcher-selectable.
function formatLine(row, gameMode, includeSet, fancy = false) {
    const teamLabel = gameMode === 'SKYWARS' ? 'SOLO' : normalizeTeamLabel(row.team);
    const kind = rowKind(row, includeSet);
    const displayName = playerShareName(row);
    let line;

    if (kind === 'nicks') {
        const statText = nickStatText(row, gameMode, fancy);
        if (fancy && statText) {
            line = `[${teamLabel}] ${playerIdentity({ ...row, name: displayName }, gameMode)} | ${statText} | NICK`;
        } else {
            line = `[${teamLabel}] ${displayName} [NICK]${statText ? ` ${statText}` : ''}`;
        }
    } else if (kind === 'tagged') {
        line = fancy
            ? `[${teamLabel}] ${playerIdentity({ ...row, name: displayName }, gameMode)} | ${statTextWithMonthly(row, gameMode, true)} | ${formatTagDescriptor(row)}`
            : `[${teamLabel}] ${displayName}: ${statTextWithMonthly(row, gameMode)} - ${formatTagDescriptor(row)}`;
    } else if (kind === 'threats') {
        line = fancy
            ? `[${teamLabel}] ${playerIdentity({ ...row, name: displayName }, gameMode)} | ${statTextWithMonthly(row, gameMode, true)}`
            : `[${teamLabel}] ${displayName}: ${statTextWithMonthly(row, gameMode)}`;
    } else {
        line = `[${teamLabel}] ${displayName}`;
    }

    const maxLineLength = MAX_PC_LENGTH - CHAT_PREFIX_LENGTH;
    if (line.length > maxLineLength) line = `${line.slice(0, maxLineLength - 3)}...`;
    return line;
}

// ---------- local recolor (formatLineComponent) ----------
// Builds a Minecraft chat component whose visible text matches formatLine's
// output for the same row exactly, but with team/name/stat/tag coloring plus a
// click-to-lookup on the player name. Used only to repaint our OWN /share
// echoes locally (see src/overlay/shareEchoRewriter.js); the outgoing party
// line stays plain text so proxy-less teammates can still read it.

const TEAM_COLOR_NAMES = {
    RED: 'red', BLUE: 'blue', GREEN: 'green', YELLOW: 'yellow',
    AQUA: 'aqua', WHITE: 'white', PINK: 'light_purple', GRAY: 'gray'
};

function teamColorName(teamLabel) {
    return TEAM_COLOR_NAMES[teamLabel] || 'gray';
}

// Cheat list gets its own color so it reads distinctly from the tag label.
const CHEAT_LIST_COLOR = 'yellow';
const STAT_LABEL_COLOR = 'white';

function tagLabelColor(row = {}) {
    return preferredTagSource(row) === 'Seraph' ? 'dark_aqua' : 'light_purple';
}

function seg(value, color, extra) {
    const node = { text: String(value) };
    if (color) node.color = color;
    if (extra) Object.assign(node, extra);
    return node;
}

// Map a legacy §-code color (as returned by getFkdrColor/getKdrColor) to a
// component color name, so the FKDR number matches /stats coloring exactly.
function legacyCodeToColorName(code) {
    const key = String(code || '').replace(/§/g, '').toLowerCase();
    return LEGACY_COLOR_NAMES[key] || 'white';
}

function fkdrColorName(value) {
    return legacyCodeToColorName(getFkdrColor(Number(value) || 0));
}

function kdrColorName(value) {
    return legacyCodeToColorName(getKdrColor(Number(value) || 0));
}

function sanitizeLookupName(name) {
    const clean = String(name || '').trim();
    return /^[A-Za-z0-9_]{1,16}$/.test(clean) ? clean : '';
}

// nameColor lets the caller tint the player name to match its Bedwars team.
function nameSegments(displayName, row, nameColor = 'white') {
    const lookupName = sanitizeLookupName(denickedRealName(row) || cleanText(row.name || ''));
    const clickHover = lookupName
        ? {
            clickEvent: { action: 'run_command', value: `/urchin ${lookupName}` },
            hoverEvent: { action: 'show_text', value: `§bClick to look up §f${lookupName}` }
        }
        : undefined;
    const arrowIndex = displayName.indexOf(' -> ');
    if (arrowIndex >= 0) {
        return [
            seg(displayName.slice(0, arrowIndex), nameColor, clickHover),
            seg(' -> ', 'dark_gray'),
            seg(displayName.slice(arrowIndex + 4), nameColor, clickHover)
        ];
    }
    return [seg(displayName, nameColor, clickHover)];
}

// Fancy identity: prestige + name + checkmark, matching playerIdentity().
function identitySegments(row, displayName, gameMode, nameColor) {
    const prestige = prestigeText(row, gameMode);
    const nodes = [];
    if (prestige) nodes.push(seg(`${prestige} `, 'gold'));
    nodes.push(...nameSegments(cleanText(displayName), row, nameColor));
    nodes.push(seg(' ✔', 'green'));
    return nodes;
}

// Stat segments: "FKDR: " / "MFKDR: " labels stay white, the numbers take the
// /stats FKDR (or SkyWars KDR) color. Concatenated text is identical to
// statTextWithMonthly() so the recolor stays faithful to the sent line.
function statSegments(row, gameMode, fancy) {
    if (gameMode === 'SKYWARS') {
        return [
            seg(fancy ? 'KDR ' : 'KDR: ', STAT_LABEL_COLOR),
            seg(numberText(row.kdr), kdrColorName(row.kdr))
        ];
    }
    const nodes = [
        seg(fancy ? 'FKDR ' : 'FKDR: ', STAT_LABEL_COLOR),
        seg(numberText(row.fkdr), fkdrColorName(row.fkdr))
    ];
    const monthly = Number(row.monthlyFkdr);
    if (Number.isFinite(monthly)) {
        // fancy separates FKDR/MFKDR with " | ", plain with a single space.
        nodes.push(seg(fancy ? ' | ' : ' ', 'dark_gray'));
        nodes.push(seg('MFKDR: ', STAT_LABEL_COLOR), seg(numberText(monthly), fkdrColorName(monthly)));
    }
    return nodes;
}

// Full tag detail shown on hover over the tag label in our LOCAL echo (the
// outgoing /pc line stays plain text). Gives an at-a-glance way to read the
// exact tag tooltip(s) without running /urchin.
function tagHoverText(row = {}) {
    const seen = new Set();
    const lines = [];
    preferredTagTexts(row).forEach((text) => {
        const clean = cleanText(text);
        if (!clean) return;
        const key = clean.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        lines.push(clean.length > 140 ? `${clean.slice(0, 137)}...` : clean);
    });
    if (lines.length === 0) return '';
    const titleColor = preferredTagSource(row) === 'Seraph' ? '§3' : '§d';
    return [`${titleColor}§lTag details`, ...lines.slice(0, 5).map(line => `§7${line}`)].join('\n');
}

// Tag descriptor split so the cheat list is a different color from the label.
// Mirrors formatTagDescriptor()'s text exactly.
function tagDescriptorSegments(row) {
    const labels = tagLabels(row).join(' / ');
    const cheats = detectedCheats(row);
    const hover = tagHoverText(row);
    const hoverExtra = hover ? { hoverEvent: { action: 'show_text', value: hover } } : undefined;
    const nodes = [seg(labels, tagLabelColor(row), hoverExtra)];
    if (cheats.length) {
        nodes.push(seg(' (', 'dark_gray'), seg(cheats.join(', '), CHEAT_LIST_COLOR), seg(')', 'dark_gray'));
    } else if (/\bcaution\b/i.test(labels)) {
        const reason = cautionReasonSnippet(row);
        if (reason) nodes.push(seg(' (', 'dark_gray'), seg(reason, 'gray'), seg(')', 'dark_gray'));
    }
    return nodes;
}

function formatLineComponent(row, gameMode, includeSet, fancy = false) {
    const teamLabel = gameMode === 'SKYWARS' ? 'SOLO' : normalizeTeamLabel(row.team);
    const nameColor = teamColorName(teamLabel);
    const kind = rowKind(row, includeSet);
    const displayName = playerShareName(row);
    const extra = [seg(`[${teamLabel}]`, teamColorName(teamLabel)), seg(' ', 'gray')];

    if (kind === 'nicks') {
        const stat = nickStatText(row, gameMode, fancy);
        if (fancy && stat) {
            extra.push(...identitySegments(row, displayName, gameMode, nameColor));
            extra.push(seg(' | ', 'dark_gray'), ...statSegments(row, gameMode, fancy), seg(' | ', 'dark_gray'), seg('NICK', 'light_purple'));
        } else {
            extra.push(...nameSegments(displayName, row, nameColor));
            extra.push(seg(' ', 'gray'), seg('[NICK]', 'light_purple'));
            if (stat) extra.push(seg(' ', 'gray'), ...statSegments(row, gameMode, fancy));
        }
    } else if (kind === 'tagged') {
        if (fancy) {
            extra.push(...identitySegments(row, displayName, gameMode, nameColor));
            extra.push(seg(' | ', 'dark_gray'), ...statSegments(row, gameMode, fancy), seg(' | ', 'dark_gray'), ...tagDescriptorSegments(row));
        } else {
            extra.push(...nameSegments(displayName, row, nameColor));
            extra.push(seg(': ', 'gray'), ...statSegments(row, gameMode, fancy), seg(' - ', 'dark_gray'), ...tagDescriptorSegments(row));
        }
    } else if (kind === 'threats') {
        if (fancy) {
            extra.push(...identitySegments(row, displayName, gameMode, nameColor));
            extra.push(seg(' | ', 'dark_gray'), ...statSegments(row, gameMode, fancy));
        } else {
            extra.push(...nameSegments(displayName, row, nameColor));
            extra.push(seg(': ', 'gray'), ...statSegments(row, gameMode, fancy));
        }
    } else {
        extra.push(...nameSegments(displayName, row, nameColor));
    }

    return { text: '', extra };
}

// ---------- /share preview ----------
// Representative fake rows spanning the scenarios /share can produce, used by
// `/share preview` to render exactly what each case looks like in chat without
// touching a real scan or sending anything to the server. Each entry carries a
// short `note` so the preview can label the scenario.

const PREVIEW_ROWS = [
    {
        note: 'Blatant cheater + detected cheats',
        gameMode: 'BEDWARS',
        row: {
            name: 'xX_Sniper_Xx', team: 'RED', stars: 305, fkdr: 8.4, monthlyFkdr: 6.2,
            uTag: 'Blatant',
            urchinRaw: { rawTags: [{ text: 'Blatant', tooltip: 'Blatant (Added by Nester 2026-01-01) - scaffold, autoblock, blink' }] }
        }
    },
    {
        note: 'Closet cheater',
        gameMode: 'BEDWARS',
        row: {
            name: 'QuietWins', team: 'BLUE', stars: 178, fkdr: 3.9, monthlyFkdr: 3.1,
            uTag: 'Closet',
            urchinRaw: { rawTags: [{ text: 'Closet', tooltip: 'Closet (Added by Nester 2026-02-11) - velocity, autoclicker' }] }
        }
    },
    {
        note: 'Legit sniper',
        gameMode: 'BEDWARS',
        row: {
            name: 'AimBotch', team: 'GREEN', stars: 412, fkdr: 6.1,
            uTag: 'Legit',
            urchinRaw: { rawTags: [{ text: 'Legit', tooltip: 'Legit sniper (Added by Nester 2026-03-02)' }] }
        }
    },
    {
        note: 'Caution tag with reason',
        gameMode: 'BEDWARS',
        row: {
            name: 'MaybeSus', team: 'YELLOW', stars: 96, fkdr: 2.3,
            uTag: 'Caution',
            urchinRaw: { rawTags: [{ text: 'Caution', tooltip: 'Caution (Added by Nester 2026-05-01) THIS TAG DOES NOT MEAN THE PLAYER IS CHEATING! ping abuse suspected' }] }
        }
    },
    {
        note: 'Blacklisted',
        gameMode: 'BEDWARS',
        row: {
            name: 'BannedAgain', team: 'AQUA', stars: 233, fkdr: 5.0,
            uTag: 'Blacklisted',
            urchinRaw: { rawTags: [{ text: 'Blacklisted', tooltip: 'Blacklisted (Added by Nester 2026-04-09)' }] }
        }
    },
    {
        note: 'Nicked -> denicked with stats',
        gameMode: 'BEDWARS',
        row: {
            name: 'Notch', team: 'WHITE', isNicked: true,
            denickResult: { realName: 'Technoblade' }, denickedAs: 'Technoblade',
            realName: 'Technoblade', stars: 520, fkdr: 12.3, monthlyFkdr: 9.1
        }
    },
    {
        note: 'Nicked, no stats resolved',
        gameMode: 'BEDWARS',
        row: { name: 'Sneaky_123', team: 'PINK', isNicked: true }
    },
    {
        note: 'Stat threat (FKDR only)',
        gameMode: 'BEDWARS',
        row: { name: 'TryhardKid', team: 'GRAY', isThreat: true, stars: 210, fkdr: 6.7 }
    },
    {
        note: 'Stat threat with monthly FKDR',
        gameMode: 'BEDWARS',
        row: { name: 'Grinder99', team: 'RED', isThreat: true, stars: 180, fkdr: 4.2, monthlyFkdr: 3.8 }
    },
    {
        note: 'SkyWars stat threat (KDR)',
        gameMode: 'SKYWARS',
        row: { name: 'SkyDemon', skyLevel: '45', isThreat: true, kdr: 3.1 }
    }
];

// Returns [{ note, gameMode, line, component }] for every preview scenario,
// rendered at the requested style (fancy = star level + icons).
function buildPreviewEntries(fancy = false) {
    const includeSet = new Set(SHARE_CATEGORIES);
    return PREVIEW_ROWS.map(({ note, gameMode, row }) => ({
        note,
        gameMode,
        line: formatLine(row, gameMode, includeSet, fancy),
        component: formatLineComponent(row, gameMode, includeSet, fancy)
    }));
}

function createShareTagsBroadcaster(deps) {
    const {
        state,
        sendChat,
        getHypixelClient,
        getLocalUsername,
        saveFeatureConfig,
        isPartyMember = () => false,
        fetchMonthlySession = null,
        fetchPlayerProfile = null,
        getDenickResult = () => null,
        // Registers (plainLine, component) so the server's echo of a just-sent
        // share line can be recolored locally. No-op when unset.
        registerLocalEcho = null,
        // true = in a party, false = confidently NOT in a party, null = unknown.
        // Only a confident false blocks the broadcast - when the party tracker
        // is uncertain we send anyway rather than silently dropping lines.
        getPartyStatus = () => null,
        // Returns true only when the client witnessed the current game's
        // start (not a rejoin). Defaults to true so tests / detached uses
        // don't gate anything unless the host wires it up.
        getPresentAtGameStart = () => true,
        // The connection-owned command queue serializes /pc and /ac with all
        // other Hypixel commands. Detached/test callers can omit it and keep
        // the legacy direct write behavior.
        sendHypixelCommand = null
    } = deps;

    async function sendOutgoingCommand(hypixelClient, command, queueOptions = {}) {
        if (typeof sendHypixelCommand === 'function') {
            return await sendHypixelCommand(command, queueOptions);
        }
        try {
            hypixelClient.write('chat', { message: command });
            return { sent: true, command };
        } catch (error) {
            return { sent: false, reason: 'send-failed', command, error };
        }
    }

    function stateIncludeSet() {
        const set = new Set();
        if (state.shareTagsIncludeTagged) set.add('tagged');
        if (state.shareTagsIncludeNicks) set.add('nicks');
        if (state.shareTagsIncludeThreats) set.add('threats');
        return set;
    }

    // Party tracking only ever learns a teammate's real IGN, while a scan row
    // carries whatever name is on the board - so a nicked teammate reads as a
    // stranger until the nick is resolved. Eligibility is decided before the
    // rows are denick-enriched, so the live lookup is consulted alongside
    // anything the row already carries.
    function isOwnPartyMember(row) {
        if (!row) return false;
        if (isPartyMember(row.name)) return true;
        const candidates = [denickedRealName(row)];
        try {
            const live = typeof getDenickResult === 'function' ? getDenickResult(row.name) : null;
            candidates.push(live?.realName, live?.realIGN);
        } catch (e) {}
        return candidates.some(candidate => {
            const name = String(candidate || '').trim();
            return Boolean(name) && isPartyMember(name);
        });
    }

    function isEligible(row, includeSet) {
        if (!row) return false;
        const localName = String(getLocalUsername() || '').toLowerCase();
        if (localName && String(row.name || '').toLowerCase() === localName) return false;
        // Never call out our own party members, on whichever team they landed:
        // a party split across opposing teams is still a party, and a teammate
        // we happen to be fighting is not someone to broadcast.
        if (isOwnPartyMember(row)) return false;
        return Boolean(rowKind(row, includeSet));
    }

    function orderedEligibleRows(snapshot, includeSet) {
        const gameMode = snapshot.gameMode;
        const eligible = (snapshot.results || []).filter(row => isEligible(row, includeSet));
        if (eligible.length === 0) return [];

        // Arrival mode: keep the scan's own result order, no team grouping.

        const grouped = new Map();
        for (const row of eligible) {
            const team = gameMode === 'SKYWARS' ? 'SOLO' : normalizeTeamLabel(row.team);
            if (!grouped.has(team)) grouped.set(team, []);
            grouped.get(team).push(row);
        }

        const teamKeys = Array.from(grouped.keys()).sort((a, b) => {
            const ai = teamSortIndex(a);
            const bi = teamSortIndex(b);
            if (ai !== bi) return ai - bi;
            return a.localeCompare(b);
        });

        const lines = [];
        for (const team of teamKeys) {
            const rows = grouped.get(team);
            rows.sort((a, b) => (b.sortValue || 0) - (a.sortValue || 0));
            for (const row of rows) {
                lines.push(row);
            }
        }
        return lines;
    }

    async function enrichDenickedRow(row, gameMode) {
        if (!row) return row;
        let next = row;
        const liveDenick = typeof getDenickResult === 'function' ? getDenickResult(row.name) : null;
        if (liveDenick?.realName && !denickedRealName(next)) {
            next = {
                ...next,
                denickResult: liveDenick,
                denickedAs: liveDenick.realName,
                isNicked: true
            };
        }

        const realName = denickedRealName(next);
        if (!realName || hasPrimaryStat(next, gameMode) || typeof fetchPlayerProfile !== 'function') return next;

        try {
            const profile = await fetchPlayerProfile(realName, next);
            const stats = shareStatsFromProfile(profile, gameMode);
            return hasPrimaryStat(stats, gameMode) ? { ...next, ...stats } : next;
        } catch (e) {
            return next;
        }
    }

    async function enrichMonthlyFkdr(row, gameMode) {
        const realName = denickedRealName(row);
        if (gameMode !== 'BEDWARS' || !row || (row.isNicked && !realName) || Number.isFinite(Number(row.monthlyFkdr))) return row;
        if (typeof fetchMonthlySession !== 'function') return row;
        try {
            const data = await fetchMonthlySession(realName || row.name);
            const monthlyFkdr = monthlyFkdrFromSessionData(data);
            return Number.isFinite(monthlyFkdr) ? { ...row, monthlyFkdr } : row;
        } catch (e) {
            return row;
        }
    }

    async function buildLinesForRows(rows, gameMode, includeSet) {
        const fancy = Boolean(state.shareTagsFancy);
        const colorLocal = Boolean(state.shareTagsColorLocal);
        const denickEnriched = await Promise.all(rows.map(row => enrichDenickedRow(row, gameMode)));
        const enriched = await Promise.all(denickEnriched.map(row => enrichMonthlyFkdr(row, gameMode)));
        return enriched.map(row => {
            const line = formatLine(row, gameMode, includeSet, fancy);
            let component = null;
            // Only attach a recolor component when it reproduces the exact sent
            // text; a mismatch (e.g. a truncated line) safely stays plain.
            if (colorLocal) {
                const built = formatLineComponent(row, gameMode, includeSet, fancy);
                if (extractText(built) === line) component = built;
            }
            return { line, component };
        });
    }

    function describeIncludeSet(includeSet = stateIncludeSet()) {
        const parts = [];
        if (includeSet.has('tagged')) parts.push('tagged');
        if (includeSet.has('nicks')) parts.push('nicks');
        if (includeSet.has('threats')) parts.push('threats');
        return parts.length > 0 ? parts.join('+') : 'nothing';
    }

    function sendLocal(client, message) {
        if (!client) return;
        try { sendChat(client, message); } catch (e) {}
    }

    async function buildItem(row, gameMode, includeSet, fancy, colorLocal) {
        const denickEnriched = await enrichDenickedRow(row, gameMode);
        const enriched = await enrichMonthlyFkdr(denickEnriched, gameMode);
        const line = formatLine(enriched, gameMode, includeSet, fancy);
        let component = null;
        if (colorLocal) {
            const built = formatLineComponent(enriched, gameMode, includeSet, fancy);
            if (extractText(built) === line) component = built;
        }
        return { line, component };
    }

    // Live streaming sink used during a scan so /share can start sending before
    // the whole scan finishes. Each team is emitted together when its members
    // resolve, in completion order (first team ready first).
    // One serialized queue drains at SEND_INTERVAL_MS with the global line cap,
    // overlapping sends with the remaining lookups. Guards mirror broadcast().
    function createStream(client, opts = {}) {
        const gameMode = opts.gameMode || 'BEDWARS';
        const includeSet = includeSetFromList(opts.includeSet || opts.include || null, stateIncludeSet());
        const isStillActive = typeof opts.isStillActive === 'function' ? opts.isStillActive : () => true;
        const fancy = Boolean(state.shareTagsFancy);
        const colorLocal = Boolean(state.shareTagsColorLocal);
        const hypixelClient = getHypixelClient();
        const noop = { onRow() {}, onTeam() {}, end() { return Promise.resolve({ sent: 0 }); } };

        // Same gates as broadcast(): categories, present-at-start, party, client.
        if (!includeSet || includeSet.size === 0) return noop;
        if (!getPresentAtGameStart()) return noop;
        if (destinationPrefix() === '/pc' && getPartyStatus() === false) return noop;
        if (!hypixelClient) return noop;

        const dest = destinationPrefix();
        const queue = [];
        const seen = new Set();
        let totalEligible = 0;
        let sent = 0;
        let ended = false;
        let wake = null;
        let resolveEnded = null;
        const endedPromise = new Promise(resolve => { resolveEnded = resolve; });
        let resolveDone = null;
        const donePromise = new Promise(resolve => { resolveDone = resolve; });

        function accept(row) {
            if (!row || !isEligible(row, includeSet)) return;
            const key = String(row.name || '').toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            totalEligible += 1;
            queue.push(row);
            if (wake) { wake(); wake = null; }
        }

        (async function pump() {
            while (true) {
                if (!isStillActive()) break;
                if (queue.length === 0) {
                    if (ended) break;
                    await new Promise(resolve => { wake = resolve; });
                    continue;
                }
                if (sent >= MAX_LINES_PER_BROADCAST) break;
                const row = queue.shift();
                const item = await buildItem(row, gameMode, includeSet, fancy, colorLocal);
                if (!isStillActive()) break;
                const result = await sendOutgoingCommand(hypixelClient, `${dest} ${item.line}`, { priority: 90 });
                if (!result?.sent) break;
                sent += 1;
                if (item.component && typeof registerLocalEcho === 'function') {
                    try { registerLocalEcho(item.line, item.component); } catch (e) {}
                }
                await new Promise(resolve => setTimeout(resolve, SEND_INTERVAL_MS));
            }
            // Wait for all input before counting drops so a late team (after the
            // cap) is included in the "+N more" tally.
            if (isStillActive()) {
                if (!ended) await endedPromise;
                const dropped = Math.max(0, totalEligible - sent);
                if (dropped > 0) {
                    await new Promise(resolve => setTimeout(resolve, SEND_INTERVAL_MS));
                    await sendOutgoingCommand(hypixelClient, `${dest} +${dropped} more (run /scan locally)`, { priority: 90 });
                }
            }
            resolveDone({ sent });
        })();

        return {
            onRow() {},
            onTeam(_teamLabel, rows) {
                const eligible = (rows || []).filter(row => isEligible(row, includeSet));
                eligible.sort((a, b) => (b.sortValue || 0) - (a.sortValue || 0));
                eligible.forEach(accept);
            },
            end() {
                if (!ended) { ended = true; resolveEnded(); if (wake) { wake(); wake = null; } }
                return donePromise;
            }
        };
    }

    async function broadcast(client, opts = {}) {
        const hypixelClient = getHypixelClient();
        const source = opts.source || 'manual';
        const includeSet = includeSetFromList(opts.includeSet || opts.include || null, stateIncludeSet());

        if (!includeSet || includeSet.size === 0) {
            if (source === 'manual') {
                sendLocal(client, '§b§lShare §8» §cNo categories enabled. Use §f/share all§c.');
            }
            return { sent: 0, reason: 'no-include' };
        }

        if (!getPresentAtGameStart()) {
            if (source === 'manual') {
                sendLocal(client, '§b§lShare §8» §cDisabled for mid-game rejoins - /share only works when you were present at game start.');
            }
            return { sent: 0, reason: 'rejoined-midgame' };
        }

        // Party chat goes nowhere useful when solo - skip instead of spamming
        // /pc into the void. Only applies to the party destination; /share
        // dest all (/ac) is unaffected.
        if (destinationPrefix() === '/pc' && getPartyStatus() === false) {
            if (source === 'manual') {
                sendLocal(client, '§b§lShare §8» §cYou are not in a party - nothing was sent.');
            }
            return { sent: 0, reason: 'not-in-party' };
        }

        const snapshot = state.lastScanResults;
        if (!snapshot || !Array.isArray(snapshot.results)) {
            if (source === 'manual') {
                sendLocal(client, '§b§lShare §8» §cNo recent scan results. Run §f/scan§c first.');
            }
            return { sent: 0, reason: 'no-scan' };
        }

        const age = Date.now() - (snapshot.at || 0);
        if (age > STALE_RESULTS_MS && source === 'manual') {
            sendLocal(client, `§b§lShare §8» §eUsing scan from §f${Math.round(age / 1000)}s§e ago. Run §f/scan§e for fresh data.`);
        }

        if (snapshot.results.length === 0) {
            if (source === 'manual') {
                sendLocal(client, `§b§lShare §8» §aNothing to share from the latest scan (filters: ${describeIncludeSet(includeSet)}).`);
            }
            return { sent: 0, reason: 'empty-scan' };
        }

        const rows = orderedEligibleRows(snapshot, includeSet);
        if (rows.length === 0) {
            if (source === 'manual') {
                sendLocal(client, `§b§lShare §8» §aNothing to share (filters: ${describeIncludeSet(includeSet)}).`);
            }
            return { sent: 0, reason: 'nothing-eligible' };
        }

        if (!hypixelClient) {
            sendLocal(client, '§b§lShare §8» §cNot connected to Hypixel.');
            return { sent: 0, reason: 'no-hypixel-client' };
        }

        const truncated = rows.length > MAX_LINES_PER_BROADCAST;
        const rowsToSend = truncated ? rows.slice(0, MAX_LINES_PER_BROADCAST) : rows;
        const toSend = await buildLinesForRows(rowsToSend, snapshot.gameMode, includeSet);

        sendLocal(client, `§b§lShare §8» §7Broadcasting §f${toSend.length}§7 line(s) to party (${describeIncludeSet(includeSet)}).`);

        let sent = 0;
        for (const item of toSend) {
            const message = `${destinationPrefix()} ${item.line}`;
            const result = await sendOutgoingCommand(hypixelClient, message, { priority: 90 });
            if (!result?.sent) {
                sendLocal(client, `§b§lShare §8» §cSend failed: §7${result?.error?.message || result?.reason || 'queue unavailable'}`);
                break;
            }
            sent += 1;
            // Arm the local recolor so the server's echo of this exact line is
            // repainted for us (and only us) instead of doubling it.
            if (item.component && typeof registerLocalEcho === 'function') {
                try { registerLocalEcho(item.line, item.component); } catch (e) {}
            }
            if (sent < toSend.length) {
                await new Promise(resolve => setTimeout(resolve, SEND_INTERVAL_MS));
            }
        }

        if (truncated) {
            const remaining = rows.length - MAX_LINES_PER_BROADCAST;
            await new Promise(resolve => setTimeout(resolve, SEND_INTERVAL_MS));
            await sendOutgoingCommand(hypixelClient, `${destinationPrefix()} +${remaining} more (run /scan locally)`, { priority: 90 });
        }

        return { sent, reason: 'ok', truncated };
    }

    function setAuto(on) {
        state.shareTagsAuto = Boolean(on);
        if (typeof saveFeatureConfig === 'function') saveFeatureConfig();
    }

    function setDestination(value) {
        const clean = String(value || '').toLowerCase();
        if (clean === 'all' || clean === 'a') state.shareTagsDestination = 'all';
        else state.shareTagsDestination = 'party';
        if (typeof saveFeatureConfig === 'function') saveFeatureConfig();
    }

    function destinationPrefix() {
        return state.shareTagsDestination === 'all' ? '/ac' : '/pc';
    }

    function setIncludeFlag(name, on) {
        const normalized = normalizeIncludeName(name);
        const key = ({
            tagged: 'shareTagsIncludeTagged',
            nicks: 'shareTagsIncludeNicks',
            threats: 'shareTagsIncludeThreats'
        })[normalized];
        if (!key) return false;
        state[key] = Boolean(on);
        if (typeof saveFeatureConfig === 'function') saveFeatureConfig();
        return true;
    }

    function setColorLocal(on) {
        state.shareTagsColorLocal = Boolean(on);
        if (typeof saveFeatureConfig === 'function') saveFeatureConfig();
    }

    function setFancy(on) {
        state.shareTagsFancy = Boolean(on);
        if (typeof saveFeatureConfig === 'function') saveFeatureConfig();
    }

    function setIncludeSet(list) {
        const wanted = includeSetFromList(list, new Set());
        state.shareTagsIncludeTagged = wanted.has('tagged');
        state.shareTagsIncludeNicks = wanted.has('nicks');
        state.shareTagsIncludeThreats = wanted.has('threats');
        if (typeof saveFeatureConfig === 'function') saveFeatureConfig();
    }

    function getSettings() {
        return {
            auto: state.shareTagsAuto,
            tagged: state.shareTagsIncludeTagged,
            nicks: state.shareTagsIncludeNicks,
            threats: state.shareTagsIncludeThreats,
            destination: state.shareTagsDestination === 'all' ? 'all' : 'party',
            fancy: Boolean(state.shareTagsFancy),
            colorLocal: Boolean(state.shareTagsColorLocal),
            groupByTeam: true
        };
    }

    function getPreview() {
        return buildPreviewEntries(Boolean(state.shareTagsFancy));
    }

    return { broadcast, createStream, setAuto, setDestination, setIncludeFlag, setIncludeSet, setColorLocal, setFancy, getPreview, getSettings, normalizeIncludeName };
}

module.exports = {
    createShareTagsBroadcaster,
    normalizeIncludeName,
    includeSetFromList,
    monthlyFkdrFromSessionData,
    labelForTagText,
    detectedCheats,
    formatLine,
    formatLineComponent,
    buildPreviewEntries,
    shareStatsFromProfile,
    SEND_INTERVAL_MS
};
