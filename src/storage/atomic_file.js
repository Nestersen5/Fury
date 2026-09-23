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

module.exports = { writeFileAtomic };
