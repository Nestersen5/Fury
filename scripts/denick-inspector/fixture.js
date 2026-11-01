'use strict';

// Explicit offline UI/test fixture. Never used by the ordinary launch command.
function options() {
    const rows = {
        finals: [{ name: 'NearPlayer', uuid: 'a'.repeat(32), finals: 4528, lastUpdated: '2026-10-01T12:00:00Z', distance: 1 },
            { name: 'SharedPlayer', uuid: 'b'.repeat(32), finals: 4500, distance: 29 }],
        beds: [{ name: 'HiddenPlayer', uuid: 'c'.repeat(32), beds: 1874, lastUpdated: '2026-10-01T12:00:00Z', distance: 0 },
            { name: 'SharedPlayer', uuid: 'b'.repeat(32), beds: 1860, distance: 14 }]
    };
    const ids = { nearplayer: 'a'.repeat(32), sharedplayer: 'b'.repeat(32), hiddenplayer: 'c'.repeat(32) };
    return { readKeys: () => ({ aurora: 'offline-fixture', hypixel: 'offline-fixture' }), axios: { get: async url => {
        if (url.includes('bordic.xyz')) return { data: { success: true, data: rows[url.includes('/finals?') ? 'finals' : 'beds'] } };
        if (url.includes('mojang.com')) return { data: { id: ids[url.split('/').at(-1).toLowerCase()] || ids.hiddenplayer } };
        const id = new URL(url).searchParams.get('uuid');
        const finals = id === ids.hiddenplayer ? 4467 : id === ids.sharedplayer ? 4600 : 4528;
        const beds = id === ids.sharedplayer ? 1874 : id === ids.hiddenplayer ? 1874 : 999;
        const displayname = Object.keys(ids).find(name => ids[name] === id) || 'HiddenPlayer';
        return { status: 200, headers: { 'ratelimit-remaining': '299', 'ratelimit-limit': '300' }, data: { success: true,
            player: { displayname, stats: { Bedwars: { final_kills_bedwars: finals, beds_broken_bedwars: beds } } } } };
    } } };
}
module.exports = { options };
