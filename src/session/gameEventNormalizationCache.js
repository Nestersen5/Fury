'use strict';

// Only launcher-owned, freshly normalized arrays enter this scope. They are
// still private until the projection returns, so callers cannot mutate them
// between the totals and reconciliation passes.
const caches = new WeakMap();

function withGameEventNormalizationCache(events, project) {
    // A zero timestamp is normalized using Date.now() again on every pass.
    if (events.some(event => !(event.at > 0))) return project();
    const previous = caches.get(events);
    caches.set(events, { value: null });
    try {
        return project();
    } finally {
        if (previous) caches.set(events, previous);
        else caches.delete(events);
    }
}

function gameEventNormalizationCache(events) {
    return caches.get(events);
}

module.exports = { withGameEventNormalizationCache, gameEventNormalizationCache };
