'use strict';

// UUID normalization helpers and a tiny JWT-payload decoder.

function formatProfileUuid(value) {
    const raw = String(value || '').replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(raw)) return null;
    return raw.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5');
}

function normalizeUuidText(uuid) {
    return String(uuid || '').replace(/-/g, '').toLowerCase();
}

function hyphenateUuid(uuid) {
    const clean = normalizeUuidText(uuid);
    if (!/^[0-9a-f]{32}$/i.test(clean)) return String(uuid || '');
    return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

function decodeJwtPayload(token) {
    if (!token || typeof token !== 'string') return null;
    const payload = token.split('.')[1];
    if (!payload) return null;
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    try {
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch (e) {
        return null;
    }
}

module.exports = { formatProfileUuid, normalizeUuidText, hyphenateUuid, decodeJwtPayload };
