'use strict';
// Adapt only recording filenames and the optional new detector. Reuse the
// existing alternating, GC-separated measurements and pre-parsed workloads.
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module');
const file = path.join(__dirname, 'compare_performance.js');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
function replaceOnce(before, after) {
    assert.strictEqual(source.split(before).length, 2, 'Performance adaptation anchor changed');
    source = source.replace(before, after);
}
replaceOnce('rawCombat ? `${row.id}.observer-packets.jsonl` : row.recorderFile',
    "rawCombat ? (row.observerPacketFile || `${row.id}_a${String(Number(row.attempt.slice(8))).padStart(2, '0')}.observer-packets.jsonl`) : row.recorderFile");
const jump = process.argv.includes('--include-jump-reset');
process.argv = process.argv.filter(a => a !== '--include-jump-reset');
if (jump) {
    replaceOnce("        Stasis: require(path.join(directory, 'stasisDetector.js')).createStasisDetector",
        "        Stasis: require(path.join(directory, 'stasisDetector.js')).createStasisDetector,\n        JumpReset: fs.existsSync(path.join(directory, 'jumpResetDetector.js')) ? require(path.join(directory, 'jumpResetDetector.js')).createJumpResetDetector : null");
    replaceOnce("                variant.factories.Stasis({ onFlag: () => emittedFlags++ })];",
        "                variant.factories.Stasis({ onFlag: () => emittedFlags++ })];\n            if (variant.factories.JumpReset) detectors.push(variant.factories.JumpReset({ onFlag: () => emittedFlags++ }));");
    replaceOnce("        if (header?.source === 'live') detectors.push(variant.factories.Stasis({ onFlag: () => emittedFlags++ }));",
        "        if (header?.source === 'live') detectors.push(variant.factories.Stasis({ onFlag: () => emittedFlags++ }));\n        if (variant.factories.JumpReset) detectors.push(variant.factories.JumpReset({ onFlag: () => emittedFlags++ }));");
    replaceOnce("'compact observer records: all three detectors'", "'compact observer records: baseline detectors plus optional Jump Reset'");
}
replaceOnce('const result = { schema: 1,', `const result = { schema: 1, adapterSha256: sha(fs.readFileSync(${JSON.stringify(__filename)})), originalHarnessSha256: sha(fs.readFileSync(__filename)), jumpResetIncluded: ${jump},`);
const compiled = new Module(file, module); compiled.filename = file;
compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, file);
