'use strict';

const fs = require('fs');
const { publicationStamp, readPublicationStamp } = require('./filePublication');

class JsonFileCache {
    constructor(filePath, {
        fallback = () => null,
        transform = value => value,
        fsImpl = fs,
        onError = null,
        checkIntervalMs = 0,
        now = Date.now,
        publicationAware = false
    } = {}) {
        this.filePath = filePath;
        this.fallback = typeof fallback === 'function' ? fallback : () => fallback;
        this.transform = typeof transform === 'function' ? transform : value => value;
        this.fs = fsImpl;
        this.onError = typeof onError === 'function' ? onError : null;
        this.checkIntervalMs = Math.max(0, Number(checkIntervalMs) || 0);
        this.now = typeof now === 'function' ? now : Date.now;
        this.publicationAware = publicationAware;
        this.nextCheckAt = 0;
        this.stamp = null;
        this.failedStamp = null;
        this.value = undefined;
        this.hasValue = false;
    }

    reportError(error) {
        if (this.onError) this.onError(error);
    }

    get() {
        const now = this.now();
        if (this.hasValue && this.checkIntervalMs > 0 && now < this.nextCheckAt) return this.value;
        this.nextCheckAt = now + this.checkIntervalMs;

        let stat;
        try {
            stat = this.fs.statSync(this.filePath, this.publicationAware ? { bigint: true } : undefined);
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                this.reportError(error);
                if (!this.hasValue) {
                    this.value = this.fallback();
                    this.hasValue = true;
                }
                return this.value;
            }
            if (this.stamp !== 'missing' || !this.hasValue) {
                this.value = this.fallback();
                this.hasValue = true;
                this.stamp = 'missing';
                this.failedStamp = null;
            }
            return this.value;
        }

        const stamp = this.publicationAware ? publicationStamp(stat) : `${stat.mtimeMs}:${stat.size}`;
        if (this.hasValue && (this.stamp === stamp || this.failedStamp === stamp)) return this.value;

        try {
            const parsed = JSON.parse(this.fs.readFileSync(this.filePath, 'utf8'));
            this.value = this.transform(parsed);
            this.hasValue = true;
            this.stamp = stamp;
            this.failedStamp = null;
        } catch (error) {
            this.reportError(error);
            this.failedStamp = stamp;
            if (!this.hasValue) {
                this.value = this.fallback();
                this.hasValue = true;
            }
        }
        return this.value;
    }

    invalidate() {
        this.stamp = null;
        this.failedStamp = null;
        this.nextCheckAt = 0;
    }

    set(value, { stamp = this.stamp } = {}) {
        this.value = value;
        this.hasValue = true;
        this.stamp = stamp;
        this.failedStamp = null;
        this.nextCheckAt = this.now() + this.checkIntervalMs;
        return this.value;
    }

    // Never stat the destination to infer which write was acknowledged: an
    // external publisher may already have replaced it by callback delivery.
    markWritten(publication) {
        if (!this.publicationAware || publication?.version !== 1 || typeof publication.stamp !== 'string') {
            throw new Error('Missing file publication receipt.');
        }
        this.stamp = publication.stamp;
        this.failedStamp = null;
        this.nextCheckAt = 0;
    }

    isCurrentPublication(stamp = this.stamp) {
        return readPublicationStamp(this.filePath, this.fs) === stamp;
    }
}

module.exports = { JsonFileCache };
