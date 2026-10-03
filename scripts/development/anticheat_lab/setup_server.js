'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SERVER = Object.freeze({ version: '1.8.9', sha1: 'b58b2ceb36e01bcd8dbf49c8fb66c55a9f0676cd',
    size: 8320755, url: 'https://launcher.mojang.com/v1/objects/b58b2ceb36e01bcd8dbf49c8fb66c55a9f0676cd/server.jar' });
const defaultDirectory = path.resolve(__dirname, '../../../output/anticheat-lab/server');
function verifyServer(bytes) {
    if (bytes.length !== SERVER.size || crypto.createHash('sha1').update(bytes).digest('hex') !== SERVER.sha1) {
        throw new Error('Official Minecraft server size/hash mismatch');
    }
}
async function setup(directory = defaultDirectory) {
    directory = path.resolve(directory);
    fs.mkdirSync(directory, { recursive: true });
    const jar = path.join(directory, 'minecraft-server-1.8.9.jar');
    if (!fs.existsSync(jar)) {
        const response = await fetch(SERVER.url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`Server download failed: ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        verifyServer(bytes);
        fs.writeFileSync(jar, bytes, { flag: 'wx' });
    }
    verifyServer(fs.readFileSync(jar));
    fs.writeFileSync(path.join(directory, 'artifact.json'), JSON.stringify(SERVER, null, 2) + '\n');
    console.log(JSON.stringify({ jar, ...SERVER }));
    return jar;
}
if (require.main === module) setup(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { setup, verifyServer, SERVER, defaultDirectory };
