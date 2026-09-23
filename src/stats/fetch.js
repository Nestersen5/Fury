'use strict';

// Player profile fetch pipeline: cache lookup, Mojang -> Hypixel
// resolution, parallel Urchin/Seraph/status/ping fan-out, error
// classification, and in-flight deduping. Extracted from proxy.js;
// proxy.js still owns the cache, key store, dedupe instance, and the
// per-service raw fetchers, and injects them via createStatsFetch.

const axios = require('axios');

function withoutEnderDust(player) {
    let clean = player;
    const stripPrivateSlumberProgress = (slumber) => {
        if (!slumber || typeof slumber !== 'object') return slumber;
        let next = slumber;
        if (slumber.minion && Object.prototype.hasOwnProperty.call(slumber.minion, 'ender_dust')) {
            next = { ...next, minion: { ...slumber.minion } };
            delete next.minion.ender_dust;
        }
        if (slumber.quest?.lastCompleted && typeof slumber.quest.lastCompleted === 'object') {
            next = { ...next, quest: { ...slumber.quest } };
            delete next.quest.lastCompleted;
        }
        return next;
    };

    if (clean?.slumber) clean = { ...clean, slumber: stripPrivateSlumberProgress(clean.slumber) };

    for (const key of ['Bedwars', 'BedWars']) {
        const slumber = clean?.stats?.[key]?.slumber;
        if (!slumber) continue;
        clean = {
            ...clean,
            stats: {
                ...clean.stats,
                [key]: {
                    ...clean.stats[key],
                    slumber: stripPrivateSlumberProgress(slumber)
                }
            }
        };
    }
    return clean;
}

function createStatsFetch({
    globalCache,
    cacheDuration,
    getHypixelKey,
    hasHypixelApiKeyConfigured,
    hypixelApiGet,
    getUrchinRaw,
    getSeraphRaw,
    getAuroraPingRaw,
    getHypixelStatusRaw,
    makePingData,
    mergeUrchinOverride,
    notifyUrchinOutageOnce,
    classifyPlayerLookupError,
    playerLookupDeduper,
    observeHypixelPlayerData = () => {}
} = {}) {
    const required = {
        globalCache, cacheDuration, getHypixelKey,
        hasHypixelApiKeyConfigured, hypixelApiGet, getUrchinRaw, getSeraphRaw,
        getAuroraPingRaw, getHypixelStatusRaw, makePingData, mergeUrchinOverride,
        notifyUrchinOutageOnce, classifyPlayerLookupError, playerLookupDeduper
    };
    for (const [name, value] of Object.entries(required)) {
        if (value === undefined || value === null) {
            throw new Error(`createStatsFetch requires ${name}`);
        }
    }

    const pendingUrchinOverrides = new Map();

    async function getPlayerData(name, options = {}) {
        const includeErrors = Boolean(options.includeErrors);
        const forceRefresh = Boolean(options.forceRefresh);
        const includeStatus = Boolean(options.includeStatus);
        const preferCache = options.preferCache !== undefined ? Boolean(options.preferCache) : true;
        const urchinOverride = options.urchinOverride || null;
        const lowerName = name.toLowerCase();
        const dedupeKey = `${lowerName}|errors:${includeErrors ? 1 : 0}|status:${includeStatus ? 1 : 0}`;
        const cached = globalCache.get(lowerName);
        if (preferCache && !forceRefresh && cached && (Date.now() - cached.timestamp < cacheDuration)) {
            if (urchinOverride) {
                cached.data.urchin = mergeUrchinOverride(cached.data.urchin, urchinOverride);
            }
            if (!cached.data.ping || cached.data.ping.requestStatus === 'not_checked') {
                const uuid = cached.data.player?.uuid;
                cached.data.ping = uuid ? await getAuroraPingRaw(uuid) : makePingData({
                    ok: false,
                    requestStatus: 'missing_uuid',
                    error: 'Missing player UUID.'
                });
            }
            notifyUrchinOutageOnce(cached.data?.urchin);
            if (includeStatus && (!cached.data.status || cached.data.status === '§7Not checked')) {
                const uuid = cached.data.player?.uuid;
                const status = uuid ? await getHypixelStatusRaw(uuid) : '§7Unknown';
                cached.data.status = status;
            }
            return { data: cached.data, fromCache: true };
        }

        if (!hasHypixelApiKeyConfigured()) {
            return includeErrors
                ? { error: true, errorType: 'hypixel_key_failed', message: 'Hypixel API key is missing.' }
                : null;
        }

        if (urchinOverride) pendingUrchinOverrides.set(dedupeKey, urchinOverride);

        const executeLookup = async () => {
            try {
                const mRes = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${name}`, { timeout: 3000 });
                const uuid = mRes.data?.id;
                if (!uuid) {
                    const miss = { error: true, errorType: 'player_not_found', message: 'Player was not found.' };
                    return includeErrors ? miss : null;
                }

                const activeUrchinOverride = pendingUrchinOverrides.get(dedupeKey) || null;
                const [hRes, urchin, seraph, status, ping] = await Promise.all([
                    hypixelApiGet(`https://api.hypixel.net/v2/player?uuid=${uuid}`, {
                        timeout: 5000,
                        apiPriority: options.apiPriority
                    }),
                    activeUrchinOverride ? Promise.resolve(activeUrchinOverride) : getUrchinRaw(name, uuid),
                    getSeraphRaw(uuid),
                    includeStatus ? getHypixelStatusRaw(uuid) : Promise.resolve('§7Not checked'),
                    getAuroraPingRaw(uuid)
                ]);

                if (!hRes.data.player) {
                    const miss = { error: true, errorType: 'hypixel_player_missing', message: 'Player has no Hypixel profile data.' };
                    return includeErrors ? miss : null;
                }

                // The host returns true only for the local account. We retain
                // its private Slumber readings in the reminders, but strip
                // other players' minion and quest progress before caching.
                let isOwnPlayer = false;
                try {
                    isOwnPlayer = Boolean(observeHypixelPlayerData(uuid, hRes.data.player));
                } catch (error) {
                    // A reminder observer must never affect a stats lookup.
                }

                const data = {
                    player: isOwnPlayer ? hRes.data.player : withoutEnderDust(hRes.data.player),
                    urchin,
                    seraph,
                    status,
                    ping
                };
                globalCache.set(lowerName, { data, timestamp: Date.now() });
                return { data, fromCache: false };
            } catch (e) {
                const classified = classifyPlayerLookupError(e, 'hypixel');
                return includeErrors ? classified : null;
            } finally {
                pendingUrchinOverrides.delete(dedupeKey);
            }
        };

        const profile = await playerLookupDeduper.run(dedupeKey, executeLookup);
        if (urchinOverride && profile?.data) {
            const data = {
                ...profile.data,
                urchin: mergeUrchinOverride(profile.data.urchin, urchinOverride)
            };
            globalCache.set(lowerName, { data, timestamp: Date.now() });
            return { ...profile, data };
        }
        return profile;
    }

    return { getPlayerData };
}

module.exports = { createStatsFetch };
