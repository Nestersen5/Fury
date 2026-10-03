'use strict';
// Reuse the established report/replay implementation without invoking its CLI.
const fs = require('fs'), path = require('path'), Module = require('module'), assert = require('assert');
function load(name, anchor, names) {
    const file = path.join(__dirname, name);
    let source = fs.readFileSync(file, 'utf8');
    if (name === 'mod_real_report.js') source = require('./adapt_f1_envelope')(source);
    assert.strictEqual(source.split(anchor).length, 2, `Analysis CLI changed: ${name}`);
    const compiled = new Module(file, module);
    compiled.filename = file; compiled.paths = Module._nodeModulePaths(__dirname);
    compiled._compile(source.slice(0, source.indexOf(anchor)) + `\nmodule.exports = { ${names} };\n`, file);
    return compiled.exports;
}
module.exports = {
    stats: load('mod_real_report.js', 'const part = process.argv[2];',
        'wilson, distribution, exactMcNemar, variantStats, rateText, timeText, summarize, writeReport'),
    analysis: load('mod_real_analysis.js', 'const [action, part] = process.argv.slice(2);',
        'replayTrial, checkHashes, detectorDirs')
};
