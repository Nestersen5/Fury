'use strict';

const GAMBLER_GEORGE_REQUIRED_WINS = 2;
const GAMBLER_GEORGE_ACCEPT_COMMAND = '/wanttobet true';
const GAMBLER_GEORGE_REMINDER_MESSAGE = '§6§lGambler George §8» §eYour 2-win bet is complete. §aReturn to George to claim it!';
// A win lands while the player is watching the end-game banner, not chat, so
// each progress line is paired with a sound. 1.8 sound names; pitch is the
// protocol byte, where 63 is normal pitch. The two are deliberately different
// so "one more to go" and "go claim it" are told apart without reading.
const GAMBLER_GEORGE_PROGRESS_SOUND = { name: 'random.orb', volume: 1, pitch: 63 };
const GAMBLER_GEORGE_COMPLETE_SOUND = { name: 'random.levelup', volume: 1, pitch: 63 };
// Hypixel dumps the end-of-game summary into chat the instant the banner shows,
// and it fills the box top to bottom. An alert sent on the win itself is buried
// before it can be read, so the win alerts wait for the summary to finish
// scrolling past — still well inside the post-game lobby countdown.
const GAMBLER_GEORGE_WIN_ALERT_DELAY_MS = 2250;
// George only offers a new bet a day after a failed one, so a loss parks the
// feature for the same window instead of letting Auto Gambler retry into a
// refusal.
const GAMBLER_GEORGE_FAIL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// A VICTORY!/GAME OVER! banner can land a beat after the match state has been
// torn down — typing /leave the instant the banner shows does exactly that —
// so the game that just ended still owns its result for this long.
const GAMBLER_GEORGE_RESULT_GRACE_MS = 3 * 60 * 1000;
// Sources that speak for the player or for Hypixel itself, so they outrank our
// own cooldown estimate.
const GAMBLER_GEORGE_COOLDOWN_OVERRIDE_SOURCES = new Set([
    'manual_command',
    'manual_control',
    'chat_confirmation'
]);

