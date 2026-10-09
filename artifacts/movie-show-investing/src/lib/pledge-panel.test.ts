import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pledgePanel } from './pledge-panel.js';

const base = { approved: false, showcase_requested: false, stage: 'idea', is_owner: false };

test('an unapproved, submitted project shows the pledge panel but no public total', () => {
  assert.deepEqual(pledgePanel(base), { show: true, showTotal: false, ownerOnlyTotal: false });
});

test('an approved, listed project shows the panel and its total to everyone', () => {
  assert.deepEqual(pledgePanel({ ...base, approved: true, showcase_requested: true }),
    { show: true, showTotal: true, ownerOnlyTotal: false });
});

test('before approval only the owning filmmaker sees the total', () => {
  assert.deepEqual(pledgePanel({ ...base, is_owner: true }), { show: true, showTotal: true, ownerOnlyTotal: true });
});

test('hidden projects and projects without a valid stage take no pledges', () => {
  assert.equal(pledgePanel({ ...base, hidden: true }).show, false);
  assert.equal(pledgePanel({ ...base, stage: null }).show, false);
});
