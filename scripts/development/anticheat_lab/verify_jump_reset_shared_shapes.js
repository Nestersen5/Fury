'use strict';
// Establish observer input parity before full capture. Thresholds stay fixed.
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const { createJumpResetFeatures } = require('./jump_reset_observer_features');
const { createJumpResetDetector } = require('./jump_reset_candidate');
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real/jump-reset');
assert(!fs.readdirSync(base).some(n => /^full-\d+$/.test(n)), 'Full captures must not precede input parity');
function extract(records) {
    const opportunities = [], features = createJumpResetFeatures({ onOpportunity: row => opportunities.push(row) });
    for (const row of records) features.observeRecord(row);
    return opportunities;
}
const motion = [{ k:'snap', t:1000, id:7, x:0, y:64, z:0, g:true }, { k:'st', t:1010, id:7, s:2 },
    ...[8,16,16,-16,-16,-8].map((dy,i)=>({ k:'mv', t:1040+i*50, id:7, dx:0, dy, dz:0, g:i===5 }))];
const extras = [{ k:'vel', t:1020, id:7, vx:800, vy:3200, vz:0 },
    { k:'look', t:1130, id:7, yaw:1, pitch:2, g:true }, { k:'look', t:1310, id:7, yaw:2, pitch:3, g:false }];
assert.deepStrictEqual(extract([...motion,...extras].sort((a,b)=>a.t-b.t)), extract(motion));
const plan = JSON.parse(fs.readFileSync(path.join(base,'PILOT_PLAN.json'))), results = [];
const shapes = new Set(['anim','meta','eq','spawn','mv','mvl','tp','vel','st','time','blk','mblk','destroy','snap']);
for (const spec of plan.trials) {
    let found = false;
    for (const run of fs.readdirSync(base).filter(n=>/^pilot-\d+$/.test(n)).sort()) {
        const trial = path.join(base,run,spec.id); if (!fs.existsSync(trial)) continue;
        for (const attempt of fs.readdirSync(trial).sort()) {
            const file = path.join(trial,attempt,'ground-truth.json'); if (!fs.existsSync(file)) continue;
            const truth = JSON.parse(fs.readFileSync(file));
            if (!truth.automatedValid || (['L13','L14','L15'].includes(spec.scenarioId) && truth.inputProtocol !== 'actor-view-controls-v2')) continue;
            const records = fs.readFileSync(path.join(base,run,truth.recorderFile),'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
            const projected = records.filter(r=>shapes.has(r.k)).map(r=>{
                const row={...r}; for(const key of ['yaw','pitch','name','uuid','vx','vy','vz','tod']) delete row[key]; return row;
            });
            assert.deepStrictEqual(extract(projected),extract(records),'Shared-shape opportunities: '+spec.id);
            const flags = input=>{const out=[], detector=createJumpResetDetector({onFlag:f=>out.push(f)});
                for(const r of input)detector.observeRecord(r); return out;};
            assert.deepStrictEqual(flags(projected),flags(records),'Shared-shape callbacks: '+spec.id);
            results.push({id:spec.id,recorderFile:path.join(base,run,truth.recorderFile),passed:true}); found=true;break;
        }
        if(found)break;
    }
}
assert.strictEqual(results.length,8,'Eight corrected pilot fixtures required');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const result={createdAt:new Date().toISOString(),decidedBeforeFullCaptures:true,passed:true,
    protocol:'damage-position-motion-v2',detectorThresholdsAndCalibrationSearchUnchanged:true,
    sourceHashes:Object.fromEntries(['jump_reset_observer_features.js','jump_reset_candidate.js'].map(n=>[n,hash(path.join(__dirname,n))])),
    searchPlanSha256:hash(path.join(base,'CALIBRATION_SEARCH_PLAN.json')),
    reason:'Shared live conversion omits pure look packets. Ignore their ground flags offline too; only positional packets establish ground freshness or finish a landing. Velocity information remains uniformly ignored.',
    checks:['synthetic extra look/velocity packets cannot alter opportunities','eight corrected pilot shared-shape opportunity/callback parity'],
    fixtures:results,syntheticCheckOnlyNotAccuracyData:true,
    limitation:'Same-timestamp input-shape parity, not yet production live timestamp parity or extra accuracy trials.'};
fs.writeFileSync(path.join(base,'LOOK_PROTOCOL_ADDENDUM.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
