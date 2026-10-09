import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backerLabel, publicBackersLine } from './backer-display.js';

test('pre-notice pledges show as an unnamed backer', () => {
  assert.equal(backerLabel({ name: null, name_shared: false }), 'Backer (name not shared)');
  assert.equal(backerLabel({ name: 'Jane Doe', name_shared: true }), 'Jane Doe');
});

test('Explore shows up to three named backers, then a count', () => {
  const fmt = (n: number) => `$${n}`;
  assert.equal(publicBackersLine([], fmt), null);
  assert.equal(publicBackersLine([{ name: 'A', amount: 300 }], fmt), 'A ($300)');
  assert.equal(publicBackersLine([
    { name: 'A', amount: 400 }, { name: 'B', amount: 300 }, { name: 'C', amount: 200 }, { name: 'D', amount: 100 },
  ], fmt), 'A ($400), B ($300), C ($200) and 1 more');
});
