'use strict';

// These are filename suggestions, not proof that a player cheated. The
// recorder still accepts any free-form label and keeps the user's wording.
const SCAFFOLD_CLIP_LABELS = Object.freeze([
    { name: 'totally_legit', description: 'verified clean; slow or careful bridging' },
    { name: 'legit', description: 'verified clean; ordinary or skilled bridging' },
    { name: 'sus_but_legit', description: 'verified clean; suspicious-looking fast bridging' },
    { name: 'legit_scaff', description: 'confirmed cheat; Scaffold Legit mode' },
    { name: 'blatant_scaff', description: 'confirmed cheat; fast placement, GodBridge, or TellyBridge mode' }
]);

const SCAFFOLD_CLIP_SUGGESTIONS = Object.freeze(SCAFFOLD_CLIP_LABELS.flatMap(({ name }) =>
    [`${name}_long`, `${name}_short`, name]));

module.exports = { SCAFFOLD_CLIP_LABELS, SCAFFOLD_CLIP_SUGGESTIONS };
