'use strict';
// Owning-path candidate: recording and detectors share a lazily read clock
// inside one synchronous post-forward packet tap. Outside that tap, normal
// start/stop/flush operations receive the actual current time.
function createObserverPacketClock({ now = Date.now } = {}) {
    let active = false, packetTime = null;
    function begin() { active = true; packetTime = null; }
    function end() { active = false; packetTime = null; }
    function read() {
        if (!active) return now();
        if (packetTime === null) packetTime = now();
        return packetTime;
    }
    return { begin, end, now: read };
}
module.exports = { createObserverPacketClock };
