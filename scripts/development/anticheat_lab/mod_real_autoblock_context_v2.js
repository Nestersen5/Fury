'use strict';
// Complete pre-click equipment context, plus actual hunger in an Easy food
// control. Peaceful mode replenished food and invalidated the first food reruns.
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module');
const sourceFile = path.join(__dirname, 'mod_real_autoblock_corrections.js');
let source = fs.readFileSync(sourceFile, 'utf8').replace(/\r\n/g, '\n');
source = require('./mod_real_combat_context_adapter')(source);
const before = '        harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:';
assert.strictEqual(source.split(before).length, 2);
source = source.replace(before,
    `        adapterSha256: sha(fs.readFileSync(${JSON.stringify(__filename)})), combatAdapterSha256: sha(fs.readFileSync(${JSON.stringify(path.join(__dirname, 'mod_real_combat_context_adapter.js'))})), harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:`);
source = source.replace('if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });',
    'module.exports = { main };');
const compiled = new Module(sourceFile, module); compiled.filename = sourceFile;
compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, sourceFile);
compiled.exports.main().catch(error => { console.error(error); process.exitCode = 1; });
