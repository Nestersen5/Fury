'use strict';

const { nametagTagCategory, stripNametagIconGlyphs, formatNametagTagValue } = require('../overlay/nametags');
const { LEGACY_COLOR_NAMES } = require('../../features/minecraft_chat');
const { tagReasonLabels } = require('./tagReasonLabels');
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
        if (source !== 'urchin') continue;
        const raw = clean(tag.value).replace(/^\[|\]$/g, '');
        const category = nametagTagCategory(tag.value) || (/^replays?(?: needed)?$/i.test(raw) ? 'replays' : '');
        const [label, color, order] = styles[category] || [raw, 'e', 6];
        if (!label) continue;
        const key = category || label.toLowerCase();
        if (!groups.has(key)) groups.set(key, { label, color, order, reports: [] });
        const group = groups.get(key);
        const report = { ...tag, source: 'Urchin' };
        if (!group.reports.some(existing => JSON.stringify(existing) === JSON.stringify(report))) group.reports.push(report);
    }

    return [...groups.values()].sort((a, b) => a.order - b.order);
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

function chatGroupLabel(group) {
    return [group.label, ...tagReasonLabels(group.reports, group.label)].join(' · ');
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
    const command = `/urchin ${clickName}`;
    const result = [badge(chatGroupLabel(first), first.color, groupHover(first), command)];
    if (groups.length > 1) result.push(badge(`+${groups.length - 1}`, '7', groups.slice(1).map(groupHover).join('\n\n'), `/tagdetails ${clickName}`));
    return result;
}

// Tab-list text cannot expose mouse hover/click events in vanilla 1.8. Show
// every classification there so a collapsed counter doesn't hide information.
function formatTagBadges(tags) {
    return groupTags(tags).map(group => `§${group.color}[${chatGroupLabel(group)}]`).join(' ');
}

// Tab badges retain Urchin's provider color.
function formatTabTags(tags) {
    return groupTags(tags).map(group => `§d[${group.label}]`).join(' ');
}

function tagDetailLines(name, tags = null, { source = '' } = {}) {
    const groups = tags ? groupTags(tags) : details.get(String(name).toLowerCase());
    if (!groups) return [{ text: '§7Tag details expired. Run §f/stats §7again to refresh them.' }];
    const total = groups.reduce((count, group) => count + group.reports.length, 0);
    const lines = [{ text: `§d§l${source || 'Tags'} §8» §f§l${name} §8· §7${total} report${total === 1 ? '' : 's'}` }];
    if (total) lines.push({ text: '§8§m--------------------------------' });
    if (!groups.length) lines.push({ text: '  §7No report tags found.' });
    let reportCount = 0;
    for (const group of groups) {
        for (const report of group.reports) {
            if (reportCount++) lines.push({ text: ' ' });
            const fullLabel = clean(formatNametagTagValue(report.value, { tagDisplayMode: 'full' }));
            const label = [fullLabel || group.label, ...tagReasonLabels([report], group.label)].join(' · ');
            lines.push({ text: `  §${group.color}§l${label}${source ? '' : ` §8· §7${report.source}`}` });
            // Each report is a compact block: classification, reason, then
            // attribution. No nested headings or repeated classification.
            const fields = reportHover(report).split('\n').slice(2);
            const reason = fields.find(field => field.startsWith('§7Reason:'));
            if (reason) lines.push({ text: `    ${reason}` });
            const metadata = fields.filter(field => !field.startsWith('§7Reason:'))
                .map(field => field.replace(/§f/g, '§7').replace('§7Date: ', ''));
            if (metadata.length) lines.push({ text: `    ${metadata.join(' §8· ')}` });
        }
    }
    if (total) lines.push({ text: '§8§m--------------------------------' });
    if (!source && groups.length) lines.push({ text: '', extra: [...new Set(groups.flatMap(group => group.reports.map(report => report.source)))].map(source => ({
        text: ` [${source}]`, color: 'aqua',
        clickEvent: { action: 'run_command', value: `/${source.toLowerCase()} ${name}` },
        hoverEvent: { action: 'show_text', value: `§7Open full §f${source} §7report` }
    })) });
    return lines;
}

module.exports = { groupTags, reportHover, buildTagComponents, formatTagBadges, formatTabTags, tagDetailLines };
