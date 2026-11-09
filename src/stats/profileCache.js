'use strict';

const { realAccountUuid } = require('../denick/identity');

function getCachedPlayerProfile(cache, name, uuid) {
    const byName = cache.get(String(name || '').toLowerCase());
    const account = realAccountUuid(uuid);
    if (!account) return byName;
    const byUuid = cache.get(`uuid:${account}`);
    if (realAccountUuid(byUuid?.data?.player?.uuid) === account) return byUuid;
    return realAccountUuid(byName?.data?.player?.uuid) === account ? byName : null;
}

function getCachedAccountUuid(cache, name) {
    const data = getCachedPlayerProfile(cache, name)?.data;
    if (!data?.player || data.isNicked || data.lookupFailed
        || String(data.player.displayname || '').toLowerCase() !== String(name || '').toLowerCase()) return null;
    return realAccountUuid(data.player.uuid);
}

module.exports = { getCachedPlayerProfile, getCachedAccountUuid };
