'use strict';

function stripAnsi(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/(?:\u00C2?\u00A7|\\u00a7|\\u00A7)[0-9A-FK-OR]/gi, '');
}

const MINECRAFT_COLOR_NAME_TO_CODE = {
    black: '\u00a70',
    dark_blue: '\u00a71',
    dark_green: '\u00a72',
    dark_aqua: '\u00a73',
    dark_red: '\u00a74',
    dark_purple: '\u00a75',
    gold: '\u00a76',
    gray: '\u00a77',
    dark_gray: '\u00a78',
    blue: '\u00a79',
    green: '\u00a7a',
    aqua: '\u00a7b',
    red: '\u00a7c',
    light_purple: '\u00a7d',
    yellow: '\u00a7e',
    white: '\u00a7f'
};

// Bed Wars uses these eight names in its sidebar.  This is deliberately a
// fixed game palette rather than the launcher accent: the sidebar should say
// "Red" in red, "Blue" in blue, and so on regardless of the selected theme.
const BEDWARS_SIDEBAR_TEAM_COLORS = Object.freeze({
    red: '\u00a7c',
    blue: '\u00a79',
    green: '\u00a7a',
    yellow: '\u00a7e',
    aqua: '\u00a7b',
    white: '\u00a7f',
    pink: '\u00a7d',
    gray: '\u00a78',
    grey: '\u00a78'
});

const MINECRAFT_LEGACY_PALETTE = Object.freeze([
    { code: '0', name: 'black', hex: '#000000' },
    { code: '1', name: 'dark_blue', hex: '#0000aa' },
    { code: '2', name: 'dark_green', hex: '#00aa00' },
    { code: '3', name: 'dark_aqua', hex: '#00aaaa' },
    { code: '4', name: 'dark_red', hex: '#aa0000' },
    { code: '5', name: 'dark_purple', hex: '#aa00aa' },
    { code: '6', name: 'gold', hex: '#ffaa00' },
    { code: '7', name: 'gray', hex: '#aaaaaa' },
    { code: '8', name: 'dark_gray', hex: '#555555' },
    { code: '9', name: 'blue', hex: '#5555ff' },
    { code: 'a', name: 'green', hex: '#55ff55' },
    { code: 'b', name: 'aqua', hex: '#55ffff' },
    { code: 'c', name: 'red', hex: '#ff5555' },
    { code: 'd', name: 'light_purple', hex: '#ff55ff' },
    { code: 'e', name: 'yellow', hex: '#ffff55' },
    { code: 'f', name: 'white', hex: '#ffffff' }
]);

// These are Fury-owned labels rendered at the start of locally injected chat
// lines. Keeping the allow-list explicit avoids recoloring ordinary Minecraft
// rank prefixes such as [MVP+] or server-provided chat components.
const BRACKETED_FEATURE_PREFIXES = new Set([
    'AC', 'AC-Experimental', 'AC2', 'AddTag', 'API Kill Switch', 'Aurora',
    'AutoDenick', 'AutoGambler', 'ChatTriggers', 'CosmeticDenick', 'CosmeticFX',
    'Cosmetics', 'Denick', 'Fury Health', 'Fury', 'FURY', 'Alias', 'Clip', 'KM', 'Launcher', 'Lobby Chat Stats',
    'NameTags', 'Overlay', 'Party', 'Party Overview', 'Ping', 'Preset',
    'Profile', 'Recap', 'RemoveTag', 'Seraph', 'Session', 'SkinCheck',
    'SkinDenick', 'TabStats', 'Tag', 'Urchin'
]);

const ARROW_FEATURE_PREFIXES = [
    'Fury Daily Rewards', 'Fury Reminder Test', 'Party Denick Test',
    'Fury Reminder', 'Fury Daily', 'Party Denick', 'Profile Diff',
    'Share Preview', 'AutoDodge', 'Session', 'Recap',
    'Profile', 'Pregame', 'Recorder', 'Dodge', 'Duels', 'Share', 'Fury', 'FURY',
    // Locally generated command/status headers; diagnostic and rank labels stay excluded.
    'Gambler George', 'Queue time', 'Lobby', 'Quick Buy + Hotbar', 'Quick Buy',
    'Hotbar', 'Preview', 'Layout', 'Urchin', 'Seraph', 'Tags'
].sort((left, right) => right.length - left.length);

