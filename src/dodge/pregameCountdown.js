'use strict';

// Tracks the Bedwars pregame "Starting in Xs" countdown from scoreboard text.
// Shared by the auto dodger and the auto party dodger so neither depends on
// the other. Create one instance per consumer; state is just the latest
// countdown sample seen.

const COUNTDOWN_STALE_MS = 3000; // ignore a countdown sample older than this

function createPregameCountdown({ isPregameActive = () => true, now = Date.now } = {}) {
    let sample = null; // { seconds, at }

    function recordSample(seconds) {
        // Scoreboard packets often re-read an unchanged countdown line. Its
        // original timestamp must survive those reads so the deadline cannot drift.
        if (sample?.seconds === seconds) return false;
        sample = { seconds, at: now() };
        return true;
    }

    function note(scoreboardText) {
        if (!isPregameActive()) return false;
        // Strip Minecraft color codes; the Bedwars pregame scoreboard shows
        // "Starting in 6s" (occasionally rendered "M:SS"), often colored.
        const clean = String(scoreboardText || '').replace(/Â?§[0-9A-FK-OR]/gi, '');
        let seconds = null;
        const mmss = clean.match(/starting in\s*(\d+):(\d+)/i);
        if (mmss) {
            seconds = parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
        } else {
            const secs = clean.match(/starting in\s*(\d+)\s*s\b/i);
            if (secs) seconds = parseInt(secs[1], 10);
        }
        if (seconds !== null && Number.isFinite(seconds)) return recordSample(seconds);
        // An explicit return to waiting cancels the countdown; a partial
        // sidebar update without a countdown does not invalidate its deadline.
        if (sample && /\bwaiting(?:\.{3}| for players\b)/i.test(clean)) {
            reset();
            return true;
        }
        return false;
    }

    function noteChat(text) {
        if (!isPregameActive()) return false;
        const clean = String(text || '').replace(/Â?§[0-9A-FK-OR]/gi, '').trim();
        // Only the server countdown, never a player's quoted chat message.
        const match = clean.match(/^The game starts in (\d+) seconds?[!.]?$/i);
        return match ? recordSample(Number(match[1])) : false;
    }

    function estimateSecondsRemaining() {
        if (!isPregameActive() || !sample) return null;
        const age = now() - sample.at;
        if (age > COUNTDOWN_STALE_MS) return null;
        return sample.seconds - age / 1000;
    }

    function reset() {
        sample = null;
    }

    return { note, noteChat, estimateSecondsRemaining, reset };
}

module.exports = { createPregameCountdown, COUNTDOWN_STALE_MS };
