'use strict';

// Port of the injectable's RewardPage/RewardTransport protocol. Read data only;
// never execute scripts from the reward page. Cookies belong to one offer.
const ID = /^[0-9a-f]{8}$/;
const HOST = 'https://rewards.hypixel.net/claim-reward/';
const LIMIT = 1 << 20;

function unescapeString(body) {
    return body.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[^\r\n])/g, (_match, escaped) => {
        if (escaped[0] === 'u' && escaped.length === 5 || escaped[0] === 'x' && escaped.length === 3) {
            return String.fromCharCode(parseInt(escaped.slice(1), 16));
        }
        if (escaped === 'u' || escaped === 'x') throw new Error('Invalid string escape');
        return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', 0: '\0' })[escaped] ?? escaped;
    });
}

function parsePage(html, expectedId) {
    const fail = () => { throw new Error('Unrecognized reward page'); };
    if (typeof html !== 'string' || html.length > LIMIT || !ID.test(expectedId)) fail();
    const app = /window\.appData\s*=\s*'((?:[^'\\\r\n]|\\.){1,65536})'\s*;/.exec(html);
    if (!app) fail();
    const data = JSON.parse(unescapeString(app[1]));
    if (!data || Array.isArray(data) || data.id !== expectedId) fail();
    if (Object.hasOwn(data, 'error')) {
        if (typeof data.error !== 'string' || !data.error.length || data.error.length > 200) fail();
        return { id: expectedId, expired: true, rewards: [] };
    }
    const token = /window\.securityToken\s*=\s*"([A-Za-z0-9_-]{8,128})"\s*;/.exec(html);
    if (!token || typeof data.skippable !== 'boolean' || !Number.isInteger(data.activeAd)
        || data.activeAd < 0 || data.activeAd > 1000 || !Array.isArray(data.rewards)
        || data.rewards.length < 1 || data.rewards.length > 3) fail();
    const rewards = data.rewards.map(row => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) fail();
        const key = Object.hasOwn(row, 'key') ? row.key : row.package;
        if (typeof row.reward !== 'string' || !/^[a-z_]{1,32}$/.test(row.reward)
            || typeof row.rarity !== 'string' || !/^[A-Z_]{1,32}$/.test(row.rarity)
            || row.gameType != null && (typeof row.gameType !== 'string' || !/^[A-Z_]{1,32}$/.test(row.gameType))
            || key != null && (typeof key !== 'string' || !/^[a-z0-9_'.-]{1,96}$/.test(key))
            || Object.hasOwn(row, 'amount') && (!Number.isInteger(row.amount) || row.amount < 0 || row.amount > 100000000)) fail();
        return { type: row.reward, rarity: row.rarity, gameType: row.gameType ?? null, key: key ?? null, amount: row.amount ?? -1 };
    });
    const streak = data.dailyStreak;
    const count = key => {
        const value = streak?.[key] ?? 0;
        if (!Number.isInteger(value) || Math.abs(value) > 1e12) fail();
        return Math.max(0, Math.min(100000, value));
    };
    return { id: expectedId, expired: false, securityToken: token[1], rewards,
        skippable: data.skippable, activeAd: data.activeAd,
        streakScore: count('score'), streakHigh: count('highScore'),
        streakKeeps: streak?.keeps === true, streakToken: streak?.token === true };
}

function pageUrl(id) {
    if (!ID.test(id)) throw new Error('Invalid reward link');
    return HOST + id;
}

function claimUrl(page, option) {
    pageUrl(page.id);
    if (!Number.isInteger(option) || option < 0 || option >= page.rewards.length) throw new Error('Invalid reward choice');
    return `${HOST}claim?${new URLSearchParams({ option, id: page.id, activeAd: page.activeAd,
        _csrf: page.securityToken, watchedFallback: 'false', skipped: '0' })}`;
}

function cookieHeader(headers) {
    return (Array.isArray(headers) ? headers : []).filter(header => typeof header === 'string')
        .map(header => header.split(';', 1)[0].trim())
        .filter(pair => /^[A-Za-z0-9_.-]{1,64}=[A-Za-z0-9_.%~+/=-]{0,512}$/.test(pair)).slice(0, 8).join('; ');
}

function createTransport(axios) {
    async function request(method, url, { signal, cookie, referer } = {}) {
        const target = new URL(url);
        if (target.origin !== 'https://rewards.hypixel.net' || target.username || target.password
            || !/^\/claim-reward\/(?:[0-9a-f]{8}|claim)$/.test(target.pathname)) throw new Error('Unexpected reward host');
        const response = await axios.request({ method, url, signal, data: method === 'POST' ? '' : undefined,
            timeout: 15000, maxRedirects: 0, maxContentLength: LIMIT, maxBodyLength: LIMIT,
            responseType: 'text', transformResponse: [body => body], validateStatus: () => true,
            headers: { 'User-Agent': 'Mozilla/5.0 Fury', Accept: method === 'GET' ? 'text/html' : '*/*',
                ...(cookie ? { Cookie: cookie } : {}),
                ...(referer ? { Referer: referer, Origin: 'https://rewards.hypixel.net' } : {}) } });
        return { status: response.status, body: response.data, cookies: response.headers?.['set-cookie'] || [] };
    }
    return { get: (url, options) => request('GET', url, options),
        post: (url, options) => request('POST', url, options) };
}

module.exports = { ID, HOST, LIMIT, unescapeString, parsePage, pageUrl, claimUrl, cookieHeader, createTransport };
