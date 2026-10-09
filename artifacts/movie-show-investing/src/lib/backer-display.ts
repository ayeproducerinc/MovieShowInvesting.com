/** Pledges signed before the backer-visibility notice never reveal a name. */
export function backerLabel(backer: { name: string | null; name_shared: boolean }): string {
  return backer.name_shared && backer.name ? backer.name : 'Backer (name not shared)';
}

/** Load-failure wording for the private backer list; retry only when it can help. */
export function backersErrorText(status: number | undefined): { text: string; canRetry: boolean } {
  if (status === 404) return { text: 'Backers for this project aren’t available to this account.', canRetry: false };
  return { text: 'Your backers couldn’t load right now. Their pledges are still saved.', canRetry: true };
}

/** "$850 from 2 backers" for the filmmaker's private views. */
export function pledgeSummary(totals: { confirmed_pledge_total: number; backer_count: number }, format: (n: number) => string): string {
  if (!totals.backer_count) return 'No pledges yet';
  return `${format(totals.confirmed_pledge_total)} from ${totals.backer_count} backer${totals.backer_count === 1 ? '' : 's'}`;
}

/** Filmmaker progress lines: increases, new pledges since the last update, and its date. */
export function progressLines(progress: {
  increase_count: number; increase_amount: number;
  new_since_last_update_count: number; new_since_last_update_amount: number; last_update_at: string | null;
}, format: (n: number) => string, formatDate: (iso: string) => string): string[] {
  const people = (n: number) => `${n} backer${n === 1 ? '' : 's'}`;
  const lines = [progress.increase_count
    ? `Increased: ${people(progress.increase_count)} pledged again, adding ${format(progress.increase_amount)}.`
    : 'Increased: no one has pledged again yet.'];
  if (progress.last_update_at) {
    lines.push(progress.new_since_last_update_count
      ? `New since your last update (${formatDate(progress.last_update_at)}): ${people(progress.new_since_last_update_count)}, ${format(progress.new_since_last_update_amount)}.`
      : `New since your last update (${formatDate(progress.last_update_at)}): none yet.`);
  } else {
    lines.push('Last update: none approved yet. Post one to keep backers informed.');
  }
  return lines;
}

/** Compact public line for Explore cards: up to three named backers, then a count. */
export function publicBackersLine(backers: { name: string; amount: number }[], format: (n: number) => string): string | null {
  if (!backers.length) return null;
  const shown = backers.slice(0, 3).map(backer => `${backer.name} (${format(backer.amount)})`).join(', ');
  const more = backers.length - 3;
  return more > 0 ? `${shown} and ${more} more` : shown;
}
