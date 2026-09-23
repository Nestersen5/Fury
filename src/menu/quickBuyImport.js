'use strict';

function parseQuickBuy(player) {
    const value = player?.stats?.Bedwars?.favourites_2;
    if (value === undefined || value === null) throw new Error('Quick Buy is not available in this player’s API data (it may be private)');
    if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid Quick Buy API data');
    const slots = value.split(',').map(value => value.trim());
    if (slots.length !== 21) throw new Error(`Expected 21 Quick Buy positions, received ${slots.length}`);
    const seen = new Set();
    return slots.map(id => {
        if (id === '' || id === 'null') return null;
        if (!/^[a-z0-9_()\-]+$/.test(id) || id.length > 120) throw new Error(`Invalid Quick Buy item identifier: ${id.slice(0, 40)}`);
        if (seen.has(id)) throw new Error(`Duplicate Quick Buy item identifier: ${id}`);
        seen.add(id);
        return { databaseName: id };
    });
}

function createQuickBuyPlayerLookup({ globalCache, cacheDuration, getPlayerData, now = Date.now }) {
    return async name => {
        if (!/^[a-zA-Z0-9_]{1,16}$/.test(name)) throw new Error('Enter a valid Minecraft player name');
        // Reuse the full stats profile, including a deliberately absent private
        // field. This retains favourites_2 and favorite_slots when present.
        // Never force-refresh just because either visibility field is missing.
        const cached = globalCache.get(name.toLowerCase());
        if (cached?.data?.player && now() - cached.timestamp < cacheDuration) return cached.data.player;
        // Shared lookup also handles in-flight deduplication, API key selection,
        // rate limits, errors and cache population used by normal stats lookups.
        const profile = await getPlayerData(name, { includeErrors: true, preferCache: true });
        if (profile?.error) throw new Error(profile.message || 'Hypixel player lookup failed');
        if (!profile?.data?.player) throw new Error('Hypixel did not return a player profile');
        return profile.data.player;
    };
}

module.exports = { parseQuickBuy, createQuickBuyPlayerLookup };
