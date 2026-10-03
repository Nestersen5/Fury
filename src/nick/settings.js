'use strict';

const DEFAULTS = Object.freeze({ rank: 'NONE', skin: 'random', delay: 1500, adaptive: true, ogEnabled: true,
    min: 3, max: 16, digits: 'any', underscores: 'any', prefix: '', suffix: '', contains: '',
    words: Object.freeze([]), wordGroups: Object.freeze([Object.freeze(['fresh', 'head'])]) });
const RANKS = ['NONE', 'VIP', 'VIP_PLUS', 'MVP', 'MVP_PLUS'];

function validate(settings) {
    if (typeof settings.ogEnabled !== 'boolean') throw new Error('OG matching must be on or off.');
    if (settings.adaptive !== true || settings.delay !== DEFAULTS.delay) throw new Error('Nickrolling pacing is automatic and cannot be changed.');
    if (!RANKS.includes(settings.rank)) throw new Error(`Rank: ${RANKS.join(', ')}`);
    if (!/^(random|actual|previous|[A-Z0-9_]{1,64})$/.test(settings.skin)) throw new Error('Skin: random, actual, or previous.');
    if (!Number.isInteger(settings.delay) || settings.delay < 1000 || settings.delay > 30000) throw new Error('Delay must be 1000–30000 milliseconds.');
    if (![settings.min, settings.max].every(n => Number.isInteger(n) && n >= 3 && n <= 16) || settings.min > settings.max) throw new Error('Length must be between 3 and 16, with min <= max.');
    for (const key of ['digits', 'underscores']) if (!['any', 'exclude', 'require'].includes(settings[key])) throw new Error(`${key}: any, exclude, or require.`);
    for (const key of ['prefix', 'suffix', 'contains']) if (!/^[a-zA-Z0-9_]{0,16}$/.test(settings[key])) throw new Error(`${key}: up to 16 letters, digits, or underscores.`);
    const validWord = word => typeof word === 'string' && /^[a-z0-9_]{1,16}$/.test(word);
    if (!Array.isArray(settings.words) || settings.words.length > 64 || !settings.words.every(validWord)) throw new Error('Use up to 64 words, each 1–16 letters, digits, or underscores.');
    if (!Array.isArray(settings.wordGroups) || settings.wordGroups.length > 32 || !settings.wordGroups.every(group => Array.isArray(group) && group.length >= 2 && group.length <= 8 && group.every(validWord))) throw new Error('Use up to 32 groups of 2–8 words each.');
    if (!possible(settings)) throw new Error('These filters cannot match a Minecraft name.');
    return settings;
}

function matches(name, s) {
    const lower = name.toLowerCase();
    return name.length >= s.min && name.length <= s.max
        && (s.digits === 'any' || /[0-9]/.test(name) === (s.digits === 'require'))
        && (s.underscores === 'any' || name.includes('_') === (s.underscores === 'require'))
        && lower.startsWith(s.prefix.toLowerCase()) && lower.endsWith(s.suffix.toLowerCase())
        && lower.includes(s.contains.toLowerCase());
}

// At most 16 lengths/positions; reject contradictory fixed text and required characters.
function possible(s) {
    for (let length = s.min; length <= s.max; length++) {
        for (let position = 0; position <= length - s.contains.length; position++) {
            const chars = Array(length).fill(null);
            let valid = true;
            for (const [text, offset] of [[s.prefix, 0], [s.suffix, length - s.suffix.length], [s.contains, position]]) {
                for (let i = 0; i < text.length; i++) {
                    const index = offset + i, char = text[i].toLowerCase();
                    if (index < 0 || index >= length || (chars[index] !== null && chars[index] !== char)) { valid = false; break; }
                    chars[index] = char;
                }
            }
            if (!valid) continue;
            for (const [key, regex, char] of [['digits', /[0-9]/, '0'], ['underscores', /_/, '_']]) {
                if (s[key] === 'require' && !regex.test(chars.join(''))) {
                    const free = chars.indexOf(null);
                    if (free < 0) { valid = false; break; }
                    chars[free] = char;
                }
            }
            if (valid && matches(chars.map(c => c ?? 'a').join(''), s)) return true;
        }
    }
    return false;
}

function normalizeSettings(value) {
    const next = { ...DEFAULTS };
    if (value && typeof value === 'object') for (const key of Object.keys(next)) if (Object.hasOwn(value, key)) next[key] = value[key];
    next.adaptive = true;
    next.delay = DEFAULTS.delay;
    try { return validate(next); } catch { return { ...DEFAULTS }; }
}

function hasFilters(s) { return s.min !== 3 || s.max !== 16 || s.digits !== 'any' || s.underscores !== 'any' || !!(s.prefix || s.suffix || s.contains); }

function matchReason(name, settings) {
    const lower = name.toLowerCase();
    if (settings.ogEnabled !== false && /([a-zA-Z])\1{2,}/.test(name)) return 'OG: repeated letters';
    const word = settings.words.find(word => lower.includes(word));
    if (word) return `Word: ${word}`;
    const group = settings.wordGroups.find(group => group.every(word => lower.includes(word)));
    if (group) return `Words: ${group.join(' + ')}`;
    if (hasFilters(settings) && matches(name, settings)) return 'Filters matched';
    return null;
}

module.exports = { DEFAULTS, RANKS, validate, matches, normalizeSettings, hasFilters, matchReason };
