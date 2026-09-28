import { useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@workspace/replit-auth-web';
import { getGetCurrentInvestorIntentQueryKey, getGetExploreQueryKey, useClaimInvestorIntent, useGetCurrentInvestorIntent, useGetExplore } from '@workspace/api-client-react';
import type { InvestorInterestHistoryItem } from '@workspace/api-client-react';
import { getInitializedAuth, useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { InvestorResultCard } from '@/components/investor-result-card';
import '../investor.css';
import '../lineup.css';

const dollars = (amount: number) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
}).format(amount);
const paybackDollars = (amount: number) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
}).format(amount);

function ProjectLineupFigures({ slug, amount }: { slug: string; amount: number }) {
  const explore = useGetExplore(undefined, {
    query: {
      queryKey: getGetExploreQueryKey(),
      refetchOnMount: 'always',
      refetchInterval: 60_000,
      retry: false,
    },
  });
  if (explore.isPending) return <p className="lineup-help" role="status">Checking current project figures…</p>;
  const project = explore.data?.projects.find(item => item.slug === slug);
  if (explore.isError || !project) {
    return <p className="lineup-help">Current project figures unavailable.</p>;
  }
  const paybackGoal = project.offer_per_100 !== null && project.offer_per_100 >= 125
    ? amount * project.offer_per_100 / 100 : null;
  return <div className="lineup-project-figures" data-testid={`figures-lineup-project-${project.id}`}>
    <p>{dollars(project.confirmed_pledge_total)} total confirmed, non-binding interest in this project.</p>
    {paybackGoal !== null && <p data-testid={`text-lineup-payback-goal-${project.id}`}>Payback goal: {paybackDollars(paybackGoal)} back on your {dollars(amount)}, based on the project’s current offer. Returns aren’t guaranteed. You may get back less, or nothing.</p>}
  </div>;
}

function SignedHistoryEntry({ entry, index }: { entry: InvestorInterestHistoryItem; index: number }) {
  return <article className="lineup-row" data-testid={`history-entry-${entry.entry_id ?? 'original'}`}>
    <span className="lineup-number">{String(index).padStart(2, '0')}</span>
    <div className="lineup-project-detail">
      <h3>Signed {new Date(entry.confirmed_at).toLocaleDateString('en-US')}</h3>
      {entry.unallocated ? <p>Unallocated</p> : entry.allocations.length ? <ul className="lineup-history-projects">
        {entry.allocations.map(row => <li key={row.project_id}>
          <strong>{row.project_title ?? `Project #${row.project_id}`}</strong> · {dollars(row.amount)} confirmed, non-binding interest
          {row.project_visible && row.project_slug && <ProjectLineupFigures slug={row.project_slug} amount={row.amount}/>}
        </li>)}
      </ul> : <p>No project allocations are on record.</p>}
    </div>
    <strong>{dollars(entry.amount)}</strong>
  </article>;
}

