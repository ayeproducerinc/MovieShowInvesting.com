import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@workspace/replit-auth-web';
import { getGetCurrentInvestorIntentQueryKey, getGetExploreQueryKey, getGetPublicProjectQueryKey, useConfirmInvestorIntent, useGetCurrentInvestorIntent } from '@workspace/api-client-react';
import { getInitializedAuth, useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { trackInvestorEvent } from '@/lib/analytics';
import '../investor.css';
import '../lineup.css';

const dollars = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
const risk = 'Returns aren’t guaranteed. You may get back less, or nothing.';
const notice = "Pledge your interest in future investment opportunities. If a project opens for investment, it will be offered only in compliance with securities laws, and you'll get full offering documents before you decide.";

export default function LineupConfirm() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const replitAuth = useAuth();
  const firebaseUser = useFirebaseUser();
  const firebaseReady = useFirebaseSessionReady();
  const signedIn = Boolean(replitAuth.user || firebaseUser);
  const identityId = replitAuth.user?.id ?? firebaseUser?.uid ?? 'visitor';
  const ready = !replitAuth.isLoading && firebaseReady;
  const current = useGetCurrentInvestorIntent({
    query: {
      queryKey: [...getGetCurrentInvestorIntentQueryKey(), identityId],
      enabled: ready && signedIn,
      refetchOnMount: 'always',
      retry: (count, error) => error.status !== 403 && count < 2,
    },
  });
  const confirm = useConfirmInvestorIntent();
  const [signature, setSignature] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const intent = current.data?.intent;
  const reviewKey = intent ? JSON.stringify([intent.investor_id, intent.entry_id, intent.name, intent.amount, intent.unallocated, intent.status, intent.allocations.map(row => [row.project_id, row.amount])]) : '';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signedIn || !intent || confirm.isPending || current.isFetching || stale || intent.status !== 'saved') return;
    if (signature !== intent.name || !accepted) {
      setError('Enter your saved full name exactly as shown and check the acknowledgment before continuing.');
      return;
    }
    setError('');
    try {
      const fresh = await current.refetch();
      const latest = fresh.data?.intent;
      const latestKey = latest ? JSON.stringify([latest.investor_id, latest.entry_id, latest.name, latest.amount, latest.unallocated, latest.status, latest.allocations.map(row => [row.project_id, row.amount])]) : '';
      if (fresh.isError || !latest || latestKey !== reviewKey) {
        setStale(true);
        return;
      }
      const allocationTotal = latest.allocations.reduce((sum, row) => sum + row.amount, 0);
      if (latest.unallocated ? latest.allocations.length !== 0 : allocationTotal !== latest.amount || latest.allocations.length === 0) {
        setStale(true);
        return;
      }
      await confirm.mutateAsync({ data: {
        signature_name: signature,
        accepted: true,
         entry_id: latest.entry_id,
        amount: latest.amount,
        allocations: latest.allocations.map(row => ({ project_id: row.project_id, amount: row.amount })),
      } });
      trackInvestorEvent('inv_confirmed');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetCurrentInvestorIntentQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetExploreQueryKey() }),
        ...latest.allocations.filter(row => row.project_slug).map(row =>
          queryClient.invalidateQueries({ queryKey: getGetPublicProjectQueryKey(row.project_slug!) })),
      ]);
      navigate('/lineup');
    } catch (cause) {
      // A lost response can follow a committed confirmation. Ask the server
      // before telling the investor whether the action succeeded.
      const reconciled = await current.refetch();
      if (reconciled.data?.intent?.status === 'confirmed' && reconciled.data.intent.entry_id === intent.entry_id) {
        trackInvestorEvent('inv_confirmed');
        await queryClient.invalidateQueries({ queryKey: getGetCurrentInvestorIntentQueryKey() });
        navigate('/lineup');
        return;
      }
      if (reconciled.isError) {
        setError('We could not verify whether confirmation succeeded. Reopen your lineup to check the latest status before trying again.');
        return;
      }
      const data = cause && typeof cause === 'object' && 'data' in cause ? cause.data : null;
      const detail = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : null;
      setError(detail ?? 'We couldn’t confirm your interest. Nothing has changed. Review your saved details and try again.');
    }
  }

  return <section className="inv lineup-page lineup-confirm-page"><div className="page-wrap">
    <div className="inv-top"><Link href="/lineup" className="inv-kicker" data-testid="link-confirm-back"><ArrowLeft size={13}/> Back to my lineup</Link><span className="inv-kicker">Private investor desk / 02</span></div>
    <div className="lineup-heading">
      <p className="inv-kicker">Review before you sign</p>
      <h1>Confirm your <em>interest.</em></h1>
      <p>Confirm the interest you already saved. This is a non-binding record of interest, not an investment or a payment.</p>
    </div>
    {!ready || (signedIn && (current.isPending || current.isFetching) && !intent) ? <div className="lineup-loading" role="status" aria-label="Loading your saved interest"><div className="inv-skeleton" style={{height:140}}/><div className="inv-skeleton" style={{height:220}}/></div> :
    !signedIn ? <div className="lineup-empty"><p className="inv-kicker">Sign-in required</p><h2>Confirm with your account.</h2><p>Sign in to review and confirm your saved interest. If you saved as a guest, use the original browser and claim the interest explicitly from your lineup after signing in.</p><div className="inv-actions"><GoogleSignInButton auth={getInitializedAuth()} queryClient={queryClient} disabled={!firebaseReady} className="inv-button" testId="button-confirm-sign-in" label="Sign in to continue" /><Link href="/lineup" className="inv-button secondary" data-testid="link-confirm-guest-lineup">View my lineup</Link></div></div> :
    current.isError ? <div className="lineup-empty" role="alert"><p className="inv-kicker">Connection interrupted</p><h2>We couldn’t verify your saved interest.</h2><p>Please retry to check its current status before confirming.</p><button type="button" className="inv-button" onClick={() => void current.refetch()} data-testid="button-confirm-retry"><RotateCcw size={16}/> Try again</button></div> :
    !intent ? <div className="lineup-empty"><p className="inv-kicker">No linked interest</p><h2>There’s nothing to confirm yet.</h2><p>If you saved as a guest in this browser, you can explicitly claim that original-browser interest from your lineup.</p><Link href="/lineup" className="inv-button" data-testid="link-confirm-claim">Go to my lineup <ArrowRight size={16}/></Link></div> :
    intent.status === 'confirmed' ? <div className="lineup-empty" role="status"><p className="inv-kicker">Already confirmed</p><h2>Your interest is confirmed.</h2><p>This is still non-binding interest, not an investment. Your confirmed record and project allocations are available in your lineup.</p><Link href="/lineup" className="inv-button" data-testid="link-confirm-already-lineup">View confirmed lineup <ArrowRight size={16}/></Link></div> :
    stale ? <div className="lineup-empty" role="alert" data-testid="status-confirm-stale"><p className="inv-kicker">Review no longer current</p><h2>Your saved details changed.</h2><p>No confirmation was made. Return to your lineup, then open a new review of the latest saved amount and allocations.</p><Link href="/lineup" className="inv-button" data-testid="link-confirm-stale-lineup">Review my lineup <ArrowRight size={16}/></Link></div> :
    <div className="lineup-review" data-testid="confirm-review">
      <div className="lineup-review-main">
        <div className="lineup-section-head"><div><p className="inv-kicker">01 / Saved record</p><h2>What you’re confirming.</h2></div><span>Non-binding</span></div>
        <div className="lineup-review-total"><div><span>Saved interest / USD</span><p>{risk}</p></div><strong data-testid="confirm-total">{dollars(intent.amount)}</strong></div>
        <div className="lineup-section-head"><div><p className="inv-kicker">02 / Project choices</p><h2>{intent.unallocated ? 'No projects selected.' : 'Your allocations.'}</h2></div><span>{intent.allocations.length} {intent.allocations.length === 1 ? 'project' : 'projects'}</span></div>
        <p className="lineup-help">{risk}</p>
        {intent.unallocated ? <div className="lineup-unallocated" data-testid="confirm-unallocated"><strong>{dollars(intent.amount)} unallocated</strong><p>Your interest is not allocated to any project.</p></div> :
           <div className="lineup-rows">{intent.allocations.map((row, index) => <div className="lineup-row" key={row.project_id} data-testid={`confirm-project-${row.project_id}`}><span className="lineup-number">{String(index + 1).padStart(2, '0')}</span><div className="lineup-project-detail"><p className="inv-kicker">{row.project_visible ? 'Project' : 'Not currently listed'}</p><h3>{row.project_title ?? `Project #${row.project_id}`}</h3></div><div className="lineup-row-amount"><span>Saved allocation</span><strong>{dollars(row.amount)}</strong></div></div>)}</div>}
        {intent.allocations.some(row => !row.project_visible) && <p className="lineup-help">A saved project is no longer publicly listed. You may still confirm your non-binding interest in it; its amount will not appear in public project totals while it remains unlisted.</p>}
        <div className="lineup-legal"><p>{notice}</p><p>No money is collected by confirming. This is not an offer to sell securities.</p></div>
      </div>
      <aside className="lineup-review-aside">
        <p className="inv-kicker">03 / Your acknowledgment</p><h2>Sign the saved record.</h2>
        <p>The full name saved with this interest is <strong data-testid="confirm-saved-name">{intent.name}</strong>. Type it exactly to confirm this non-binding interest.</p>
        <form className="lineup-confirm-form" onSubmit={event => void submit(event)}>
          <label htmlFor="signature-name">Your full name</label>
          <input id="signature-name" data-testid="input-confirm-signature" type="text" autoComplete="name" value={signature} onChange={event => { setSignature(event.target.value); setError(''); }} aria-invalid={Boolean(signature && signature !== intent.name)} required disabled={confirm.isPending || current.isFetching}/>
          <p className="lineup-hint">Must match the saved name exactly, including spacing and capitalization.</p>
          <label className="lineup-check" htmlFor="confirm-acknowledgment"><input id="confirm-acknowledgment" data-testid="checkbox-confirm-acknowledgment" type="checkbox" checked={accepted} onChange={event => { setAccepted(event.target.checked); setError(''); }} disabled={confirm.isPending || current.isFetching}/><span>I understand this confirms only my non-binding interest. No investment is being made and no money is collected.</span></label>
          {error && <p className="lineup-review-error" role="alert" data-testid="error-confirm">{error}</p>}
          <button type="submit" className="inv-button" data-testid="button-confirm-interest" disabled={signature !== intent.name || !accepted || confirm.isPending || current.isFetching}>{confirm.isPending || current.isFetching ? 'Verifying saved record…' : 'Confirm non-binding interest'} <ArrowRight size={16}/></button>
        </form>
      </aside>
    </div>}
  </div></section>;
}