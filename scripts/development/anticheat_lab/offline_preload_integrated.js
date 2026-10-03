'use strict';
// Copy the established loopback-only seam in memory and trace the fourth check.
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module');
const file = path.join(__dirname,'offline_preload.js');
let source = fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const anchor = "['stasisDetector.js', 'createStasisDetector', 'Stasis'], ['scaffoldDetector.js', 'createScaffoldDetector', 'Scaffold']";
assert.strictEqual(source.split(anchor).length,2);
source=source.replace(anchor,anchor+", ['jumpResetDetector.js', 'createJumpResetDetector', 'JumpReset']");
const compiled=new Module(file,module);compiled.filename=file;compiled.paths=Module._nodeModulePaths(__dirname);compiled._compile(source,file);
