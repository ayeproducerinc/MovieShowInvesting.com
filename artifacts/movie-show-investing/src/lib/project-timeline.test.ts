import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timelineDate, timelineEntries } from './project-timeline.js';

const updates = [
  { id: 1, label: 'Script locked', role: null, person_name: null, note: null, approved_at: '2026-09-01T00:00:00.000Z' },
  { id: 2, label: 'Team member joined', role: 'Director', person_name: 'Ava Lee', note: 'Welcome!', approved_at: '2026-10-01T00:00:00.000Z' },
];

test('the timeline lists approved updates newest first and ends with the listing date', () => {
  const entries = timelineEntries(updates, '2026-08-15T00:00:00.000Z');
  assert.deepEqual(entries.map(entry => entry.title), [
    'Team member joined · Director: Ava Lee', 'Script locked', 'Listed on Movie Show Investing',
  ]);
  assert.equal(entries.at(-1)?.kind, 'listed');
});

test('an unlisted project timeline has no listing entry and no pledge-count entries', () => {
  const entries = timelineEntries(updates, null);
  assert.equal(entries.length, 2);
  assert.ok(entries.every(entry => entry.kind === 'update' && !/pledge|\$/i.test(entry.title)));
});

test('dates read like Oct 1, 2026', () => {
  assert.equal(timelineDate('2026-10-01T00:00:00.000Z'), 'Oct 1, 2026');
});
