import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminProjectUpdatesQueryKey, useApproveAdminProjectUpdate, useGetAdminProjectUpdates, useRejectAdminProjectUpdate,
} from '@workspace/api-client-react';
import { adminEmailNotice } from '@/lib/project-update-display';

// Backer update emails are built in step 9.7. Until then approval adds the update
// to the timeline only; remove this note when sending is switched on.
const UPDATE_EMAILS_LIVE = false;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

/** Pending project updates for owner review (DECISIONS.md › Project updates, rule a and c). */
export function AdminProjectUpdates({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const params = { status: 'pending' as const };
  const pending = useGetAdminProjectUpdates(params, { query: {
    queryKey: [...getGetAdminProjectUpdatesQueryKey(params), userId], retry: false, refetchOnWindowFocus: true,
  } });
  const approve = useApproveAdminProjectUpdate();
  const reject = useRejectAdminProjectUpdate();
  const [result, setResult] = useState<{ text: string; failed: boolean } | null>(null);
  const busy = approve.isPending || reject.isPending;

  async function act(action: 'approve' | 'reject', updateId: number) {
    setResult(null);
    try {
      if (action === 'approve') await approve.mutateAsync({ updateId });
      else await reject.mutateAsync({ updateId });
      setResult({ text: action === 'approve' ? 'Update approved. It now appears on the project timeline.' : 'Update rejected. It won’t be shown or emailed.', failed: false });
    } catch (cause) {
      const status = cause && typeof cause === 'object' && 'status' in cause ? (cause as { status?: number }).status : undefined;
      setResult({ text: status === 409 ? 'This update was already reviewed.' : 'That didn’t save. Please try again.', failed: true });
    }
    await queryClient.invalidateQueries({ queryKey: getGetAdminProjectUpdatesQueryKey() });
  }

  return <section data-testid="section-admin-project-updates" style={{ marginBottom: 32, overflowWrap: 'anywhere' }}>
    <h3 style={{ margin: '0 0 8px' }}>Project updates awaiting review</h3>
    {!UPDATE_EMAILS_LIVE && <p className="admin-mono" data-testid="text-update-emails-off">Update emails aren’t switched on yet. Approving adds an update to the project timeline only.</p>}
    {result && <p className={`admin-review-feedback ${result.failed ? 'error' : ''}`} role={result.failed ? 'alert' : 'status'} data-testid="status-update-review">{result.text}</p>}
    {pending.isPending ? <p role="status">Loading updates…</p>
      : pending.isError ? <p role="alert">Updates couldn’t load. <button type="button" className="underline" onClick={() => void pending.refetch()}>Try again</button></p>
      : !pending.data.updates.length ? <p data-testid="text-no-pending-updates">No updates are waiting for review.</p>
      : <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 14 }}>
        {pending.data.updates.map(update => <li key={update.id} data-testid={`card-update-${update.id}`} style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-line)', padding: 18 }}>
          <p style={{ margin: 0 }}><strong>{update.label}</strong>{update.role && ` · ${update.role}`}{update.person_name && ` · ${update.person_name} (agreed to be named)`}</p>
          <p style={{ margin: '6px 0' }}>{update.project_slug ? <a href={`/project/${encodeURIComponent(update.project_slug)}`} target="_blank" rel="noopener noreferrer">{update.project_title || 'Untitled project'}</a> : update.project_title || 'Untitled project'}
            {' · '}{update.filmmaker_name || 'Filmmaker'}{update.filmmaker_email && ` (${update.filmmaker_email})`} · posted {day(update.created_at)}</p>
          {update.note && <p style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{update.note}</p>}
          <p style={{ margin: '10px 0' }} data-testid={`text-update-email-decision-${update.id}`}><strong>{adminEmailNotice(update.email_decision, update.backers_to_email)}</strong></p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button type="button" className="admin-button" data-testid={`button-approve-update-${update.id}`} disabled={busy} onClick={() => void act('approve', update.id)}>Approve</button>
            <button type="button" className="admin-button secondary" data-testid={`button-reject-update-${update.id}`} disabled={busy} onClick={() => void act('reject', update.id)}>Reject</button>
          </div>
        </li>)}
      </ul>}
  </section>;
}
