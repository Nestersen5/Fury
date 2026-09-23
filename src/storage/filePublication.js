'use strict';

const fs = require('fs');

// Captured from the completed temporary file BEFORE rename. Inode/device,
// size and nanosecond mtime survive rename; ctime does not on every platform.
function publicationStamp(stat) {
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
}

function readPublicationStamp(file, fsImpl = fs) {
    try { return publicationStamp(fsImpl.statSync(file, { bigint: true })); }
    catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error; }
}

module.exports = { publicationStamp, readPublicationStamp };
