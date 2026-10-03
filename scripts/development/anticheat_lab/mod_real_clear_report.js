'use strict';
// Keep very small exact-test p values readable in the original study report.
const fs = require('fs'), path = require('path'), Module = require('module'), assert = require('assert');
const file = path.join(__dirname, 'mod_real_report.js');
let source = require('./adapt_f1_envelope')(fs.readFileSync(file, 'utf8'));
const before = 'fmt(pair.mcnemarExactTwoSidedP)';
assert.strictEqual(source.split(before).length, 2);
source = source.replace(before, 'pair.mcnemarExactTwoSidedP.toPrecision(6)');
const compiled = new Module(file, module); compiled.filename = file;
compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, file);
