'use strict';
// Separate, reviewable experiment. Production files are never changed here.
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const root = path.resolve(__dirname, '../../..');
const destination = path.join(root, 'output/anticheat-lab/mod-real/improvements/movement-clock-candidate');
assert(!fs.existsSync(destination), 'Candidate already frozen');
let source = fs.readFileSync(path.join(root, 'src/detect/autoblockDetector.js'), 'utf8');
const initialHash = crypto.createHash('sha256').update(source).digest('hex');
assert.strictEqual(initialHash, 'eb13ff1a2303b1691033c7461a5a07fc89105086e4d92b2a3d8b411b011be6cf');
source = source.replace(/\r\n/g, '\n');
function replaceOnce(before, after) {
    assert.strictEqual(source.split(before).length, 2, 'Adaptation anchor changed: ' + before.slice(0, 65));
    source = source.replace(before, after);
}
replaceOnce('    moveLeadMs: 1000,', '    moveMinTickMs: 40,\n    moveMaxTickMs: 125,\n    moveTimingFreshMs: 3500,\n    moveLeadMs: 1000,');
replaceOnce('    let validTimeIntervals = 0;', '    let validTimeIntervals = 0;\n    let movementTimeIntervals = 0;');
replaceOnce('    function noteTime(age, t) {', `    function movementTimingReady(t) {
        return lastTime && movementTimeIntervals >= cfg.timingIntervals
            && t >= lastTime.t && t - lastTime.t <= cfg.moveTimingFreshMs;
    }

    function noteTime(age, t) {`);
const begin = source.indexOf('    function noteTime(age, t) {');
const end = source.indexOf('\n    function entityState(id)', begin);
assert(begin >= 0 && end > begin);
source = source.slice(0, begin) + `    function noteTime(age, t) {
        const ticks = lastTime ? age - lastTime.age : 0;
        const elapsed = lastTime ? t - lastTime.t : 0;
        const tickMs = elapsed / ticks;
        const steady = Number.isSafeInteger(age) && ticks > 0 && elapsed >= 500;
        const strict = steady && tickMs >= cfg.minTickMs && tickMs <= cfg.maxTickMs;
        const movement = steady && tickMs >= cfg.moveMinTickMs && tickMs <= cfg.moveMaxTickMs;
        validTimeIntervals = strict ? Math.min(validTimeIntervals + 1, cfg.timingIntervals) : 0;
        movementTimeIntervals = movement ? Math.min(movementTimeIntervals + 1, cfg.timingIntervals) : 0;
        if (!strict) entities.forEach(state => discardUncertified(state, t, !movement));
        lastTime = Number.isSafeInteger(age) ? { age, t } : null;
        const swingReady = timingReady(t), movementReady = movementTimingReady(t);
        if (swingReady || movementReady) entities.forEach(state => {
            if (!state.pendingEvaluation) return;
            state.pendingEvaluation = false;
            if (swingReady) state.swings.forEach(swing => { swing.certified = true; });
            if (movementReady) {
                state.movePending.forEach(hit => state.moveHits.push(hit));
                state.movePending.length = 0;
            }
            prune(state.swings, t - cfg.windowMs);
            prune(state.moveHits, t - cfg.moveMemoryMs);
            evaluate(state, t, swingReady);
        });
    }
` + source.slice(end);
// The original certify helper becomes unused; omit it in the copied candidate.
const certifyStart = source.indexOf('    function certify(state) {');
const certifyEnd = source.indexOf('    function discardUncertified', certifyStart);
assert(certifyStart >= 0 && certifyEnd > certifyStart);
source = source.slice(0, certifyStart) + source.slice(certifyEnd);
replaceOnce('    function discardUncertified(state, t) {', '    function discardUncertified(state, t, discardMoves = true) {');
replaceOnce(`        state.movePending.length = 0;
        if (state.blocking) restartMoves(state, t);
        state.pendingEvaluation = false;`, `        if (discardMoves) {
            state.movePending.length = 0;
            if (state.blocking) restartMoves(state, t);
        }
        state.pendingEvaluation = !discardMoves && state.movePending.length > 0;`);
replaceOnce('    function evaluate(state, t) {', '    function evaluate(state, t, allowSwing = true) {');
replaceOnce('        const parts = [swingEvidence(state), moveEvidence(state)].filter(Boolean);',
    '        const parts = [allowSwing ? swingEvidence(state) : null, moveEvidence(state)].filter(Boolean);');
replaceOnce('        if (d > cfg.moveMaxStepBlocks || !timingReady(t)) {',
    '        if (d > cfg.moveMaxStepBlocks || !movementTimingReady(t)) {');
replaceOnce('        validTimeIntervals = 0;\n        usingCount = 0;',
    '        validTimeIntervals = 0;\n        movementTimeIntervals = 0;\n        usingCount = 0;');
source = source.replace('// Live Auto Block detector.', `// Experimental movement-clock Auto Block candidate.
// Swing evidence still requires certified 40–60 ms ticks. Movement evidence
// requires separately certified steady 40–125 ms ticks, retaining the same
// speed/lead/knockback/step/window thresholds. No unknown or burst clocks.
// This is a candidate until independent evaluation justifies promotion.`);
fs.mkdirSync(destination, { recursive: true });
for (const file of ['scaffoldDetector.js', 'detectorShared.js', 'stasisDetector.js'])
    fs.copyFileSync(path.join(root, 'src/detect', file), path.join(destination, file));
fs.writeFileSync(path.join(destination, 'autoblockDetector.js'), source, { flag: 'wx' });
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(),
    hypothesis: 'Steady slow ticks may certify item-use speed, while they cannot certify release/swing ordering.',
    baselineHash: initialHash, candidateHash: crypto.createHash('sha256').update(source).digest('hex'),
    productionUnchanged: true, frozenBeforeFreshEvaluation: true,
    thresholds: { moveMinTickMs: 40, moveMaxTickMs: 125, moveTimingFreshMs: 3500 } }, null, 2));
console.log(destination);
