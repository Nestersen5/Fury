'use strict';
const { isIP } = require('net');

function cosmeticBindHost(env = process.env) {
    // A launcher-owned service cannot inherit a standalone public bind.
    if (env.FURY_SERVICE_INSTANCE) return '127.0.0.1';
    const host = String(env.COSMETIC_SEARCH_BIND_HOST || '127.0.0.1').trim();
    if (host === 'localhost') return '127.0.0.1';
    if (!isIP(host)) throw new Error('COSMETIC_SEARCH_BIND_HOST must be an explicit IPv4/IPv6 address or localhost.');
    return host;
}
module.exports = { cosmeticBindHost };
