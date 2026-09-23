'use strict';

// Display names only: persisted setting keys and launcher controls stay stable.
const LABELS = {
    'Name tags above heads': 'Player Labels',
    'Custom Nametags': 'Player Labels',
    'Auto skin denick': 'Skin Reveal',
    'Auto stats denick': 'Stats Reveal',
    'Post-game session recap': 'Match Summary',
    'Auto dodge delay': 'Dodge Delay',
    'Denick chat announcements': 'Reveal Notices',
    'Show denicked real IGN': 'Real Player Names',
    'Replace known nicks in game': 'Real Names in Game',
    'Replace known nicks in chat': 'Real Names in Chat',
    'Replace known nick skins in game': 'Real Player Skins',
    'Name tags for teammates': 'Teammate Labels',
    'Name tags for threats': 'Threat Labels',
    'Name tags for everyone else': 'Other Player Labels',
    'Dark gray BedWars star brackets': 'Star Brackets',
    'Show tags in tabstats': 'Tab Tags',
    'In-game chat prefix accent': 'Chat Accent',
    'Auto share tags to party': 'Auto Share',
    'Fancy share lines': 'Detailed Sharing',
    'Recolor own share lines': 'Share Colors',
    'Live share keeps team order': 'Share Team Order',
    'Slumber NPC daily rewards reminder': 'Daily Rewards Reminder',
    'Ender Dust reminder threshold': 'Ender Dust Threshold',
    'Queue time messages': 'Queue Timer',
    'Queue time to party chat': 'Party Queue Timer',
    'BedWars chat event labels': 'BedWars Event Colors',
    'BedWars scoreboard team colors': 'Scoreboard Team Colors',
    'Session inactivity boundary': 'Session Idle Limit',
    'Session history retention': 'Saved Sessions',
    'Session recap style': 'Match Summary Style',
    'Session recap fields': 'Match Summary Fields'
};

const PREFIX = '§b§lFURY §8» ';
const MAX_ROWS = 12;

function plain(value) {
    return String(value ?? '').replace(/§[0-9a-fk-or]/gi, '').replace(/[\r\n\t]+/g, ' ').trim();
}

function displayLabel(label) {
    const text = plain(label);
    return LABELS[text] || text.replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

function displayValue(label, value) {
    const text = plain(value);
    if (/^-?\d+(\.\d+)?$/.test(text)) {
        if (label === 'Dodge Delay') return `${text}s`;
        if (label === 'Session Idle Limit') return `${text}m`;
    }
    return text || 'none';
}

function changeRow(change) {
    const label = displayLabel(change.label);
    const from = displayValue(label, change.from);
    const to = displayValue(label, change.to);
    const toggle = /^(on|off|true|false)$/i.test(to);
    const value = toggle
        ? (/^(on|true)$/i.test(to) ? '§aON' : '§7OFF')
        : `§7${from} §8› §b${to}`;
    return `§f${label} §8· ${value}§r`;
}

function buildSettingsAnnouncements(changes, profileLabel = '') {
    const rows = (Array.isArray(changes) ? changes : []).filter(change =>
        change && plain(change.label) && String(change.from) !== String(change.to));
    const profile = plain(profileLabel);
    if (profile) {
        return [`${PREFIX}§7Profile applied: §b${profile} §8· §f${rows.length} §7updated§r`];
    }
    if (!rows.length) return [];
    if (rows.length === 1) return [PREFIX + changeRow(rows[0])];
    const lines = [
        `${PREFIX}§f${rows.length} §7settings updated§r`,
        ...rows.slice(0, MAX_ROWS).map(change => `  ${changeRow(change)}`)
    ];
    if (rows.length > MAX_ROWS) lines.push(`  §7+${rows.length - MAX_ROWS} more changes§r`);
    return lines;
}

module.exports = { buildSettingsAnnouncements };
