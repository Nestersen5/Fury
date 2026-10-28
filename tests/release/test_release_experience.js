'use strict';
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createReleaseExperience } = require('../../src/updates/releaseExperience');
const { bundled, validateNotes, summarizeNotes } = require('../../src/updates/releaseNotes');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-release-experience-'));
    try {
        const statePath = path.join(directory, 'state.json');
        const service = (version, remote = null, extra = {}) => createReleaseExperience({
            installedVersion: version, isPackaged: true, statePath,
            updates: { check: async () => remote }, ...extra
        });
        assert.throws(() => validateNotes({ schemaVersion: 1, releases: [{ version: 'bad' }] }));
        assert.throws(() => validateNotes({ schemaVersion: 1, releases: [{ version: '1.1.2', features: ['bad\ntext'], improvements: [], fixes: [] }] }));
        const one = summarizeNotes(bundled, '1.1.1', '1.1.2');
        assert(one.features.includes(bundled.releases[2].features[0]));
        assert(!one.features.includes(bundled.releases[0].features[2]));
        assert(summarizeNotes(bundled, '1.0.8', '1.1.2').features.includes(bundled.releases[0].features[2]));
        assert.deepEqual(summarizeNotes(bundled, null, '1.1.2'), one);

        let current = service('1.1.1');
        assert.equal((await current.check()).kind, 'welcome');
        assert.equal(await current.check(), null);
        assert.equal(await current.dismiss('9.9.9'), false);
        await current.dismiss('1.1.1');
        current.dispose();
        current = service('1.1.1', { version: '1.1.2' });
        assert.equal((await current.check()).kind, 'available');
        assert.equal((await current.notes()).fromVersion, '1.1.1');
        await current.dismiss('1.1.2'); current.dispose();
        current = service('1.1.1', { version: '1.1.2' });
        assert.equal(await current.check(), null, 'Dismissal survives restart');
        current.dispose();
        current = service('1.1.2');
        assert.equal(await current.check(), null, 'Dismissal survives upgrading to that release');
        assert.equal((await current.notes()).fromVersion, '1.1.1');
        current.dispose();
        current = service('1.1.2', { version: '9.9.8' }, { read: async () => ({ schemaVersion: 1, releases: [
            { version: '9.9.8', features: ['Future release feature.'], improvements: [], fixes: [] }
        ] }) });
        assert.equal((await current.check()).version, '9.9.8', 'New releases still notify');
        assert.deepEqual((await current.notes()).sections.features, ['Future release feature.']);
        current.dispose();
        current = service('1.1.2', { version: '1.1.4' }, { read: async () => { throw Error('Offline'); } });
        await current.check(); assert.equal((await current.notes()).complete, false); current.dispose();

        fs.unlinkSync(statePath);
        current = service('1.1.2', null, { isPackaged: false, env: {} });
        assert.equal(await current.check(), null, 'Ordinary development has no welcome'); current.dispose();
        fs.writeFileSync(statePath, JSON.stringify({ lastVersion: '1.1.0', seen: [] }));
        current = service('1.1.2');
        assert.equal((await current.check()).fromVersion, '1.1.0');
        await current.dismiss('1.1.2'); current.dispose();
        current = service('1.1.2');
        assert.equal(await current.check(), null);
        assert.equal((await current.notes()).fromVersion, '1.1.0', 'Reopening preserves upgrade baseline');
        current.dispose();
        console.log('Release filtering, first launch, persistence, future notes and development checks passed.');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
