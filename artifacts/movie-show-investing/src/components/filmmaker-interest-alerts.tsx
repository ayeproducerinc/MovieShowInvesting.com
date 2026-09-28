import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFilmmakerInterestAlertsQueryKey,
  useGetFilmmakerInterestAlerts,
  useReadFilmmakerInterestAlert,
} from '@workspace/api-client-react';

export function FilmmakerInterestAlerts({ uid, onOpenProject, busy }: { uid: string; onOpenProject: (id: number) => void; busy: boolean }) {
  const queryClient = useQueryClient();
  const key = [...getGetFilmmakerInterestAlertsQueryKey(), uid];
  const list = useGetFilmmakerInterestAlerts({
    query: { queryKey: key, refetchOnMount: 'always', refetchInterval: 60_000, retry: false },
  });
  const read = useReadFilmmakerInterestAlert();
  const [error, setError] = useState('');
  const alerts = list.data?.alerts ?? [];
  const unread = alerts.filter(alert => !alert.read_at).length;

  async function markRead(id: number) {
    setError('');
    try {
      await read.mutateAsync({ alertId: id });
      await queryClient.invalidateQueries({ queryKey: key });
    } catch {
      setError('Could not mark this alert read. Please try again.');
    }
  }

  return <section className="q-desk" aria-label="Confirmed interest alerts"><div className="page-wrap" style={{ paddingTop: 32, paddingBottom: 32 }}>
    <p className="dossier-kicker">Private filmmaker alerts</p>
    <h2 style={{ margin: '8px 0' }}>Confirmed non-binding interest {unread > 0 && <span aria-label={`${unread} unread alerts`} style={{ fontSize: '0.55em', verticalAlign: 'middle' }}>· {unread} new</span>}</h2>
    <p>These alerts are for signed project allocations, not payments or binding investments. Investor contact details are not shared here.</p>
    {list.isPending ? <p role="status">Loading alerts…</p>
      : list.isError ? <p role="alert">Alerts could not be loaded. <button type="button" onClick={() => void list.refetch()}>Try again</button></p>
      : alerts.length === 0 ? <p>No confirmed interest alerts yet.</p>
      : <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
        {alerts.map(alert => <li key={alert.id} style={{ border: '1px solid #d4c9b7', borderRadius: 8, padding: 16, background: alert.read_at ? 'transparent' : '#f9f5ee' }}>
          <strong>{alert.read_at ? 'Confirmed non-binding interest' : 'New confirmed non-binding interest'}</strong>
          <p style={{ margin: '8px 0' }}>{alert.project_title || 'Your project'} · {new Date(alert.created_at).toLocaleDateString()}</p>
          <button type="button" disabled={busy} onClick={() => onOpenProject(alert.project_id)}>Open project</button>
          {!alert.read_at && <button type="button" disabled={read.isPending} onClick={() => void markRead(alert.id)} style={{ marginLeft: 16 }}>Mark read</button>}
        </li>)}
      </ul>}
    {error && <p role="alert">{error}</p>}
  </div></section>;
}