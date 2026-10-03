'use strict';

// Reuse the shipped Hypixel preview captures. Exact templates also cover
// messages without "by" and Lucid's "by a half-awake <player>" wording.
const seeds = require('../../assets/kill-message-patterns.json');
const TEAM = '(Your|Red|Blue|Green|Yellow|Aqua|White|Pink|Gr[ae]y)';
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = [...new Set([
    'Green Bed was destroyed by ExampleKiller!',
    ...seeds.flatMap(pattern => pattern.lines.filter(line => /^Green Bed\b/.test(line)))
])].map(template => {
    const body = template.replace(/^Green Bed /, '').replace(/[!.]$/, '');
    const pattern = body.split(/(ExampleKiller|#1)/).map(part => part === 'ExampleKiller'
        ? '(?<breaker>[A-Za-z0-9_]{2,16})' : part === '#1' ? '#(?<beds>[\\d,]+)' : escape(part)).join('');
    return new RegExp(`^(?:BED DESTRUCTION\\s*>\\s*)?${TEAM} Bed ${pattern}[!.]?$`, 'i');
});

function parseBedDestroyChat(text) {
    const clean = String(text || '').replace(/(?:\u00c2)?\u00a7[0-9a-fk-or]/gi, '').replace(/\s+/g, ' ').trim();
    if (!/^(?:BED DESTRUCTION\s*>\s*)?(?:Your|Red|Blue|Green|Yellow|Aqua|White|Pink|Gr[ae]y) Bed\b/i.test(clean)) return null;
    for (const template of templates) {
        const match = clean.match(template);
        if (match) return {
            type: 'beddestroy', team: match[1], breaker: match.groups.breaker,
            beds: match.groups.beds ? Number(match.groups.beds.replace(/,/g, '')) || null : null,
            text: clean
        };
    }
    return null;
}

module.exports = { parseBedDestroyChat };
