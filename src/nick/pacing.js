'use strict';

// Response latency is not a server rate-limit measurement. Start conservatively,
// then reduce only the extra post-response wait, retaining a local margin.
function createNickPacing() {
    const samples = [];
    let pause = null, floor = 500, cooldowns = 0, queueWait = 0;
    function begin(base) { pause = Math.max(base, floor); }
    function observe(responseMs, waitingMs, adaptive) {
        if (!Number.isFinite(responseMs) || responseMs < 0) return;
        samples.push(responseMs);
        if (samples.length > 20) samples.shift();
        queueWait = Math.max(0, waitingMs || 0);
        if (adaptive && samples.length >= 5) {
            const target = Math.max(floor, Math.min(30000, Math.ceil(percentile() / 2)));
            pause = target > pause ? target : Math.max(target, pause - 100);
        }
    }
    function percentile() { return [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1] || 0; }
    function cooldown(base) {
        cooldowns++;
        floor = Math.min(30000, Math.max(floor * 2, (pause || base) * 2));
        pause = Math.max(pause || base, floor);
    }
    function delay(base, adaptive) { return Math.max(floor, adaptive ? pause ?? base : base); }
    function snapshot(base, adaptive) {
        return { samples: samples.length, min: samples.length ? Math.min(...samples) : null,
            average: samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : null,
            p95: samples.length ? percentile() : null, queueWait, pause: delay(base, adaptive), cooldowns };
    }
    return { begin, observe, cooldown, delay, snapshot };
}

module.exports = { createNickPacing };
