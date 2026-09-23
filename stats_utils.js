const axios = require('axios');

// --- FORMATTING & UI HELPERS ---
function stripAnsi(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/§[0-9a-fk-or]/g, '');
}

function extractText(jsonMsg) {
    if (typeof jsonMsg === 'string') return stripAnsi(jsonMsg);
    let text = jsonMsg.text || '';
    if (jsonMsg.extra) {
        jsonMsg.extra.forEach(e => {
            if (typeof e === 'string') text += e;
            else if (e.text) text += e.text;
        });
    }
    return stripAnsi(text);
}

function sendChat(client, message) {
    try {
        client.write('chat', { message: JSON.stringify({ text: message }), position: 0 });
    } catch (e) {}
}

// Rank rendering lives in features/minecraft_chat.js so YouTube, staff and
// AQUA-coloured MVP++ ranks read identically everywhere. Re-exported here
// for the callers that still pull rank formatting from this module.
const { getRankedName } = require('./features/minecraft_chat.js');

// --- COLOR LOGIC ---
function getStarColor(s) {
    const colors = ['§7','§f','§e','§b','§a','§3','§4','§d','§9','§5'];
    return colors[Math.floor(Math.min(s, 999) / 100)] || '§6';
}

function getFkdrColor(fkdr) {
    if (fkdr < 1) return '§7';
    if (fkdr < 3) return '§a';
    if (fkdr < 6) return '§2';
    if (fkdr < 10) return '§e';
    if (fkdr < 15) return '§6';
    return '§4';
}

function getWlrColor(wlr) {
    if (wlr < 1) return '§7';
    if (wlr < 3) return '§a';
    if (wlr < 5) return '§6';
    return '§4';
}

function getWsColor(ws) {
    if (ws === 0) return '§7';
    if (ws < 5) return '§a';
    if (ws < 10) return '§6';
    return '§4';
}

function getPingColor(p) {
    return p < 0 ? '§7' : p < 80 ? '§a' : p < 140 ? '§e' : '§c';
}

function getHypixelColor(c) {
    const colors = {
        'BLACK': '§0', 'DARK_BLUE': '§1', 'DARK_GREEN': '§2', 'DARK_AQUA': '§3',
        'DARK_RED': '§4', 'DARK_PURPLE': '§5', 'GOLD': '§6', 'GRAY': '§7',
        'DARK_GRAY': '§8', 'BLUE': '§9', 'GREEN': '§a', 'AQUA': '§b',
        'RED': '§c', 'LIGHT_PURPLE': '§d', 'YELLOW': '§e', 'WHITE': '§f'
    };
    return colors[c] || '§c';
}

// --- API FETCHING ---
async function getHypixelStatusRaw(uuid, apiKey) {
    try {
        const res = await axios.get(`https://api.hypixel.net/status?key=${apiKey}&uuid=${uuid}`, { timeout: 1500 });
        const s = res.data.session;
        if (!s || !s.online) return '§7Offline';
        const game = s.gameType === 'BEDWARS' ? 'Bedwars' : s.gameType;
        const mode = s.mode ? `(${s.mode.toLowerCase().replace('eight_one', 'solos').replace('eight_two', 'doubles')})` : '';
        const map = s.map ? `on §e${s.map}` : '';
        return `§aPlaying ${game} ${mode} ${map}`;
    } catch (e) { return '§7Unknown'; }
}

async function getUrchinRaw(name, uuid, urchinKey) {
    if (!urchinKey) return { tag: '' };
    try {
        const res = await axios.get(`https://api.urchin.gg/v3/cubelify?uuid=${uuid}&name=${name}&key=${urchinKey}&sources=GAME`, { timeout: 1500 });
        const tags = res.data.tags || [];
        let data = { tag: '' };
        tags.forEach(obj => {
            if (obj.tooltip && obj.tooltip.toLowerCase().includes('added by')) {
                data.tag = obj.tooltip.split('(')[0].trim().replace(/Time since last.*/gi, "");
            }
        });
        return data;
    } catch (e) { return { tag: '' }; }
}

function validPingNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : -1;
}

function hyphenateUuid(uuid) {
    const clean = String(uuid || '').replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/i.test(clean)) return String(uuid || '');
    return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

function summarizePingRows(rows = []) {
    const avgValues = rows.map(row => validPingNumber(row.avg)).filter(value => value > 0);
    return {
        ping: avgValues.length ? Math.round(avgValues.reduce((sum, value) => sum + value, 0) / avgValues.length) : -1
    };
}

async function getAuroraPingRaw(uuid, auroraKey) {
    if (!auroraKey) return { ping: -1, avgPing: -1 };
    try {
        const res = await axios.get('https://bordic.xyz/api/v2/resources/ping', {
            timeout: 3500,
            params: { uuid: hyphenateUuid(uuid), key: auroraKey }
        });
        const rows = Array.isArray(res.data?.data) ? res.data.data
            .filter(row => validPingNumber(row.avg) > 0)
            .sort((a, b) => String(b.day || '').localeCompare(String(a.day || '')))
            : [];
        const latest = rows[0] || null;
        const weekly = summarizePingRows(rows.slice(0, 7));
        return {
            ping: validPingNumber(latest?.avg),
            avgPing: validPingNumber(weekly.ping)
        };
    } catch (e) {
        return { ping: -1, avgPing: -1 };
    }
}

async function getPlayerData(name, keys, cache, CACHE_DURATION) {
    const lowerName = name.toLowerCase();
    const cached = cache.get(lowerName);
    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
        return { data: cached.data, fromCache: true };
    }
    if (!keys.hypixel) return null;

    try {
        const mRes = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${name}`, { timeout: 3000 });
        const uuid = mRes.data.id;
        const [hRes, urchin, status, ping] = await Promise.all([
            axios.get(`https://api.hypixel.net/player?key=${keys.hypixel}&uuid=${uuid}`, { timeout: 5000 }),
            getUrchinRaw(name, uuid, keys.urchin),
            getHypixelStatusRaw(uuid, keys.hypixel),
            getAuroraPingRaw(uuid, keys.aurora)
        ]);
        if (!hRes.data.player) return null;
        const data = { player: hRes.data.player, urchin, status, ping };
        cache.set(lowerName, { data, timestamp: Date.now() });
        return { data, fromCache: false };
    } catch (e) { return null; }
}

module.exports = {
    stripAnsi, extractText, sendChat, getRankedName,
    getStarColor, getFkdrColor, getWlrColor, getWsColor, getPingColor, getHypixelColor,
    getHypixelStatusRaw, getUrchinRaw, getAuroraPingRaw, getPlayerData
};
