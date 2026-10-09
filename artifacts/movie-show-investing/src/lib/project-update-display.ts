/** Wording for project updates (DECISIONS.md › Project updates). */
const backers = (count: number) => `${count} backer${count === 1 ? '' : 's'}`;

/** Filmmaker form: the real number of consenting confirmed backers. */
export function filmmakerEmailLine(count: number): string {
  if (!count) return 'None of your backers have allowed update emails yet. Approved updates still appear on your project page.';
  return `When approved, this update can be emailed to ${backers(count)} who allowed update emails. At most one update email goes out every 14 days.`;
}

/** Admin queue: rule c says the admin must know before approving whether an email goes out. */
export function adminEmailNotice(decision: 'send' | 'skip_recent', count: number): string {
  if (decision === 'skip_recent') {
    return 'No email: this project’s backers already got an update email in the last 14 days. Approving adds it to the timeline only.';
  }
  if (!count) return 'No email: none of this project’s backers have allowed update emails. Approving adds it to the timeline only.';
  return `Approving adds it to the timeline and emails ${backers(count)} who allowed update emails.`;
}

export function updateStatusLabel(status: 'pending' | 'approved' | 'rejected'): string {
  return status === 'pending' ? 'Waiting for review' : status === 'approved' ? 'Approved' : 'Not approved';
}
