'use strict';
// Apply only the reviewed owning-path files after pinned capture is complete.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../..'), base = path.join(root,'output/anticheat-lab/mod-real');
const prepared = path.join(base,'improvements/prepared-production');
const read = file=>JSON.parse(fs.readFileSync(file));
const hash = file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const gate = read(path.join(base,'improvements/PRODUCTION_GATE.json'));
assert(gate.heldOutEvaluationComplete && gate.reviewed && gate.noHeldOutRetuning, 'Complete the held-out promotion decision first');
assert(gate.accepted.jumpResetExperimental, 'Do not ship a rejected Jump Reset experiment');
const manifest = read(path.join(prepared,'manifest.json'));
assert(!manifest.applied && !fs.existsSync(path.join(prepared,'APPLIED.json')));
assert.strictEqual(manifest.accepted.movementClock, gate.accepted.movementClock);
assert.strictEqual(manifest.accepted.scaffoldCorroboration, gate.accepted.scaffoldCorroboration);
for(const [relative,n] of [['FULL_EVIDENCE.json',110],['scaffold/FULL_EVIDENCE.json',82],
    ['improvements/fresh/FULL_EVIDENCE.json',48],['improvements/fresh/scaffold/FULL_EVIDENCE.json',40],
    ['improvements/movement-stress/FULL_EVIDENCE.json',40],['jump-reset/FULL_EVIDENCE.json',320]]) {
    const evidence=read(path.join(base,relative));
    assert(evidence.complete && evidence.valid===n && evidence.rows.length===n, 'Incomplete accepted evidence: '+relative);
}
for(const part of ['autoblock','scaffold']) {
    const archive=path.join(base,'overnight/measurement-'+part), frozen=read(path.join(archive,'manifest.json'));
    for(const [file,expected] of Object.entries(frozen.files)) assert.strictEqual(hash(path.join(archive,file)),expected,'Frozen original changed: '+file);
}
const active=execFileSync('powershell',['-NoProfile','-Command',
    "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'java.exe' -and $_.CommandLine -like '*anticheat-lab*mod-real*') -or ($_.Name -eq 'node.exe' -and ($_.CommandLine -match 'mod_real_followup.js|mod_real_movement_stress.js|jump_reset_real_campaign.js' -or $_.CommandLine -match '--require.+anticheat_lab.+offline_preload')) } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"],{encoding:'utf8'});
assert(!active.trim(),'Pinned lab processes must exit before production files change: '+active);
for(const [relative,entry] of Object.entries(manifest.files)) {
    assert.strictEqual(hash(path.join(prepared,relative)),entry.afterSha256,'Prepared file changed: '+relative);
    const target=path.join(root,relative);
    if(entry.beforeSha256===null) assert(!fs.existsSync(target),'New production path already exists: '+relative);
    else assert.strictEqual(hash(target),entry.beforeSha256,'Preserve a changed working-tree file: '+relative);
}
// Mod and source hashes immediately before applying are retained separately.
execFileSync(process.execPath,[path.join(__dirname,'overnight_manifest.js'),'pre-implementation'],{cwd:root});
const changed = Object.entries(manifest.files).filter(([,entry])=>entry.beforeSha256!==entry.afterSha256).map(([relative])=>relative);
for(const relative of changed) {
    const destination=path.join(root,relative); fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.copyFileSync(path.join(prepared,relative),destination);
}
const applied={appliedAt:new Date().toISOString(),files:manifest.files,changedFiles:changed,
    productionGateSha256:hash(path.join(base,'improvements/PRODUCTION_GATE.json')),
    experimentalJumpReset:{defaultEnabled:false,tier:'possible'},noCommit:true};
fs.writeFileSync(path.join(prepared,'APPLIED.json'),JSON.stringify(applied,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({applied:true,files:changed,noCommit:true}));
