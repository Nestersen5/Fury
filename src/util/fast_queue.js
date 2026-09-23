'use strict';

class FastQueue {
    constructor({ compactThreshold = 1024 } = {}) {
        this.items = [];
        this.head = 0;
        this.compactThreshold = Math.max(16, Number(compactThreshold) || 1024);
    }

    get length() {
        return this.items.length - this.head;
    }

    push(value) {
        this.items.push(value);
        return this.length;
    }

    peek(offset = 0) {
        const index = this.head + Math.max(0, Number(offset) || 0);
        return index < this.items.length ? this.items[index] : undefined;
    }

    shift() {
        if (!this.length) return undefined;
        const value = this.items[this.head];
        this.items[this.head] = undefined;
        this.head += 1;
        this.compactIfNeeded();
        return value;
    }

    take(count) {
        const amount = Math.min(this.length, Math.max(0, Math.floor(Number(count) || 0)));
        if (!amount) return [];
        const start = this.head;
        const end = start + amount;
        const values = this.items.slice(start, end);
        for (let index = start; index < end; index += 1) this.items[index] = undefined;
        this.head = end;
        this.compactIfNeeded();
        return values;
    }

    dropOldest(count) {
        const amount = Math.min(this.length, Math.max(0, Math.floor(Number(count) || 0)));
        if (!amount) return 0;
        const end = this.head + amount;
        for (let index = this.head; index < end; index += 1) this.items[index] = undefined;
        this.head = end;
        this.compactIfNeeded();
        return amount;
    }

    findIndex(predicate) {
        if (typeof predicate !== 'function') return -1;
        for (let index = this.head; index < this.items.length; index += 1) {
            if (predicate(this.items[index], index - this.head)) return index - this.head;
        }
        return -1;
    }

    some(predicate) {
        return this.findIndex(predicate) >= 0;
    }

    removeAt(index) {
        const logicalIndex = Math.floor(Number(index));
        if (!Number.isFinite(logicalIndex) || logicalIndex < 0 || logicalIndex >= this.length) return undefined;
        const physicalIndex = this.head + logicalIndex;
        const [removed] = this.items.splice(physicalIndex, 1);
        this.compactIfNeeded();
        return removed;
    }

    clear() {
        this.items = [];
        this.head = 0;
    }

    toArray() {
        return this.items.slice(this.head);
    }

    compactIfNeeded() {
        if (this.head === this.items.length) {
            this.clear();
            return;
        }
        if (this.head >= this.compactThreshold && this.head * 2 >= this.items.length) {
            this.items = this.items.slice(this.head);
            this.head = 0;
        }
    }

    *[Symbol.iterator]() {
        for (let index = this.head; index < this.items.length; index += 1) {
            yield this.items[index];
        }
    }
}

module.exports = { FastQueue };
