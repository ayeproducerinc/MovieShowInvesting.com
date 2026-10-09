/** Wording for project updates (DECISIONS.md › Project updates). */
const backers = (count: number) => `${count} backer${count === 1 ? '' : 's'}`;

/** Filmmaker form: the real number of confirmed backers with update emails on (on by default). */
export function filmmakerEmailLine(count: number): string {
  if (!count) return 'No backers will be emailed yet. Approved updates still appear on your project page.';
  return `When approved, this update can be emailed to ${backers(count)}. At most one update email goes out every 14 days.`;
}

/** Admin queue: rule c says the admin must know before approving whether an email goes out. */
export function adminEmailNotice(decision: 'send' | 'skip_recent', count: number): string {
  if (decision === 'skip_recent') {
    return 'No email: this project’s backers already got an update email in the last 14 days. Approving adds it to the timeline only.';
  }
  if (!count) return 'No email: this project has no backers with update emails on. Approving adds it to the timeline only.';
  return `Approving adds it to the timeline and emails ${backers(count)}.`;
}

/** Admin results per approved update: the numbers the owner needs. */
export function updateImpactLines(update: {
  emails_queued: number; emails_sent: number; increase_count: number; increase_amount: number;
  new_pledge_count_14d: number; new_pledge_amount_14d: number;
}, format: (n: number) => string): string[] {
  return [
    update.emails_queued ? `Emails: ${update.emails_sent} sent of ${update.emails_queued}.` : 'Emails: none (14-day rule or no backers).',
    `Increases from this update: ${backers(update.increase_count)}, ${format(update.increase_amount)}.`,
    `New pledges in the 14 days after: ${backers(update.new_pledge_count_14d)}, ${format(update.new_pledge_amount_14d)}.`,
  ];
}

export function updateStatusLabel(status: 'pending' | 'approved' | 'rejected'): string {
  return status === 'pending' ? 'Waiting for review' : status === 'approved' ? 'Approved' : 'Not approved';
}
