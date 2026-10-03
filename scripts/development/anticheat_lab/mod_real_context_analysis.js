'use strict';
// Original analysis, with an independent starting-position observer-data gate.
const fs = require('fs'), path = require('path'), Module = require('module');
const file = path.join(__dirname, 'mod_real_analysis.js');
const source = require('./adapt_scaffold_careful_validation')(require('./adapt_scaffold_context_validation')(fs.readFileSync(file, 'utf8')));
const compiled = new Module(file, module); compiled.filename = file;
compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, file);
