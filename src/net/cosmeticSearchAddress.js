'use strict';

function cosmeticSearchPort(env = process.env) {
    const port = Number(env.COSMETIC_SEARCH_PORT || 3210);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('COSMETIC_SEARCH_PORT must be a valid TCP port.');
    }
    return port;
}

function localCosmeticSearchUrl(env = process.env) {
    return `http://127.0.0.1:${cosmeticSearchPort(env)}`;
}

module.exports = { cosmeticSearchPort, localCosmeticSearchUrl };
