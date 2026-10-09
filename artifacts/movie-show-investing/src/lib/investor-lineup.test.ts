import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canUseSingleProjectDraft, cap, singleProjectLineup } from './investor-lineup.js';

test('project counts follow $100 per project, up to 5', () => {
  assert.equal(cap(100), 1);
  assert.equal(cap(299), 2);
  assert.equal(cap(500), 5);
  assert.equal(cap(5000), 5);
});

test('a project-page pledge reuses only a draft that holds nothing but that project', () => {
  assert.equal(canUseSingleProjectDraft([], 7, false), true);
  assert.equal(canUseSingleProjectDraft([{ project_id: 7 }], 7, false), true);
  assert.equal(canUseSingleProjectDraft([{ project_id: 7 }, { project_id: 8 }], 7, false), false);
  assert.equal(canUseSingleProjectDraft([{ project_id: 8 }], 7, false), false);
  assert.equal(canUseSingleProjectDraft([], 7, true), false);
});

test('the whole one-project amount goes to that project', () => {
  assert.deepEqual(singleProjectLineup(7, 250), [{ project_id: 7, amount: 250 }]);
});
