'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { JavaRandom, JavaSplittableRandom } = require('./random');
const root = path.resolve(__dirname, '../../..');
const java = process.env.FURY_LAB_JAVA || 'C:/Program Files/Eclipse Adoptium/jdk-8.0.462.8-hotspot/bin/java.exe';
const javac = path.join(path.dirname(java), process.platform === 'win32' ? 'javac.exe' : 'javac');
const directory = path.join(root, 'output/anticheat-lab/trusted-rng-reference');
fs.mkdirSync(directory, { recursive: true });
const compile = spawnSync(javac, ['-d', directory, path.join(__dirname, 'reference/RngReference.java')], { encoding: 'utf8', windowsHide: true });
assert.strictEqual(compile.status, 0, compile.stderr || compile.error?.message);
const reference = spawnSync(java, ['-cp', directory, 'RngReference'], { encoding: 'utf8', windowsHide: true });
assert.strictEqual(reference.status, 0, reference.stderr || reference.error?.message);
const instances = new Map();
let rows = 0;
for (const line of reference.stdout.trim().split(/\r?\n/)) {
    const [type, seed, bound, bounded, signed, double] = line.split(',');
    const key = `${type}:${seed}`;
    if (!instances.has(key)) instances.set(key, new (type === 'random' ? JavaRandom : JavaSplittableRandom)(BigInt(seed)));
    const rng = instances.get(key);
    assert.strictEqual(rng.nextInt(Number(bound)), Number(bounded), `${key} bounded, row ${rows}`);
    assert.strictEqual(rng.nextInt(), Number(signed), `${key} signed, row ${rows}`);
    assert.strictEqual(rng.nextDouble(), Number(double), `${key} double, row ${rows}`);
    rows++;
}
const result = { java, reference: 'Java standard library only; no original client source compiled or executed',
    rows, comparisons: rows * 3, seeds: instances.size / 2, passed: true };
fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
