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

export const TIMELINE_PREVIEW = 3;

/**
 * Collapsed view: the newest few updates; the listing line ends the list only
 * when nothing is hidden. Expanded: everything.
 */
export function visibleTimeline(entries: TimelineEntry[], expanded: boolean, limit = TIMELINE_PREVIEW) {
  const updates = entries.filter(entry => entry.kind === 'update');
  const hiddenCount = Math.max(0, updates.length - limit);
  if (expanded || !hiddenCount) return { shown: entries, hiddenCount: expanded ? 0 : hiddenCount, total: updates.length };
  return { shown: updates.slice(0, limit), hiddenCount, total: updates.length };
}

export function timelineDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
