import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backerLabel, backersErrorText, pledgeSummary, progressLines, publicBackersLine } from './backer-display.js';

test('the filmmaker sees increases, new pledges since the last update, and its date', () => {
  const fmt = (n: number) => `$${n}`;
  const date = (iso: string) => iso.slice(0, 10);
  assert.deepEqual(progressLines({
    increase_count: 2, increase_amount: 350, new_since_last_update_count: 1, new_since_last_update_amount: 100,
    last_update_at: '2026-10-01T00:00:00.000Z',
  }, fmt, date), [
    'Increased: 2 backers pledged again, adding $350.',
    'New since your last update (2026-10-01): 1 backer, $100.',
  ]);
  assert.deepEqual(progressLines({
    increase_count: 0, increase_amount: 0, new_since_last_update_count: 0, new_since_last_update_amount: 0, last_update_at: null,
  }, fmt, date), [
    'Increased: no one has pledged again yet.',
    'Last update: none approved yet. Post one to keep backers informed.',
  ]);
});

test('a backer list that is not available to the account offers no pointless retry', () => {
  assert.equal(backersErrorText(404).canRetry, false);
  assert.equal(backersErrorText(500).canRetry, true);
  assert.equal(backersErrorText(undefined).canRetry, true);
});

test('the filmmaker sees the total and how many people pledged', () => {
  const fmt = (n: number) => `$${n}`;
  assert.equal(pledgeSummary({ confirmed_pledge_total: 0, backer_count: 0 }, fmt), 'No pledges yet');
  assert.equal(pledgeSummary({ confirmed_pledge_total: 100, backer_count: 1 }, fmt), '$100 from 1 backer');
  assert.equal(pledgeSummary({ confirmed_pledge_total: 850, backer_count: 2 }, fmt), '$850 from 2 backers');
});

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
