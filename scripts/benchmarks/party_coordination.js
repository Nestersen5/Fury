'use strict';

// CPU-only checker comparison. The pre-change checker had no working-tree
// changes when this feature started, so HEAD is its verified source baseline.
// Network, Electron responsiveness and live Hypixel accuracy are not measured.
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const { createPartyArrivalCheck: current } = require('../../src/party/arrivalCheck');
const baselineSource = execFileSync('git', ['show', 'HEAD:src/party/arrivalCheck.js'], { encoding: 'utf8' });
const moduleFixture = { exports: {} };
new Function('module', 'setTimeout', 'clearTimeout', baselineSource)(moduleFixture, setTimeout, clearTimeout);
const baseline = moduleFixture.exports.createPartyArrivalCheck;
const members = ['Alice', 'Bob', 'Charlie', 'David'];
// Model a normal lobby visible-name projection; every lookup still resolves
// existing denick data through the same injected callback in both variants.
const visible = [...members, ...Array.from({ length: 12 }, (_, i) => `Stranger${i}`)];
const iterations = 30000;
function measure(factory, coordinated) {
    let callback = null, messages = 0, traversals = 0;
    const checker = factory({ getMembers: () => members, getKnownDenick: () => null,
        isOwnName: () => false, sendChat: () => messages++, playSound: () => {},
        getVisibleNames: () => { traversals++; return visible; },
        getCoordination: coordinated ? () => ({ status: 'same' }) : () => null,
        setTimer: fn => { callback = fn; return 1; }, clearTimer: () => { callback = null; } });
    const started = performance.now();
    for (let i = 0; i < iterations; i++) {
        checker.enter(); checker.observeChatLine('Self has joined (5/16)!'); callback();
    }
    const ms = performance.now() - started;
    checker.stop(); assert.equal(messages, 0);
    return { microsecondsPerCheck: ms * 1000 / iterations, visibleTraversals: traversals };
}
const cases = [['before', baseline, false], ['fallback', current, false], ['coordinated', current, true]];
for (const [, factory, coordinated] of cases) measure(factory, coordinated);
const results = Object.fromEntries(cases.map(([name]) => [name, []]));
for (let sample = 0; sample < 7; sample++) {
    for (const [name, factory, coordinated] of sample % 2 ? [...cases].reverse() : cases) {
        results[name].push(measure(factory, coordinated));
    }
}
for (const [name, samples] of Object.entries(results)) {
    const timings = samples.map(x => x.microsecondsPerCheck).sort((a, b) => a - b);
    console.log(`${name}: median ${timings[3].toFixed(3)} us/check; ${samples[0].visibleTraversals} visible-name projections / ${iterations} checks`);
}
console.log(`Node ${process.version}; 4 teammates, 16 visible players; 7 samples; CPU only, no network or renderer.`);
