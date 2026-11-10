'use strict';

const fs = require('fs');
const path = require('path');
const { publicationStamp } = require('./filePublication');

async function writeFileAtomic(filePath, data, encoding = 'utf8', { publication = false } = {}) {
    const directory = path.dirname(filePath);
    const tempPath = path.join(
        directory,
        `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    );

    await fs.promises.mkdir(directory, { recursive: true });
    try {
        await fs.promises.writeFile(tempPath, data, encoding);
        const receipt = publication
            ? { version: 1, stamp: publicationStamp(await fs.promises.stat(tempPath, { bigint: true })) }
            : undefined;
        await fs.promises.rename(tempPath, filePath);
        return receipt;
    } catch (error) {
        await fs.promises.unlink(tempPath).catch(() => {});
        throw error;
    }
}

// Configuration callers are synchronous. Stage the complete batch before
// replacing any file, and retain original bytes until every rename succeeds.
// This rolls back publication errors; it is not a cross-file crash transaction.
function writeFilesAtomicSync(entries) {
    const staged = [], published = [];
    const temporary = file => path.join(path.dirname(file),
        `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    try {
        for (const { filePath, data, encoding = 'utf8' } of entries) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            const entry = { filePath, temp: temporary(filePath), backup: null };
            staged.push(entry);
            if (entries.length > 1) {
                let original;
                try { original = fs.readFileSync(filePath); }
                catch (error) { if (error.code !== 'ENOENT') throw error; }
                if (original !== undefined) {
                    entry.backup = temporary(filePath);
                    fs.writeFileSync(entry.backup, original, { flag: 'wx' });
                }
            }
            fs.writeFileSync(entry.temp, data, { encoding, flag: 'wx' });
        }
        for (const entry of staged) {
            fs.renameSync(entry.temp, entry.filePath);
            published.push(entry);
        }
    } catch (error) {
        const failures = [];
        for (const entry of published.reverse()) {
            try {
                if (entry.backup) fs.renameSync(entry.backup, entry.filePath);
                else fs.unlinkSync(entry.filePath);
            } catch (restoreError) {
                // Preserve the original bytes for recovery if the filesystem
                // also refuses rollback; never report this as a clean failure.
                entry.keepBackup = true;
                failures.push(restoreError);
            }
        }
        if (failures.length) throw new AggregateError([error, ...failures],
            `Could not restore previous settings. Recovery copies: ${staged.filter(e => e.keepBackup).map(e => e.backup || e.filePath).join(', ')}`);
        throw error;
    } finally {
        for (const entry of staged) for (const file of [entry.temp, !entry.keepBackup && entry.backup]) {
            if (file) try { fs.unlinkSync(file); } catch (_) { /* already published/restored */ }
        }
    }
}

function writeFileAtomicSync(filePath, data, encoding = 'utf8') {
    writeFilesAtomicSync([{ filePath, data, encoding }]);
}

module.exports = { writeFileAtomic, writeFileAtomicSync, writeFilesAtomicSync };
