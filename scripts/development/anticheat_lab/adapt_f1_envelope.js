'use strict';
const assert = require('assert');
// With no positive predictions, precision is unidentified, not certainly zero.
// This is still a descriptive bound envelope, not a Wilson confidence interval
// for F1. Counts, point estimates and candidate selection remain unchanged.
module.exports = source => {
    const before = 'high: f1(precision.high || 0, recall.high || 0)';
    assert.strictEqual(source.split(before).length, 2, 'F1 report anchor changed');
    return source.replace(before, 'high: f1(precision.high ?? 1, recall.high ?? 1)');
};
