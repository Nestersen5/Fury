'use strict';

const { nametagTagCategory, stripNametagIconGlyphs } = require('../overlay/nametags');
const { LEGACY_COLOR_NAMES } = require('../../features/minecraft_chat');
const details = new Map();
const clean = value => stripNametagIconGlyphs(String(value || '')).replace(/§[0-9a-fk-or]/gi, '').trim();
const styles = {
    blatant_cheater: ['Blatant', 'c', 0], confirmed_cheater: ['C.Cheater', 'c', 1],
    closet_cheater: ['Closet', 'c', 2], blacklisted: ['Blacklisted', 'c', 3],
    sniper: ['Sniper', 'd', 4], caution: ['Caution', '6', 5],
    replays: ['Replays', 'e', 6], legit_sniper: ['Legit Sniper', 'a', 7], account: ['Account', 'b', 8]
};

function groupTags(tags = []) {
    const groups = new Map();
    for (const tag of tags || []) {
        if (!tag || tag.title === 'Urchin API Status') continue;
        const source = String(tag.source || '').toLowerCase();
        if (!['urchin', 'seraph'].includes(source)) continue;
        const raw = clean(tag.value).replace(/^\[|\]$/g, '');
        const category = nametagTagCategory(tag.value) || (/^replays?(?: needed)?$/i.test(raw) ? 'replays' : '');
        const [label, color, order] = styles[category] || [raw, 'e', 6];
        if (!label) continue;
        const key = category || label.toLowerCase();
        if (!groups.has(key)) groups.set(key, { label, color, order, reports: [] });
        const group = groups.get(key);
        const report = { ...tag, source: source === 'urchin' ? 'Urchin' : 'Seraph' };
        if (!group.reports.some(existing => JSON.stringify(existing) === JSON.stringify(report))) group.reports.push(report);
    }
    // Urchin takes priority over Seraph: groups backed by an Urchin report
    // come first (so the lead chat badge is Urchin's), then category order.
    const isUrchin = report => report.source === 'Urchin';
    const hasUrchin = group => group.reports.some(isUrchin);
    for (const group of groups.values()) group.reports.sort((a, b) => isUrchin(b) - isUrchin(a));
    return [...groups.values()].sort((a, b) => (hasUrchin(b) - hasUrchin(a)) || (a.order - b.order));
}

function reportHover(tag) {
    const lines = [`§b§l${tag.source}§r`, `§7Classification: §f${clean(tag.value)}`];
    const reason = clean(tag.reasons);
    if (reason && !/^no (?:specific |detailed )?(?:cheats|details|tooltip)/i.test(reason)) lines.push(`§7Reason: §f${reason}`);
    if (clean(tag.addedBy) && clean(tag.addedBy) !== 'Unknown') lines.push(`§7Added by: §f${clean(tag.addedBy)}`);
    if (clean(tag.when) && !['Unknown', 'Tags unknown'].includes(clean(tag.when))) lines.push(`§7Date: §f${clean(tag.when)}`);
    return lines.join('\n');
}

function groupHover(group) {
    return `§b§l${group.label}§r\n\n${group.reports.map(reportHover).join('\n\n')}`;
}

function buildTagComponents(tags, { clickName = '' } = {}) {
    const groups = groupTags(tags);
    if (!groups.length) return [];
    const validName = /^[A-Za-z0-9_]{3,16}$/.test(clickName);
    if (validName) {
        const key = clickName.toLowerCase();
        details.delete(key);
        details.set(key, groups);
        if (details.size > 512) details.delete(details.keys().next().value);
    }
    const badge = (label, color, hover, command) => ({
        text: `[${label}]`, color: LEGACY_COLOR_NAMES[color],
        hoverEvent: { action: 'show_text', value: hover + (validName ? `\n\n§7Click: §f${command}` : '') },
        ...(validName ? { clickEvent: { action: 'run_command', value: command } } : {})
    });
    const first = groups[0];
    const sources = new Set(first.reports.map(report => report.source));
    const command = sources.size > 1 ? `/tagdetails ${clickName}` : `/${first.reports[0].source.toLowerCase()} ${clickName}`;
    const result = [badge(first.label, first.color, groupHover(first), command)];
    if (groups.length > 1) result.push(badge(`+${groups.length - 1}`, '7', groups.slice(1).map(groupHover).join('\n\n'), `/tagdetails ${clickName}`));
    return result;
}

// Tab-list text cannot expose mouse hover/click events in vanilla 1.8. Show
// every classification there so a collapsed counter doesn't hide information.
function formatTagBadges(tags) {
    return groupTags(tags).map(group => `§${group.color}[${group.label}]`).join(' ');
}

// Tab list colours badges by source instead of category: Urchin pink, Seraph
// dark aqua. When a player has any Urchin report, Seraph-only tags are hidden.
const TAB_SOURCE_COLORS = { Urchin: 'd', Seraph: '3' };
function formatTabTags(tags) {
    const groups = groupTags(tags);
    const hasSource = source => group => group.reports.some(report => report.source === source);
    const source = groups.some(hasSource('Urchin')) ? 'Urchin' : 'Seraph';
    return groups.filter(hasSource(source)).map(group => `§${TAB_SOURCE_COLORS[source]}[${group.label}]`).join(' ');
}

function tagDetailLines(name, tags = null, { source = '' } = {}) {
    const groups = tags ? groupTags(tags) : details.get(String(name).toLowerCase());
    if (!groups) return [{ text: '§7Tag details expired. Run §f/stats §7again to refresh them.' }];
    const lines = [{ text: `§b§l${source || 'Tags'} §7» §f${name}` }];
    if (!groups.length) lines.push({ text: '  §7No report tags found.' });
    let reportCount = 0;
    for (const group of groups) {
        for (const report of group.reports) {
            if (reportCount++) lines.push({ text: ' ' });
            lines.push({ text: `  §b${group.label}${source ? '' : ` §7| §f${report.source}`}` });
            // Each report is a compact block: classification, reason, then
            // attribution. No nested headings or repeated classification.
            const fields = reportHover(report).split('\n').slice(2);
            const reason = fields.find(field => field.startsWith('§7Reason:'));
            if (reason) lines.push({ text: `  ${reason}` });
            const metadata = fields.filter(field => !field.startsWith('§7Reason:'));
            if (metadata.length) lines.push({ text: `  ${metadata.join(' §7| ')}` });
        }
    }
    if (!source && groups.length) lines.push({ text: '', extra: [...new Set(groups.flatMap(group => group.reports.map(report => report.source)))].map(source => ({
        text: ` [${source}]`, color: 'aqua',
        clickEvent: { action: 'run_command', value: `/${source.toLowerCase()} ${name}` },
        hoverEvent: { action: 'show_text', value: `§7Open full §f${source} §7report` }
    })) });
    return lines;
}

module.exports = { groupTags, reportHover, buildTagComponents, formatTagBadges, formatTabTags, tagDetailLines };