function cleanGeorgeText(value = '') {
    return String(value || '')
        .normalize('NFKC')
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/(?:\u00C2?\u00A7|\\u00a7|\\u00A7|&)[0-9A-FK-OR]/gi, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function safeTimestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function formatGeorgeCooldown(ms) {
    const total = Math.max(0, Math.round(Number(ms) || 0));
    if (total <= 0) return 'ready';
    const minutes = Math.ceil(total / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function gamblerGeorgeProgressMessage(wins) {
    return `§6§lGambler George §8» §aWin §f${wins}§7/§f${GAMBLER_GEORGE_REQUIRED_WINS} §arecorded.`;
}

function gamblerGeorgeCompleteMessage() {
    return `§6§lGambler George §8» §aWin §f${GAMBLER_GEORGE_REQUIRED_WINS}§7/§f${GAMBLER_GEORGE_REQUIRED_WINS} §a— bet complete! §eReturn to George to claim it.`;
}

function gamblerGeorgeFailMessage(remainingMs) {
    return `§6§lGambler George §8» §cBet failed §7— that loss ended it. §7New bet in §f${formatGeorgeCooldown(remainingMs)}§7.`;
}

function normalizeGamblerGeorgeReminderState(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
    const active = Boolean(raw.active);
    const wins = active
        ? Math.min(GAMBLER_GEORGE_REQUIRED_WINS, Math.max(0, Math.round(Number(raw.wins) || 0)))
        : 0;
    const claimReady = active && (Boolean(raw.claimReady) || wins >= GAMBLER_GEORGE_REQUIRED_WINS);
    return {
        active,
        wins: claimReady ? GAMBLER_GEORGE_REQUIRED_WINS : wins,
        claimReady,
        acceptedAt: active ? safeTimestamp(raw.acceptedAt) : 0,
        source: active ? String(raw.source || '').trim().slice(0, 40) : '',
        lastWinSessionKey: active ? String(raw.lastWinSessionKey || '').trim().slice(0, 100) : '',
        // Settled games are remembered so a win and a stray "GAME OVER" from the
        // same match can never both count. Older saves only carried the win key,
        // which was the same thing for every game they recorded.
        lastResultSessionKey: String(raw.lastResultSessionKey || raw.lastWinSessionKey || '').trim().slice(0, 100),
        // A failure and its cooldown outlive the bet they ended, so they are
        // normalized independently of `active`.
        failedAt: safeTimestamp(raw.failedAt),
        cooldownUntil: safeTimestamp(raw.cooldownUntil)
    };
}

function isGeorgeAcceptanceCommand(command = '') {
    return cleanGeorgeText(command).toLowerCase() === GAMBLER_GEORGE_ACCEPT_COMMAND;
}

function isGeorgeAcceptanceText(text = '') {
    const clean = cleanGeorgeText(text).toLowerCase();
    if (!clean) return false;
    const hasGeorgeContext = clean.includes('gambler george') || clean.includes('win the bet');
    return hasGeorgeContext && (
        /\b(?:quest|bet)\s+(?:accepted|started|active)\b/.test(clean)
        || /\b(?:accepted|started)\s+(?:the\s+)?(?:quest|bet)\b/.test(clean)
        || /\b(?:go\s+)?win\s+(?:2|two)\s+bed\s*wars\s+(?:games|matches)\b/.test(clean)
    );
}

function isGeorgeClaimText(text = '') {
    const clean = cleanGeorgeText(text).toLowerCase();
    if (!clean) return false;
    const hasGeorgeContext = clean.includes('gambler george') || clean.includes('win the bet');
    return hasGeorgeContext && (
        /\b(?:reward|bet)\s+(?:claimed|collected|redeemed)\b/.test(clean)
        || /\b(?:claimed|collected|redeemed)\s+(?:the\s+)?(?:reward|bet)\b/.test(clean)
        || /\b(?:won|completed|finished)\s+(?:the\s+)?bet\b/.test(clean)
        || /\b(?:here(?:'s| is| are)|take)\b.*\b(?:tickets|reward|winnings)\b/.test(clean)
    );
}

function isGeorgeFailureText(text = '') {
    const clean = cleanGeorgeText(text).toLowerCase();
    if (!clean) return false;
    const hasGeorgeContext = clean.includes('gambler george') || clean.includes('win the bet');
    return hasGeorgeContext && (
        /\b(?:quest|bet)\s+(?:failed|lost)\b/.test(clean)
        || /\b(?:failed|lost)\s+(?:the\s+)?(?:quest|bet)\b/.test(clean)
        || clean.includes("couldn't do it")
        || clean.includes('could not do it')
    );
}

// "Name: gg", "[MVP+] Name: victory!", "Party > Name: game over" — the end-game
// banners never carry a speaker, so a line that does is somebody typing and must
// not be able to score the bet, let alone fail it into a 24h cooldown.
const GAMBLER_GEORGE_SPEAKER_PATTERN = /(?:\[[^\]]{1,24}\]\s*)*\b[A-Za-z0-9_]{2,16}\s*:\s/;

function resultBannerText(text = '') {
    const clean = cleanGeorgeText(text);
    if (!clean || GAMBLER_GEORGE_SPEAKER_PATTERN.test(clean)) return '';
    return clean;
}

function isVictoryText(text = '') {
    const clean = resultBannerText(text);
    return Boolean(clean) && /(?:^|\s)VICTORY\s*!(?:\s|$)/i.test(clean);
}

function isDefeatText(text = '') {
    const clean = resultBannerText(text);
    if (!clean) return false;
    return /(?:^|\s)DEFEAT\s*!(?:\s|$)/i.test(clean)
        || /(?:^|\s)GAME\s*OVER\s*!?(?:\s|$)/i.test(clean);
}

function createGamblerGeorgeReminder(options = {}) {
    const {
        getEnabled = () => false,
        getSavedState = () => null,
        saveState = () => {},
        sendChat = () => {},
        playSound = () => {},
        // Auto Gambler is what answers George's prompt in the first place, so
        // with it off there is no bet for this tracker to be tracking.
        getAutoGamblerEnabled = () => true,
        logger = console,
        now = () => Date.now(),
        // Injectable so tests can fire a held-back alert without waiting on a
        // real clock. The real timer is unref'd: a queued alert must never be
        // the reason the proxy stays alive.
        setTimer = (fn, ms) => {
            const handle = setTimeout(fn, ms);
            handle.unref?.();
            return handle;
        },
        clearTimer = handle => clearTimeout(handle)
    } = options;

    let state = normalizeGamblerGeorgeReminderState(getSavedState());
    let lastReminderTransitionKey = '';
    const pendingAlerts = new Set();

    function autoGamblerActive() {
        try {
            return Boolean(getAutoGamblerEnabled());
        } catch (error) {
            return false;
        }
    }

    function cooldownRemainingMs() {
        if (!state.cooldownUntil) return 0;
        return Math.max(0, state.cooldownUntil - now());
    }

    function snapshot() {
        const remaining = cooldownRemainingMs();
        const autoGambler = autoGamblerActive();
        return {
            ...state,
            enabled: Boolean(getEnabled()),
            autoGamblerEnabled: autoGambler,
            // Parked, not disabled: progress already banked is kept intact and
            // resumes as soon as Auto Gambler is switched back on.
            paused: !autoGambler,
            requiredWins: GAMBLER_GEORGE_REQUIRED_WINS,
            cooldownRemainingMs: remaining,
            onCooldown: remaining > 0
        };
    }

    function persist(nextState) {
        state = normalizeGamblerGeorgeReminderState(nextState);
        try {
            saveState({ ...state });
        } catch (error) {
            logger.warn?.('[Gambler George Reminder] Could not save quest progress:', error?.message || error);
        }
        return snapshot();
    }

    function announce(message, sound = null) {
        if (!getEnabled() || !autoGamblerActive()) return;
        sendChat(message);
        if (!sound) return;
        // Never let a sound write break the alert that matters.
        try {
            playSound(sound);
        } catch (error) {
            logger.warn?.('[Gambler George Reminder] Could not play alert sound:', error?.message || error);
        }
    }

    // The enabled/Auto-Gambler check runs when the alert actually fires, so
    // switching the reminder off inside the delay window still silences it.
    function announceLater(message, sound = null, delayMs = GAMBLER_GEORGE_WIN_ALERT_DELAY_MS) {
        if (!(delayMs > 0)) {
            announce(message, sound);
            return;
        }
        // The token, not the timer handle, is what identifies a queued alert: a
        // test timer that fires synchronously would otherwise have to be
        // cancelled before setTimer had even returned its handle.
        const pending = { handle: null };
        pendingAlerts.add(pending);
        pending.handle = setTimer(() => {
            pendingAlerts.delete(pending);
            announce(message, sound);
        }, delayMs);
    }

    // A queued alert describes the bet as it stood when the win landed, so any
    // move to a different bet state has to drop it rather than let it arrive
    // contradicting what has happened since.
    function cancelPendingAlerts() {
        for (const pending of pendingAlerts) {
            try {
                clearTimer(pending.handle);
            } catch (error) {
                logger.warn?.('[Gambler George Reminder] Could not cancel a queued alert:', error?.message || error);
            }
        }
        pendingAlerts.clear();
    }

    function acceptQuest(source = 'detected', { restart = false, force = null } = {}) {
        if (!autoGamblerActive()) {
            logger.log?.(`[Gambler George Reminder] Ignored ${String(source || 'unknown').trim()} acceptance; `
                + 'Auto Gambler is off.');
            return snapshot();
        }
        if (state.active && !restart) return snapshot();
        const normalizedSource = String(source || '').trim();
        const allowOverride = force === null
            ? GAMBLER_GEORGE_COOLDOWN_OVERRIDE_SOURCES.has(normalizedSource)
            : Boolean(force);
        const remaining = cooldownRemainingMs();
        if (remaining > 0 && !allowOverride) {
            logger.log?.(`[Gambler George Reminder] Ignored ${normalizedSource || 'unknown'} acceptance; `
                + `bet is on cooldown for ${formatGeorgeCooldown(remaining)}.`);
            return snapshot();
        }
        lastReminderTransitionKey = '';
        cancelPendingAlerts();
        return persist({
            active: true,
            wins: 0,
            claimReady: false,
            acceptedAt: now(),
            source: normalizedSource,
            lastWinSessionKey: '',
            lastResultSessionKey: '',
            // A bet that actually started means the cooldown before it is spent.
            failedAt: 0,
            cooldownUntil: 0
        });
    }

    function clearQuest(reason = 'claimed') {
        if (!state.active) return snapshot();
        lastReminderTransitionKey = '';
        cancelPendingAlerts();
        logger.log?.(`[Gambler George Reminder] Cleared quest state (${reason}).`);
        // Claiming ends the bet without touching a cooldown it never earned.
        return persist({ failedAt: state.failedAt, cooldownUntil: state.cooldownUntil });
    }

    function clearCooldown(reason = 'manual') {
        if (!state.cooldownUntil && !state.failedAt) return snapshot();
        logger.log?.(`[Gambler George Reminder] Cleared bet cooldown (${reason}).`);
        return persist({ ...state, failedAt: 0, cooldownUntil: 0 });
    }

    function failQuest(reason = 'bedwars_loss', sessionKey = '') {
        const failedAt = now();
        const cooldownUntil = failedAt + GAMBLER_GEORGE_FAIL_COOLDOWN_MS;
        lastReminderTransitionKey = '';
        cancelPendingAlerts();
        persist({
            active: false,
            lastResultSessionKey: String(sessionKey || '').trim(),
            failedAt,
            cooldownUntil
        });
        logger.log?.(`[Gambler George Reminder] Bet failed (${reason}); cooldown until ${new Date(cooldownUntil).toISOString()}.`);
        announce(gamblerGeorgeFailMessage(GAMBLER_GEORGE_FAIL_COOLDOWN_MS));
        return snapshot();
    }

    // A result belongs to the BedWars game that produced it even when the match
    // state has already been reset — see GAMBLER_GEORGE_RESULT_GRACE_MS.
    function resolveBedwarsSessionKey(context = {}) {
        const mode = String(context.mode || '').toUpperCase();
        if (context.gameActive) {
            // Whatever game the player is actually in owns its own result. A
            // SkyWars or Duels VICTORY! must fall out here rather than drop
            // through to the grace window below and borrow the BedWars key a
            // game from minutes ago left behind.
            return mode === 'BEDWARS' ? `bedwars:${String(context.gameSessionId ?? '').trim()}` : '';
        }
        const recentId = String(context.recentBedwarsSessionId ?? '').trim();
        if (!recentId) return '';
        const recentAt = safeTimestamp(context.recentBedwarsAt);
        if (!recentAt || now() - recentAt > GAMBLER_GEORGE_RESULT_GRACE_MS) return '';
        return `bedwars:${recentId}`;
    }

    function recordWin(sessionKey = '') {
        if (!autoGamblerActive()) return false;
        if (!state.active || state.claimReady) return false;
        const normalizedKey = String(sessionKey || '').trim();
        if (!normalizedKey || normalizedKey === state.lastResultSessionKey) return false;

        const wins = Math.min(GAMBLER_GEORGE_REQUIRED_WINS, state.wins + 1);
        const claimReady = wins >= GAMBLER_GEORGE_REQUIRED_WINS;
        persist({
            ...state,
            wins,
            claimReady,
            lastWinSessionKey: normalizedKey,
            lastResultSessionKey: normalizedKey
        });
        logger.log?.(`[Gambler George Reminder] Recorded BedWars win ${wins}/${GAMBLER_GEORGE_REQUIRED_WINS}.`);
        // Held back until the end-of-game summary has finished scrolling past,
        // so the line is still on screen when the player next looks at chat.
        announceLater(
            claimReady ? gamblerGeorgeCompleteMessage() : gamblerGeorgeProgressMessage(wins),
            claimReady ? GAMBLER_GEORGE_COMPLETE_SOUND : GAMBLER_GEORGE_PROGRESS_SOUND
        );
        return true;
    }

    function recordLoss(sessionKey = '') {
        if (!autoGamblerActive()) return false;
        if (!state.active || state.claimReady) return false;
        const normalizedKey = String(sessionKey || '').trim();
        if (normalizedKey && normalizedKey === state.lastResultSessionKey) return false;
        failQuest('bedwars_loss', normalizedKey);
        return true;
    }

    function observeGameResult(text = '', context = {}) {
        if (!autoGamblerActive()) return false;
        if (!state.active || state.claimReady) return false;
        const victory = isVictoryText(text);
        const defeat = !victory && isDefeatText(text);
        if (!victory && !defeat) return false;
        const sessionKey = resolveBedwarsSessionKey(context);
        if (!sessionKey) return false;
        return victory ? recordWin(sessionKey) : recordLoss(sessionKey);
    }

    // The VICTORY!/GAME OVER! banner is a title packet, which Hypixel sends the
    // instant the game ends — ahead of the end-of-game chat block, and ahead of
    // any /leave that would otherwise tear the match state down first.
    function observeTitle(text = '', context = {}) {
        return observeGameResult(text, context);
    }

    function observeCommand(command = '', source = 'manual_command') {
        if (!autoGamblerActive()) return false;
        if (!isGeorgeAcceptanceCommand(command)) return false;
        // The explicit positive response is a fresh bet. Restarting here also
        // recovers safely if a previous loss happened while Fury was offline.
        acceptQuest(source, { restart: true });
        return true;
    }

    function observeChatLine(text = '', context = {}) {
        if (!autoGamblerActive()) return false;
        if (isGeorgeClaimText(text)) {
            if (!state.claimReady) return false;
            clearQuest('claim_chat');
            return true;
        }
        if (isGeorgeFailureText(text)) {
            if (!state.active || state.claimReady) return false;
            failQuest('failure_chat');
            return true;
        }
        if (isGeorgeAcceptanceText(text)) {
            acceptQuest('chat_confirmation');
            return true;
        }
        return observeGameResult(text, context);
    }

    function onTransition(kind = 'transition', transitionKey = '') {
        if (!getEnabled() || !autoGamblerActive()) return false;
        if (!state.active || !state.claimReady) return false;
        const key = String(transitionKey || '').trim();
        if (!key || key === lastReminderTransitionKey) return false;
        lastReminderTransitionKey = key;
        sendChat(GAMBLER_GEORGE_REMINDER_MESSAGE);
        logger.log?.(`[Gambler George Reminder] Sent claim reminder on ${kind}.`);
        return true;
    }

    return {
        // Cheap enough for a packet hot path: lets callers skip parsing a
        // payload no bet could act on.
        hasPendingResult: () => autoGamblerActive() && state.active && !state.claimReady,
        acceptQuest,
        clearQuest,
        clearCooldown,
        failQuest,
        observeCommand,
        observeChatLine,
        observeTitle,
        recordWin,
        recordLoss,
        onTransition,
        getCooldownRemainingMs: cooldownRemainingMs,
        getStatus: snapshot
    };
}

module.exports = {
    GAMBLER_GEORGE_REQUIRED_WINS,
    GAMBLER_GEORGE_ACCEPT_COMMAND,
    GAMBLER_GEORGE_REMINDER_MESSAGE,
    GAMBLER_GEORGE_PROGRESS_SOUND,
    GAMBLER_GEORGE_COMPLETE_SOUND,
    GAMBLER_GEORGE_WIN_ALERT_DELAY_MS,
    GAMBLER_GEORGE_FAIL_COOLDOWN_MS,
    GAMBLER_GEORGE_RESULT_GRACE_MS,
    cleanGeorgeText,
    formatGeorgeCooldown,
    gamblerGeorgeProgressMessage,
    gamblerGeorgeCompleteMessage,
    gamblerGeorgeFailMessage,
    normalizeGamblerGeorgeReminderState,
    isGeorgeAcceptanceCommand,
    isGeorgeAcceptanceText,
    isGeorgeClaimText,
    isGeorgeFailureText,
    isVictoryText,
    isDefeatText,
    createGamblerGeorgeReminder
};
