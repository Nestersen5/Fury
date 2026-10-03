'use strict';

// Snapshot current working-tree detector code and the private local corpus.
// No original cheat code is imported, compiled, or executed by the lab.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '../../..');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function snapshot(destination) {
    destination = path.resolve(destination);
    if (fs.existsSync(destination)) throw new Error('Baseline already exists; select a new destination.');
    fs.mkdirSync(path.join(destination, 'detectors'), { recursive: true });
    fs.mkdirSync(path.join(destination, 'recordings'));
    const manifest = { createdAt: new Date().toISOString(), node: process.version, platform: process.platform,
        arch: process.arch, sources: [], recordings: [], tests: [], runtimeClaims: 'none; recorded corpus and unit tests only' };
    for (const name of fs.readdirSync(path.join(root, 'src/detect')).filter(n => n.endsWith('.js')).sort()) {
        const bytes = fs.readFileSync(path.join(root, 'src/detect', name));
        fs.writeFileSync(path.join(destination, 'detectors', name), bytes);
        manifest.sources.push({ path: `src/detect/${name}`, sha256: sha256(bytes) });
    }
    for (const name of ['proxy.js', 'src/recorder/packetRecorder.js', 'src/recorder/recordingAnalysis.js']) {
        manifest.sources.push({ path: name, sha256: sha256(fs.readFileSync(path.join(root, name))) });
    }
    for (const name of fs.readdirSync(path.join(root, 'recordings')).filter(n => n.endsWith('.jsonl')).sort()) {
        const bytes = fs.readFileSync(path.join(root, 'recordings', name));
        fs.writeFileSync(path.join(destination, 'recordings', name), bytes);
        const records = bytes.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        const header = records.find(r => r.k === 'header') || {};
        const times = records.reduce((a, r) => Number.isFinite(r.t)
            ? { min: Math.min(a.min, r.t), max: Math.max(a.max, r.t) } : a, { min: Infinity, max: -Infinity });
        manifest.recordings.push({ file: name, sha256: sha256(bytes), bytes: bytes.length, records: records.length,
            label: header.label, source: header.source, durationMs: Number.isFinite(times.min) ? times.max - times.min : 0 });
    }
    for (const file of ['tests/features/test_scaffold_detector.js', 'tests/features/test_combat_detectors.js']) {
        const start = performance.now();
        const result = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
        const log = `${path.basename(file, '.js')}.txt`;
        fs.writeFileSync(path.join(destination, log), (result.stdout || '') + (result.stderr || ''));
        manifest.tests.push({ file, exitCode: result.status, wallMs: performance.now() - start, log,
            error: result.error?.message });
    }
    fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ destination, corpusFiles: manifest.recordings.length,
        labels: manifest.recordings.reduce((a, r) => { a[r.label] = (a[r.label] || 0) + 1; return a; }, {}), tests: manifest.tests }, null, 2));
    if (manifest.tests.some(t => t.exitCode !== 0)) process.exitCode = 1;
}

if (require.main === module) snapshot(process.argv[2] || path.join(root, 'output/anticheat-lab/baseline'));
module.exports = { snapshot };
