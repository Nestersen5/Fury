'use strict';
// Keep the inspected correction runner intact. Record before the initial click
// and make its equipment state explicit, so neither live nor replay inherits an
// uncaptured held sword from the preceding client connection.
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module');
const sourceFile = path.join(__dirname, 'mod_real_autoblock_corrections.js');
let source = fs.readFileSync(sourceFile, 'utf8').replace(/\r\n/g, '\n');
function replaceOnce(before, after) {
    assert.strictEqual(source.split(before).length, 2, 'Complete context adaptation anchor changed');
    source = source.replace(before, after);
}
replaceOnce('        await lab.startRecording(label); recording = true;',
    "        await lab.startRecording(label); recording = true;\n        await lab.commands(['clear LabActor']);\n        await delay(300);");
replaceOnce('        harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:',
    `        adapterSha256: sha(fs.readFileSync(${JSON.stringify(__filename)})), harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:`);
source = source.replace('if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });',
    'module.exports = { main };');
const compiled = new Module(sourceFile, module); compiled.filename = sourceFile;
compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, sourceFile);
compiled.exports.main().catch(error => { console.error(error); process.exitCode = 1; });
