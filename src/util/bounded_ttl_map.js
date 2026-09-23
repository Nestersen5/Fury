'use strict';

class BoundedTtlMap extends Map {
    constructor({
        ttlMs = Infinity,
        maxEntries = Infinity,
        timestampKey = 'timestamp',
        pruneIntervalMs = null,
        now = Date.now
    } = {}) {
        super();
        this.ttlMs = Number.isFinite(ttlMs) ? Math.max(0, ttlMs) : Infinity;
        this.maxEntries = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : Infinity;
        this.timestampKey = timestampKey;
        this.now = typeof now === 'function' ? now : Date.now;
        this.pruneIntervalMs = Number.isFinite(pruneIntervalMs)
            ? Math.max(0, pruneIntervalMs)
            : (Number.isFinite(this.ttlMs) ? Math.min(60000, Math.max(1000, this.ttlMs / 4)) : 60000);
        this.lastPruneAt = 0;
    }

    entryTimestamp(value) {
        const rawTimestamp = typeof this.timestampKey === 'function'
            ? this.timestampKey(value)
            : value?.[this.timestampKey];
        const timestamp = Number(rawTimestamp);
        return Number.isFinite(timestamp) ? timestamp : null;
    }

    isExpired(value, now = this.now()) {
        if (!Number.isFinite(this.ttlMs)) return false;
        const timestamp = this.entryTimestamp(value);
        return timestamp !== null && now - timestamp > this.ttlMs;
    }

    get(key) {
        if (!super.has(key)) return undefined;
        const value = super.get(key);
        if (this.isExpired(value)) {
            super.delete(key);
            return undefined;
        }

        // Refresh insertion order so the size cap evicts the least recently used item.
        super.delete(key);
        super.set(key, value);
        return value;
    }

    set(key, value) {
        super.delete(key);
        super.set(key, value);
        const now = this.now();
        if (this.size > this.maxEntries || now - this.lastPruneAt >= this.pruneIntervalMs) {
            this.prune(now);
        }
        return this;
    }

    prune(now = this.now()) {
        this.lastPruneAt = now;
        if (Number.isFinite(this.ttlMs)) {
            for (const [key, value] of this) {
                if (this.isExpired(value, now)) super.delete(key);
            }
        }

        while (this.size > this.maxEntries) {
            const oldestKey = this.keys().next().value;
            super.delete(oldestKey);
        }
        return this.size;
    }
}

module.exports = { BoundedTtlMap };
