'use strict';

const assert = require('assert/strict');
const { assertApplicationComplete, plan } = require('../../scripts/export_public');

const { included, findings } = plan();
assert.deepEqual(findings, [], 'Public export privacy gate must pass');
for (const file of [
    '.gitattributes',
    'src/launcher/launcher_auth_worker.js',
    'src/launcher/renderer/launcher_updates.js',
    'src/launcher/styles/launcher_theme.css',
    'src/storage/json_writer_worker.js'
]) {
    assert(included.some(entry => entry.file === file), `Export must include ${file}`);
    assert.throws(
        () => assertApplicationComplete(included.filter(entry => entry.file !== file)),
        /Required application file missing from public export/,
        `Completeness gate must reject an omitted ${file}`
    );
}
console.log('Public export completeness checks passed.');
