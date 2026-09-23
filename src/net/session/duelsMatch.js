'use strict';

// Pure helpers for the Duels scan: turning what Hypixel shows on the
// sidebar / in game-start chat into (a) the DUELS_MODE_DEFS entry we are
// playing and (b) the list of opponent IGNs to look up.
//
// Kept dependency-free so it is unit-testable in isolation (test_duels_scan.js).
// The host (proxy.js) owns DUELS_MODE_DEFS and passes it in — this module
// never imports it, so the two can't drift apart in surprising ways.

function stripFmt(value) {
    // Strip Minecraft §-color codes (§ is U+00A7) plus any stray control bytes.
    return String(value || '').replace(/§./g, '');
}

// Collapse a "Mode:" display name to lowercase words: "Classic Duel" ->
// "classic duel", "No Debuff" -> "no debuff". Non-alphanumerics become spaces
// but digit/letter runs like "3v3" survive intact.
function normalizeDuelsModeName(value) {
    return stripFmt(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// Exact in-game sidebar/chat "Mode:" names -> DUELS_MODE_DEFS id. This is the
// primary path; the heuristic below is only a fallback for names not listed
// here (or new modes Hypixel adds later).
const SCOREBOARD_NAME_TO_ID = {
    'classic duel': 'classic_1v1',
    'classic doubles': 'classic_2v2',
    'bridge duel': 'bridge_1v1',
    'bridge doubles': 'bridge_2v2',
    'bridge 3v3': 'bridge_3v3',
    'bridge 3v3v3v3': 'bridge_3v3',
    'bridge 4v4': 'bridge_4v4',
    'bridge 2v2v2v2': 'bridge_2v2',
    'skywars duel': 'skywars_1v1',
    'skywars doubles': 'skywars_2v2',
    'sky wars duel': 'skywars_1v1',
    'sky wars doubles': 'skywars_2v2',
    'uhc duel': 'uhc_1v1',
    'uhc doubles': 'uhc_2v2',
    'uhc fours': 'uhc_4v4',
    'uhc 4v4': 'uhc_4v4',
    'uhc deathmatch': 'uhc_ffa',
    'uhc meetup': 'uhc_ffa',
    'sumo duel': 'sumo_1v1',
    'nodebuff duel': 'nodebuff_1v1',
    'no debuff duel': 'nodebuff_1v1',
    'boxing duel': 'boxing_1v1',
    'combo duel': 'combo_1v1',
    'classic combo duel': 'combo_1v1',
    'blitz duel': 'blitz_1v1',
    'blitz sg duel': 'blitz_1v1',
    'op duel': 'op_1v1',
    'op doubles': 'op_2v2',
    'spleef duel': 'spleef_duel',
    'bow spleef duel': 'bow_spleef_duel',
    'quake duel': 'quake_1v1',
    'quakecraft duel': 'quake_1v1',
    'parkour duel': 'parkour_ffa',
    'parkour': 'parkour_ffa',
    'mega walls duel': 'mega_walls_1v1',
    'megawalls duel': 'mega_walls_1v1',
    'bow duel': 'bow_1v1',
    'bed wars duel': 'bedwars_duel',
    'bedwars duel': 'bedwars_duel',
    'bed wars rush duel': 'bed_rush_duel',
    'bedwars rush duel': 'bed_rush_duel'
};

// Family keyword -> DUELS_MODE_DEFS `family` label. Used by the heuristic
// fallback when the exact name isn't in SCOREBOARD_NAME_TO_ID.
const FAMILY_KEYWORDS = [
    { keys: ['bed wars rush', 'bedwars rush', 'bed rush'], family: 'BedWars', forceId: 'bed_rush_duel' },
    { keys: ['bed wars', 'bedwars'], family: 'BedWars' },
    { keys: ['bridge'], family: 'The Bridge' },
    { keys: ['sky wars', 'skywars'], family: 'SkyWars' },
    { keys: ['uhc'], family: 'UHC' },
    { keys: ['classic'], family: 'Classic' },
    { keys: ['sumo'], family: 'Sumo' },
    { keys: ['no debuff', 'nodebuff', 'potion'], family: 'NoDebuff' },
    { keys: ['boxing'], family: 'Boxing' },
    { keys: ['combo'], family: 'Combo' },
    { keys: ['blitz'], family: 'Blitz' },
    { keys: ['op'], family: 'OP' },
    { keys: ['bow spleef', 'bowspleef'], family: 'Spleef', forceId: 'bow_spleef_duel' },
    { keys: ['spleef'], family: 'Spleef' },
    { keys: ['quakecraft', 'quake'], family: 'Quakecraft' },
    { keys: ['parkour'], family: 'Parkour' },
    { keys: ['mega walls', 'megawalls'], family: 'Mega Walls' },
    { keys: ['bow'], family: 'Bow' }
];

// Which variation a name describes, mapped to the token that appears in a
// mode def's short/prefix so we can disambiguate 1v1 vs 2v2 vs 4v4 etc.
function detectVariation(normalized) {
    if (/\bdoubles\b|\b2v2\b|\b2s\b/.test(normalized)) return 'doubles';
    if (/\bthrees\b|\b3v3\b|\b3s\b/.test(normalized)) return 'threes';
    if (/\bfours\b|\b4v4\b|\b4s\b/.test(normalized)) return 'four';
    if (/\bdeathmatch\b|\bmeetup\b|\bffa\b|\b8\b/.test(normalized)) return 'ffa';
    return 'duel';
}

function findDefById(defs, id) {
    return defs.find(def => def.id === id) || null;
}

// Resolve a sidebar/chat mode name to a DUELS_MODE_DEFS entry. Returns null if
// the family can't be recognized at all (caller should fall back to Overall).
function matchDuelsMode(modeName, defs = []) {
    const normalized = normalizeDuelsModeName(modeName);
    if (!normalized) return null;

    const directId = SCOREBOARD_NAME_TO_ID[normalized];
    if (directId) {
        const direct = findDefById(defs, directId);
        if (direct) return direct;
    }

    const family = FAMILY_KEYWORDS.find(entry => entry.keys.some(key => normalized.includes(key)));
    if (!family) return null;
    if (family.forceId) {
        const forced = findDefById(defs, family.forceId);
        if (forced) return forced;
    }

    const familyDefs = defs.filter(def => def.family === family.family);
    if (familyDefs.length === 0) return null;
    if (familyDefs.length === 1) return familyDefs[0];

    const variation = detectVariation(normalized);
    const variationToken = {
        doubles: 'doubles',
        threes: 'threes',
        four: 'four',
        ffa: 'meetup',
        duel: 'duel'
    }[variation];

    const byVariation = familyDefs.find(def => (def.prefix || '').includes(variationToken)
        || (def.short || '').includes(variation)
        || (def.id || '').includes(variation));
    return byVariation || familyDefs[0];
}

const STAT_WORD_STOPLIST = new Set([
    'opponent', 'opponents', 'mode', 'time', 'left', 'winstreak', 'overall',
    'duels', 'www', 'hypixel', 'net', 'you', 'vs', 'duel', 'doubles'
]);

function looksLikeIgn(token) {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(token)) return false;
    if (!/[A-Za-z_]/.test(token)) return false; // exclude pure numbers (health, etc.)
    if (STAT_WORD_STOPLIST.has(token.toLowerCase())) return false;
    return true;
}

// Pull opponent IGNs out of a single labeled line, e.g.
//   "Opponents: [VIP] dog0223_TW, jeremy0714" -> ['dog0223_TW', 'jeremy0714']
//   "Opponent: elpabloGG"                     -> ['elpabloGG']
// Rank prefixes like "[VIP]" and level tags are stripped; comma-separated.
function parseOpponentsFromLabeledLine(line) {
    const clean = stripFmt(line).trim();
    const match = clean.match(/opponents?\s*:\s*(.+)$/i);
    if (!match) return [];
    return splitOpponentNames(match[1]);
}

function splitOpponentNames(rest) {
    const out = [];
    const seen = new Set();
    String(rest || '')
        .split(/[,]+/)
        .forEach(part => {
            const withoutRank = part.replace(/\[[^\]]*\]/g, ' ');
            const tokens = withoutRank.split(/[^A-Za-z0-9_]+/).filter(Boolean);
            // Prefer the last IGN-looking token (rank/level sit before the name).
            for (let i = tokens.length - 1; i >= 0; i--) {
                if (looksLikeIgn(tokens[i])) {
                    const key = tokens[i].toLowerCase();
                    if (!seen.has(key)) {
                        seen.add(key);
                        out.push(tokens[i]);
                    }
                    break;
                }
            }
        });
    return out;
}

