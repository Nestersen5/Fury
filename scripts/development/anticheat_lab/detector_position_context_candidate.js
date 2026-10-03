'use strict';
// Candidate owning-path support: seed from the existing observer entity tracker
// once on a check's disabled -> enabled transition. No labels/private inputs.
// Consumers see the pre-packet position, then process the current packet once.
function createDetectorPositionContext({ detector, forEachEntity, now = Date.now }) {
    let active = false;
    function sync(enabled) {
        const next = !!enabled;
        if (next === active) return;
        active = next;
        if (!next) return;
        const t = now();
        forEachEntity((entry, id) => {
            if (!Number.isInteger(id) || !entry ||
                !Number.isFinite(entry.x) || !Number.isFinite(entry.y) || !Number.isFinite(entry.z)) return;
            detector.observeRecord({ k: 'snap', t, id, name: entry.name || null,
                x: entry.x, y: entry.y, z: entry.z });
        });
    }
    // World-clearing callers should keep the activation state: the subsequent
    // world spawn packets initialize new entities, and the tracker may still
    // contain old-world entries at the detector's earlier post-forward tap.
    return { sync };
}
module.exports = { createDetectorPositionContext };
