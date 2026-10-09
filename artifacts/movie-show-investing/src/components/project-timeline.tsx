import { useState } from 'react';
import { getGetPublicProjectUpdatesQueryKey, useGetPublicProjectUpdates } from '@workspace/api-client-react';
import { TIMELINE_PREVIEW, timelineDate, timelineEntries, visibleTimeline } from '@/lib/project-timeline';

/** Public "Progress" timeline of approved filmmaker milestones. Hidden when there is nothing to show. */
export function ProjectTimeline({ slug }: { slug: string }) {
  const updates = useGetPublicProjectUpdates(slug, { query: { queryKey: getGetPublicProjectUpdatesQueryKey(slug), retry: false } });
  const [expanded, setExpanded] = useState(false);
  if (!updates.isSuccess) return null;
  const entries = timelineEntries(updates.data.updates, updates.data.listed_at);
  if (!entries.length) return null;
  const view = visibleTimeline(entries, expanded);
  return <section className="dossier-section pj-sec" data-testid="section-project-progress" style={{ overflowWrap: 'anywhere' }}>
    <span className="dossier-kicker">Progress</span>
    <h2>How the project is moving.</h2>
    <ol id="project-progress-list" style={{ listStyle: 'none', padding: 0, margin: '18px 0 0', borderLeft: '2px solid #c8c0b5' }}>
      {view.shown.map(entry => <li key={entry.key} data-testid={`timeline-${entry.key}`} style={{ position: 'relative', padding: '0 0 22px 20px' }}>
        <span aria-hidden="true" style={{ position: 'absolute', left: -7, top: 6, width: 12, height: 12, borderRadius: '50%', background: entry.kind === 'listed' ? '#c8c0b5' : '#7a3f4c' }} />
        <p className="dossier-kicker" style={{ margin: 0 }}>{timelineDate(entry.date)}</p>
        <p style={{ margin: '4px 0 0', fontWeight: 600 }}>{entry.title}</p>
        {entry.note && <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{entry.note}</p>}
      </li>)}
    </ol>
    {(view.hiddenCount > 0 || expanded) && view.total > TIMELINE_PREVIEW && <button type="button" className="dossier-button dossier-button-outline" aria-expanded={expanded} aria-controls="project-progress-list"
      data-testid="button-toggle-progress" onClick={() => setExpanded(open => !open)}>
      {expanded ? 'Show fewer' : `Show all ${view.total} updates`}
    </button>}
  </section>;
}
