'use strict';

// Synthetic UI stores still use the real atomic publication/receipt contract.
// This runs in the test driver, never inside the distributed application.
const { writeFileAtomic } = require('../../src/storage/atomic_file');

function writeJson(file, data, _label, acknowledge, options) {
    return writeFileAtomic(file, JSON.stringify(data), 'utf8', options)
        .then(receipt => acknowledge(null, receipt), error => acknowledge(error));
}

module.exports = { writeJson };
