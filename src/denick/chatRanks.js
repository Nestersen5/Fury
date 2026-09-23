'use strict';

const { legacyTextToSegments, styleFromComponent, eventPropsFromComponent } = require('../../features/minecraft_chat');

// Work on visible runs, so a rank split into bracket/plus/name components is
// still one match. Keep events and translation arguments in their own trees.
function rewriteChatRanks(message, resolveRankedName) {
    const groups = [[]];
    const defaults = { color: 'white', bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false };
    function visit(component, inherited = defaults, group = groups[0]) {
        if (Array.isArray(component)) return component.map(child => visit(child, inherited, group));
        if (typeof component === 'string') component = { text: component };
        if (!component || typeof component !== 'object') return component;
        const base = { ...inherited, ...styleFromComponent(component), ...eventPropsFromComponent(component) };
        const value = { ...component };
        const parts = typeof component.text === 'string'
            ? legacyTextToSegments(component.text, base).map(segment => ({ ...defaults, ...segment })) : [];
        if (parts.length) {
            value.text = '';
            group.push(...parts);
        }
        if (component.with) {
            // Translation arguments are not necessarily adjacent on screen.
            value.with = component.with.map(arg => {
                const argument = [];
                groups.push(argument);
                return visit(arg, base, argument);
            });
        }
        if (component.translate) {
            group = [];
            groups.push(group);
        }
        const children = Array.isArray(component.extra) ? component.extra.map(child => visit(child, base, group)) : [];
        if (parts.length || children.length) value.extra = [...parts, ...children];
        return value;
    }
    const value = visit(message);
    let changed = false;
    for (const segments of groups) {
        const text = segments.map(segment => segment.text).join('');
        const matches = [...text.matchAll(/(?<![A-Za-z0-9_])(?:\[(?:VIP|MVP)\+{0,2}\][ \t]+)?([A-Za-z0-9_]{3,16})(?![A-Za-z0-9_])/g)];
        // Reverse order keeps original offsets valid while editing each run.
        for (const match of matches.reverse()) {
            const hasRank = match[0].startsWith('[');
            if (!hasRank && !/^\s*[:>]/.test(text.slice(match.index + match[0].length))) continue;
            const ranked = resolveRankedName(match[1]);
            if (!ranked) continue;
            const start = match.index;
            const end = start + match[0].length;
            // Hypixel greys the whole line for unranked players ("Nick: msg"),
            // while ranked players' messages are white. When a real rank
            // replaces an unranked nick, whiten the grey message body too.
            const whitenBody = !hasRank
                && /^\s*:/.test(text.slice(end))
                && /^\[/.test(ranked.replace(/§./g, '').trimStart());
            const whiten = run => {
                if (!run || typeof run !== 'object') return;
                if (run.color === 'gray') run.color = 'white';
                (run.extra || []).forEach(whiten);
            };
            let offset = 0;
            for (const segment of segments) {
                const original = segment.text;
                const next = offset + original.length;
                if (offset < end && next > start) {
                    const from = Math.max(0, start - offset);
                    const to = Math.min(original.length, end - offset);
                    // Insert at the name, retaining its click/hover actions.
                    const nameStart = end - match[1].length;
                    const insert = offset <= nameStart && next > nameStart;
                    const replacement = insert ? legacyTextToSegments(ranked, defaults).map(part => ({ ...defaults, ...part })) : [];
                    segment.text = original.slice(0, from);
                    const tail = { ...defaults, ...styleFromComponent(segment), text: original.slice(to) };
                    if (whitenBody) {
                        whiten(tail);
                        (segment.extra || []).forEach(whiten);
                    }
                    segment.extra = [...replacement, tail, ...(segment.extra || [])];
                } else if (whitenBody && offset >= end) {
                    whiten(segment);
                }
                offset = next;
            }
            changed = true;
        }
    }
    return changed ? value : message;
}

module.exports = { rewriteChatRanks };
