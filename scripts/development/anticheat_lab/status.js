'use strict';
// Read campaign progress only. Does not open recordings or detector verdicts.
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || 'output/anticheat-lab/runs');
const rows = [];
for (const name of fs.readdirSync(root)) {
    const directory = path.join(root, name), manifestFile = path.join(directory, 'campaign.json');
    if (!fs.existsSync(manifestFile)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestFile));
    const outcomeFile = path.join(directory, 'outcomes.jsonl');
    const lines = fs.existsSync(outcomeFile) ? fs.readFileSync(outcomeFile, 'utf8').split('\n') : [];
    lines.pop(); // a currently appended partial line is not a finished trial
    const outcomes = lines.filter(Boolean).map(JSON.parse);
    const resultFile = path.join(directory, 'campaign-result.json');
    const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile)) : null;
    rows.push({ run: name, completed: outcomes.length, assigned: manifest.assignedTrials,
        invalid: outcomes.filter(r => !r.valid).length,
        state: result ? result.complete ? 'complete' : 'closed partial'
            : fs.existsSync(path.join(directory, 'campaign-interruption.json')) ? 'diagnosed interruption' : 'running or unreported interruption',
        errors: result?.errors.length ?? null });
}
console.table(rows);
