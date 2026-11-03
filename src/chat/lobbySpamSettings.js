'use strict';

function normalizeLobbySpamSettings(value = {}) {
    return {
        lobbySpamEnabled: value?.lobbySpamEnabled === true,
        lobbySpamSensitivity: ['low', 'balanced', 'high'].includes(value?.lobbySpamSensitivity)
            ? value.lobbySpamSensitivity : 'balanced'
    };
}

module.exports = { normalizeLobbySpamSettings };
