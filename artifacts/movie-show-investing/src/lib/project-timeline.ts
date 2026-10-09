/**
 * Public "Progress" timeline (DECISIONS.md › Project updates › Timeline): approved
 * filmmaker milestones only, newest first, ending with the date the project was
 * listed. No automatic pledge-count entries.
 */
export type TimelineUpdate = {
  id: number; label: string; role: string | null; person_name: string | null; note: string | null; approved_at: string;
};
export type TimelineEntry =
  | { kind: 'update'; key: string; date: string; title: string; note: string | null }
  | { kind: 'listed'; key: string; date: string; title: string; note: null };

export function timelineEntries(updates: TimelineUpdate[], listedAt: string | null): TimelineEntry[] {
  const entries: TimelineEntry[] = [...updates]
    .sort((a, b) => Date.parse(b.approved_at) - Date.parse(a.approved_at) || b.id - a.id)
    .map(update => ({
      kind: 'update',
      key: `update-${update.id}`,
      date: update.approved_at,
      title: [update.label, [update.role, update.person_name].filter(Boolean).join(': ')].filter(Boolean).join(' · '),
      note: update.note,
    }));
  if (listedAt) entries.push({ kind: 'listed', key: 'listed', date: listedAt, title: 'Listed on Movie Show Investing', note: null });
  return entries;
}

export function timelineDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
