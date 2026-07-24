'use strict';

const assert = require('node:assert/strict');
const { validPriority, slaDueAt } = require('../lib/support-store');

assert.equal(validPriority(), 'normal');
assert.equal(validPriority('low'), 'low');
assert.equal(validPriority('urgent'), 'urgent');
assert.throws(() => validPriority('critical'), /優先級/);

const createdAt = new Date('2026-07-24T00:00:00.000Z');
assert.equal(slaDueAt('low', createdAt).toISOString(), '2026-07-26T00:00:00.000Z');
assert.equal(slaDueAt('normal', createdAt).toISOString(), '2026-07-25T00:00:00.000Z');
assert.equal(slaDueAt('high', createdAt).toISOString(), '2026-07-24T08:00:00.000Z');
assert.equal(slaDueAt('urgent', createdAt).toISOString(), '2026-07-24T02:00:00.000Z');

console.log('support SLA tests passed');
