'use strict';

const assert = require('assert/strict');
const { assertApplicationComplete, classify, plan, publicPackage } = require('../../scripts/export_public');

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
for (const file of ['tests/features/fixtures/nick_books.json',
    'tests/features/fixtures/anticheat_lab/legit_ladder_blockchange.jsonl',
    'src/detect/scaffoldDetector.js']) {
    assert(included.some(entry => entry.file === file), `Export must include ${file}`);
}
for (const file of ['AGENTS.md', '.agents/skills/fury-release/SKILL.md', 'website/index.html',
    'cloudflare/download-stats/worker.mjs', 'scripts/publish_release.js',
    'docs/RELEASE_PUBLISHING.md', 'docs/release-preparation/1.1.0.md',
    'tests/features/fixtures/anticheat_lab/private-recording.jsonl']) {
    assert.equal(classify(file).include, false, `Export must exclude ${file}`);
}
const config = require('../../package.json');
const projected = publicPackage(config);
assert.equal(projected.scripts['test:publishing'], undefined);
assert.equal(projected.scripts['stage:download-site'], undefined);
assert(!projected.scripts.test.includes('test_release_publication.js'));
assert(projected.scripts.test.includes('test_release_hygiene.js'));
assert.deepEqual(projected.dependencies, config.dependencies);
assert.deepEqual(projected.build, config.build);
assert.deepEqual(publicPackage(projected), projected, 'Public export must be idempotent');
console.log('Public export completeness checks passed.');
