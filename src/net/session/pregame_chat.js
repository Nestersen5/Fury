function stripMinecraftFormatting(value = '') {
    return String(value)
        .replace(/\u00c2?\u00a7[0-9A-FK-OR]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Hypixel system lines (e.g. "Party Leader: ...") that look like "Name: text".
const BEDWARS_PREGAME_IGNORED_SENDERS = new Set([
    'reminder',
    'reminders',
    'leader',
    'leaders',
    'moderator',
    'moderators',
    'member',
    'members'
]);

function isBedwarsPregameIgnoredSender(value = '') {
    return BEDWARS_PREGAME_IGNORED_SENDERS.has(String(value || '').trim().toLowerCase());
}

function isBedwarsPregameScoreboard(value = '') {
    const clean = stripMinecraftFormatting(value).toUpperCase();
    const compact = clean.replace(/[^A-Z0-9/]/g, '');
    if (!compact.includes('BEDWARS')) return false;
    if (compact.includes('SLUMBERTICKETS') || compact.includes('LEVELPROGRESS')) return false;

    const hasPregameDetails = /\bMAP\s*:/.test(clean)
        && /\bMODE\s*:/.test(clean)
        && /\bPLAYERS\s*:\s*\d+\s*\/\s*\d+/.test(clean);
    const hasCountdown = compact.includes('STARTINGIN') || compact.includes('WAITING');
    return hasPregameDetails && hasCountdown;
}

function parseBedwarsPregameMap(value = '') {
    const lines = Array.isArray(value)
        ? value.map(line => stripMinecraftFormatting(line)).filter(Boolean)
        : [];
    const clean = lines.length
        ? lines.join(' ')
        : stripMinecraftFormatting(value);
    if (!isBedwarsPregameScoreboard(clean)) return null;

    // Prefer the reconstructed scoreboard line. Score packets are not required
    // to arrive in visual order, so parsing only the flattened sidebar can make
    // a multi-word map absorb an unrelated date/server line.
    const mapLine = lines
        .map(line => line.match(/^Map\s*:\s*(.+?)\s*$/i)?.[1] || '')
        .find(Boolean);

    const match = mapLine ? null : clean.match(
        /\bMap\s*:\s*(.+?)(?=\s+(?:Players|Mode|Starting\s+in|Waiting|Version)\b\s*:|\s+Starting\s+in\b|\s+Waiting\b|$)/i
    );
    const map = String(mapLine || match?.[1] || '').replace(/\s+/g, ' ').trim();
    return map && map.length <= 80 ? map : null;
}

function detectLobbyModeScoreboard(value = '') {
    const clean = stripMinecraftFormatting(value).toUpperCase();
    const compact = clean.replace(/[^A-Z]/g, '');
    if (compact.includes('SOLOKILLS') && compact.includes('SOLOWINS') && compact.includes('SOULS')) {
        return 'SKYWARS';
    }
    if (compact.includes('SLUMBERTICKETS')
        || (compact.includes('LEVEL') && compact.includes('PROGRESS'))) {
        return 'BEDWARS';
    }
    return null;
}

function reconstructScoreboardLine(entry = '', team = null) {
    if (!team) return String(entry || '');
    return `${team.prefix || ''}${entry || ''}${team.suffix || ''}`;
}

function parseBedwarsPregameChat(value = '') {
    const clean = stripMinecraftFormatting(value);
    if (!clean || /^From\s+/i.test(clean)) return null;

    const colonIndex = clean.indexOf(':');
    if (colonIndex <= 0) return null;

    const left = clean.slice(0, colonIndex).trim();
    const message = clean.slice(colonIndex + 1).trim();
    if (!message || /^(Party|Guild|Officer|Team|To|Co-?op)\b/i.test(left)) return null;

    const senderMatch = left.match(/(?:\[[^\]]+\]\s*)*([A-Za-z0-9_]{3,16})$/);
    const sender = senderMatch?.[1] || '';
    if (!/^[A-Za-z0-9_]{3,16}$/.test(sender) || isBedwarsPregameIgnoredSender(sender)) return null;
    return { sender, message };
}

module.exports = {
    detectLobbyModeScoreboard,
    isBedwarsPregameScoreboard,
    parseBedwarsPregameMap,
    reconstructScoreboardLine,
    parseBedwarsPregameChat,
    isBedwarsPregameIgnoredSender,
    BEDWARS_PREGAME_IGNORED_SENDERS,
    stripMinecraftFormatting
};
