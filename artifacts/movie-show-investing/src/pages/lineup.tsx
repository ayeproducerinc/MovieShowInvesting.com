import { ArrowRight, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@workspace/replit-auth-web';
import { getGetCurrentInvestorIntentQueryKey, useGetCurrentInvestorIntent } from '@workspace/api-client-react';
import { getInitializedAuth, useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import '../investor.css';
import '../lineup.css';

const dollars = (amount: number) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
}).format(amount);

export default function Lineup() {
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
      enabled: ready,
      refetchOnMount: 'always',
      retry: (count, error) => error.status !== 403 && count < 2,
    },
  });
  const intent = current.data?.intent;
  const allocated = intent?.allocations.reduce((sum, row) => sum + row.amount, 0) ?? 0;
  const allInterestIsPending = Boolean(intent && (intent.unallocated || allocated === intent.amount));

  return <section className="inv lineup-page"><div className="page-wrap">
    <div className="inv-top"><Link href="/explore" className="inv-kicker">Movie Show Investing / Explore</Link><span className="inv-kicker">Private view</span></div>
    <div className="lineup-heading">
      <p className="inv-kicker">Your investor desk / Saved interest</p>
      <h1>Your saved <em>lineup.</em></h1>
      <p>This is a record of your non-binding interest, not a signed pledge or an investment. No money has been collected.</p>
    </div>

    {!ready || current.isPending ? <div className="lineup-loading" role="status" aria-label="Loading your saved lineup"><div className="inv-skeleton" style={{height:120}}/><div className="inv-skeleton" style={{height:180}}/></div> :
    current.isError ? <div className="lineup-empty" role="alert"><p className="inv-kicker">Connection interrupted</p><h2>We couldn’t open your lineup.</h2><p>Your saved interest has not been changed. Please try again.</p><button type="button" className="inv-button" onClick={() => void current.refetch()} data-testid="button-retry-lineup"><RotateCcw size={16}/> Try again</button></div> :
    !intent ? <div className="lineup-empty" data-testid="lineup-empty"><p className="inv-kicker">{signedIn ? 'No saved interest found' : 'Private lineup'}</p><h2>{signedIn ? 'Nothing is linked to this account.' : 'Sign in to see your saved lineup.'}</h2><p>{signedIn ? 'If you saved with a different account, sign out and use that account instead. An unlinked guest lineup is only available when signed out in its original browser.' : 'Use the same account you used to save your interest. If you saved as a guest, return to the original browser while signed out.'}</p><div className="inv-actions">{!signedIn && <GoogleSignInButton auth={getInitializedAuth()} queryClient={queryClient} disabled={!firebaseReady} className="inv-button" testId="button-lineup-sign-in" label="Sign in to view lineup" />}<Link href="/invest" className="inv-button secondary" data-testid="link-lineup-invest">Start the investor worksheet <ArrowRight size={16}/></Link></div></div> :
    <>
      <div className="lineup-summary" data-testid="lineup-summary">
        <div><span className="inv-kicker">Total saved interest / USD</span><strong data-testid="lineup-total">{dollars(intent.amount)}</strong></div>
        <div className="lineup-summary-status"><span className="lineup-status">{allInterestIsPending ? 'Saved · Not confirmed' : 'Saved interest · Partial view'}</span><p>{allInterestIsPending ? 'View-only for now. A separate signed confirmation step is not available yet.' : 'Only unconfirmed project choices appear below. The saved total includes interest not shown in these choices.'}</p></div>
      </div>
      <div className="lineup-section-head"><div><p className="inv-kicker">Project choices</p><h2>{intent.unallocated ? 'Not allocated yet.' : 'Where your interest goes.'}</h2></div><span>{intent.allocations.length} {intent.allocations.length === 1 ? 'project' : 'projects'}</span></div>
      {intent.unallocated ? <div className="lineup-unallocated" data-testid="lineup-unallocated"><strong>{dollars(intent.amount)} unallocated</strong><p>You saved interest without choosing a project. No project allocation has been recorded.</p></div> :
      intent.allocations.length ? <>
        <div className="lineup-rows">{intent.allocations.map((row, index) => {
          return <article className="lineup-row" key={row.project_id} data-testid={`lineup-project-${row.project_id}`}>
            <span className="lineup-number">{String(index + 1).padStart(2, '0')}</span>
            <div className="lineup-project-detail"><p className="inv-kicker">{row.project_visible ? 'Approved project' : 'Not currently listed'}</p><h3>{row.project_title ?? `Project #${row.project_id}`}</h3>{row.project_visible && row.project_slug && <Link href={`/project/${row.project_slug}`} className="lineup-project-link">View project <ArrowRight size={14}/></Link>}</div>
            <div className="lineup-row-amount"><span>Saved interest</span><strong>{dollars(row.amount)}</strong></div>
          </article>;
        })}</div>
        {allocated < intent.amount && <p className="lineup-help" role="status">Your saved total includes {dollars(intent.amount - allocated)} that is not attached to an unconfirmed project choice shown here.</p>}
      </> : <div className="lineup-unallocated" role="status"><strong>No project allocations are on record.</strong><p>Your saved total remains {dollars(intent.amount)}.</p></div>}
      <p className="lineup-disclaimer">Pledges are non-binding. No money is collected. This is not an offer to sell securities. Returns aren’t guaranteed; you may get back less, or nothing.</p>
      <div className="inv-actions lineup-actions"><Link href="/explore" className="inv-button secondary">Explore projects <ArrowRight size={16}/></Link><Link href="/messages" className="inv-button secondary">Messages <ArrowRight size={16}/></Link></div>
    </>}
  </div></section>;
}