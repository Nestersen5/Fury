'use strict';

// Tracks the Bedwars pregame "Starting in Xs" countdown from scoreboard text.
// Shared by the auto dodger and the auto party dodger so neither depends on
// the other. Create one instance per consumer; state is just the latest
// countdown sample seen.

const COUNTDOWN_STALE_MS = 3000; // ignore a countdown sample older than this

function createPregameCountdown({ isPregameActive = () => true, now = Date.now } = {}) {
    let sample = null; // { seconds, at }

    function note(scoreboardText) {
        if (!isPregameActive()) return;
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
        if (seconds === null || !Number.isFinite(seconds)) return;
        sample = { seconds, at: now() };
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

    return { note, estimateSecondsRemaining, reset };
}

module.exports = { createPregameCountdown, COUNTDOWN_STALE_MS };
