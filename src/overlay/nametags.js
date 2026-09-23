'use strict';

const {
    getFkdrColor,
    getKdrColor,
    getWlrColor,
    getWsColor,
    getPingColor
} = require('../stats/colors.js');
const {
    getBedwarsPrestigePalette,
    getBedwarsStarIcon
} = require('../stats/format.js');

const MAX_TEAM_FIELD = 16;
const MINECRAFT_FORMAT_CODE = /(?:Â?§|\\u00a7|\\u00A7)[0-9A-FK-OR]/gi;
// Every prestige icon getBedwarsStarIcon can return.
const BEDWARS_STAR_ICONS = '\u272b\u272a\u269d\u2725\u272f';
const BRACKETED_STAR_TEXT = new RegExp(`^\\[\\d+[${BEDWARS_STAR_ICONS}]\\]$`);
// Hard cap on rules per slot. Keeps configs (and the launcher editor) bounded,
// and stops a pathological config from making evaluation expensive per player.
const CONTROL_CHARS = new RegExp(
    '[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']',
    'g'
);

// The stat types a nametag slot (prefix or suffix) can render. Kept here so the
// proxy command parser, controller, launcher, and formatter all agree.
//
// 's'-prefixed entries are current-session deltas sourced from Coral. They are
// the only stats here that can cost an extra API request, so the proxy fetches
// them lazily and only when an enabled rule actually references one (see
// nametagStatsNeedSession below).
const NAMETAG_STAT_TYPES = [
    'none',
    'star', 'fkdr', 'kdr', 'wlr', 'bblr', 'ws', 'level',
    'finals', 'finaldeaths', 'beds', 'bedslost', 'wins', 'losses',
    'kills', 'deaths', 'games',
    'guild', 'tag', 'ping',
    // `s*` names are retained as aliases for the original daily-session
    // settings. New settings expose the period explicitly.
    'sfkdr', 'swlr', 'swins', 'sfinals',
    'dfkdr', 'dwlr', 'dwins', 'dfinals',
    'wfkdr', 'wwlr', 'wwins', 'wfinals',
    'mfkdr', 'mwlr', 'mwins', 'mfinals'
];

const NAMETAG_STAT_LABELS = {
    none: 'None',
    star: 'Star',
    fkdr: 'FKDR',
    kdr: 'KDR',
    wlr: 'WLR',
    bblr: 'BBLR',
    ws: 'Winstreak',
    level: 'Level',
    finals: 'Finals',
    finaldeaths: 'Final Deaths',
    beds: 'Beds',
    bedslost: 'Beds Lost',
    wins: 'Wins',
    losses: 'Losses',
    kills: 'Kills',
    deaths: 'Deaths',
    games: 'Games',
    guild: 'Guild',
    tag: 'Tag',
    ping: 'Avg Ping',
    sfkdr: 'Daily FKDR',
    swlr: 'Daily WLR',
    swins: 'Daily Wins',
    sfinals: 'Daily Finals',
    dfkdr: 'Daily FKDR',
    dwlr: 'Daily WLR',
    dwins: 'Daily Wins',
    dfinals: 'Daily Finals',
    wfkdr: 'Weekly FKDR',
    wwlr: 'Weekly WLR',
    wwins: 'Weekly Wins',
    wfinals: 'Weekly Finals',
    mfkdr: 'Monthly FKDR',
    mwlr: 'Monthly WLR',
    mwins: 'Monthly Wins',
    mfinals: 'Monthly Finals'
};

const NAMETAG_SESSION_STATS = [
    'sfkdr', 'swlr', 'swins', 'sfinals',
    'dfkdr', 'dwlr', 'dwins', 'dfinals',
    'wfkdr', 'wwlr', 'wwins', 'wfinals',
    'mfkdr', 'mwlr', 'mwins', 'mfinals'
];

const NAMETAG_STAT_SOURCES = {
    none: 'none',
    star: 'hypixel', fkdr: 'hypixel', kdr: 'hypixel', wlr: 'hypixel', bblr: 'hypixel',
    ws: 'hypixel', level: 'hypixel', finals: 'hypixel', finaldeaths: 'hypixel',
    beds: 'hypixel', bedslost: 'hypixel', wins: 'hypixel', losses: 'hypixel',
    kills: 'hypixel', deaths: 'hypixel', games: 'hypixel', guild: 'hypixel',
    ping: 'aurora',
    tag: 'intelligence',
    sfkdr: 'coral', swlr: 'coral', swins: 'coral', sfinals: 'coral',
    dfkdr: 'coral', dwlr: 'coral', dwins: 'coral', dfinals: 'coral',
    wfkdr: 'coral', wwlr: 'coral', wwins: 'coral', wfinals: 'coral',
    mfkdr: 'coral', mwlr: 'coral', mwins: 'coral', mfinals: 'coral'
};

