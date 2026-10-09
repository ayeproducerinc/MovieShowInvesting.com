/** Pledges signed before the backer-visibility notice never reveal a name. */
export function backerLabel(backer: { name: string | null; name_shared: boolean }): string {
  return backer.name_shared && backer.name ? backer.name : 'Backer (name not shared)';
}

/** "$850 from 2 backers" for the filmmaker's private views. */
export function pledgeSummary(totals: { confirmed_pledge_total: number; backer_count: number }, format: (n: number) => string): string {
  if (!totals.backer_count) return 'No pledges yet';
  return `${format(totals.confirmed_pledge_total)} from ${totals.backer_count} backer${totals.backer_count === 1 ? '' : 's'}`;
}

/** Compact public line for Explore cards: up to three named backers, then a count. */
export function publicBackersLine(backers: { name: string; amount: number }[], format: (n: number) => string): string | null {
  if (!backers.length) return null;
  const shown = backers.slice(0, 3).map(backer => `${backer.name} (${format(backer.amount)})`).join(', ');
  const more = backers.length - 3;
  return more > 0 ? `${shown} and ${more} more` : shown;
}
