import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@workspace/replit-auth-web';
import {
  getGetInvestorNotificationPermissionQueryKey,
  useGetInvestorNotificationPermission, useSetInvestorNotificationPermission,
} from '@workspace/api-client-react';
import { useFirebaseUser, useFirebaseSessionReady } from './firebase-bootstrap';

/** Separate notification permission; never changes a signed interest entry. */
export function InvestorNotificationPermissionControl() {
  const auth = useAuth();
  const firebase = useFirebaseUser();
  const firebaseReady = useFirebaseSessionReady();
  const owner = auth.user ? `replit:${auth.user.id}` : firebase ? `firebase:${firebase.uid}` : null;
  const cache = useQueryClient();
  const [error, setError] = useState('');
  const queryKey = [...getGetInvestorNotificationPermissionQueryKey(), owner];
  const permission = useGetInvestorNotificationPermission({ query: { queryKey, enabled: Boolean(owner) && firebaseReady && !auth.isLoading, retry: false } });
  const update = useSetInvestorNotificationPermission();
  async function save(allowed: boolean) {
    if (!owner) return;
    setError('');
    try {
      const result = await update.mutateAsync({ data: { allowed, expected_owner: owner } });
      cache.setQueryData(queryKey, result);
    } catch { setError('Your notification choice could not be saved. Your signed interest has not changed. Please try again.'); }
  }
  if (!owner) return null;
  return <section className="inv-section" aria-label="Offering notification permission" data-testid="notification-permission">
    <label className="fm-check">
      <input type="checkbox" checked={permission.data?.allowed === true}
        disabled={permission.isPending || permission.isError || update.isPending}
        onChange={event => void save(event.target.checked)} data-testid="checkbox-offering-notifications"/>
      <span>Email me when investment offerings relevant to my project waitlist or general interest become available.</span>
    </label>
    <p className="inv-small">Optional and separate from a chat invitation. This gives permission for future outreach; it does not guarantee an offering, invitation or eligibility. You can withdraw permission here without changing your signed interest.</p>
    {permission.data?.allowed === null && <p className="inv-small">No notification permission recorded. <button type="button" className="text-link" disabled={update.isPending} onClick={() => void save(false)}>No thanks</button></p>}
    {permission.data?.allowed === false && <p className="inv-small" role="status">Offering notifications are off.</p>}
    {permission.data?.allowed === true && <p className="inv-small" role="status">Offering notification permission saved.</p>}
    {permission.isError && <p className="inv-small" role="alert">Notification preferences unavailable. <button type="button" className="text-link" onClick={() => void permission.refetch()}>Retry</button></p>}
    {update.isPending && <p className="inv-small" role="status">Saving your choice…</p>}
    {error && <p role="alert" className="inv-error">{error}</p>}
  </section>;
}