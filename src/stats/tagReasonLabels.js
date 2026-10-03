'use strict';

const { stripAnsi } = require('../../features/minecraft_chat');

// Display-only summaries of Urchin's reason, never replacement classifications.
// Order puts playstyle/association first, specific cheats next, queue size last.
const RULES = [
    ['Annoying', /\b(?:annoying|cringe|bow\s*spam(?:ming|mer)?|punch\s*bow\s*abus(?:e|ing)|camp(?:ing|er)|stall(?:ing|er))\b|\bkeep(?:s)?\b[^.!?]{0,60}\bpot(?:ion)?\s*rushing\b/],
    ['Cheat Party', /\b(?:playing|plays|play|queuing|queueing|queued|q'ing|boosting)\s+with\s+(?:(?:a|the|known)\s+)*(?:cheaters?|blatants?)\b/],
    ['Blatant', /\bblatant\b/],
    ['Scaffold', /\b(?:legit\s*scaff(?:old)?|scaffold(?:ing)?|scaff)\b/],
    ['Nuker', /\b(?:nuker|nuke|nuking)\b/],
    ['AB', /\b(?:auto\s*block(?:ing)?|ab(?:ing)?)\b/],
    ['Lag Abuse', /\b(?:lag\s*switch(?:ing)?|lagrang(?:e|ing)|blink(?:ing)?|backtrack(?:ing)?|f3\s*\+\s*s)\b/],
    ['Crossmap', /\bcross\s*map(?:ping)?\b/],
    ['History', /\b(?:ban(?:ned)?\s+from\s+hypixel|(?:blacklisted|blisted)\s+(?:on|by)\s+other\s+apis?)\b/],
    ['Fastmine', /\bfast\s*min(?:e|ing)\b/],
    ['Aim', /\baim\s*assist\b/],
    ['Velocity', /\bvelocity\b/],
    ['Bhop', /\b(?:bhop(?:ping|per)?|hopping)\b/],
    ['Timer', /\btimer\b/],
    ['AutoClutch', /\bauto\s*clutch(?:ing)?\b/],
    ...[2, 3, 4, 8].map(size => [`${size}Q`, new RegExp(`\\b${size}q\\b`)])
];

const NEGATED = /\b(?:no|not|never|without|didn't|didnt|doesn't|doesnt|don't|dont|isn't|isnt|wasn't|wasnt|denies|denied)\b/;
const UNCERTAIN = /\b(?:maybe|possibly|probably|prob|likely|suspected|unsure|might|could|idk)\b|\bnot sure\b/;
const OTHER_SUBJECT = /\b(?:against|versus|vs|(?:his|her|their|my|our)\s+(?:teammate|tm8|opponent))\b/;

function tagReasonLabels(reports = [], classification = '') {
    const found = new Map();
    for (const report of reports) {
        if (String(report?.source || '').toLowerCase() !== 'urchin' || report.title === 'Urchin API Status') continue;
        const reason = stripAnsi(report.reasons).toLowerCase().replace(/[’‘]/g, "'");
        if (!reason || /^no (?:reason|specific|detailed)\b/.test(reason)) continue;

        // Avoid treating quoted chat and references to opponents as the report's
        // accusation. Clause boundaries keep "scaffold (didnt nuke)" independent.
        const clauses = reason.replace(/"[^"]*"/g, '').split(/[\n,;.!()]+|(?<=\?)|\bbut\b/);
        for (const clause of clauses) {
            if (/\[(?:shout|chat|party)\]|[<>]/.test(clause)) continue;
            const assertion = clause.replace(/\bnot sure\b/g, 'unsure');
            for (const [label, pattern] of RULES) {
                const match = assertion.match(pattern);
                if (!match) continue;
                const before = assertion.slice(0, match.index);
                const after = assertion.slice(match.index + match[0].length);
                const subject = before.replace(/\b(?:he|she|this (?:guy|player))\s+and\s+(?:his|her|their)\s+(?:tm8|teammate)\b/g, 'the player');
                if (NEGATED.test(before) || OTHER_SUBJECT.test(subject)) continue;
                if (/^\s+(?:(?:was |is )?not (?:detected|seen|confirmed)|denied)\b/.test(after)) continue;
                // "Playing with a blatant cheater" describes the party, not
                // the player's own cheats.
                if (label !== 'Cheat Party' && /\bwith\s+(?:(?:a|the|known)\s+)*$/.test(before)) continue;
                const uncertain = UNCERTAIN.test(before) || /^\s*\?/.test(after)
                    || /^\s+(?:maybe|possibly|probably|unsure|idk)\b/.test(after);
                // A later direct report can strengthen an uncertain mention.
                found.set(label, found.get(label) === false ? false : uncertain);
            }
        }
    }

    const base = classification.toLowerCase().replace(/\s+report$/, '');
    return RULES.map(([label]) => label)
        .filter(label => found.has(label) && label.toLowerCase() !== base)
        .slice(0, 2)
        .map(label => label + (found.get(label) ? '?' : ''));
}

module.exports = { tagReasonLabels };
