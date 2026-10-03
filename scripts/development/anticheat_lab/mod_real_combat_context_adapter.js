'use strict';
const assert = require('assert');
module.exports = function adaptCombatContext(source) {
    function replaceOnce(before, after) {
        assert.strictEqual(source.split(before).length, 2, 'Combat adaptation anchor changed: ' + before.slice(0, 60));
        source = source.replace(before, after);
    }
    replaceOnce('        await lab.startRecording(label); recording = true;',
        "        await lab.startRecording(label); recording = true;\n        await lab.commands(['clear LabActor']);\n        await delay(300);");
    replaceOnce("await lab.commands(['effect LabActor 17 8 50 true'])",
        "await lab.commands(['difficulty 1', 'effect LabActor 17 60 100 true'])");
    replaceOnce("        await lab.commands(['clear LabActor', 'effect LabActor clear', 'effect LabOpponent clear',",
        "        await lab.commands(['difficulty 0', 'clear LabActor', 'effect LabActor clear', 'effect LabOpponent clear',");
    // An explicit local checkpoint file supports orderly future interruptions.
    replaceOnce('        for (const spec of selected) {',
        "        for (const spec of selected) {\n            if (fs.existsSync(path.join(outputRoot, 'STOP_AFTER_TRIAL'))) break;");
    replaceOnce('                if (result.automatedValid) break;',
        "                if (result.automatedValid || fs.existsSync(path.join(outputRoot, 'STOP_AFTER_TRIAL'))) break;");
    return source;
};
