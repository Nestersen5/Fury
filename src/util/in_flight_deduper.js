'use strict';

class InFlightDeduper {
    constructor() {
        this.requests = new Map();
    }

    run(key, factory) {
        if (this.requests.has(key)) return this.requests.get(key);
        const request = Promise.resolve()
            .then(factory)
            .finally(() => {
                if (this.requests.get(key) === request) this.requests.delete(key);
            });
        this.requests.set(key, request);
        return request;
    }

    get size() {
        return this.requests.size;
    }
}

module.exports = { InFlightDeduper };
