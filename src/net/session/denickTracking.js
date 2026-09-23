'use strict';

// Per-connection denick session state, extracted from createProxyServer.
//
// Owns the four maps that track auto-denick state for one connection:
// - autoDenickStats: nickKey → progressing { final_kills, beds_broken, ... }
// - autoDenickResults: nickKey → { nick, realName, source, fromHistory, ... }
// - autoDenickNickChecks: Set of nickKeys currently being verified
// - autoSkinDenickAttempts: nickKey → skin-based denick attempt state
//
// Heavy orchestration (cleanupDenickAliasDuplicate, the auto-denick
// scheduler, tab/overlay coordination) stays in proxy.js because it
// reaches into scoreboards, gameRoster, tab timers, and packet writes.
// What lives here are the storage and the read/write helpers that don't
// need to touch anything outside the four maps.

function createDenickTracker(deps) {
    const {
        isValidPlayerName,
        nickKey,
        findKnownDenickByNick,
        getDenickChatAnnouncementsEnabled,
        getShowDenickedRealIgn,
        isOwnPlayerName,
        isSameTeamAsClient,
        sendChat,
        client,
        afterApplyKnownDenick = () => {}
    } = deps;

    const autoDenickStats = new Map();
    const autoDenickResults = new Map();
    const autoDenickNickChecks = new Set();
    const autoSkinDenickAttempts = new Map();
    const announcedDenicks = new Set();

    function getAutoDenickResult(name) {
        return autoDenickResults.get(nickKey(name)) || null;
    }

    function shouldSuppressDenickAnnouncement(name) {
        return isOwnPlayerName(name) || isSameTeamAsClient(name);
    }

    function hasAnnouncedDenick(name) {
        const key = nickKey(name);
        return Boolean(key) && announcedDenicks.has(key);
    }

    function markDenickAnnounced(name) {
        const key = nickKey(name);
        if (key) announcedDenicks.add(key);
    }

    function rememberKnownDenickInSession(name, realName, source = 'history') {
        if (!isValidPlayerName(name) || !isValidPlayerName(realName) || nickKey(name) === nickKey(realName)) return false;

        const key = nickKey(name);
        const existing = autoDenickResults.get(key) || {};
        autoDenickResults.set(key, {
            ...existing,
            nick: name,
            realName,
            source,
            fromHistory: source === 'history',
            fromManual: source === 'manual',
            at: Date.now()
        });
        return true;
    }

    function applyKnownDenickFromHistory(name, source = 'history', options = {}) {
        if (!isValidPlayerName(name) || getAutoDenickResult(name)?.realName) return false;
        const known = findKnownDenickByNick(name);
        if (!known?.realName || !isValidPlayerName(known.realName)) return false;

        const denickSource = known.source || source;
        if (!rememberKnownDenickInSession(name, known.realName, denickSource)) return false;
        afterApplyKnownDenick(name, known.realName, denickSource, options);
        if (getDenickChatAnnouncementsEnabled() && options.announce !== false && !shouldSuppressDenickAnnouncement(name) && !hasAnnouncedDenick(name)) {
            const label = denickSource === 'manual' ? 'manual' : 'history';
            sendChat(client, `§b[Denick] §7Known nick §c${name} §8-> §a${known.realName} §8(${label})`);
            markDenickAnnounced(name);
        }
        return true;
    }

    function denickSuffix(name) {
        if (!getShowDenickedRealIgn()) return '';
        const result = getAutoDenickResult(name);
        return result?.realName ? ` §a(${result.realName})` : '';
    }

    function getDenickAliasForRealName(realName) {
        const realKey = nickKey(realName);
        if (!realKey) return null;

        for (const [nick, result] of autoDenickResults.entries()) {
            if (!result?.realName) continue;
            if (nick !== realKey && nickKey(result.realName) === realKey) {
                return { nick, nickName: result.nick || nick, result };
            }
        }
        return null;
    }

    function clear() {
        autoDenickStats.clear();
        autoDenickResults.clear();
        autoDenickNickChecks.clear();
        autoSkinDenickAttempts.clear();
        announcedDenicks.clear();
    }

    return {
        autoDenickStats,
        autoDenickResults,
        autoDenickNickChecks,
        autoSkinDenickAttempts,
        getAutoDenickResult,
        shouldSuppressDenickAnnouncement,
        hasAnnouncedDenick,
        markDenickAnnounced,
        rememberKnownDenickInSession,
        applyKnownDenickFromHistory,
        denickSuffix,
        getDenickAliasForRealName,
        clear
    };
}

module.exports = { createDenickTracker };
