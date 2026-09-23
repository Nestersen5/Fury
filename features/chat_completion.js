'use strict';

const { uniqueTabMatches } = require('./command_completion');

function createChatTabCompletion({
    // null means no party; an empty party list must not fall back to teammates.
    getPartyNames = () => null,
    getTeamNames = () => [],
    displayName = name => name
} = {}) {
    const pending = [];

    function forwardedRequest(packet) {
        let matches = [];
        const text = String(packet?.text || '');
        if (!text.trimStart().startsWith('/')) {
            // The client sends text up to the cursor, and replaces its last word.
            const word = /(?:^|\s)([A-Za-z0-9_]{0,16})$/.exec(text);
            if (word) {
                const prefix = word[1].toLowerCase();
                const names = getPartyNames() ?? getTeamNames();
                matches = uniqueTabMatches(names.map(displayName)
                    .filter(name => /^[A-Za-z0-9_]{3,16}$/.test(name) && name.toLowerCase().startsWith(prefix))
                    .sort((a, b) => a.localeCompare(b)), Infinity);
            }
        }
        // 1.8 has no request IDs. Track every forwarded request, including
        // commands, so a command response never receives old chat suggestions.
        pending.push(matches);
    }

    function serverResponse(packet) {
        const additions = pending.shift();
        if (!additions?.length || !Array.isArray(packet?.matches)) return packet;
        return { ...packet, matches: uniqueTabMatches([...packet.matches, ...additions], Infinity) };
    }

    return { forwardedRequest, serverResponse };
}

module.exports = { createChatTabCompletion };
