'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real/improvements/movement-stress');
assert(!fs.readdirSync(base).some(n=>/^full-\d+$/.test(n)), 'Freeze arena provenance before full stress captures');
const pilots=path.join(base,'pilots'), bootFailures=[];
for(const run of fs.readdirSync(pilots).filter(n=>/^full-\d+$/.test(n))) {
    const folder=path.join(pilots,run), log=path.join(folder,'server.log');
    if(fs.existsSync(log)&&!fs.existsSync(path.join(folder,'full-summary.json'))&&
        fs.readFileSync(log,'utf8').includes('Cannot place blocks outside of the world'))
        bootFailures.push({run,reason:'Arena command failed on unloaded chunks before any real-client trial. No completed trial/ground truth; retained, excluded.'});
}
const result={createdAt:new Date().toISOString(),beforeFullCaptures:true,
    arena:'Stone floor x/z -16 through 15 inclusive, y=63; inside loaded central chunks.',
    correction:'Initial x/z -32 through 63 fill failed at lab startup. Narrow the floor command; inputs, seeds, settings, conditions and detector sources/thresholds unchanged.',
    harnessSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'mod_real_movement_stress.js'))).digest('hex'),
    bootFailures,pilotsExcludedFromAccuracyResults:true};
fs.writeFileSync(path.join(base,'ARENA_PROTOCOL_ADDENDUM.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
