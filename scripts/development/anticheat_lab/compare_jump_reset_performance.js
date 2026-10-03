'use strict';
// Retain the established timing/GC/ordering procedure. Compare the initial
// three checks with integrated source at default Jump Reset OFF and opt-in ON.
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module');
const file = path.join(__dirname, 'compare_performance.js');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
function once(before, after) { assert.strictEqual(source.split(before).length, 2, before); source = source.replace(before, after); }
once('const variants = [baselineDir, candidateDir].map(directory => {', 'const variants = [baselineDir, candidateDir, candidateDir].map((directory, index) => {');
once('    return { directory, packetToRecord:', "    return { directory, label: ['initial three checks', 'integrated, Jump Reset OFF', 'integrated, Jump Reset ON'][index], jumpEnabled: index === 2, jumpFactory: index ? require(path.join(directory, 'jumpResetDetector.js')).createJumpResetDetector : null, packetToRecord:");
once('        for (const record of dataset.records) { for (const detector of detectors) detector.observeRecord(record); consumedRecords++; }', `        // Include construction while OFF, as the owning proxy does; skip its
        // record calls until opted in. Replay headers never activate this check.
        const jump = variant.jumpFactory ? variant.jumpFactory({ isEnabled: () => variant.jumpEnabled,
            onFlag: () => emittedFlags++ }) : null;
        if (jump && variant.jumpEnabled && header?.source === 'live') detectors.push(jump);
        for (const record of dataset.records) { for (const detector of detectors) detector.observeRecord(record); consumedRecords++; }`);
once('    for (const index of pass % 2 ? [1, 0] : [0, 1])', '    for (const index of [[0,1,2],[1,2,0],[2,0,1],[2,1,0],[1,0,2],[0,2,1]][pass % 6])');
once("    method: 'Three warm-ups per version, nine measured corpus passes, alternating order, explicit GC outside timing, same pre-parsed records.',",
    "    method: 'Three warm-ups per version, nine measured corpus passes, balanced three-way order (each version first/middle/last three times), explicit GC outside timing, same pre-parsed records.',");
once('const measurements = variants.map((variant, i) => ({ directory: variant.directory, sourceHashes:', 'const measurements = variants.map((variant, i) => ({ directory: variant.directory, label: variant.label, sourceHashes:');
once("    mode: rawCombat ? 'selected raw observer packets: conversion plus combat detectors' : 'compact observer records: all three detectors',", "    mode: 'compact observer records: initial three / integrated default OFF / integrated opt-in ON',");
once('    medianWallRatio: measurements[1].medianWallMs / measurements[0].medianWallMs,', `    medianWallRatio: measurements[1].medianWallMs / measurements[0].medianWallMs,
    optInMedianWallRatio: measurements[2].medianWallMs / measurements[0].medianWallMs,`);
once("console.log(JSON.stringify({ output, datasets: datasets.length, records: result.totalRecords,\n    baselineMedianMs: measurements[0].medianWallMs, candidateMedianMs: measurements[1].medianWallMs, ratio: result.medianWallRatio }));", `console.log(JSON.stringify({ output, datasets: datasets.length, records: result.totalRecords,
    measurements: measurements.map(m => ({ label: m.label, medianWallMs: m.medianWallMs, medianCpuMs: m.medianCpuMs, p95WallMs: m.p95WallMs })),
    defaultRatio: result.medianWallRatio, optInRatio: result.optInMedianWallRatio }));`);
assert(!process.argv.includes('--raw-combat'), 'Use compact observer records for this four-check comparison');
const compiled = new Module(file, module); compiled.filename = file; compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, file);
