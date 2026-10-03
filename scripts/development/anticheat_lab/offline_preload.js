'use strict';

// Explicitly opted-in, isolated test-process seam, following the repository's
// offline integration fixtures. Production authentication/config is untouched.
const fs = require('fs');
const path = require('path');
const net = require('net');
const root = path.resolve(__dirname, '../../..');
const port = Number(process.env.FURY_LAB_SERVER_PORT);
if (process.env.FURY_LAB_ISOLATED !== '1' || !Number.isInteger(port) || port < 1 || port > 65535
    || !process.env.FURY_DATA_DIR || path.resolve(process.env.FURY_DATA_DIR) === root) {
    throw new Error('The lab preload requires an isolated profile and a local server port.');
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    let normalized = args;
    while (Array.isArray(normalized[0])) normalized = normalized[0];
    const first = normalized[0];
    const host = typeof first === 'object' ? first.host || 'localhost'
        : typeof normalized[1] === 'string' ? normalized[1] : 'localhost';
    if (!['127.0.0.1', 'localhost', '::1'].includes(String(host))) {
        fs.appendFileSync(path.join(process.env.FURY_DATA_DIR, 'blocked-network.jsonl'),
            JSON.stringify({ t: Date.now(), host: String(host) }) + '\n');
        process.nextTick(() => this.destroy(new Error('Anticheat lab permits only loopback connections')));
        return this;
    }
    return originalConnect.apply(this, args);
};

const mc = require('minecraft-protocol');
const createServer = mc.createServer;
const createClient = mc.createClient;
mc.createServer = options => createServer({ ...options, host: '127.0.0.1', 'online-mode': false });
mc.createClient = options => createClient({ ...options, host: '127.0.0.1', port, auth: 'offline',
    session: undefined, accessToken: undefined, clientToken: undefined });
require(path.join(root, 'src/accounts/connectionAuth.js')).hasSavedLogin = () => true;

// Optional verification probe: observe the actual Fury callbacks and the exact
// compact inputs used by combat detectors, without changing their decisions.
// This is absent from production and disabled in ordinary campaign workers.
if (process.env.FURY_LAB_TRACE_DETECTORS === '1') {
    const trace = fs.createWriteStream(path.join(process.env.FURY_DATA_DIR, 'lab-detector-trace.jsonl'), { flags: 'wx' });
    let instance = 0;
    const write = event => trace.write(JSON.stringify({ observedAt: Date.now(), ...event }) + '\n');
    for (const [file, factory, family] of [['autoblockDetector.js', 'createAutoblockDetector', 'Autoblock'],
        ['stasisDetector.js', 'createStasisDetector', 'Stasis'], ['scaffoldDetector.js', 'createScaffoldDetector', 'Scaffold']]) {
        const owning = require(path.join(root, 'src/detect', file)), original = owning[factory];
        owning[factory] = (deps = {}) => {
            const id = ++instance; write({ kind: 'create', id, family });
            const detector = original({ ...deps, onFlag: flag => {
                write({ kind: 'flag', id, family, flag }); deps.onFlag?.(flag);
            } });
            if (family !== 'Scaffold') {
                const observe = detector.observeRecord, clear = detector.clear;
                detector.observeRecord = record => { write({ kind: 'record', id, family, record }); return observe(record); };
                detector.clear = () => { write({ kind: 'clear', id, family }); return clear(); };
            }
            return detector;
        };
    }
}
