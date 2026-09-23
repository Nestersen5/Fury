'use strict';

const { BoundedTtlMap } = require('../util/bounded_ttl_map.js');
const { InFlightDeduper } = require('../util/in_flight_deduper.js');

const VALID_NAME = /^[A-Za-z0-9_]{3,16}$/;
const VALID_UUID = /^[0-9a-f]{32}$/i;

function normalizeTextureProperties(properties) {
    if (!Array.isArray(properties)) return null;
    const textures = properties
        .filter(property => property
            && property.name === 'textures'
            && typeof property.value === 'string'
            && property.value.length > 0
            && typeof property.signature === 'string'
            && property.signature.length > 0)
        .map(property => ({
            name: 'textures',
            value: property.value,
            signature: property.signature
        }));
    return textures.length > 0 ? textures : null;
}

function mergeTextureProperties(original, textures) {
    const retained = Array.isArray(original)
        ? original.filter(property => property?.name !== 'textures')
        : [];
    return retained.concat(textures.map(property => ({ ...property })));
}

function createRealSkinTextureResolver({
    httpClient,
    timeoutMs = 4000,
    cacheTtlMs = 30 * 60 * 1000,
    failureTtlMs = 60 * 1000,
    maxEntries = 512,
    now = Date.now,
    logger = console
} = {}) {
    if (!httpClient || typeof httpClient.get !== 'function') {
        throw new TypeError('createRealSkinTextureResolver requires an HTTP client with get()');
    }

    const cache = new BoundedTtlMap({
        ttlMs: Math.max(cacheTtlMs, failureTtlMs),
        maxEntries,
        timestampKey: 'expiresFrom',
        now
    });
    const inFlight = new InFlightDeduper();

    function cachedValue(key) {
        const entry = cache.get(key);
        if (!entry) return undefined;
        const age = now() - entry.expiresFrom;
        const ttl = entry.properties ? cacheTtlMs : failureTtlMs;
        if (age > ttl) {
            cache.delete(key);
            return undefined;
        }
        return entry.properties ? entry.properties.map(property => ({ ...property })) : null;
    }

    async function resolve(realName) {
        const name = String(realName || '').trim();
        if (!VALID_NAME.test(name)) return null;
        const key = name.toLowerCase();
        const cached = cachedValue(key);
        if (cached !== undefined) return cached;

        return inFlight.run(key, async () => {
            const afterWait = cachedValue(key);
            if (afterWait !== undefined) return afterWait;

            try {
                const profileResponse = await httpClient.get(
                    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
                    { timeout: timeoutMs }
                );
                const uuid = String(profileResponse?.data?.id || '').replace(/-/g, '');
                if (!VALID_UUID.test(uuid)) throw new Error('Mojang returned an invalid profile UUID');

                const sessionResponse = await httpClient.get(
                    `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}?unsigned=false`,
                    { timeout: timeoutMs }
                );
                const properties = normalizeTextureProperties(sessionResponse?.data?.properties);
                cache.set(key, { properties, expiresFrom: now() });
                return properties ? properties.map(property => ({ ...property })) : null;
            } catch (error) {
                cache.set(key, { properties: null, expiresFrom: now() });
                logger.warn?.(`[Denick] Real skin lookup failed for ${name}:`, error?.message || error);
                return null;
            }
        });
    }

    return {
        resolve,
        clear: () => cache.clear(),
        get cacheSize() { return cache.size; },
        get inFlightSize() { return inFlight.size; }
    };
}

module.exports = {
    createRealSkinTextureResolver,
    normalizeTextureProperties,
    mergeTextureProperties,
    VALID_NAME,
    VALID_UUID
};
