'use strict';

const assert = require('assert/strict');
const { assertApplicationComplete, classify, plan } = require('../../scripts/export_public');

const { included, findings } = plan();
assert.deepEqual(findings, [], 'Public export privacy gate must pass');
for (const file of [
    '.gitattributes',
    'src/launcher/launcher_auth_worker.js',
    'src/launcher/renderer/launcher_updates.js',
    'src/launcher/styles/launcher_theme.css',
    'src/net/cosmeticSearchAddress.js',
    'src/storage/json_writer_worker.js'
]) {
    assert(included.some(entry => entry.file === file), `Export must include ${file}`);
    assert.throws(
        () => assertApplicationComplete(included.filter(entry => entry.file !== file)),
        /Required application file missing from public export/,
        `Completeness gate must reject an omitted ${file}`
    );
}
assert(included.some(entry => entry.file === 'tests/features/test_cosmetic_search_local.js'),
    'Export must include the permanent local Cosmetic Search regression test');
for (const excluded of ['AGENTS.md', '.agents/skills/fury-ui/SKILL.md',
    'website/index.html', 'cloudflare/download-stats/worker.mjs',
    'scripts/publish_release.js', 'docs/RELEASE_PUBLISHING.md']) {
    assert.equal(classify(excluded).include, false, `Export policy must exclude ${excluded}`);
    assert(!included.some(entry => entry.file === excluded), `Export must exclude ${excluded}`);
}
console.log('Public export completeness checks passed.');