function nametagStatSource(value) {
    return NAMETAG_STAT_SOURCES[normalizeNametagStat(value, 'none')] || 'none';
}

function normalizeNametagFallback(primaryValue, fallbackValue) {
    const primary = normalizeNametagStat(primaryValue, 'none');
    const fallback = normalizeNametagStat(fallbackValue, 'none');
    if (fallback === 'none' || primary === 'none') return fallback;
    return nametagStatSource(primary) === nametagStatSource(fallback) ? 'none' : fallback;
}

function nametagSessionPeriod(statType) {
    const stat = normalizeNametagStat(statType, 'none');
    if (['sfkdr', 'swlr', 'swins', 'sfinals', 'dfkdr', 'dwlr', 'dwins', 'dfinals'].includes(stat)) return 'daily';
    if (['wfkdr', 'wwlr', 'wwins', 'wfinals'].includes(stat)) return 'weekly';
    if (['mfkdr', 'mwlr', 'mwins', 'mfinals'].includes(stat)) return 'monthly';
    return null;
}

const NAMETAG_STAT_ALIASES = {
    stars: 'star', prestige: 'star',
    winstreak: 'ws', streak: 'ws',
    networklevel: 'level', hypixel: 'level', hypixellevel: 'level',
    tags: 'tag', cheat: 'tag',
    guildtag: 'guild',
    avgping: 'ping', averageping: 'ping', latency: 'ping', ms: 'ping',
    bedbreak: 'bblr', bedratio: 'bblr',
    finalkills: 'finals', fkills: 'finals',
    finaldeaths: 'finaldeaths', fdeaths: 'finaldeaths',
    bedsbroken: 'beds',
    bedslost: 'bedslost',
    sessionfkdr: 'sfkdr', sessionwlr: 'swlr',
    sessionwins: 'swins', sessionfinals: 'sfinals',
    dailyfkdr: 'dfkdr', dailywlr: 'dwlr', dailywins: 'dwins', dailyfinals: 'dfinals',
    weeklyfkdr: 'wfkdr', weeklywlr: 'wwlr', weeklywins: 'wwins', weeklyfinals: 'wfinals',
    monthlyfkdr: 'mfkdr', monthlywlr: 'mwlr', monthlywins: 'mwins', monthlyfinals: 'mfinals'
};

function normalizeNametagStat(value, fallback = 'none') {
    const clean = String(value || '').toLowerCase().trim();
    if (NAMETAG_STAT_TYPES.includes(clean)) return clean;
    const alias = NAMETAG_STAT_ALIASES[clean.replace(/[\s_-]+/g, '')];
    if (alias) return alias;
    return NAMETAG_STAT_TYPES.includes(fallback) ? fallback : 'none';
}

// --- Rule conditions -----------------------------------------------------
// A rule is { show: <statType>, when: <condition|null> }, and a slot holds an
// ordered list of them. The first rule whose condition passes and whose stat
// actually renders wins; `show: 'none'` is an explicit "stop here, render
// nothing" so you can express "blank unless the player is interesting".

const NAMETAG_AUDIENCE_LABELS = {
    teammates: 'Teammates',
    threats: 'Threats',
    others: 'Everyone else'
};

// Grouped so the in-game picker can show every option at once inside a chat
// panel: each group is one row, and no row overflows the box.
const NAMETAG_STAT_GROUPS = [
    ['Ratios', ['fkdr', 'kdr', 'wlr', 'bblr']],
    ['Levels', ['star', 'level', 'ws']],
    ['Counts', ['finals', 'beds', 'wins', 'kills', 'games']],
    ['Info', ['tag', 'guild', 'ping']],
    ['Daily', ['dfkdr', 'dwlr', 'dwins', 'dfinals']],
    ['Weekly', ['wfkdr', 'wwlr', 'wwins', 'wfinals']],
    ['Monthly', ['mfkdr', 'mwlr', 'mwins', 'mfinals']]
];

