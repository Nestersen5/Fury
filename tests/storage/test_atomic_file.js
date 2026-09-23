'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('../../src/storage/atomic_file.js');

(async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nester-atomic-file-'));
    const targetPath = path.join(tempDirectory, 'nested', 'state.json');

    try {
        await writeFileAtomic(targetPath, '{"version":1}');
        assert.strictEqual(fs.readFileSync(targetPath, 'utf8'), '{"version":1}');

        await writeFileAtomic(targetPath, '{"version":2,"complete":true}');
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), {
            version: 2,
            complete: true
        });

        const leftovers = fs.readdirSync(path.dirname(targetPath))
            .filter(name => name.endsWith('.tmp'));
        assert.deepStrictEqual(leftovers, [], 'successful writes should not leave temporary files');
    } finally {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    }

    console.log('Atomic file tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
