'use strict';

function eventTimestamp(event = {}) {
    const parsed = Date.parse(event.at || '');
    return Number.isFinite(parsed) ? parsed : 0;
}

function buildDenickHistoryIndex(players = []) {
    const byNick = new Map();
    for (const player of Array.isArray(players) ? players : []) {
        if (!player?.realIGN) continue;
        const nickKeys = new Set();
        for (const nick of Array.isArray(player.nicks) ? player.nicks : []) {
            const key = String(nick || '').trim().toLowerCase();
            if (key) nickKeys.add(key);
        }
        for (const event of Array.isArray(player.events) ? player.events : []) {
            const key = String(event?.nick || '').trim().toLowerCase();
            if (key) nickKeys.add(key);
        }

        for (const key of nickKeys) {
            if (byNick.has(key)) continue;
            let latestEvent = null;
            for (const event of Array.isArray(player.events) ? player.events : []) {
                if (String(event?.nick || '').trim().toLowerCase() !== key) continue;
                if (!latestEvent || eventTimestamp(event) >= eventTimestamp(latestEvent)) latestEvent = event;
            }
            const method = latestEvent?.method || (player.methods || [])[0] || 'history';
            byNick.set(key, {
                nick: latestEvent?.nick || (player.nicks || []).find(nick => String(nick || '').toLowerCase() === key) || key,
                realName: player.realIGN,
                source: method === 'manual' ? 'manual' : 'history',
                method
            });
        }
    }
    return byNick;
}

module.exports = {
    buildDenickHistoryIndex,
    eventTimestamp
};
