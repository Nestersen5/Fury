'use strict';

// Prepare private, current identities for the opt-in isolated live study.
// This never calls Hypixel or Urchin and never changes application caches.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const axios = require('axios');
const { shuffle } = require('./hypixel_live_concurrency');
const root = path.resolve(__dirname, '../..'), directory = path.join(root, 'output/isolated-live-scan');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bucket = stars => stars < 100 ? 0 : stars < 300 ? 1 : stars < 600 ? 2 : 3;

async function run() {
    const source = JSON.parse(fs.readFileSync(path.join(directory, 'aurora-pool.private.json'), 'utf8'));
    const priorIds = new Set();
    for (const file of ['output/hypixel-live-concurrency/requests.jsonl', 'output/urchin-live-concurrency/requests.jsonl']) {
        if (!fs.existsSync(path.join(root, file))) continue;
        for (const line of fs.readFileSync(path.join(root, file), 'utf8').trim().split('\n').filter(Boolean)) priorIds.add(JSON.parse(line).player);
    }
    const recent = source.players.filter(p => p.stars >= 10 && p.lastUpdated >= Date.now() - 86400000 && !priorIds.has(hash(p.uuid)));
    const bins = [0, 1, 2, 3].map(i => shuffle(recent.filter(p => bucket(p.stars) === i), 20261101 + i));
    const candidates = [];
    while (bins.some(x => x.length)) for (const bin of bins) if (bin.length) candidates.push(bin.pop());
    const verified = [], seenNames = new Set(), stats = { checked: 0, rejected: 0, renamed: 0, errors: {} };
    const privateFile = path.join(directory, 'players.private.json');
    const publicFile = path.join(directory, 'player-preparation.json');
    let nextAt = 0;
    const save = () => {
        fs.writeFileSync(privateFile, JSON.stringify({ source: 'live Aurora superstar / Mojang session profile', preparedAt: Date.now(), players: verified }));
        fs.writeFileSync(publicFile, JSON.stringify({ ...stats, verified: verified.length,
            bins: [0, 1, 2, 3].map(i => verified.filter(p => p.bucket === i).length),
            sourcePlayers: source.players.length, freshCandidates: recent.length, target: 320, lastUpdate: new Date().toISOString() }, null, 2));
    };
    for (const candidate of candidates.slice(0, 480)) {
        if (verified.length >= 320) break;
        await sleep(Math.max(0, nextAt - Date.now())); nextAt = Date.now() + 1000;
        stats.checked++;
        try {
            const response = await axios.get(`https://sessionserver.mojang.com/session/minecraft/profile/${candidate.uuid}`, {
                timeout: 5000, maxContentLength: 40000, maxRedirects: 0
            });
            const uuid = String(response.data?.id || '').replace(/-/g, '').toLowerCase(), name = String(response.data?.name || '').trim();
            if (response.status !== 200 || uuid !== candidate.uuid || !/^[A-Za-z0-9_]{3,16}$/.test(name) || seenNames.has(name.toLowerCase())) {
                stats.rejected++; continue;
            }
            seenNames.add(name.toLowerCase());
            if (name.toLowerCase() !== candidate.name.toLowerCase()) stats.renamed++;
            verified.push({ uuid, name, stars: candidate.stars, bucket: bucket(candidate.stars), verifiedAt: Date.now() });
        } catch (error) {
            const key = String(error.response?.status || error.code || 'unknown'); stats.errors[key] = (stats.errors[key] || 0) + 1;
            if (error.response?.status === 429) { save(); throw Error('Mojang preparation was rate limited; no benchmark started'); }
        }
        if (stats.checked % 20 === 0) { save(); console.log(JSON.stringify({ checked: stats.checked, verified: verified.length, rejected: stats.rejected, renamed: stats.renamed, errors: stats.errors })); }
    }
    save();
    if (verified.length < 288) throw Error('Not enough verified players for the complete study');
    console.log(JSON.stringify({ ready: true, verified: verified.length, checked: stats.checked, rejected: stats.rejected,
        renamed: stats.renamed, errors: stats.errors, bins: [0, 1, 2, 3].map(i => verified.filter(p => p.bucket === i).length) }));
}

if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { bucket };
