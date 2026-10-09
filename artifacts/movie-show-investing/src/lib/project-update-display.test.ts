import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminEmailNotice, filmmakerEmailLine, updateStatusLabel } from './project-update-display.js';

test('the filmmaker sees the real number of backers who would be emailed', () => {
  assert.match(filmmakerEmailLine(3), /emailed to 3 backers\./);
  assert.match(filmmakerEmailLine(1), /emailed to 1 backer\./);
  assert.match(filmmakerEmailLine(0), /No backers will be emailed yet/);
});

test('the admin is told before approving whether an email goes out', () => {
  assert.match(adminEmailNotice('send', 4), /emails 4 backers/);
  assert.match(adminEmailNotice('skip_recent', 4), /^No email: .* last 14 days/);
  assert.match(adminEmailNotice('send', 0), /^No email: this project has no backers/);
});

test('a posted update shows Waiting for review', () => {
  assert.equal(updateStatusLabel('pending'), 'Waiting for review');
  assert.equal(updateStatusLabel('approved'), 'Approved');
  assert.equal(updateStatusLabel('rejected'), 'Not approved');
});
