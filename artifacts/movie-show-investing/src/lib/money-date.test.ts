import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMonth, monthsLeft, monthsLeftText, neededByStatus } from './money-date.js';

const now = new Date(2026, 9, 9); // Oct 9, 2026 (local time)

test('months read like Mar 2027', () => {
  assert.equal(formatMonth('2027-03'), 'Mar 2027');
  assert.equal(formatMonth(null), '');
  assert.equal(formatMonth('2027-13'), '');
});

test('time left counts whole months from this month', () => {
  assert.equal(monthsLeft('2027-03', now), 5);
  assert.equal(monthsLeft('2026-10', now), 0);
  assert.equal(monthsLeft('2026-08', now), -2);
  assert.equal(monthsLeftText(1), '1 month left');
  assert.equal(monthsLeftText(0), 'this month');
});

test('a skipped or missing date asks to be added; a passed date says so', () => {
  assert.deepEqual(neededByStatus(null, now), { state: 'missing', skipped: false });
  assert.deepEqual(neededByStatus({ money_needed_by_month: null, money_needed_by_skipped: true }, now), { state: 'missing', skipped: true });
  assert.deepEqual(neededByStatus({ money_needed_by_month: '2026-08', money_needed_by_skipped: false }, now), { state: 'passed', label: 'Aug 2026' });
  assert.deepEqual(neededByStatus({ money_needed_by_month: '2027-03', money_needed_by_skipped: false }, now), { state: 'upcoming', label: 'Mar 2027', months: 5 });
});