// Reconstruct { modeName, opponents } from the ordered sidebar line list.
// Opponents may be inline ("Opponent: X") or listed on the lines that follow
// an "Opponent(s):" label (each like "↝ elpabloGG 20♥").
function extractDuelsInfoFromScoreboard(lines = []) {
    const cleaned = lines.map(line => stripFmt(line).trim());
    let modeName = '';
    const opponents = [];
    const seen = new Set();
    const pushOpp = (name) => {
        const key = name.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            opponents.push(name);
        }
    };

    for (let i = 0; i < cleaned.length; i++) {
        const line = cleaned[i];
        if (!line) continue;

        const modeMatch = line.match(/^mode\s*:\s*(.+)$/i);
        if (modeMatch) {
            modeName = modeMatch[1].trim();
            continue;
        }

        const oppLabel = line.match(/^opponents?\s*:\s*(.*)$/i);
        if (oppLabel) {
            // Inline names on the label line.
            splitOpponentNames(oppLabel[1]).forEach(pushOpp);
            // Plus any names on the immediately following non-label lines.
            for (let j = i + 1; j < cleaned.length; j++) {
                const next = cleaned[j];
                if (!next) break;
                if (/^(mode|time left|overall winstreak|mode winstreak|opponents?)\s*:/i.test(next)) break;
                if (/hypixel\.net/i.test(next)) break;
                const tokens = next.replace(/\[[^\]]*\]/g, ' ').split(/[^A-Za-z0-9_]+/).filter(Boolean);
                let matched = false;
                for (let k = tokens.length - 1; k >= 0; k--) {
                    if (looksLikeIgn(tokens[k])) { pushOpp(tokens[k]); matched = true; break; }
                }
                if (!matched) break; // stop at first line with no IGN
            }
        }
    }

    return { modeName, opponents };
}

// True when the sidebar clearly belongs to a Duels game (title "DUELS" plus a
// labeled Mode/Opponent line — the lobby sidebar has neither).
function isDuelsScoreboard(title = '', lines = []) {
    const compactTitle = stripFmt(title).toUpperCase().replace(/[^A-Z]/g, '');
    if (!compactTitle.includes('DUELS')) return false;
    return lines.some(line => /^(mode|opponents?)\s*:/i.test(stripFmt(line).trim()));
}

module.exports = {
    stripFmt,
    normalizeDuelsModeName,
    matchDuelsMode,
    parseOpponentsFromLabeledLine,
    splitOpponentNames,
    extractDuelsInfoFromScoreboard,
    isDuelsScoreboard,
    looksLikeIgn,
    SCOREBOARD_NAME_TO_ID
};
