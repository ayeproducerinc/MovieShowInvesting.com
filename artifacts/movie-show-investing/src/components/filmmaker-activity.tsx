import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import {
  getGetFilmmakerInterestAlertsQueryKey, getGetMessagingConfigQueryKey, getGetMyConversationsQueryKey,
  useGetFilmmakerInterestAlerts, useGetMessagingConfig, useGetMyConversations, useReadFilmmakerInterestAlert,
} from '@workspace/api-client-react';
import './project-hub-view.css';

const LIMIT = 6;

type ActivityItem =
  | { kind: 'pledge'; key: string; at: string; id: number; projectId: number; projectTitle: string; unread: boolean }
  | { kind: 'message'; key: string; at: string; id: number; projectTitle: string; otherParty: string; status: string | null };

function day(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** New confirmed pledges and project threads for the filmmaker, newest first. */
export function FilmmakerActivity({ uid, provider, projectIds, busy, onOpenProject }: {
  uid: string;
  provider: string;
  projectIds: number[];
  busy: boolean;
  onOpenProject: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const alertsKey = [...getGetFilmmakerInterestAlertsQueryKey(), uid];
  const alerts = useGetFilmmakerInterestAlerts({ query: { queryKey: alertsKey, refetchOnMount: 'always', refetchInterval: 60_000, retry: false } });
  const config = useGetMessagingConfig({ query: { queryKey: getGetMessagingConfigQueryKey(), retry: false } });
  const messaging = config.data?.available === true;
  const threads = useGetMyConversations({ query: { queryKey: [...getGetMyConversationsQueryKey(), provider, uid], enabled: messaging, retry: false } });
  const read = useReadFilmmakerInterestAlert();
  const [error, setError] = useState('');

  async function dismiss(id: number) {
    setError('');
    try {
      await read.mutateAsync({ alertId: id });
      await queryClient.invalidateQueries({ queryKey: alertsKey });
    } catch {
      setError('Could not dismiss this alert. Please try again.');
    }
  }

  const items: ActivityItem[] = [
    ...(alerts.data?.alerts ?? []).map(alert => ({
      kind: 'pledge' as const, key: `pledge-${alert.id}`, at: alert.created_at, id: alert.id,
      projectId: alert.project_id, projectTitle: alert.project_title || 'Your project', unread: !alert.read_at,
    })),
    ...(messaging ? threads.data?.conversations ?? [] : []).filter(item => projectIds.includes(item.project_id)).map(item => ({
      kind: 'message' as const, key: `message-${item.id}`, at: item.last_message_at ?? item.created_at, id: item.id,
      projectTitle: item.project_title, otherParty: item.other_party_name,
      status: item.locked ? 'Paused' : item.reported ? 'Under review' : null,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const loading = alerts.isPending || (messaging && threads.isPending);
  const failed = alerts.isError || (messaging && threads.isError);

  return <section className="project-hub" aria-label="Recent activity"><div className="project-hub__wrap">
    <div className="project-hub__section-head"><h2>Activity</h2></div>
    {loading ? <p role="status">Loading activity…</p>
      : items.length === 0 ? failed ? null : <div className="project-hub__state"><p data-testid="text-activity-empty">No activity yet. New pledges and messages will appear here.</p></div>
      : <ul className="project-hub__list" data-testid="list-filmmaker-activity">{items.slice(0, LIMIT).map(item => <li key={item.key} className="project-hub__item">
        {item.kind === 'pledge' ? <>
          <div className="project-hub__project-info"><strong>{item.unread ? 'New pledge' : 'Pledge'}</strong> — {item.projectTitle}<span className="project-hub__project-date">{day(item.at)} · confirmed non-binding interest</span></div>
          <span />
          <div className="project-hub__row-actions">
            <button type="button" className="project-hub__action project-hub__action--outline" disabled={busy} onClick={() => onOpenProject(item.projectId)} data-testid={`button-activity-open-${item.id}`}>Open</button>
            {item.unread && <button type="button" className="project-hub__action project-hub__action--outline" disabled={read.isPending} onClick={() => void dismiss(item.id)} data-testid={`button-activity-dismiss-${item.id}`}>Dismiss</button>}
          </div>
        </> : <>
          <div className="project-hub__project-info"><strong>{item.otherParty}</strong> (investor) — {item.projectTitle}<span className="project-hub__project-date">{day(item.at)}{item.status ? ` · ${item.status}` : ''}</span></div>
          <span />
          <div className="project-hub__row-actions"><Link href={`/messages/${item.id}`} className="project-hub__action project-hub__action--outline" data-testid={`link-filmmaker-conversation-${item.id}`}>Reply <ArrowRight size={15} aria-hidden="true" /></Link></div>
        </>}
      </li>)}</ul>}
    {failed && <p role="alert">Some activity couldn’t load. <button type="button" className="underline" onClick={() => { void alerts.refetch(); if (messaging) void threads.refetch(); }}>Try again</button></p>}
    {error && <p role="alert">{error}</p>}
    {messaging && <p style={{ marginTop: 14 }}><Link href="/messages" className="underline" data-testid="link-all-messages">All messages →</Link></p>}
  </div></section>;
}
