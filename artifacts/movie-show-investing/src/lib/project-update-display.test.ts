import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminEmailNotice, filmmakerEmailLine, updateImpactLines, updateStatusLabel } from './project-update-display.js';

test('admin sees emails sent, increases and new pledges for each approved update', () => {
  const fmt = (n: number) => `$${n}`;
  assert.deepEqual(updateImpactLines({
    emails_queued: 4, emails_sent: 3, increase_count: 1, increase_amount: 250, new_pledge_count_14d: 2, new_pledge_amount_14d: 300,
  }, fmt), [
    'Emails: 3 sent of 4.',
    'Increases from this update: 1 backer, $250.',
    'New pledges in the 14 days after: 2 backers, $300.',
  ]);
  assert.equal(updateImpactLines({
    emails_queued: 0, emails_sent: 0, increase_count: 0, increase_amount: 0, new_pledge_count_14d: 0, new_pledge_amount_14d: 0,
  }, fmt)[0], 'Emails: none (14-day rule or no backers).');
});

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