const TITLE_FEATURE_PREFIXES = [
    'Fury Commands', 'Session History', 'Scan Settings', 'Fury Health'
].sort((left, right) => right.length - left.length);

let chatPrefixAccent = null;

function normalizeHexColor(value, fallback = '#e5b35d') {
    const clean = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(clean) ? clean : fallback;
}

function hexToRgb(hex) {
    const clean = normalizeHexColor(hex).slice(1);
    return {
        red: parseInt(clean.slice(0, 2), 16),
        green: parseInt(clean.slice(2, 4), 16),
        blue: parseInt(clean.slice(4, 6), 16)
    };
}

function rgbToLab(rgb) {
    const linear = [rgb.red, rgb.green, rgb.blue]
        .map(value => value / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    const [red, green, blue] = linear;
    const xyz = [
        (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047,
        red * 0.2126 + green * 0.7152 + blue * 0.0722,
        (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883
    ].map(value => value > 0.008856 ? Math.cbrt(value) : (7.787 * value) + (16 / 116));
    return {
        lightness: (116 * xyz[1]) - 16,
        greenRed: 500 * (xyz[0] - xyz[1]),
        blueYellow: 200 * (xyz[1] - xyz[2])
    };
}

function closestLegacyChatColor(hex) {
    const source = rgbToLab(hexToRgb(hex));
    return MINECRAFT_LEGACY_PALETTE.reduce((closest, candidate) => {
        const target = rgbToLab(hexToRgb(candidate.hex));
        const distance = ((source.lightness - target.lightness) ** 2)
            + ((source.greenRed - target.greenRed) ** 2)
            + ((source.blueYellow - target.blueYellow) ** 2);
        return !closest || distance < closest.distance
            ? { ...candidate, distance }
            : closest;
    }, null);
}

function setChatPrefixAccent(hex) {
    const sourceHex = normalizeHexColor(hex);
    chatPrefixAccent = { ...closestLegacyChatColor(sourceHex), sourceHex };
    return { ...chatPrefixAccent };
}

function getChatPrefixAccent() {
    return chatPrefixAccent ? { ...chatPrefixAccent } : null;
}

function featurePrefixRange(text) {
    const visible = String(text || '');
    const leadingLength = visible.match(/^\s*/)?.[0]?.length || 0;
    const value = visible.slice(leadingLength);
    if (!value) return null;

    if (value.startsWith('[')) {
        const closingIndex = value.indexOf(']');
        if (closingIndex > 1) {
            const label = value.slice(1, closingIndex).trim();
            if (BRACKETED_FEATURE_PREFIXES.has(label)) {
                return { start: leadingLength, end: leadingLength + closingIndex + 1, label };
            }
        }
    }

    const arrowLabel = ARROW_FEATURE_PREFIXES.find(label => value.startsWith(label));
    if (arrowLabel) {
        const separator = value.slice(arrowLabel.length).match(/^\s*»/);
        if (separator) {
            return {
                start: leadingLength,
                end: leadingLength + arrowLabel.length + separator[0].length,
                label: arrowLabel
            };
        }
    }

    const titleLabel = TITLE_FEATURE_PREFIXES.find(label => value === label || value.startsWith(`${label} `));
    return titleLabel
        ? { start: leadingLength, end: leadingLength + titleLabel.length, label: titleLabel }
        : null;
}

function applyChatPrefixAccent(component) {
    if (!chatPrefixAccent || !component || !Array.isArray(component.extra)) return component;
    const visible = component.extra.map(segment => String(segment?.text || '')).join('');
    const range = featurePrefixRange(visible);
    if (!range) return component;

    let offset = 0;
    const extra = [];
    component.extra.forEach((segment) => {
        const length = String(segment?.text || '').length;
        const overlapsPrefix = offset < range.end && offset + length > range.start;
        if (overlapsPrefix && segment && typeof segment === 'object') {
            const text = String(segment.text || '');
            const start = Math.max(0, range.start - offset);
            const end = Math.min(length, range.end - offset);
            if (start > 0) extra.push({ ...segment, text: text.slice(0, start) });
            extra.push({ ...segment, text: text.slice(start, end), color: chatPrefixAccent.name });
            if (end < length) extra.push({ ...segment, text: text.slice(end) });
        } else {
            extra.push(segment);
        }
        offset += length;
    });
    return { ...component, extra };
}

function bedwarsEventLabelRanges(text) {
    const visible = String(text || '');
    const ranges = [];
    [
        /TEAM\s+ELIMINATED\s*>/gi,
        /BED\s+DESTRUCTION\s*>/gi,
        /FINAL\s+KILL!/gi
    ].forEach((pattern) => {
        for (const match of visible.matchAll(pattern)) {
            ranges.push({
                start: match.index,
                end: match.index + match[0].length,
                label: match[0]
            });
        }
    });
    return ranges.sort((left, right) => left.start - right.start);
}

function applyBedwarsEventLabelAccent(component) {
    if (!chatPrefixAccent || component === null || component === undefined) return component;
    const normalized = normalizeLegacyJsonComponent(component);
    const segments = Array.isArray(normalized.extra) ? normalized.extra : [];
    const visible = segments.map(segment => String(segment?.text || '')).join('');
    const ranges = bedwarsEventLabelRanges(visible);
    if (!ranges.length) return component;

    let offset = 0;
    const extra = [];
    segments.forEach((segment) => {
        const text = String(segment?.text || '');
        const start = offset;
        const end = start + text.length;
        const boundaries = new Set([0, text.length]);
        ranges.forEach((range) => {
            if (range.start > start && range.start < end) boundaries.add(range.start - start);
            if (range.end > start && range.end < end) boundaries.add(range.end - start);
        });
        const points = Array.from(boundaries).sort((left, right) => left - right);
        for (let index = 0; index < points.length - 1; index += 1) {
            const localStart = points[index];
            const localEnd = points[index + 1];
            if (localEnd <= localStart) continue;
            const globalStart = start + localStart;
            const accented = ranges.some(range => globalStart >= range.start && globalStart < range.end);
            extra.push({
                ...segment,
                ...(accented ? { color: chatPrefixAccent.name } : {}),
                text: text.slice(localStart, localEnd)
            });
        }
        offset = end;
    });

    return { text: '', extra };
}

function legacyStyleBefore(text, end) {
    let color = '';
    const formats = [];
    const value = String(text || '');

    for (let index = 0; index < end; index += 1) {
        if (value[index] !== '\u00a7' || index + 1 >= end) continue;
        const code = value[++index].toLowerCase();
        if (LEGACY_COLOR_NAMES[code]) {
            color = `\u00a7${code}`;
            formats.length = 0;
        } else if (code === 'r') {
            color = '';
            formats.length = 0;
        } else if (LEGACY_FORMAT_CODES[code] && !formats.includes(code)) {
            formats.push(code);
        }
    }

    return { color, formats };
}

function restoreLegacyStyle(style = {}) {
    const formats = Array.isArray(style.formats)
        ? style.formats.map(code => `\u00a7${code}`).join('')
        : '';
    return `${style.color || '\u00a7r'}${formats}`;
}

// Scoreboard score entries are identity keys, so only team packet display
// fields may be recolored.  Preserve the style that was active before a team
// name to avoid changing the rest of the sidebar row.
function applyBedwarsSidebarTeamColors(value) {
    if (typeof value !== 'string') return value;

    // A legacy color code ends in a hexadecimal character, so a normal word
    // boundary would miss `§7Red`. Treat that two-character sequence as a
    // valid boundary while still rejecting ordinary words such as Redstone.
    return value.replace(/(^|[^A-Za-z0-9_]|\u00a7[0-9a-fk-or])(Red|Blue|Green|Yellow|Aqua|White|Pink|Gray|Grey)(?![A-Za-z0-9_])/gi, (match, boundary, teamName, offset) => {
        const teamOffset = offset + boundary.length;
        const style = legacyStyleBefore(value, teamOffset);
        const teamColor = BEDWARS_SIDEBAR_TEAM_COLORS[String(teamName).toLowerCase()];
        if (!teamColor) return match;
        const separator = boundary.startsWith('\u00a7') ? '' : boundary;
        return `${separator}${teamColor}${style.formats.map(code => `\u00a7${code}`).join('')}${teamName}${restoreLegacyStyle(style)}`;
    });
}

// Hypixel builds each Bed Wars sidebar row from a team prefix, an invisible
// score entry, and a suffix containing the visible check/X (plus an optional
// `YOU`). The split point moves between updates to keep each field under the
// 1.8 protocol limit, so status detection must inspect both prefix and suffix.
function getBedwarsSidebarTeamStatus(prefix, suffix = '') {
    if (typeof prefix !== 'string') return null;

    const visible = stripAnsi(prefix).replace(/\s+/g, ' ').trim();
    const match = visible.match(/^(?:[A-Z]\s+)?(Red|Blue|Green|Yellow|Aqua|White|Pink|Gray|Grey)\s*:\s*(.*)$/i);
    if (!match) return null;

    // Red is short enough that Hypixel sometimes fits its status character in
    // the final byte of the 16-character prefix. Longer rows put the same
    // character at the start of the suffix.
    const statusInPrefix = Boolean(String(match[2] || '').trim());

    // The visible status normally starts the suffix (`§a✓` / `§c✖`). Some
    // variants place its colour at the end of the prefix, so retain that as a
    // fallback. Ignore later suffix formatting used by the optional `YOU`.
    const suffixLead = String(suffix || '').match(/^(?:(?:\u00c2?\u00a7)[0-9a-fk-or]|\s)*/i)?.[0] || '';
    const suffixColors = suffixLead.match(/(?:\u00c2?\u00a7)[0-9a-f]/gi) || [];
    const prefixColors = prefix.match(/(?:\u00c2?\u00a7)[0-9a-f]/gi) || [];
    const statusColor = (statusInPrefix ? prefixColors.at(-1) : (suffixColors.at(-1) || prefixColors.at(-1)))
        ?.slice(-1).toLowerCase();

    return {
        teamName: match[1],
        eliminated: statusColor === 'c' || statusColor === '4',
        statusInPrefix
    };
}

function rewriteBedwarsSidebarTeamStatusLine(prefix, suffix = '') {
    const status = getBedwarsSidebarTeamStatus(prefix, suffix);
    if (!status) return prefix;

    const teamName = status.teamName;
    const teamColor = BEDWARS_SIDEBAR_TEAM_COLORS[teamName.toLowerCase()];
    if (!teamColor) return prefix;

    if (status.eliminated) return `\u00a78\u00a7m${teamName}\u00a7r`;

    if (status.statusInPrefix) {
        const colon = prefix.lastIndexOf(':');
        const statusTail = colon >= 0 ? prefix.slice(colon + 1) : '';
        const rewritten = `${teamColor}${teamName}\u00a7f:${statusTail}`;
        return rewritten.length <= 16 ? rewritten : prefix;
    }

    const trailingStyle = prefix.match(/(?:\u00a7[0-9a-fk-or])+$/i)?.[0] || '\u00a7f';
    const rewritten = `${teamColor}${teamName}\u00a7f: ${trailingStyle}`;
    return rewritten.length <= 16 ? rewritten : prefix;
}

function rewriteBedwarsSidebarTeamStatusSuffix(suffix, status) {
    if (!status?.eliminated || status.statusInPrefix || typeof suffix !== 'string' || !suffix) return suffix;

    // Drop only the first visible code point (Hypixel's X/cross) and its
    // following whitespace. Formatting and `YOU` after it are preserved.
    let offset = 0;
    while (offset < suffix.length) {
        if (suffix[offset] === '\u00a7' && offset + 1 < suffix.length) {
            offset += 2;
            continue;
        }
        if (suffix[offset] === '\u00c2' && suffix[offset + 1] === '\u00a7' && offset + 2 < suffix.length) {
            offset += 3;
            continue;
        }
        if (/\s/.test(suffix[offset])) {
            offset += 1;
            continue;
        }
        break;
    }
    if (offset >= suffix.length) return '';
    const codePoint = suffix.codePointAt(offset);
    offset += codePoint > 0xffff ? 2 : 1;
    while (offset < suffix.length && /\s/.test(suffix[offset])) offset += 1;

    const tail = suffix.slice(offset);
    return stripAnsi(tail).trim() ? ` ${tail}` : '';
}

function getHypixelColor(color) {
    const colors = {
        BLACK: '\u00a70',
        DARK_BLUE: '\u00a71',
        DARK_GREEN: '\u00a72',
        DARK_AQUA: '\u00a73',
        DARK_RED: '\u00a74',
        DARK_PURPLE: '\u00a75',
        GOLD: '\u00a76',
        GRAY: '\u00a77',
        DARK_GRAY: '\u00a78',
        BLUE: '\u00a79',
        GREEN: '\u00a7a',
        AQUA: '\u00a7b',
        RED: '\u00a7c',
        LIGHT_PURPLE: '\u00a7d',
        YELLOW: '\u00a7e',
        WHITE: '\u00a7f'
    };
    return colors[String(color || '').toUpperCase()] || '\u00a7c';
}

function extractText(jsonMsg) {
    const read = (component) => {
        if (typeof component === 'string') return component;
        if (Array.isArray(component)) return component.map(read).join('');
        if (!component || typeof component !== 'object') return '';

        let text = component.text === undefined ? '' : String(component.text);
        if (Array.isArray(component.with)) text += component.with.map(read).join('');
        if (Array.isArray(component.extra)) text += component.extra.map(read).join('');
        return text;
    };
    return stripAnsi(read(jsonMsg));
}

function extractFormattedText(jsonMsg) {
    const read = (component, inheritedColor = '') => {
        if (typeof component === 'string') return `${inheritedColor}${component}`;
        if (Array.isArray(component)) return component.map(item => read(item, inheritedColor)).join('');
        if (!component || typeof component !== 'object') return '';

        const colorCode = MINECRAFT_COLOR_NAME_TO_CODE[String(component.color || '').toLowerCase()] || inheritedColor;
        let text = component.text === undefined ? '' : `${colorCode}${String(component.text)}`;
        if (Array.isArray(component.with)) text += component.with.map(item => read(item, colorCode)).join('');
        if (Array.isArray(component.extra)) text += component.extra.map(item => read(item, colorCode)).join('');
        return text;
    };
    return read(jsonMsg);
}

// --- HYPIXEL RANKS -------------------------------------------------------
//
// A player's rank is spread across four API fields that are not
// interchangeable:
//
//   player.prefix              custom override ("\u00a7c[OWNER]"). Wins outright.
//   player.rank                staff and YouTube ranks. On accounts made
//                              before packageRank existed this same field
//                              still holds donor values (VIP/MVP/...), so
//                              only the special set below may be read from
//                              it - never "is player.rank truthy".
//   player.monthlyPackageRank  "SUPERSTAR" => MVP++
//   player.newPackageRank      current donor rank, else packageRank
//
// Two colour fields matter too: rankPlusColor tints the "+"/"++" of MVP+ and
// MVP++, and monthlyRankColor is the MVP++ subscriber's pick of GOLD
// (default) or AQUA for the brackets and the name. That second one is why an
// MVP++ can never be identified by name colour alone - an AQUA MVP++ renders
// in the same blue as a plain MVP.
const HYPIXEL_SPECIAL_RANKS = Object.freeze({
    OWNER: { id: 'OWNER', label: 'OWNER', prefix: '\u00a7c[OWNER]', color: '\u00a7c', staff: true },
    ADMIN: { id: 'ADMIN', label: 'ADMIN', prefix: '\u00a7c[ADMIN]', color: '\u00a7c', staff: true },
    GAME_MASTER: { id: 'GAME_MASTER', label: 'GM', prefix: '\u00a72[GM]', color: '\u00a72', staff: true },
    MODERATOR: { id: 'MODERATOR', label: 'MOD', prefix: '\u00a72[MOD]', color: '\u00a72', staff: true },
    HELPER: { id: 'HELPER', label: 'HELPER', prefix: '\u00a79[HELPER]', color: '\u00a79', staff: true },
    JR_HELPER: { id: 'JR_HELPER', label: 'JR HELPER', prefix: '\u00a79[JR HELPER]', color: '\u00a79', staff: true },
    // Red brackets, white wordmark, red name - Hypixel renders it exactly so.
    YOUTUBER: { id: 'YOUTUBER', label: 'YOUTUBE', prefix: '\u00a7c[\u00a7fYOUTUBE\u00a7c]', color: '\u00a7c', youtube: true }
});

// Everyone who can run /nick: Hypixel gates it behind MVP++ and grants it to
// YouTube and staff ranks as well, so a nicked player is always one of these.
const HYPIXEL_NICK_CAPABLE_RANKS = Object.freeze([
    'MVP_PLUS_PLUS',
    ...Object.keys(HYPIXEL_SPECIAL_RANKS)
]);

const DEFAULT_HYPIXEL_RANK = Object.freeze({
    id: 'NONE',
    label: '',
    prefix: '',
    nameColor: '\u00a77',
    plusColor: '\u00a7c',
    isStaff: false,
    isYoutube: false,
    isMvpPlusPlus: false,
    canNick: false
});

function firstLegacyColorCode(value, fallback = '\u00a77') {
    const match = String(value || '').match(/\u00a7([0-9a-fA-F])/);
    return match ? `\u00a7${match[1].toLowerCase()}` : fallback;
}

function makeHypixelRank(overrides = {}) {
    return { ...DEFAULT_HYPIXEL_RANK, ...overrides };
}

// Classify a rank that exists only as rendered text - a tab entry, a chat
// prefix, a stored display name. Weaker than resolveHypixelRank, which reads
// the API fields, but it is all that is available for a player who has not
// been looked up yet.
function hypixelRankIdFromText(value = '', { requireBrackets = false } = {}) {
    const clean = stripAnsi(String(value || '')).toUpperCase();
    if (!clean) return 'NONE';
    // Hypixel always renders a rank inside brackets, so only the bracketed
    // part is classified - otherwise a player named "YouTubeFan" would read
    // as a YouTube rank and land in the nick candidate pool. Text that has no
    // brackets at all is classified whole only for raw API field values
    // ("SUPERSTAR", "MVP_PLUS"); callers passing rendered display text set
    // requireBrackets so an unbracketed name is simply rankless.
    const bracketed = clean.match(/\[[^\]]*\]/g);
    if (!bracketed && requireBrackets) return 'NONE';
    const tag = bracketed ? bracketed.join(' ') : clean;

    if (tag.includes('YOUTUBE') || /\bYT\b/.test(tag)) return 'YOUTUBER';
    if (tag.includes('OWNER')) return 'OWNER';
    if (tag.includes('ADMIN')) return 'ADMIN';
    if (tag.includes('GAME MASTER') || /\bGM\b/.test(tag)) return 'GAME_MASTER';
    if (tag.includes('JR HELPER') || tag.includes('JR_HELPER')) return 'JR_HELPER';
    if (tag.includes('HELPER')) return 'HELPER';
    if (tag.includes('MODERATOR') || /\bMOD\b/.test(tag)) return 'MODERATOR';
    if (tag.includes('SUPERSTAR') || tag.includes('MVP++')) return 'MVP_PLUS_PLUS';
    if (tag.includes('MVP+') || tag.includes('MVP_PLUS')) return 'MVP_PLUS';
    if (/\bMVP\b/.test(tag)) return 'MVP';
    if (tag.includes('VIP+') || tag.includes('VIP_PLUS')) return 'VIP_PLUS';
    if (/\bVIP\b/.test(tag)) return 'VIP';
    return 'NONE';
}

function isNickCapableRankId(id = '') {
    return HYPIXEL_NICK_CAPABLE_RANKS.includes(String(id || '').toUpperCase());
}

// True when rendered rank text belongs to someone who can /nick. Used where
// only a tab entry or a chat prefix is on hand, so the bracket rule applies.
function displayLooksNickCapable(value = '') {
    return isNickCapableRankId(hypixelRankIdFromText(value, { requireBrackets: true }));
}

function resolveHypixelRank(input = {}) {
    // Callers hand this whatever a lookup returned, and an explicit null slips
    // past the default parameter, so normalize before reading any field.
    const player = input && typeof input === 'object' ? input : {};
    const plusColor = getHypixelColor(player.rankPlusColor || 'RED');

    // A custom prefix is the server's final word on how the player renders,
    // so it is kept verbatim and only the classification is inferred from it.
    const customPrefix = String(player.prefix || '').trim();
    if (customPrefix) {
        const id = hypixelRankIdFromText(customPrefix);
        const special = HYPIXEL_SPECIAL_RANKS[id];
        return makeHypixelRank({
            id: special ? id : 'CUSTOM',
            label: stripAnsi(customPrefix).replace(/[[\]]/g, '').trim(),
            prefix: customPrefix,
            nameColor: firstLegacyColorCode(customPrefix, special?.color || '\u00a77'),
            plusColor,
            isStaff: Boolean(special?.staff),
            isYoutube: Boolean(special?.youtube),
            isMvpPlusPlus: id === 'MVP_PLUS_PLUS',
            canNick: isNickCapableRankId(id)
        });
    }

    const special = HYPIXEL_SPECIAL_RANKS[String(player.rank || '').toUpperCase()];
    if (special) {
        return makeHypixelRank({
            id: special.id,
            label: special.label,
            prefix: special.prefix,
            nameColor: special.color,
            plusColor,
            isStaff: Boolean(special.staff),
            isYoutube: Boolean(special.youtube),
            canNick: true
        });
    }

    if (String(player.monthlyPackageRank || '').toUpperCase() === 'SUPERSTAR') {
        const monthlyColor = getHypixelColor(player.monthlyRankColor || 'GOLD');
        return makeHypixelRank({
            id: 'MVP_PLUS_PLUS',
            label: 'MVP++',
            prefix: `${monthlyColor}[MVP${plusColor}++${monthlyColor}]`,
            nameColor: monthlyColor,
            plusColor,
            isMvpPlusPlus: true,
            canNick: true
        });
    }

    const rank = String(player.newPackageRank || player.packageRank || 'NONE').toUpperCase();
    if (rank === 'MVP_PLUS') {
        return makeHypixelRank({
            id: 'MVP_PLUS',
            label: 'MVP+',
            prefix: `\u00a7b[MVP${plusColor}+\u00a7b]`,
            nameColor: '\u00a7b',
            plusColor
        });
    }
    if (rank === 'MVP') {
        return makeHypixelRank({ id: 'MVP', label: 'MVP', prefix: '\u00a7b[MVP]', nameColor: '\u00a7b', plusColor });
    }
    if (rank === 'VIP_PLUS') {
        // The VIP+ plus is always gold - rankPlusColor does not apply to it.
        return makeHypixelRank({
            id: 'VIP_PLUS',
            label: 'VIP+',
            prefix: '\u00a7a[VIP\u00a76+\u00a7a]',
            nameColor: '\u00a7a',
            plusColor
        });
    }
    if (rank === 'VIP') {
        return makeHypixelRank({ id: 'VIP', label: 'VIP', prefix: '\u00a7a[VIP]', nameColor: '\u00a7a', plusColor });
    }
    return makeHypixelRank({ plusColor });
}

function getHypixelRankPrefix(player = {}) {
    return resolveHypixelRank(player).prefix;
}

function getHypixelRankNameColor(player = {}) {
    return resolveHypixelRank(player).nameColor;
}

// "[YOUTUBE]" / "[MVP++]" / "Default" - the rank alone, for label rows.
function getHypixelRankLabel(player = {}) {
    const rank = resolveHypixelRank(player);
    return rank.label ? `[${rank.label}]` : 'Default';
}

function getRankedName(player = {}) {
    const rank = resolveHypixelRank(player);
    const name = (player && (player.displayname || player.name)) || '';
    return rank.prefix ? `${rank.prefix} ${name}` : `${rank.nameColor}${name}`;
}

const LEGACY_COLOR_NAMES = {
    '0': 'black',
    '1': 'dark_blue',
    '2': 'dark_green',
    '3': 'dark_aqua',
    '4': 'dark_red',
    '5': 'dark_purple',
    '6': 'gold',
    '7': 'gray',
    '8': 'dark_gray',
    '9': 'blue',
    a: 'green',
    b: 'aqua',
    c: 'red',
    d: 'light_purple',
    e: 'yellow',
    f: 'white'
};

const LEGACY_FORMAT_CODES = {
    k: 'obfuscated',
    l: 'bold',
    m: 'strikethrough',
    n: 'underlined',
    o: 'italic'
};

const JSON_STYLE_KEYS = ['color', 'bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'];

function styleFromComponent(component = {}) {
    const style = {};
    JSON_STYLE_KEYS.forEach((key) => {
        if (component[key] !== undefined) style[key] = component[key];
    });
    return style;
}

function eventPropsFromComponent(component = {}) {
    const props = {};
    ['clickEvent', 'hoverEvent', 'insertion'].forEach((key) => {
        if (component[key] !== undefined) props[key] = component[key];
    });
    return props;
}

function legacyTextToSegments(text, baseComponent = {}) {
    const value = String(text || '');
    const baseStyle = styleFromComponent(baseComponent);
    const eventProps = eventPropsFromComponent(baseComponent);
    let style = { ...baseStyle };
    let buffer = '';
    const segments = [];

    const flush = () => {
        if (!buffer) return;
        segments.push({ ...eventProps, ...style, text: buffer });
        buffer = '';
    };

    for (let index = 0; index < value.length; index += 1) {
        if (value[index] === '\u00a7' && index + 1 < value.length) {
            const code = value[++index].toLowerCase();
            flush();

            if (LEGACY_COLOR_NAMES[code]) {
                style = { color: LEGACY_COLOR_NAMES[code] };
            } else if (LEGACY_FORMAT_CODES[code]) {
                style[LEGACY_FORMAT_CODES[code]] = true;
            } else if (code === 'r') {
                style = { ...baseStyle };
            }
            continue;
        }

        buffer += value[index];
    }

    flush();
    return segments.length > 0 ? segments : [{ ...eventProps, ...style, text: '' }];
}

function legacyComponentToSegments(component) {
    if (typeof component === 'string') return legacyTextToSegments(component);
    if (!component || typeof component !== 'object') return legacyTextToSegments(String(component || ''));

    const text = component.text === undefined ? '' : String(component.text);
    const segments = text.includes('\u00a7')
        ? legacyTextToSegments(text, component)
        : [{ ...eventPropsFromComponent(component), ...styleFromComponent(component), text }];

    if (Array.isArray(component.extra)) {
        component.extra.forEach((child) => {
            segments.push(...legacyComponentToSegments(child));
        });
    }

    return segments;
}

function legacyTextToJsonComponent(text) {
    return { text: '', extra: legacyTextToSegments(text) };
}

function normalizeLegacyJsonComponent(component) {
    if (typeof component === 'string') return legacyTextToJsonComponent(component);
    return { text: '', extra: legacyComponentToSegments(component) };
}

function sendChat(client, message) {
    try {
        const msg = JSON.stringify(applyChatPrefixAccent(normalizeLegacyJsonComponent(message)));
        client.write('chat', { message: msg, position: 0 });
    } catch (e) {
    }
}

// 1.8 renders the action bar from getUnformattedText(), which drops JSON
// colour fields. Legacy strings keep their § codes inline so colours survive.
function sendActionBar(client, message) {
    try {
        const msg = JSON.stringify(typeof message === 'string'
            ? { text: message }
            : normalizeLegacyJsonComponent(message));
        client.write('chat', { message: msg, position: 2 });
    } catch (e) {
    }
}

module.exports = {
    MINECRAFT_COLOR_NAME_TO_CODE,
    MINECRAFT_LEGACY_PALETTE,
    BEDWARS_SIDEBAR_TEAM_COLORS,
    LEGACY_COLOR_NAMES,
    LEGACY_FORMAT_CODES,
    JSON_STYLE_KEYS,
    HYPIXEL_SPECIAL_RANKS,
    HYPIXEL_NICK_CAPABLE_RANKS,
    stripAnsi,
    getHypixelColor,
    extractText,
    extractFormattedText,
    resolveHypixelRank,
    hypixelRankIdFromText,
    isNickCapableRankId,
    displayLooksNickCapable,
    getHypixelRankPrefix,
    getHypixelRankNameColor,
    getHypixelRankLabel,
    getRankedName,
    styleFromComponent,
    eventPropsFromComponent,
    legacyTextToSegments,
    legacyComponentToSegments,
    legacyTextToJsonComponent,
    normalizeLegacyJsonComponent,
    normalizeHexColor,
    closestLegacyChatColor,
    setChatPrefixAccent,
    getChatPrefixAccent,
    featurePrefixRange,
    applyChatPrefixAccent,
    bedwarsEventLabelRanges,
    applyBedwarsEventLabelAccent,
    applyBedwarsSidebarTeamColors,
    getBedwarsSidebarTeamStatus,
    rewriteBedwarsSidebarTeamStatusLine,
    rewriteBedwarsSidebarTeamStatusSuffix,
    sendChat,
    sendActionBar
};
