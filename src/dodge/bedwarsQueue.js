'use strict';

const MC_FORMAT_RE = /(?:\u00C2?\u00A7|\\u00a7|\\u00A7)[0-9A-FK-OR]/gi;
const DEFAULT_REQUEUE_COMMAND = '/rq';
const MODE_REQUEUE_COMMANDS = Object.freeze([
    { label: 'Solos', command: '/play bedwars_eight_one', aliases: ['solo', 'solos', '1s', '1v1'], teamSize: 1 },
    { label: 'Doubles', command: '/play bedwars_eight_two', aliases: ['double', 'doubles', '2s', '2v2'], teamSize: 2 },
    { label: 'Threes', command: '/play bedwars_four_three', aliases: ['three', 'threes', '3s', '3v3v3v3'], teamSize: 3 },
    { label: 'Fours', command: '/play bedwars_four_four', aliases: ['four', 'fours', '4s', '4v4v4v4'], teamSize: 4 },
    { label: '4v4', command: '/play bedwars_two_four', aliases: ['4v4'], teamSize: 4 }
]);

// Hypixel's sidebar entries are emoji placed between a team's prefix and
// suffix, so a reconstructed "09/16/26 L32A" arrives as "09/16/26 L3🔮2A".
const SIDEBAR_ENTRY_RE = /[\u{10000}-\u{10FFFF}]/gu;

function cleanScoreboardText(text = '') {
    return String(text || '')
        .replace(SIDEBAR_ENTRY_RE, '')
        .replace(MC_FORMAT_RE, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizePregameLobbyId(value = '') {
    const clean = String(value || '').trim();
    if (!/^[A-Za-z0-9]{2,16}$/.test(clean)) return null;
    if (!/[A-Za-z]/.test(clean) || !/\d/.test(clean)) return null;
    return clean;
}

function pregameLobbyIdForScoreboard(scoreboardText = '') {
    const clean = cleanScoreboardText(scoreboardText);
    const dated = clean.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\s+([A-Za-z0-9]{2,16})\b/);
    const datedId = normalizePregameLobbyId(dated?.[1]);
    if (datedId) return datedId;

    const labeled = clean.match(/\b(?:server|srv|id)\s*:?\s*([A-Za-z0-9]{2,16})\b/i);
    return normalizePregameLobbyId(labeled?.[1]);
}

function requeueCommandForScoreboard(scoreboardText = '') {
    const clean = cleanScoreboardText(scoreboardText);
    // "4v4v4v4" must stay before "4v4" in the alternation so Fours wins the match.
    const match = clean.match(/\bMode\s*:?\s*(solo|solos|1s|1v1|double|doubles|2s|2v2|three|threes|3s|3v3v3v3|four|fours|4s|4v4v4v4|4v4)\b/i);
    if (!match) return { label: 'Unknown', command: DEFAULT_REQUEUE_COMMAND, fallback: true, teamSize: null };
    const token = match[1].toLowerCase();
    const mode = MODE_REQUEUE_COMMANDS.find(entry => entry.aliases.includes(token));
    return mode
        ? { label: mode.label, command: mode.command, fallback: false, teamSize: mode.teamSize }
        : { label: 'Unknown', command: DEFAULT_REQUEUE_COMMAND, fallback: true, teamSize: null };
}

module.exports = { pregameLobbyIdForScoreboard, requeueCommandForScoreboard };