// Chip text for the in-game picker, where a row of seven full labels does not
// fit. Hovers still carry the full name.
const NAMETAG_STAT_SHORT_LABELS = {
    none: 'None',
    star: 'Star', fkdr: 'FKDR', kdr: 'KDR', wlr: 'WLR', bblr: 'BBLR',
    ws: 'WS', level: 'Level',
    finals: 'Finals', finaldeaths: 'F.Deaths', beds: 'Beds', bedslost: 'BedsLost',
    wins: 'Wins', losses: 'Losses', kills: 'Kills', deaths: 'Deaths', games: 'Games',
    guild: 'Guild', tag: 'Tag', ping: 'Ping',
    sfkdr: 'D.FKDR', swlr: 'D.WLR', swins: 'D.Wins', sfinals: 'D.Finals',
    dfkdr: 'D.FKDR', dwlr: 'D.WLR', dwins: 'D.Wins', dfinals: 'D.Finals',
    wfkdr: 'W.FKDR', wwlr: 'W.WLR', wwins: 'W.Wins', wfinals: 'W.Finals',
    mfkdr: 'M.FKDR', mwlr: 'M.WLR', mwins: 'M.Wins', mfinals: 'M.Finals'
};

// One click per condition, grouped the same way: the group names the field, the
// chips are the thresholds. Anything else is still reachable by typing the
// field/op/value out.
function clampField(str, max = MAX_TEAM_FIELD) {
    let out = String(str || '');
    if (out.length <= max) return out;
    out = out.slice(0, max);
    if (out.endsWith('§')) out = out.slice(0, -1);
    return out;
}

function fitField(candidates) {
    for (const candidate of candidates) {
        const value = String(candidate || '');
        if (value.length <= MAX_TEAM_FIELD) return value;
    }
    return clampField(candidates[candidates.length - 1] || '');
}

// --- Overlay team names (tab-list order) ---------------------------------
// The 1.8 tab list sorts rows by their scoreboard team name first and the
// player name second, so the name we give an overlay team decides where that
// player's row lands. Hypixel gives every BedWars player their own team named
// "<Colour><n>" (Red8, Blue12, ...) and that is what produces the familiar
// team-grouped tab list.
//
// So an overlay team must sort where the player's real team did. Appending a
// marker to the real team name does exactly that: '!' (0x21) is below every
// character Hypixel uses in a team name, giving
// "Red8" < "Red8!0" < "Red80" < "Red9". Naming the teams independently of the
// real ones (the old NMT_<counter> scheme) instead ordered the whole tab list
// by whatever order we happened to meet players in, and split each team across
// the list once some of its players were annotated and others were not.
const NAMETAG_TEAM_MARKER = '!';
// Reserve the marker plus two index digits so the base can never push a name
// past the client's 16-character cap.
const NAMETAG_TEAM_BASE_MAX = MAX_TEAM_FIELD - 3;

function nametagTeamBase(rawTeamName) {
    return String(rawTeamName || '').slice(0, NAMETAG_TEAM_BASE_MAX);
}

function nametagTeamName(rawTeamName, index = 0) {
    return `${nametagTeamBase(rawTeamName)}${NAMETAG_TEAM_MARKER}${Math.min(Math.max(index, 0), 99)}`;
}

// Give each entry ({ name, base }) a team name that sorts inside its base
// team's block. Entries sharing a base are ordered by player name - the same
// secondary sort the client applies - so teammates keep their vanilla order.
// Input order is preserved; only `teamName` is added.
function assignNametagTeamNames(entries = []) {
    const groups = new Map();
    const rows = entries.map(entry => {
        const base = nametagTeamBase(entry?.base);
        if (!groups.has(base)) groups.set(base, []);
        const row = { ...entry, base };
        groups.get(base).push(row);
        return row;
    });

    groups.forEach(group => {
        group.sort((a, b) => {
            const left = String(a.name || '');
            const right = String(b.name || '');
            return left < right ? -1 : (left > right ? 1 : 0);
        });
        group.forEach((row, index) => {
            row.teamName = nametagTeamName(row.base, index);
        });
    });

    return rows;
}

