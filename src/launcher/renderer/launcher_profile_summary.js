'use strict';

// One summary per feature family; exact changes remain available in Details.
function summarizeProfile(profile) {
    const { enabled = [], disabled = [], configured = [] } = profile.preview || {};
    const changes = profile.applyChanges || [];
    const groups = [
        ['scan', 'Scanning', 'Find player threats', /^(scanMode|minFkdr|minStars|minSkywars|autoScan)/i, [], 'scanMode'],
        ['dodge', 'Auto Dodge', 'Skip unwanted lobbies', /^autoDodge/i, ['Auto Dodge'], 'autoDodgeEnabled'],
        ['names', 'Nametags', 'Player labels in game', /^(nametag|showTags|denickRealIgnNametags)/i, ['Name tags'], 'nametagOverlayEnabled'],
        ['tab', 'Tab stats', 'Stats in the player list', /^tabStats/i, ['Tab stats'], 'tabStatsEnabled'],
        ['nicks', 'Nicknames', 'Identify nicked players', /^(autoSkinDenick|autoStatsDenick|denick|showDenicked)/i, ['Skin denick', 'Stats denick'], null],
        ['chat', 'Chat & sharing', 'Chat stats and party updates', /^(share|lobbyChat|pregameChat|partyOverview|chatTrigger|accentBedwars)/i, ['Auto Share', 'Lobby chat stats', 'Pregame chat stats', 'Party overview'], null],
        ['overlay', 'Overlay', 'Player board display', /^(socialOverlay|overlay)/i, ['Use Overlay'], 'socialOverlayAddsEnabled'],
        ['sessions', 'Sessions & reminders', 'Tracking, recaps and reminders', /^(session|gameRecap|enderDust|slumber|gambler)/i, ['Session tracking', 'Game recap', 'Ender Dust reminder', 'Slumber reward reminder', 'Gambler George reminder'], null]
    ];
    const assigned = new Set();
    return groups.map(([id, label, description, pattern, highlights, primary]) => {
        const related = changes.filter(change => { if (assigned.has(change.key) || !pattern.test(change.key || '')) return false; assigned.add(change.key); return true; });
        const on = highlights.filter(name => enabled.includes(name)).length;
        const off = highlights.filter(name => disabled.includes(name)).length;
        let state = on && off ? 'Mixed' : on ? 'On' : off ? 'Off' : 'Unchanged';
        if (id === 'scan') {
            const scan = configured.find(text => /scanning/i.test(text));
            state = !scan ? 'Unchanged' : /off/i.test(scan) ? 'Off' : /all-player/i.test(scan) ? 'All players' : 'Threats';
        }
        const mainChange = related.find(change => change.key === primary);
        const first = mainChange || related[0];
        const valueText = value => typeof value === 'boolean' ? (value ? 'On' : 'Off') : value == null ? 'Not set' : String(value);
        let changeText = '';
        if (first) {
            if (Array.isArray(first.from) || Array.isArray(first.to)) {
                changeText = id === 'tab' ? 'Player-list columns updated' : 'Selected options updated';
            } else if (typeof first.from === 'object' || typeof first.to === 'object') {
                changeText = 'Display options updated';
            } else {
                const detail = first === mainChange ? '' : `${first.label || label}: `;
                changeText = `${detail}${valueText(first.from)} \u2192 ${valueText(first.to)}`;
            }
            if (related.length > 1) changeText += ` +${related.length - 1} more`;
        }
        const paths = {
            scan: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
            dodge: '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6Z"/>',
            names: '<path d="M3 4h9l9 9-8 8-10-10Z"/><circle cx="8" cy="9" r="1"/>',
            tab: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
            nicks: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
            chat: '<path d="M3 4h18v13H9l-6 4ZM7 8h10M7 12h7"/>',
            overlay: '<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
            sessions: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>'
        };
        const icon = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[id]}</svg>`;
        return { id, label, description, state, changes: related.length, changeText, icon, from: first?.from, to: first?.to, changeLabel: mainChange ? label : first?.label || label };
    });
}
module.exports = { summarizeProfile };
