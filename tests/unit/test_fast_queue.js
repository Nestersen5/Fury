'use strict';

const assert = require('assert');
const { FastQueue } = require('../../src/util/fast_queue.js');

const queue = new FastQueue({ compactThreshold: 4 });
for (let value = 1; value <= 8; value += 1) queue.push(value);

assert.strictEqual(queue.peek(), 1);
assert.strictEqual(queue.peek(2), 3);
assert.strictEqual(queue.shift(), 1);
assert.deepStrictEqual(queue.take(3), [2, 3, 4]);
assert.strictEqual(queue.length, 4);
assert.deepStrictEqual(queue.toArray(), [5, 6, 7, 8]);

assert.strictEqual(queue.findIndex(value => value === 7), 2);
assert.strictEqual(queue.some(value => value === 7), true);
assert.strictEqual(queue.removeAt(2), 7);
assert.deepStrictEqual([...queue], [5, 6, 8]);

queue.push(9);
queue.push(10);
assert.strictEqual(queue.dropOldest(2), 2);
assert.deepStrictEqual(queue.take(10), [8, 9, 10]);
assert.strictEqual(queue.length, 0);
assert.strictEqual(queue.shift(), undefined);

console.log('Fast queue tests passed.');