function cleanNametagText(value = '') {
    return String(value || '')
        .replace(MINECRAFT_FORMAT_CODE, '')
        .replace(NAMETAG_ICON_GLYPHS, '')
        // Strip control characters and DEL. Built with fromCharCode on
        // purpose: the equivalent literal character class is invisible in
        // editors and silently corrupts on copy/rewrite (it did exactly
        // that once, turning into a space+hyphen class that ate real spaces).
        .replace(CONTROL_CHARS, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function pickNametagTag(row, compactTagName, priority = 'urchin') {
    const chosen = pickNametagTagEntry(row, priority);
    if (!chosen) return '';
    const compact = typeof compactTagName === 'function'
        ? compactTagName(chosen.value)
        : chosen.value;
    return cleanNametagText(compact);
}

function realNametagTags(row) {
    const tags = Array.isArray(row?.tags) ? row.tags : [];
    return tags.filter(tag => {
        const value = String(tag?.value || '');
        return value && !/^api\b/i.test(value);
    });
}

function pickNametagTagEntry(row, priority = 'urchin') {
    const realTags = realNametagTags(row);
    const order = priority === 'seraph' ? ['Seraph', 'Urchin'] : ['Urchin', 'Seraph'];
    for (const source of order) {
        const found = realTags.find(tag => tag?.source === source);
        if (found) return found;
    }
    return null;
}

// Tag glyphs remain part of the resource-pack asset map, but are intentionally
// not a live display mode. In-game surfaces use readable text only.
const NAMETAG_TAG_DISPLAY_MODES = Object.freeze(['acronyms', 'full']);
const NAMETAG_TAG_SOURCE_COLORS = Object.freeze({
    urchin: '§d',
    seraph: '§3'
});
const NAMETAG_TAG_DEFINITIONS = Object.freeze({
    blatant_cheater: Object.freeze({ icon: '\uE000\uE001', acronym: 'BC', label: 'Blatant Cheater', color: '§4' }),
    closet_cheater: Object.freeze({ icon: '\uE002\uE003', acronym: 'CC', label: 'Closet Cheater', color: '§6' }),
    confirmed_cheater: Object.freeze({ icon: '\uE004\uE005', acronym: 'CF', label: 'Confirmed Cheater', color: '§d' }),
    caution: Object.freeze({ icon: '\uE006\uE007', acronym: 'CA', label: 'Caution', color: '§b' }),
    sniper: Object.freeze({ icon: '\uE008\uE009', acronym: 'SN', label: 'Sniper', color: '§c' }),
    legit_sniper: Object.freeze({ icon: '\uE00A\uE00B', acronym: 'LS', label: 'Legit Sniper', color: '§a' }),
    account: Object.freeze({ icon: '\uE00C\uE00D', acronym: 'AC', label: 'Account', color: '§7' }),
    blacklisted: Object.freeze({ icon: '\uE00E\uE00F', acronym: 'BL', label: 'Blacklisted', color: '§8' })
});
const NAMETAG_NICK_DEFINITION = Object.freeze({
    icon: '\uE010\uE011',
    acronym: 'NK',
    label: '[NICK]',
    color: '§c'
});

// These private-use characters are still kept in the resource-pack map above,
// but they must never escape into an in-game text renderer. API responses and
// cached rows can contain the old glyph form directly, so strip it at the
// shared display-text boundary as well as avoiding the icon rendering path.
const NAMETAG_ICON_GLYPHS = /[\uE000-\uE011]/g;

function stripNametagIconGlyphs(value = '') {
    return String(value || '').replace(NAMETAG_ICON_GLYPHS, '');
}

// Private-use glyphs installed by assets/fury_nametag_icons. Exporting this
// smaller view preserves the explicit code-point map used by the pack builder.
const NAMETAG_TAG_ICONS = Object.freeze(Object.fromEntries(
    Object.entries(NAMETAG_TAG_DEFINITIONS).map(([key, definition]) => [key, definition.icon])
));

function normalizeNametagTagDisplayMode(value, fallback = 'acronyms') {
    const clean = String(value || '').trim().toLowerCase();
    // Migrate old saved/icon command values to the compact text mode while
    // keeping the old spellings harmless for existing installations.
    const aliases = {
        icons: 'acronyms', icon: 'acronyms', glyph: 'acronyms', glyphs: 'acronyms',
        acronym: 'acronyms', text: 'full', labels: 'full'
    };
    const normalized = aliases[clean] || clean;
    if (NAMETAG_TAG_DISPLAY_MODES.includes(normalized)) return normalized;
    const normalizedFallback = aliases[String(fallback || '').trim().toLowerCase()]
        || String(fallback || '').trim().toLowerCase();
    return NAMETAG_TAG_DISPLAY_MODES.includes(normalizedFallback) ? normalizedFallback : fallback;
}

function nametagTagCategory(value = '') {
    const rawValue = String(value || '').trim();
    const iconValue = rawValue.replace(MINECRAFT_FORMAT_CODE, '').trim();
    const iconCategory = Object.entries(NAMETAG_TAG_DEFINITIONS)
        .find(([, definition]) => definition.icon === rawValue || definition.icon === iconValue)?.[0];
    if (iconCategory) return iconCategory;

    const tag = cleanNametagText(value)
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!tag) return '';

    // Test specific categories before their broader forms (Legit Sniper must
    // not be swallowed by Sniper). Urchin commonly sends the short forms
    // "Blatant", "Closet", and "Legit", so those are accepted as well.
    if (/\bblatant\b/.test(tag)) return 'blatant_cheater';
    if (/\bcloset\b/.test(tag)) return 'closet_cheater';
    if (/\bconfirmed\b/.test(tag)) return 'confirmed_cheater';
    if (/\bcaution\b/.test(tag)) return 'caution';
    if (/\blegit\b/.test(tag)) return 'legit_sniper';
    if (/\bsniper\b/.test(tag)) return 'sniper';
    if (/\baccount\b/.test(tag)) return 'account';
    if (/\bblacklist(?:ed)?\b/.test(tag)) return 'blacklisted';
    return '';
}

function nametagIconForTag(value = '') {
    const definition = NAMETAG_TAG_DEFINITIONS[nametagTagCategory(value)];
    return definition?.icon || '';
}

function nametagTagSourceColor(source = '', fallback = '') {
    const normalized = String(source || '').trim().toLowerCase();
    if (normalized === 'urchin' || normalized === 'u') return NAMETAG_TAG_SOURCE_COLORS.urchin;
    if (normalized === 'seraph' || normalized === 's') return NAMETAG_TAG_SOURCE_COLORS.seraph;
    return fallback;
}

function formatNametagNick(displayMode = 'acronyms') {
    // Nick is intentionally the one exception to the configurable tag style:
    // keep the familiar light-red [NICK] marker in every surface and mode.
    return `${NAMETAG_NICK_DEFINITION.color}${NAMETAG_NICK_DEFINITION.label}`;
}

function formatNametagTagValue(value, opts = {}) {
    const mode = normalizeNametagTagDisplayMode(opts.tagDisplayMode, 'acronyms');
    const definition = NAMETAG_TAG_DEFINITIONS[nametagTagCategory(value)];
    const sourceColor = nametagTagSourceColor(opts.source);
    const requestedColor = sourceColor || opts.color;
    if (definition) {
        if (mode === 'acronyms') return `${requestedColor || definition.color}${definition.acronym}`;
        return `${requestedColor || '§d'}${definition.label}`;
    }

    const fallback = mode === 'full'
        ? cleanNametagText(value)
        : (typeof opts.compactTagName === 'function'
            ? cleanNametagText(opts.compactTagName(value))
            : cleanNametagText(value));
    return fallback ? `${requestedColor || '§d'}${fallback}` : '';
}

function formatNametagTag(row, opts = {}) {
    const chosen = pickNametagTagEntry(row, opts.priority);
    if (!chosen) return '';
    return formatNametagTagValue(chosen.value, { ...opts, source: chosen.source });
}

// Lowercased text of the highest-priority real tag, for `tagType` conditions.
function nametagPrimaryTagType(row, priority = 'urchin') {
    const chosen = pickNametagTagEntry(row, priority);
    return chosen ? cleanNametagText(chosen.value).toLowerCase() : '';
}

// True when the player carries a real (non-API-status) tag. Used by the proxy
// to classify a player into the "threats" audience.
function nametagRowHasTag(row) {
    return realNametagTags(row).length > 0;
}

function isStatThreat(row, threatConfig = {}) {
    const fkdr = Number(row?.stats?.fkdr);
    const stars = Number(row?.stats?.stars);
    const minFkdr = Number(threatConfig.minFkdr);
    const minStars = Number(threatConfig.minStars);
    return (Number.isFinite(fkdr) && Number.isFinite(minFkdr) && fkdr >= minFkdr)
        || (Number.isFinite(stars) && Number.isFinite(minStars) && stars >= minStars);
}

// True for a field that renders a BedWars prestige, whatever colours it wears.
function isBracketedStarField(value) {
    return BRACKETED_STAR_TEXT.test(cleanNametagText(value));
}

// The BedWars prestige as /stats and the tab list draw it - the same palette
// and the same star icon, both from src/stats/format.js - re-encoded to fit a
// scoreboard team field, which holds 16 characters in total.
//
// formatBedwarsPrestige emits a colour code per character so its callers can
// slice the result freely. Here that is unaffordable (a 1000-prestige rainbow
// costs 21 characters that way), so a code is emitted only where the colour
// actually changes, and only while the rest of the number still fits. Any
// character past that point keeps the colour already in effect, which spends
// the field on as many of the real prestige bands as it can hold. The old
// single colour was cheaper still, but it painted every star above 1000 the
// same gold and boxed them all in grey brackets the other surfaces never used.
function formatNametagPrestige(level, { brackets = true, budget = MAX_TEAM_FIELD } = {}) {
    const safeLevel = Math.max(0, Math.round(Number(level) || 0));
    const inner = `${safeLevel}${getBedwarsStarIcon(safeLevel)}`;
    const text = brackets ? `[${inner}]` : inner;
    const palette = getBedwarsPrestigePalette(safeLevel);
    if (!palette) return text;

    // The palette is written against the bracketed form, so an unbracketed
    // field starts one position in and its digits keep their own colours.
    const offset = brackets ? 0 : 1;
    const chars = Array.from(text);
    const safeBudget = Math.max(0, Number(budget) || 0);
    let out = '';
    let active = '';
    chars.forEach((char, index) => {
        const color = palette[index + offset] || palette[palette.length - 1] || '§0';
        const remaining = chars.length - index;
        if (color !== active && out.length + color.length + remaining <= safeBudget) {
            out += color;
            active = color;
        }
        out += char;
    });
    return out;
}

function ratio(value, colorFn) {
    const v = Number(value);
    if (!Number.isFinite(v)) return '';
    return `${colorFn(v)}${v.toFixed(2)}`;
}

// Counts can be six digits lifetime, which would eat the whole field, so
// shorten anything over 10k.
function compactCount(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return '';
    if (Math.abs(v) >= 1000000) return `${(v / 1000000).toFixed(1)}m`;
    if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(1)}k`;
    return String(Math.round(v));
}

function signedCompactCount(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return '';
    return v > 0 ? `+${compactCount(v)}` : compactCount(v);
}

// Render a single stat slot to a short colored string, or '' when the stat has
// no data. Callers hard-clamp the result to the field budget afterwards.
function formatNametagStat(statType, row, opts = {}) {
    const stats = row?.stats || {};
    const session = row?.session || {};
    const sessions = row?.sessions || { daily: session };
    const sessionStat = (period, field) => sessions?.[period]?.[field];
    switch (statType) {
        case 'star': {
            const stars = Number(stats.stars);
            if (!Number.isFinite(stars)) return '';
            return formatNametagPrestige(stars, {
                brackets: opts.starBracketsEnabled !== false,
                budget: Number.isFinite(Number(opts.starBudget)) ? Number(opts.starBudget) : MAX_TEAM_FIELD
            });
        }
        case 'fkdr': return ratio(stats.fkdr, getFkdrColor);
        case 'kdr': return ratio(stats.kdr, getKdrColor);
        case 'wlr': return ratio(stats.wlr, getWlrColor);
        case 'bblr': return ratio(stats.bblr, getKdrColor);
        case 'ws': {
            const ws = Number(stats.ws);
            if (!Number.isFinite(ws)) return '';
            return `${getWsColor(ws)}${Math.round(ws)}`;
        }
        case 'finals': {
            const text = compactCount(stats.finals);
            return text ? `§e${text}` : '';
        }
        case 'beds': {
            const text = compactCount(stats.beds);
            return text ? `§b${text}` : '';
        }
        case 'wins': {
            const text = compactCount(stats.wins);
            return text ? `§a${text}` : '';
        }
        case 'finaldeaths': {
            const text = compactCount(stats.finalDeaths);
            return text ? `\u00a7c${text}` : '';
        }
        case 'bedslost': {
            const text = compactCount(stats.bedsLost);
            return text ? `\u00a7c${text}` : '';
        }
        case 'losses': {
            const text = compactCount(stats.losses);
            return text ? `\u00a7c${text}` : '';
        }
        case 'kills': {
            const text = compactCount(stats.kills);
            return text ? `\u00a7e${text}` : '';
        }
        case 'deaths': {
            const text = compactCount(stats.deaths);
            return text ? `\u00a7c${text}` : '';
        }
        case 'games': {
            const text = compactCount(stats.games);
            return text ? `\u00a7f${text}` : '';
        }
        case 'level': {
            const level = Number(row?.networkLevel);
            if (!Number.isFinite(level) || level <= 0) return '';
            return `§b${Math.round(level)}`;
        }
        case 'ping': {
            // Same value /ping reports as the average: Aurora's weekly mean,
            // falling back to monthly then the latest day. It rides along on
            // every profile lookup (getPlayerData already awaits getAuroraPingRaw),
            // so rendering it here costs no extra request. Missing data is -1.
            const avgPing = Number(row?.avgPing);
            if (!Number.isFinite(avgPing) || avgPing <= 0) return '';
            return `${getPingColor(avgPing)}${Math.round(avgPing)}ms`;
        }
        case 'sfkdr': return ratio(session.fkdr, getFkdrColor);
        case 'swlr': return ratio(session.wlr, getWlrColor);
        case 'swins': {
            const text = signedCompactCount(session.wins);
            return text ? `§a${text}` : '';
        }
        case 'sfinals': {
            const text = signedCompactCount(session.finals);
            return text ? `§e${text}` : '';
        }
        case 'dfkdr': return ratio(sessionStat('daily', 'fkdr'), getFkdrColor);
        case 'dwlr': return ratio(sessionStat('daily', 'wlr'), getWlrColor);
        case 'dwins': {
            const text = signedCompactCount(sessionStat('daily', 'wins'));
            return text ? `\u00a7a${text}` : '';
        }
        case 'dfinals': {
            const text = signedCompactCount(sessionStat('daily', 'finals'));
            return text ? `\u00a7e${text}` : '';
        }
        case 'wfkdr': return ratio(sessionStat('weekly', 'fkdr'), getFkdrColor);
        case 'wwlr': return ratio(sessionStat('weekly', 'wlr'), getWlrColor);
        case 'wwins': {
            const text = signedCompactCount(sessionStat('weekly', 'wins'));
            return text ? `\u00a7a${text}` : '';
        }
        case 'wfinals': {
            const text = signedCompactCount(sessionStat('weekly', 'finals'));
            return text ? `\u00a7e${text}` : '';
        }
        case 'mfkdr': return ratio(sessionStat('monthly', 'fkdr'), getFkdrColor);
        case 'mwlr': return ratio(sessionStat('monthly', 'wlr'), getWlrColor);
        case 'mwins': {
            const text = signedCompactCount(sessionStat('monthly', 'wins'));
            return text ? `\u00a7a${text}` : '';
        }
        case 'mfinals': {
            const text = signedCompactCount(sessionStat('monthly', 'finals'));
            return text ? `\u00a7e${text}` : '';
        }
        case 'guild': {
            const tag = cleanNametagText(row?.guildTag || '');
            if (!tag) return '';
            return `§7[${tag.slice(0, 6)}]`;
        }
        case 'tag': {
            return formatNametagTag(row, opts);
        }
        default:
            return '';
    }
}

// Resolve one nametag slot. A fallback is used only when a real configured
// primary stat has no displayable value; `none` intentionally leaves the slot
// blank and never cascades into its fallback.
function formatNametagSlot(primaryStat, fallbackStat, row, opts = {}) {
    const primary = normalizeNametagStat(primaryStat, 'none');
    if (primary === 'none') return '';

    const primaryValue = formatNametagStat(primary, row, opts);
    if (primaryValue) return primaryValue;

    const fallback = normalizeNametagStat(fallbackStat, 'none');
    if (fallback === 'none' || nametagStatSource(fallback) === nametagStatSource(primary)) return '';
    return formatNametagStat(fallback, row, opts);
}

// Build the prefix/suffix fields for one player.
//
// `audience` contains a primary and fallback stat for each prefix/suffix slot.
// prefixBudget is what's left of the 16-char prefix after the Bedwars team
// letter; the suffix gets the full field.
function buildNametagFields(row, opts = {}) {
    if (!row) return { prefixExtra: '', suffix: '' };

    const {
        compactTagName,
        isLikelyBot,
        priority = 'urchin',
        audience = null,
        isTeammate = false,
        starBracketsEnabled = true,
        tagDisplayMode = 'acronyms',
        prefixBudget = MAX_TEAM_FIELD,
        coloredStarPrefixBudget = prefixBudget
    } = opts;

    const name = row.name || '';
    if (row.isNicked) {
        if (typeof isLikelyBot === 'function' && isLikelyBot(name)) {
            return { prefixExtra: '', suffix: '' };
        }
        return { prefixExtra: '', suffix: ` ${formatNametagNick(tagDisplayMode)}` };
    }

    // A confirmed nick is a stronger identity result than a later transient
    // API failure. Keep the [NICK] marker visible instead of briefly removing
    // the overlay and letting the client fall back to a stale scoreboard team.
    if (row.lookupFailed) return { prefixExtra: '', suffix: '' };

    if (!audience) return { prefixExtra: '', suffix: '' };

    const statOpts = { compactTagName, priority, isTeammate, guildTag: row.guildTag, starBracketsEnabled, tagDisplayMode };
    // A prestige has to know its field before it can pick how many colour bands
    // to spend on.
    //
    // composeBedwarsNametagPrefix lays a bracketed star out as "<star> <team
    // letter> " where any other prefix needs "<value>§r <team letter> ", so a
    // star gets the two characters of that reset back. Aim at exactly that:
    // anything wider buys another colour band by costing the team letter, which
    // is the one thing above a head that says which team an enemy is on.
    const starPrefixBudget = starBracketsEnabled
        ? Math.min(MAX_TEAM_FIELD, Math.max(0, (Number(prefixBudget) || 0) + 2))
        : Math.max(0, Number(prefixBudget) || 0);
    const prefixRaw = formatNametagSlot(
        audience.prefix || audience.prefixStat || 'none',
        audience.prefixFallback || audience.prefixFallbackStat || 'none',
        row,
        { ...statOpts, starBudget: starPrefixBudget }
    );
    const suffixRaw = formatNametagSlot(
        audience.suffix || audience.suffixStat || 'none',
        audience.suffixFallback || audience.suffixFallbackStat || 'none',
        row,
        { ...statOpts, starBudget: Math.max(0, MAX_TEAM_FIELD - 1) }
    );

    const safePrefixBudget = Math.max(0, prefixBudget);
    let prefixExtra = prefixRaw;
    // BedWars can grant a bracketed star extra characters by removing cosmetic
    // separators (and, for four-digit levels, the redundant team-letter marker)
    // before the player name. Never abbreviate the level: the full number and
    // its prestige icon always survive, and the prestige palette is spent down
    // to fit rather than truncated (see formatNametagPrestige).
    const bracketedStar = isBracketedStarField(prefixExtra);
    let effectivePrefixBudget = safePrefixBudget;
    if (bracketedStar) {
        effectivePrefixBudget = Math.max(
            safePrefixBudget,
            Math.min(MAX_TEAM_FIELD, Math.max(0, Number(coloredStarPrefixBudget) || 0))
        );
    }
    prefixExtra = prefixExtra ? clampField(prefixExtra, effectivePrefixBudget) : '';
    const suffix = suffixRaw ? clampField(` ${suffixRaw}`, MAX_TEAM_FIELD) : '';

    return { prefixExtra, suffix };
}

function composeBedwarsNametagPrefix(teamColor, teamLetter, prefixExtra = '') {
    const basePrefix = `${String(teamColor || '')}${String(teamLetter || '')} `;
    if (!prefixExtra) return basePrefix;
    if (isBracketedStarField(prefixExtra)) {
        // Keep a visible separator between the BedWars star and the team
        // letter. The closing bracket's own colour costs two protocol
        // characters and only repaints one glyph, so drop it when the full
        // prefix would otherwise exceed the 1.8 team's 16-character field.
        const withTeamGap = `${prefixExtra} ${basePrefix}`;
        if (withTeamGap.length <= MAX_TEAM_FIELD) return withTeamGap;

        const compactBracketedStar = prefixExtra.replace(/\u00a7[0-9a-f]\]$/i, ']');
        const compactWithTeamGap = `${compactBracketedStar} ${basePrefix}`;
        if (compactWithTeamGap.length <= MAX_TEAM_FIELD) {
            return compactWithTeamGap;
        }

        const coloredNameGap = `${String(teamColor || '')} `;
        if (compactBracketedStar.length + coloredNameGap.length <= MAX_TEAM_FIELD) {
            return `${compactBracketedStar}${coloredNameGap}`;
        }
        if (compactBracketedStar.length + String(teamColor || '').length <= MAX_TEAM_FIELD) {
            return `${compactBracketedStar}${String(teamColor || '')}`;
        }
    }
    // The custom value should read first, while the reset prevents its color
    // from bleeding into Hypixel's team letter. Re-applying teamColor at the
    // end also leaves the following player name in the correct team color.
    return `${prefixExtra}\u00a7r ${basePrefix}`;
}

module.exports = {
    MAX_TEAM_FIELD,
    NAMETAG_TEAM_MARKER,
    NAMETAG_TEAM_BASE_MAX,
    nametagTeamBase,
    nametagTeamName,
    assignNametagTeamNames,
    NAMETAG_STAT_TYPES,
    NAMETAG_STAT_LABELS,
    NAMETAG_SESSION_STATS,
    NAMETAG_STAT_SOURCES,
    NAMETAG_AUDIENCE_LABELS,
    NAMETAG_STAT_GROUPS,
    NAMETAG_STAT_SHORT_LABELS,
    normalizeNametagStat,
    nametagStatSource,
    normalizeNametagFallback,
    nametagSessionPeriod,
    clampField,
    fitField,
    cleanNametagText,
    pickNametagTag,
    NAMETAG_TAG_DISPLAY_MODES,
    NAMETAG_TAG_SOURCE_COLORS,
    NAMETAG_TAG_DEFINITIONS,
    NAMETAG_TAG_ICONS,
    NAMETAG_NICK_DEFINITION,
    normalizeNametagTagDisplayMode,
    stripNametagIconGlyphs,
    nametagTagCategory,
    nametagIconForTag,
    nametagTagSourceColor,
    formatNametagNick,
    formatNametagTagValue,
    formatNametagTag,
    nametagPrimaryTagType,
    nametagRowHasTag,
    isStatThreat,
    formatNametagStat,
    formatNametagSlot,
    buildNametagFields,
    composeBedwarsNametagPrefix
};
