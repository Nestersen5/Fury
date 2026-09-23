'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '../..');

if (process.env.FURY_COSMETIC_TEST_PRELOAD === '1') {
    const axios = require('axios');
    const players = [
        { name: 'Alpha', uuid: 'a', killMessage: 'killmessages_counter', activeSprays: null, activeBedDestroy: 'random_cosmetic' },
        { name: 'Beta', uuid: 'b', killMessage: 'killmessages_counter', activeSprays: 'spray_fire', activeBedDestroy: 'random_favorite_cosmetic' },
        { name: 'Gamma', uuid: 'c', killMessage: 'killmessages_other', activeSprays: null, activeBedDestroy: 'beddestroy_ghosts' }
    ];
    axios.get = async (url, options) => {
        assert.equal(url, 'https://bordic.xyz/api/v2/resources/superstar');
        const key = options.params.key;
        process.send?.({ type: 'aurora-request', key });
        if (key === 'error-key') return { data: { success: false, error: 'Synthetic Aurora error.' } };
        if (key === 'timeout-key') throw Object.assign(new Error('Synthetic timeout.'), { code: 'ECONNABORTED' });
        if (key === 'slow-key') await new Promise(resolve => setTimeout(resolve, 80));
        return { data: { success: true, data: key === 'key-b'
            ? [{ name: 'Changed', uuid: 'd', killMessage: 'new_key_cosmetic' }]
            : players } };
    };
} else {
    const { superviseChild } = require('../../src/bootstrap/childShutdown');

    async function freePort() {
        const server = net.createServer();
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        await new Promise(resolve => server.close(resolve));
        return port;
    }

    function get(port, pathname) {
        return new Promise((resolve, reject) => {
            http.get(`http://127.0.0.1:${port}${pathname}`, response => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', chunk => { body += chunk; });
                response.on('end', () => {
                    try { resolve({ status: response.statusCode, body: JSON.parse(body) }); }
                    catch (error) { reject(error); }
                });
            }).on('error', reject);
        });
    }

    async function eventually(check, message) {
        let error;
        const deadline = Date.now() + 7000;
        do {
            try { return await check(); } catch (next) { error = next; }
            await new Promise(resolve => setTimeout(resolve, 40));
        } while (Date.now() < deadline);
        throw new Error(`${message}: ${error?.message || 'timed out'}`);
    }

    async function main() {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-cosmetic-local-'));
        const port = await freePort();
        const children = [];
        const writeKey = key => fs.writeFileSync(path.join(dataDir, 'statmod_key.txt'), `Aurora API key: ${key}\n`);
        const cacheFile = path.join(dataDir, 'cosmetic_search_cache.json');
        async function start() {
            const instanceId = randomUUID();
            const env = { ...process.env, FURY_DATA_DIR: dataDir, COSMETIC_SEARCH_PORT: String(port),
                COSMETIC_SEARCH_BIND_HOST: '0.0.0.0', COSMETIC_SEARCH_API_URL: 'https://unused.invalid',
                AURORA_API_KEY: 'wrong-environment-key', FURY_SERVICE_INSTANCE: instanceId,
                FURY_COSMETIC_TEST_PRELOAD: '1' };
            const child = spawn(process.execPath, ['--require', __filename, path.join(root, 'cosmetic_search_api.js')],
                { cwd: dataDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
            const session = { child, instanceId, requests: [], output: '' };
            children.push(session);
            child.on('message', message => { if (message?.type === 'aurora-request') session.requests.push(message.key); });
            child.stdout.on('data', chunk => { session.output += chunk; });
            child.stderr.on('data', chunk => { session.output += chunk; });
            await eventually(async () => {
                assert.equal(child.exitCode, null, session.output);
                assert.equal((await get(port, '/health')).status, 200);
            }, 'Cosmetic Search startup');
            return session;
        }
        async function stop(session) {
            const result = await superviseChild(session.child, session.instanceId).stop();
            assert.equal(result.clean, true, `F7 shutdown: ${JSON.stringify(result)} ${session.output}`);
            assert.equal(result.exited, true);
            assert(!/key-a|key-b|error-key|timeout-key|slow-key/.test(session.output), 'API key entered service logs');
        }
        try {
            writeKey('key-a');
            const first = await start();
            const search = query => get(port, `/api/cosmetics/search?${query}`);
            assert.equal((await get(port, '/api/cosmetics/fields')).body.fields.length, 12);
            let result = await search('killMessage=killmessages_counter');
            assert.equal(result.status, 200);
            assert.equal(result.body.totalMatches, 2);
            assert.deepEqual(result.body.data.map(row => row.name), ['Alpha', 'Beta']);
            assert.equal((await search('killmsg=killmessages_counter')).body.totalMatches, 2);
            assert.equal((await search('activeSprays=null')).body.totalMatches, 2);
            assert.equal((await search('bedDestroy=random')).body.totalMatches, 2);
            assert.equal((await search('killMessage=killmessages_counter,killmessages_other')).body.totalMatches, 3);
            assert.equal((await search('killMessage=killmessages_counter&activeSprays=null')).body.totalMatches, 1);
            assert.equal((await search('killMessage=absent')).body.totalMatches, 0);
            assert.equal((await search('unknown=value')).body.totalMatches, 0);
            result = await search('killMessage=killmessages_counter&limit=1&offset=1');
            assert.equal(result.body.totalMatches, 2);
            assert.equal(result.body.data[0].name, 'Beta');
            assert.deepEqual(first.requests, ['key-a'], 'Fresh cache must avoid repeat Aurora calls');

            writeKey('key-b');
            result = await search('killMessage=new_key_cosmetic');
            assert.equal(result.body.data[0].name, 'Changed');
            assert.deepEqual(first.requests, ['key-a', 'key-b'], 'Running child must read saved Aurora key');
            writeKey('error-key');
            assert.equal((await search('killMessage=anything')).status, 502);
            writeKey('timeout-key');
            assert.equal((await search('killMessage=anything')).status, 502);
            writeKey('');
            result = await search('killMessage=anything');
            assert.equal(result.status, 502);
            assert.match(result.body.error, /Aurora API key is missing/);
            writeKey('slow-key');
            const concurrent = await Promise.all(Array.from({ length: 3 }, () => search('killMessage=killmessages_counter')));
            assert(concurrent.every(reply => reply.status === 200 && reply.body.totalMatches === 2));
            await stop(first);

            // A fresh disk cache survives Stop -> Start and refresh still reaches Aurora.
            writeKey('key-a');
            fs.writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), resource: 'superstar',
                players: [{ name: 'Disk', uuid: 'disk', killMessage: 'disk_value' }] }));
            const second = await start();
            assert.equal((await search('killMessage=disk_value')).body.data[0].name, 'Disk');
            assert.equal(second.requests.length, 0);
            assert.equal((await search('killMessage=killmessages_counter&refresh=1')).body.totalMatches, 2);
            assert.deepEqual(second.requests, ['key-a']);
            await stop(second);

            // An expired disk entry is refreshed, rather than returned as current.
            fs.writeFileSync(cacheFile, JSON.stringify({ at: Date.now() - 60 * 60 * 1000, resource: 'superstar',
                players: [{ name: 'Expired', uuid: 'expired', killMessage: 'expired_value' }] }));
            const third = await start();
            assert.equal((await search('killMessage=killmessages_counter')).body.totalMatches, 2);
            await eventually(() => assert.deepEqual(third.requests, ['key-a']), 'Expired cache refetch notification');
            await stop(third);
            console.log('PASS local Cosmetic Search exact filters, cache, key refresh, errors, concurrency and F7 restart');
        } finally {
            for (const session of children) {
                if (session.child.exitCode === null && session.child.signalCode === null) {
                    session.child.kill('SIGKILL');
                    await eventually(() => {
                        assert.notEqual(session.child.exitCode ?? session.child.signalCode, null);
                    }, 'Cosmetic Search test cleanup');
                }
            }
            assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
            assert(path.basename(dataDir).startsWith('fury-cosmetic-local-'));
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    }

    main().catch(error => { console.error(error); process.exitCode = 1; });
}