export default function Lineup() {
  const queryClient = useQueryClient();
  const replitAuth = useAuth();
  const firebaseUser = useFirebaseUser();
  const firebaseReady = useFirebaseSessionReady();
  const signedIn = Boolean(replitAuth.user || firebaseUser);
  const identityId = replitAuth.user?.id ?? firebaseUser?.uid ?? 'visitor';
  const ready = !replitAuth.isLoading && firebaseReady;
  const claim = useClaimInvestorIntent();
  const [claimError, setClaimError] = useState('');
  const current = useGetCurrentInvestorIntent({
    query: {
      queryKey: [...getGetCurrentInvestorIntentQueryKey(), identityId],
      enabled: ready,
      refetchOnMount: 'always',
      retry: (count, error) => error.status !== 403 && count < 2,
    },
  });
  const intent = current.data?.intent;
  const history = current.data?.history ?? [];
  const confirmedTotal = history.reduce((sum, entry) => sum + entry.amount, 0);
  const latestConfirmedEntry = history.reduce<(typeof history)[number] | null>((latest, entry) =>
    !latest || Date.parse(entry.confirmed_at) > Date.parse(latest.confirmed_at) ||
      (entry.confirmed_at === latest.confirmed_at && (entry.entry_id ?? 0) > (latest.entry_id ?? 0)) ? entry : latest, null);
  const allocated = intent?.allocations.reduce((sum, row) => sum + row.amount, 0) ?? 0;
  const confirmed = intent?.status === 'confirmed';
  async function claimGuestInterest() {
    setClaimError('');
    try {
      await claim.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: getGetCurrentInvestorIntentQueryKey() });
    } catch (cause) {
      const apiError = cause && typeof cause === 'object' ? cause as {status?:unknown} : null;
      if (apiError?.status === 404) {
        setClaimError('No guest interest was found in this browser. Return to the browser where you first saved it. Nothing was changed.');
      } else if (apiError?.status === 403) {
        setClaimError('This browser’s guest interest does not match the signed-in account. Sign in with the account for the guest email in the original browser. Nothing was changed.');
      } else if (apiError?.status === 409) {
        setClaimError('This account already has different investor interest. We cannot merge the two records automatically. Nothing was changed.');
      } else {
        setClaimError('We could not confirm whether guest interest was linked. Reload My lineup before trying again.');
      }
    }
  }

  return <section className="inv lineup-page"><div className="page-wrap">
    <div className="inv-top"><Link href="/explore" className="inv-kicker">Movie Show Investing / Explore</Link><span className="inv-kicker">Private view</span></div>
    <div className="lineup-heading">
      <p className="inv-kicker">Your investor desk / Private record</p>
      <h1>Your <em>lineup.</em></h1>
      <p>Your saved interest and project choices live here. Confirmation records your acknowledgment, but does not make an investment. No money has been collected.</p>
    </div>

    {!ready || current.isPending || current.isFetching ? <div className="lineup-loading" role="status" aria-label="Loading your saved lineup"><div className="inv-skeleton" style={{height:120}}/><div className="inv-skeleton" style={{height:180}}/></div> :
    current.isError ? <div className="lineup-empty" role="alert"><p className="inv-kicker">Connection interrupted</p><h2>We couldn’t open your lineup.</h2><p>Your saved interest has not been changed. Please try again.</p><button type="button" className="inv-button" onClick={() => void current.refetch()} data-testid="button-retry-lineup"><RotateCcw size={16}/> Try again</button></div> :
    !intent ? <div className="lineup-empty" data-testid="lineup-empty"><p className="inv-kicker">{signedIn ? 'No linked interest' : 'Private lineup'}</p><h2>{signedIn ? 'Nothing is linked to this account.' : 'Sign in to see your saved lineup.'}</h2><p>{signedIn ? 'Saved as a guest in this browser? You can choose to link that original-browser interest to your signed-in account. The verified account email must match the guest record. We will never link it automatically.' : 'Sign in with the account you used to save interest. If you saved as a guest, return to the original browser to find that record.'}</p><div className="inv-actions">{signedIn ? <button type="button" className="inv-button" data-testid="button-claim-guest-intent" disabled={claim.isPending} onClick={() => void claimGuestInterest()}>{claim.isPending ? 'Checking original-browser interest…' : 'Claim guest interest from this browser'} <ArrowRight size={16}/></button> : <GoogleSignInButton auth={getInitializedAuth()} queryClient={queryClient} disabled={!firebaseReady} className="inv-button" testId="button-lineup-sign-in" label="Sign in to view lineup" />}<Link href="/invest" className="inv-button secondary" data-testid="link-lineup-invest">Start the investor worksheet <ArrowRight size={16}/></Link></div>{claimError && <p role="alert" className="lineup-claim-error" data-testid="error-claim-intent">{claimError}</p>}</div> :
    <>
      <div className="lineup-summary" data-testid="lineup-summary">
        <div className="lineup-summary-main"><span className="inv-kicker">{confirmed ? 'Current confirmed entry' : 'Current saved, unconfirmed entry'} / USD</span><strong data-testid="lineup-total">{dollars(intent.amount)}</strong><p className="lineup-risk">Returns aren’t guaranteed. You may get back less, or nothing.</p></div>
        <div className="lineup-summary-status"><span className="lineup-status" data-testid="status-lineup">{confirmed ? 'Confirmed · Non-binding' : 'Saved · Not confirmed'}</span><p>{confirmed ? `Confirmed${intent.confirmed_at ? ` on ${new Date(intent.confirmed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}` : ''}. No investment or payment has been made.` : 'Your saved interest is awaiting your signed acknowledgment. No investment or payment has been made.'}</p></div>
      </div>
       {confirmed ? <div className="lineup-confirm-callout lineup-confirmed" role="status"><div><p className="inv-kicker">Signed acknowledgment on record</p><h2>Interest confirmed.</h2><p>This entry is confirmed and non-binding. Earlier signed entries remain below.</p></div></div> : signedIn ? <div className="lineup-confirm-callout"><div><p className="inv-kicker">Next step / Your acknowledgment</p><h2>Ready to confirm?</h2><p>Review the exact saved amount and allocations, then sign with your saved full name. Your interest remains non-binding.</p></div><div className="inv-actions"><Link href="/lineup/confirm" className="inv-button" data-testid="link-lineup-confirm">Review & confirm <ArrowRight size={16}/></Link><Link href={`/invest?revise=1${intent.allocations[0]?.project_slug ? `&project=${encodeURIComponent(intent.allocations[0].project_slug)}` : ''}`} className="inv-button secondary" data-testid="link-lineup-revise">Revise saved interest</Link></div></div> : <div className="lineup-confirm-callout"><div><p className="inv-kicker">Next step / Sign in</p><h2>Sign in to confirm.</h2><p>This guest interest is saved, but confirmation needs an account. After signing in, explicitly claim it from this original browser if it is not linked.</p></div><GoogleSignInButton auth={getInitializedAuth()} queryClient={queryClient} disabled={!firebaseReady} className="inv-button" testId="button-lineup-confirm-sign-in" label="Sign in to confirm" /></div>}
       {latestConfirmedEntry && <InvestorResultCard entry={latestConfirmedEntry}/>}
      <div className="lineup-section-head"><div><p className="inv-kicker">Project choices</p><h2>{intent.unallocated ? 'Not allocated yet.' : 'Where your interest goes.'}</h2></div><span>{intent.allocations.length} {intent.allocations.length === 1 ? 'project' : 'projects'}</span></div>
      {intent.unallocated ? <div className="lineup-unallocated" data-testid="lineup-unallocated"><strong>{dollars(intent.amount)} unallocated</strong><p>You {confirmed ? 'confirmed' : 'saved'} interest without choosing a project. No project allocation has been recorded.</p></div> :
      intent.allocations.length ? <>
        <div className="lineup-rows">{intent.allocations.map((row, index) => {
          return <article className="lineup-row" key={row.project_id} data-testid={`lineup-project-${row.project_id}`}>
            <span className="lineup-number">{String(index + 1).padStart(2, '0')}</span>
              <div className="lineup-project-detail"><p className="inv-kicker">{row.project_visible ? 'Approved project' : 'Not currently listed'}</p><h3>{row.project_title ?? `Project #${row.project_id}`}</h3>{row.project_visible && row.project_slug && <Link href={`/project/${row.project_slug}`} className="lineup-project-link" data-testid={`link-lineup-project-${row.project_id}`}>View project <ArrowRight size={14}/></Link>}{row.project_visible && row.project_slug && <ProjectLineupFigures slug={row.project_slug} amount={row.amount}/>}</div>
             <div className="lineup-row-amount"><span>{confirmed ? 'Confirmed allocation' : 'Saved interest'}</span><strong>{dollars(row.amount)}</strong></div>
          </article>;
        })}</div>
        {allocated < intent.amount && <p className="lineup-help" role="status">Your {confirmed ? 'confirmed' : 'saved'} total includes {dollars(intent.amount - allocated)} not attached to a project choice shown here.</p>}
      </> : <div className="lineup-unallocated" role="status"><strong>No project allocations are on record.</strong><p>Your {confirmed ? 'confirmed' : 'saved'} total remains {dollars(intent.amount)}.</p></div>}
        {history.length > 0 && <section className="lineup-legal" data-testid="lineup-confirmed-history"><h2>Signed interest history</h2><p>{dollars(confirmedTotal)} total confirmed, non-binding interest across {history.length} {history.length===1?'entry':'entries'}. Any saved but unconfirmed entry above is not included. These entries are not payments or investments.</p>{[...history].reverse().map((entry, index)=><SignedHistoryEntry key={entry.entry_id ?? 'original'} entry={entry} index={history.length-index}/>)}</section>}
      <div className="lineup-legal"><p>Pledge your interest in future investment opportunities. If a project opens for investment, it will be offered only in compliance with securities laws, and you'll get full offering documents before you decide.</p><p>No money is collected. This is not an offer to sell securities.</p></div>
      <div className="inv-actions lineup-actions"><Link href="/explore" className="inv-button secondary">Explore projects <ArrowRight size={16}/></Link><Link href="/messages" className="inv-button secondary">Messages <ArrowRight size={16}/></Link></div>
    </>}
  </div></section>;
}