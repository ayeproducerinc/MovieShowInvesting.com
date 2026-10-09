import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, RotateCcw, X } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { getFilmmakerResult, getGetFilmmakerResultQueryKey, useGetFilmmakerResult, useGetPitchReviewCheckoutConfig, useGetPitchReviewCheckoutStatus, useStartPitchReviewCheckout, useUpdateFilmmakerShowcase } from '@workspace/api-client-react';
import type { FilmmakerResult, FilmmakerShowcaseUpdate, GetPitchReviewCheckoutStatus200 } from '@workspace/api-client-react';
import { useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { closeGuestConfirmation, guestConfirmationVisible } from '@/lib/filmmaker-confirmation';
import { setFilmmakerAction } from '@/lib/filmmaker-intent';
import { consumePitchReviewChoice, getPitchReviewProof, type PitchReviewChoice } from '@/lib/pitch-review-intent';
import { ProjectShare, FilmmakerInvite, projectShareUrl } from '@/components/project-share';
import { ProjectMaterialsEditor } from '@/components/project-materials-editor';
import { PitchMaterialsEntry } from '@/components/pitch-materials-entry';
import { pitchDetailsFingerprint } from '@/lib/pitch-details-state';
import { legacyDeal, money, type Stage } from './filmmaker-calculator';
import { AgeGateForCurrentUser } from '@/components/age-acknowledgment';
import { ProposalSummary } from '@/components/proposal-summary';

const clean = (value: string) => value.trim() || null;
function validLinks(value: string) {
  const links = value.split('\n').map(s => s.trim()).filter(Boolean);
  if (links.length > 8 || links.some(s => s.length > 500)) return null;
  try {
    if (links.some(s => !['http:', 'https:'].includes(new URL(s).protocol))) return null;
    return links;
  } catch { return null; }
}

type ShowcaseStatus = {
  project_id: number | null;
  project_slug: string;
  showcase_requested: boolean;
  approved: boolean;
  hidden: boolean;
  refreshFailed?: boolean;
};

function ShowcaseForm({ result, onSaved, reviewStatus, reviewStatusState, checkoutEnabled, sandboxCheckout, checkoutUnavailableText, autoOpenReady, reviewTriggerRef, onRetryStatus, statusFetching }: { result: FilmmakerResult; onSaved: (updated: ShowcaseStatus) => Promise<ShowcaseStatus>; reviewStatus?: GetPitchReviewCheckoutStatus200; reviewStatusState: 'checking' | 'verified' | 'unavailable'; checkoutEnabled: boolean; sandboxCheckout: boolean; checkoutUnavailableText: string; autoOpenReady: boolean; reviewTriggerRef: React.RefObject<HTMLButtonElement | null>; onRetryStatus: () => void; statusFetching: boolean }) {
  const update = useUpdateFilmmakerShowcase({ request: { headers: result.project_id ? { 'X-MSI-Project-Id': String(result.project_id) } : {} } });
  const checkoutProof = result.checkout_proof || getPitchReviewProof(result.project_id);
  const checkout = useStartPitchReviewCheckout({ request: { headers: result.project_id ? {
    'X-MSI-Project-Id': String(result.project_id),
    ...(checkoutProof ? { 'X-MSI-Checkout-Proof': checkoutProof } : {}),
  } : {} } });
  const [showPaywall, setShowPaywall] = useState(false);
  const [offerSource, setOfferSource] = useState<PitchReviewChoice | 'manual'>('manual');
  const paywallRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [checkoutError, setCheckoutError] = useState('');
  const [checking, setChecking] = useState(false);
  const [needsReselect, setNeedsReselect] = useState(false);
  const [links, setLinks] = useState(result.team_links.join('\n'));
  const [moneyUse, setMoneyUse] = useState(result.money_use || '');
  const [distribution, setDistribution] = useState(result.distribution_plan || '');
  const [teamInfo, setTeamInfo] = useState(result.team_info || '');
  const [cfRan, setCfRan] = useState<boolean | null>(result.crowdfunding_ran ?? null);
  const [cfCampaign, setCfCampaign] = useState(result.crowdfunding_campaign || '');
  const [cfSame, setCfSame] = useState<boolean | null>(result.crowdfunding_same_project ?? null);
  const [cfGoal, setCfGoal] = useState(result.crowdfunding_goal != null ? String(result.crowdfunding_goal) : '');
  const [cfRaised, setCfRaised] = useState(result.crowdfunding_raised != null ? String(result.crowdfunding_raised) : '');
  const [cfObligations, setCfObligations] = useState(result.crowdfunding_obligations || '');
  const [publicName, setPublicName] = useState(result.public_filmmaker_name || '');
  const [savedDetailsFingerprint, setSavedDetailsFingerprint] = useState(() => pitchDetailsFingerprint({
    publicName: result.public_filmmaker_name || '', links: result.team_links.join('\n'),
    teamInfo: result.team_info || '', moneyUse: result.money_use || '', distribution: result.distribution_plan || '',
    cfRan: result.crowdfunding_ran ?? null, cfCampaign: result.crowdfunding_campaign || '',
    cfSame: result.crowdfunding_same_project ?? null,
    cfGoal: result.crowdfunding_goal != null ? String(result.crowdfunding_goal) : '',
    cfRaised: result.crowdfunding_raised != null ? String(result.crowdfunding_raised) : '',
    cfObligations: result.crowdfunding_obligations || '',
  }));
  const [materialsWarning, setMaterialsWarning] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [savedStatus, setSavedStatus] = useState<ShowcaseStatus | null>(null);
  const [approvalMayHavePaused, setApprovalMayHavePaused] = useState(false);
  const canCheckout = checkoutEnabled && reviewStatusState === 'verified';
  const paymentNotice = reviewStatusState === 'unavailable'
    ? 'Checkout status is temporarily unavailable. This does not mean you paid. Your pitch is saved. Retry status before starting another checkout.'
    : reviewStatusState === 'checking'
      ? 'Checking this pitch’s payment status before checkout is available…'
      : checkoutUnavailableText;
  const detailsFingerprint = pitchDetailsFingerprint({
    publicName, links, teamInfo, moneyUse, distribution,
    cfRan, cfCampaign, cfSame, cfGoal, cfRaised, cfObligations,
  });
  const unsavedDetails = detailsFingerprint !== savedDetailsFingerprint;
  useEffect(() => {
    if (autoOpenReady && result.project_id && !result.showcase_requested
      && !result.hidden && !reviewStatus?.paid && !reviewStatus?.fee_waived && !reviewStatus?.pending) {
      const choice = consumePitchReviewChoice(result.project_id);
      if (choice) {
        setOfferSource(choice);
        setShowPaywall(true);
      }
    }
  }, [result.project_id, result.showcase_requested, result.hidden, reviewStatus?.paid, reviewStatus?.fee_waived, reviewStatus?.pending, autoOpenReady]);
  useEffect(() => {
    if (result.showcase_requested || result.hidden || reviewStatus?.paid || reviewStatus?.fee_waived || reviewStatus?.pending) setShowPaywall(false);
  }, [result.showcase_requested, result.hidden, reviewStatus?.paid, reviewStatus?.fee_waived, reviewStatus?.pending]);
  useEffect(() => {
    if (showPaywall) paywallRef.current?.focus();
  }, [showPaywall]);
  function restoreOfferFocus() {
    window.requestAnimationFrame(() => (returnFocusRef.current?.isConnected ? returnFocusRef.current : reviewTriggerRef.current)?.focus());
  }
  useEffect(() => {
    if (!showPaywall) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !checkout.isPending) {
        event.preventDefault();
        setShowPaywall(false);
        restoreOfferFocus();
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(paywallRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? []);
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === paywallRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showPaywall, checkout.isPending, reviewTriggerRef]);
  function closePaywall() {
    setShowPaywall(false);
    restoreOfferFocus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checking || update.isPending || needsReselect) return;
    const teamLinks = validLinks(links);
    if (!teamLinks) { setError('Add up to eight full http:// or https:// team links, one per line.'); return; }
    const nonNeg = (v: string) => !v.trim() || (Number.isFinite(Number(v)) && Number(v) >= 0);
    if (!nonNeg(cfGoal) || !nonNeg(cfRaised)) { setError('Campaign goal and amount raised must be zero or more.'); return; }
    setError(''); setSaved(false);
    setSavedStatus(null);
    setApprovalMayHavePaused(Boolean(result.approved && result.showcase_requested && !result.hidden));
    const data: FilmmakerShowcaseUpdate = {
      showcase_requested: Boolean(result.showcase_requested),
      team_links: teamLinks,
      public_filmmaker_name: clean(publicName),
      money_use: clean(moneyUse),
      distribution_plan: clean(distribution),
      // Collapsing preserves values; explicitly clearing this editor removes current team text.
      team_info: clean(teamInfo),
      crowdfunding_ran: cfRan ?? undefined,
      ...(cfRan === true ? {
        crowdfunding_campaign: clean(cfCampaign) ?? undefined,
        crowdfunding_same_project: cfSame ?? undefined,
        crowdfunding_goal: cfGoal.trim() ? Number(cfGoal) : undefined,
        crowdfunding_raised: cfRaised.trim() ? Number(cfRaised) : undefined,
        crowdfunding_obligations: clean(cfObligations) ?? undefined,
      } : {}),
    };
    setChecking(true);
    try {
      const current = await getFilmmakerResult();
      if (current.project_id !== result.project_id) {
        setNeedsReselect(true);
        setError('This project is no longer selected for editing. Copy any unsaved details, then open My projects and select it again.');
        return;
      }
      const updated = await update.mutateAsync({ data });
      setSavedDetailsFingerprint(detailsFingerprint);
      setMaterialsWarning('');
      const refreshedStatus = await onSaved({
        project_id: result.project_id,
        project_slug: updated.project_slug,
        showcase_requested: updated.showcase_requested,
        approved: updated.approved,
        hidden: updated.hidden,
      });
      setSavedStatus(refreshedStatus);
      setSaved(true);
    } catch (failure) {
      const status = failure && typeof failure === 'object' && 'status' in failure ? failure.status : null;
      if (status === 404 || status === 409 || status === 403 || status === 401) {
        setNeedsReselect(true);
        setError('This project could not be opened for editing with the current sign-in and selection. Copy any unsaved details, then open My projects and select it again.');
      } else {
        setError('We could not save your pitch details. Please try again.');
      }
    } finally {
      setChecking(false);
    }
  }
  return <section id="section-showcase" className="dossier-section" data-testid="section-showcase">
    {sandboxCheckout && <p className="dossier-notice mb-4" data-testid="notice-sandbox-review">Sandbox test mode · No real charge. Test payments affect only this preview, not the live site.</p>}
    {!result.showcase_requested && !reviewStatus?.paid && !reviewStatus?.fee_waived && !reviewStatus?.pending && !result.hidden && <div className="dossier-notice mb-4" data-testid="offer-editorial-review">
      <strong>Submit for editorial review · $49 once per pitch</strong>
      <p>The free unlisted page and share link remain yours. If approved, your pitch will join Explore’s public Pitch Collection with no preset expiration date. Investors will be able to browse when they join.</p>
      <button ref={reviewTriggerRef} type="button" className="dossier-button" data-testid="button-open-review-paywall" onClick={() => { returnFocusRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : reviewTriggerRef.current; if (result.project_id) consumePitchReviewChoice(result.project_id); setOfferSource('manual'); setCheckoutError(''); setShowPaywall(true); }}>Submit for editorial review · $49 <ArrowRight size={17}/></button>
      {!canCheckout && <p role="status">{paymentNotice}</p>}
      {reviewStatusState === 'unavailable' && <button type="button" className="dossier-button dossier-button-outline" data-testid="button-retry-review-status" disabled={statusFetching} onClick={onRetryStatus}>{statusFetching ? 'Checking status…' : 'Retry checkout status'}</button>}
    </div>}
    <details className="dossier-fold" data-testid="details-edit-pitch" style={{ marginTop: 8 }}><summary style={{ cursor:'pointer', fontWeight:600 }}>Edit pitch details</summary>
    <PitchMaterialsEntry disabled={checking || update.isPending || needsReselect} warning={materialsWarning} onOpen={event => {
      if (checking || update.isPending || needsReselect || unsavedDetails) {
        event.preventDefault();
        setMaterialsWarning(needsReselect
          ? 'Open My projects and select this project again before managing materials. Your unsaved edits are still here.'
          : checking || update.isPending
            ? 'Wait for your pitch details to finish saving before opening materials.'
            : 'You have unsaved pitch details. Click Save pitch details below before opening materials. Your edits are still here.');
      } else {
        setMaterialsWarning('');
      }
    }}/>
    <span className="dossier-kicker" style={{ marginTop: 16, display:'block' }}>Optional / pitch details</span>
    <h2 style={{ fontSize: 28 }}>{result.showcase_requested ? 'Your showcase details.' : 'Tell more of the story.'}</h2>
    <p>{result.approved && result.showcase_requested && !result.hidden
      ? 'This project is approved for showcase listing. Saving changes to approved showcase content may pause approval and require another review before it is listed. Share a synopsis, not a full script.'
      : result.showcase_requested
        ? 'Your showcase review is pending; requesting review is not approval. The page remains accessible to anyone with its link. Share a synopsis, not a full script. You can revise these optional details later.'
         : 'Your project is free and unlisted. Save optional details here, then choose Submit for review when you are ready. Saving details alone does not request review. Share a synopsis, not a full script.'}</p>
    <form onSubmit={event => void submit(event)} style={{ marginTop: 30 }}>
      <fieldset disabled={checking || update.isPending || needsReselect} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="dossier-field"><label htmlFor="showcase-public-name">Public filmmaker name <small>· optional</small></label><input id="showcase-public-name" data-testid="input-showcase-public-name" maxLength={120} value={publicName} onChange={e => setPublicName(e.target.value)} aria-describedby="showcase-public-name-help" autoComplete="off" /><small id="showcase-public-name-help">Appears beside your project title on the public page, visible to anyone with the link. Leave blank to keep your private contact name private. Don’t enter emails or phone numbers.</small></div>
      <div className="dossier-field"><label htmlFor="showcase-team-info">Key team <small>· optional</small></label><textarea id="showcase-team-info" data-testid="input-showcase-team-info" maxLength={3000} value={teamInfo} onChange={e => setTeamInfo(e.target.value)} /></div>
      <div className="dossier-field"><label htmlFor="showcase-links">Team links <small>· optional, one full URL per line, up to 8</small></label><textarea id="showcase-links" data-testid="input-showcase-links" value={links} onChange={e => setLinks(e.target.value)} placeholder={'https://example.com/team'} /></div>
      <div className="dossier-field"><label htmlFor="showcase-money-use">How the money would be used <small>· optional</small></label><textarea id="showcase-money-use" data-testid="input-showcase-money-use" maxLength={3000} value={moneyUse} onChange={e => setMoneyUse(e.target.value)} /></div>
      <div className="dossier-field"><label htmlFor="showcase-distribution">Distribution plan <small>· optional</small></label><textarea id="showcase-distribution" data-testid="input-showcase-distribution" maxLength={3000} value={distribution} onChange={e => setDistribution(e.target.value)} /></div>
      <fieldset className="dossier-field" data-testid="group-edit-crowdfunding" style={{ border: 0, padding: 0 }}><legend>Crowdfunding campaign <small>· optional, private to review</small></legend>
        <label><input type="checkbox" data-testid="checkbox-edit-crowdfunding-ran" checked={cfRan === true} onChange={e => setCfRan(e.target.checked ? true : false)} /> I ran a crowdfunding campaign</label>
        {cfRan === true && <>
          <input data-testid="input-edit-crowdfunding-campaign" aria-label="Platform or campaign link" placeholder="Platform or link, or explain if none" value={cfCampaign} onChange={e => setCfCampaign(e.target.value)} />
          <label><input type="checkbox" checked={cfSame === true} onChange={e => setCfSame(e.target.checked)} /> It was for this project</label>
          <input aria-label="Goal in dollars" inputMode="decimal" placeholder="Goal $" value={cfGoal} onChange={e => setCfGoal(e.target.value)} />
          <input aria-label="Raised in dollars" inputMode="decimal" placeholder="Raised $" value={cfRaised} onChange={e => setCfRaised(e.target.value)} />
          <textarea aria-label="Campaign type and anything still owed" placeholder="Rewards still to ship, repayment commitments" value={cfObligations} onChange={e => setCfObligations(e.target.value)} />
        </>}
        <small>Unchecking never deletes saved campaign details.</small>
      </fieldset>
      </fieldset>
      {error && <p className="dossier-error" role="alert" data-testid="error-showcase">{error}</p>}
      {needsReselect && <Link href="/me/projects?action=manage" onClick={() => setFilmmakerAction('manage')} data-testid="link-reselect-showcase-project" className="dossier-button dossier-button-outline">Open My projects <ArrowRight size={17}/></Link>}
      {saved && savedStatus && <p className="dossier-notice" role="status" data-testid="status-showcase-saved">
        {savedStatus.hidden
          ? 'Your details were saved. The project is currently hidden and its page is unavailable to viewers.'
          : savedStatus.approved && savedStatus.showcase_requested
            ? 'Your details were saved. The refreshed project status is approved for showcase listing.'
            : savedStatus.showcase_requested
              ? approvalMayHavePaused
                ? 'Your changes were saved. Showcase review is now pending; approval was paused, so the project may need re-review before it is listed.'
                : 'Your details were saved. Your showcase review remains pending.'
              : 'Your details were saved. Your project is still unlisted and has not been sent for review.'}
        {savedStatus.refreshFailed && ' The latest status could not be refreshed; this reflects the status returned when the update was saved.'}
      </p>}
      <button type="submit" data-testid="button-save-showcase" className="dossier-button dossier-button-outline" disabled={checking || update.isPending || needsReselect} style={{ marginTop: 18 }}>{checking || update.isPending ? 'Saving details…' : 'Save pitch details'} <ArrowRight size={17}/></button>
    </form>
    </details>
    {!result.showcase_requested && !reviewStatus?.paid && !reviewStatus?.fee_waived && !reviewStatus?.pending && !result.hidden && <>
      {showPaywall && <div ref={paywallRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Pitch review checkout" className="fixed inset-0 z-50 flex items-center justify-center bg-[#202936]/75 p-4">
        <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col bg-[#f4f0e7] shadow-2xl">
          <button type="button" aria-label="Close editorial review offer" data-testid="button-close-review-paywall" disabled={checkout.isPending} onClick={closePaywall} className="absolute right-4 top-4 z-10 rounded p-2 text-[#202936] hover:bg-[#e7dfd2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><X size={22} aria-hidden="true" /></button>
          <div className="min-h-0 overflow-y-auto p-7 pb-4 md:p-10 md:pb-4">
           <p className="dossier-kicker pr-10">Editorial review · $49 per pitch</p>
          <h2 className="serif mt-3 text-4xl">Submit your pitch for review</h2>
          {sandboxCheckout && <p className="dossier-notice mt-4" data-testid="notice-sandbox-checkout">Sandbox test checkout · No real money is charged. Use a Stripe test card to check the post-payment flow in this preview.</p>}
          <p className="mt-5 leading-relaxed"><strong>$49 one time.</strong> This pays for editorial review of this pitch. Approval is not guaranteed. If approved, we’ll list it in the public Pitch Collection with no preset expiration date.</p>
          <p className="mt-3 text-sm">Have a promotion code? Enter it in Stripe Checkout before completing your order. An eligible code may reduce or waive the fee; checkout shows your final total.</p>
           <p className="mt-3 text-sm">After we complete your review, a declined pitch is not automatically refunded. If we cannot deliver the review, we’ll refund the payment, subject to applicable law. You can leave checkout before paying; cancelling checkout does not submit the pitch for review.</p>
          <p className="mt-3 text-sm">We’re building the Pitch Collection that investors will be able to browse when they join.</p>
            {!canCheckout && <p role="status" className="dossier-notice mt-4">{paymentNotice}</p>}
            {reviewStatusState === 'unavailable' && <button type="button" className="dossier-button dossier-button-outline mt-3" data-testid="button-retry-review-status-modal" disabled={statusFetching} onClick={onRetryStatus}>{statusFetching ? 'Checking status…' : 'Retry checkout status'}</button>}
          </div>
           <div className="shrink-0 border-t border-[#c8c0b5] px-7 py-4 md:px-10">
             {!canCheckout && <p role="status" className="mb-3 text-xs text-[#4d5557]">{paymentNotice}</p>}
             {unsavedDetails && <p role="alert" className="mb-3 text-sm text-[#943c55]">You have unsaved pitch details. Close this window and save them before checkout so they are included in your review.</p>}
             {checkoutError && <p role="alert" className="mb-3 text-sm text-[#943c55]">{checkoutError}</p>}
             <AgeGateForCurrentUser role="filmmaker"><div className="flex flex-wrap gap-3">
             <button type="button" className="dossier-button" disabled={!canCheckout || checkout.isPending || needsReselect || unsavedDetails} data-testid="button-pay-review" onClick={() => void (async () => {
              setCheckoutError('');
              try {
                let current: FilmmakerResult | null = null;
                try {
                  current = await getFilmmakerResult();
                } catch (error) {
                  const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
                  if (status !== 404 || !checkoutProof) throw error;
                }
                if (current && current.project_id !== result.project_id) { setNeedsReselect(true); setCheckoutError('The selected pitch changed. Open My projects and select it again.'); return; }
                const started = await checkout.mutateAsync();
                if (started.already_submitted) { setShowPaywall(false); await onSaved({ project_id: result.project_id, project_slug: result.project_slug ?? '', showcase_requested: true, approved: Boolean(result.approved), hidden: Boolean(result.hidden) }); return; }
                if (!started.url) throw new Error('Missing checkout URL');
                window.location.assign(started.url);
              } catch (error) {
                const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
                if (status === 409 || status === 404 || status === 403) {
                  setNeedsReselect(true);
                  setCheckoutError('This pitch could not be verified for checkout. Sign in and select it again from My projects. No payment was started.');
                } else if (status === 400 || status === 401) {
                  setCheckoutError('This browser no longer has access to the visit that submitted this pitch. Return to the original browser or sign in and open it from My projects. No payment was started.');
                } else if (status === 503) {
                   setCheckoutError('Checkout is unavailable. Your free pitch remains saved. If you completed checkout already, check its review status before trying again.');
                } else {
                  setCheckoutError('Checkout could not start. Your free pitch is saved; please try again.');
                }
              }
              })()}>{checkout.isPending ? 'Opening checkout…' : 'Continue to checkout'}</button>
            {offerSource !== 'paid' && <button type="button" className="dossier-button dossier-button-outline" disabled={checkout.isPending} onClick={closePaywall}>Not now</button>}
            {needsReselect && <Link href="/me/projects" className="underline">Open My projects</Link>}
             </div></AgeGateForCurrentUser>
          </div>
        </div>
      </div>}
    </>}
    {reviewStatus?.declined && <p role="status" className="dossier-notice">Your pitch was reviewed and was not approved for the public Pitch Collection. Your free unlisted page remains available.</p>}
  </section>;
}

export default function FilmmakerDone() {
  const firebaseUser = useFirebaseUser();
  const identityId = firebaseUser?.uid ?? 'visitor';
  return <FilmmakerDoneContent key={identityId} identityId={identityId} />;
}

function FilmmakerDoneContent({ identityId }: { identityId: string }) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const reviewTriggerRef = useRef<HTMLButtonElement>(null);
  const authReady = useFirebaseSessionReady();
  const user = useFirebaseUser();
  const [guestVisible] = useState(guestConfirmationVisible);
  const result = useGetFilmmakerResult({ query: { queryKey: [...getGetFilmmakerResultQueryKey(), identityId], enabled: authReady, refetchOnMount: 'always', retry: (count, error) => error.status !== 404 && count < 2 } });
  const checkoutConfig = useGetPitchReviewCheckoutConfig({ query: { queryKey: ['/api/filmmakers/review-checkout/config'], retry: false, staleTime: 0, refetchOnMount: 'always' } });
  const sandboxCheckout = import.meta.env.DEV && checkoutConfig.data?.mode === 'sandbox';
  // Preview accepts only the verified sandbox; published builds accept only live checkout.
  const checkoutEnabled = checkoutConfig.isSuccess && checkoutConfig.data.enabled
    && (import.meta.env.DEV ? sandboxCheckout : checkoutConfig.data.mode === 'live');
  const checkoutUnavailableText = checkoutConfig.isLoading
    ? 'Checking editorial review checkout availability…'
    : checkoutConfig.isSuccess && (import.meta.env.DEV ? checkoutConfig.data.mode !== 'sandbox' : checkoutConfig.data.mode !== 'live')
      ? 'Checkout does not match this environment. Your free pitch and share link remain saved.'
      : `${sandboxCheckout ? 'Sandbox test' : 'Editorial review'} checkout is temporarily unavailable. Your free pitch and share link remain saved. Please try again later.`;
  const data = result.data;
  const editMaterials = new URLSearchParams(search).get('edit') === 'materials';
  const wasEditingMaterials = useRef(editMaterials);
  useEffect(() => {
    if (wasEditingMaterials.current && !editMaterials) void result.refetch();
    wasEditingMaterials.current = editMaterials;
  }, [editMaterials, result.refetch]);
  useEffect(() => {
    if (editMaterials || !data?.completed || !authReady
      || new URLSearchParams(search).get('details') !== 'materials') return;
    const frame = window.requestAnimationFrame(() => {
      const details = document.querySelector<HTMLDetailsElement>('[data-testid="details-edit-pitch"]');
      if (!details) return;
      details.open = true;
      details.querySelector('summary')?.focus({ preventScroll: true });
      details.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [search, editMaterials, data?.completed, data?.project_id, authReady]);
  const checkoutProof = data?.checkout_proof || getPitchReviewProof(data?.project_id ?? null);
  const reviewStatus = useGetPitchReviewCheckoutStatus({
    request: { headers: data?.project_id ? {
      'X-MSI-Project-Id': String(data.project_id),
      ...(checkoutProof ? { 'X-MSI-Checkout-Proof': checkoutProof } : {}),
    } : {} },
    query: { queryKey: ['/api/filmmakers/review-checkout/status', identityId, data?.project_id], enabled: authReady && !!data?.project_id, refetchOnMount: 'always', refetchInterval: 20_000, retry: false },
  });
  const checkoutReturn = new URLSearchParams(search).get('review_checkout');
  useEffect(() => {
    if (checkoutReturn && data?.project_id) consumePitchReviewChoice(data.project_id);
  }, [checkoutReturn, data?.project_id]);
  useEffect(() => {
    if ((reviewStatus.data?.paid || reviewStatus.data?.fee_waived) && !data?.showcase_requested) void result.refetch();
  }, [reviewStatus.data?.paid, reviewStatus.data?.fee_waived, data?.showcase_requested]);
  const [showcaseStatusOverride, setShowcaseStatusOverride] = useState<ShowcaseStatus | null>(null);
  useEffect(() => {
    if (result.isSuccess) setShowcaseStatusOverride(null);
  }, [result.dataUpdatedAt, result.isSuccess]);
  const activeShowcaseStatus: ShowcaseStatus | null = data?.project_id != null && data.project_slug
    ? showcaseStatusOverride?.project_id === data.project_id && showcaseStatusOverride.project_slug === data.project_slug
      ? showcaseStatusOverride
      : {
        project_id: data.project_id,
        project_slug: data.project_slug,
        showcase_requested: Boolean(data.showcase_requested),
        approved: Boolean(data.approved),
        hidden: Boolean(data.hidden),
      }
    : null;
  async function refreshResult() {
    const refreshed = await result.refetch();
    if (!refreshed.isError && refreshed.data) setShowcaseStatusOverride(null);
    return refreshed;
  }
  async function refreshShowcaseStatus(updated: ShowcaseStatus): Promise<ShowcaseStatus> {
    let current = updated;
    let refreshFailed = false;
    try {
      const refreshed = await refreshResult();
      const latest = refreshed.data;
      if (refreshed.isError) {
        refreshFailed = true;
      } else if (latest?.project_id === updated.project_id && latest.project_slug === updated.project_slug) {
        current = {
          project_id: latest.project_id,
          project_slug: latest.project_slug,
          showcase_requested: Boolean(latest.showcase_requested),
          approved: Boolean(latest.approved),
          hidden: Boolean(latest.hidden),
        };
      } else {
        refreshFailed = true;
      }
    } catch {
      refreshFailed = true;
    } finally {
      current = { ...current, refreshFailed };
      // A successful refetch is authoritative, including later approval changes.
      // Only retain the mutation response when the fresh project status is unavailable.
      setShowcaseStatusOverride(refreshFailed ? current : null);
    }
    return current;
  }
  useEffect(() => () => closeGuestConfirmation(), []);
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && !user && !guestConfirmationVisible()) navigate('/me/projects');
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [user, navigate]);
  useEffect(() => {
    if (!authReady || user) return;
    if ((data?.completed && !guestVisible) || result.error?.status === 401) navigate('/me/projects');
  }, [authReady, user, data?.completed, guestVisible, result.error, navigate]);
  useEffect(() => {
    if (data?.completed) sessionStorage.removeItem('filmmaker-submitted-no-project');
  }, [data?.completed]);
  if (!authReady || result.isLoading || (!user && data?.completed && !guestVisible)) return <section className="dossier"><div className="page-wrap dossier-hero" aria-label="Loading your saved submission"><p className="dossier-kicker">Retrieving your submission</p><div className="dossier-skeleton" style={{ width: 'min(90%, 660px)', height: 95 }} /><div className="dossier-skeleton" style={{ width: 'min(60%, 420px)' }} /></div></section>;
  if (result.isError && result.error?.status === 404 && identityId !== 'visitor') return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker">Select your project</p><h1 className="dossier-title">Your project is <em>still saved.</em></h1><p className="dossier-lead" role="alert">There is no submitted project selected for this visit. Open My projects and select the project you want to edit before submitting it for paid review.</p><Link href="/me/projects?action=manage" onClick={() => setFilmmakerAction('manage')} data-testid="link-reselect-result-project" className="dossier-button" style={{ marginTop: 30 }}>Open My projects <ArrowRight size={17}/></Link></div></section>;
  if (result.isError && result.error?.status !== 404) return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker">Connection interrupted</p><h1 className="dossier-title">Your story is <em>still here.</em></h1><p className="dossier-lead" role="alert">We couldn’t retrieve your saved submission right now. Please try again.</p><button type="button" className="dossier-button" data-testid="button-retry-result" style={{ marginTop: 30 }} onClick={() => void refreshResult()}><RotateCcw size={16}/> Try again</button></div></section>;
   if (!data?.completed) return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker">Not submitted</p><h1 className="dossier-title">The beginning<br/><em>comes first.</em></h1><p className="dossier-lead">No final submission is attached to this visit. If you saved a draft, open the worksheet to continue it; otherwise, start your answers. Saving a draft does not submit it.</p><Link href="/start/filmmaker" data-testid="link-return-to-worksheet" className="dossier-button" style={{ marginTop: 32 }}>Open the worksheet <ArrowRight size={17}/></Link></div></section>;
   if (data.no_project_yet) return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker"><Check size={15} style={{ display: 'inline', marginRight: 9 }}/> Answers received / No project yet</p><h1 className="dossier-title" data-testid="text-confirmation">There’s room<br/><em>for what’s next.</em></h1><p className="dossier-lead">We received your contact details and your interest in participating in the future. No project or deal terms were submitted.</p><div className="dossier-notice" style={{ maxWidth: 680, marginTop: 42 }}>We’re still building this experience. There’s no investment available or money collected here today. If there’s a relevant next step, we’ll reach out using the information you shared.</div>{!user && <p className="dossier-status">Your answers are saved. Sign in to manage future projects across devices.</p>}<div className="dossier-actions" style={{ marginTop: 38 }}><Link href="/me/projects?action=start" onClick={() => setFilmmakerAction('start')} data-testid="link-start-another-project" className="dossier-button">Start a project <ArrowRight size={17}/></Link><Link href="/me/projects?action=manage" onClick={() => setFilmmakerAction('manage')} className="dossier-button dossier-button-outline">Manage projects <ArrowRight size={17}/></Link></div></div></section>;
    if (editMaterials) return <section className="dossier"><div className="page-wrap">
      <div className="dossier-head"><Link href="/" className="dossier-kicker">Movie Show Investing / Filmmakers</Link><span className="dossier-kicker">Project materials / {data.title || 'Your project'}</span></div>
      {data.project_id && data.project_slug
        ? <ProjectMaterialsEditor key={`project-${data.project_id}`} projectId={data.project_id} title={data.title || 'Your project'}/>
        : <p className="dossier-notice" role="alert">Materials are unavailable for this project selection. Open My projects and select an available account-owned project before editing.</p>}
    </div></section>;
  const stageValue = data.stage as string | null | undefined;
  const stage = (['distribution', 'production', 'idea'].includes(stageValue || '') ? stageValue : null) as Stage | null;
  const legacyStage = stageValue && !stage ? stageValue : null;
  const legacyStageDetail = (data as FilmmakerResult & { stage_other?: string | null }).stage_other;
  const snapshot = data.proposal ?? null;
  const repayment = snapshot?.repayment_per100 ?? data.offer_per100 ?? null;
  const snapshotFee = snapshot?.platform_fee_percent;
  const deal = stage && data.budget && repayment && (snapshot ? snapshotFee !== undefined : data.price_group) ? (() => {
    // Snapshot fee when present; otherwise the historical group/stage fee. Never re-priced.
    const base = legacyDeal(data.budget, stage, (data.price_group ?? 'A') as 'A' | 'B', repayment);
    if (!snapshot) return base;
    const platformFee = Math.round(data.budget * snapshotFee!) / 100;
    return { ...base, feeRate: snapshotFee!, platformFee, combinedPayback: Math.round((base.investorTarget + platformFee) * 100) / 100 };
  })() : null;
    const reviewEligible = Boolean(!editMaterials && data.project_slug && !activeShowcaseStatus?.hidden && !activeShowcaseStatus?.showcase_requested && !reviewStatus.data?.paid && !reviewStatus.data?.fee_waived && !reviewStatus.data?.pending);
   return <section className="dossier dossier--result"><div className="page-wrap">
     <div className="dossier-head"><Link href="/" className="dossier-kicker" data-testid="link-result-home">Movie Show Investing / Filmmakers</Link><span className="dossier-kicker">Final submission received</span></div>
    <div className="dossier-grid">
     <div className="dossier-intro">
     <div className="dossier-hero"><p className="dossier-kicker" data-testid="status-final-submission"><Check size={15} style={{ display: 'inline', marginRight: 9 }}/> Final submission received</p><h1 className="dossier-title" data-testid="text-confirmation" style={{ fontSize: 'clamp(34px, 5vw, 56px)' }}>{data.title || 'Your project'}<em>.</em></h1>{data.logline && <p className="dossier-lead" style={{ fontSize: 18 }}>{data.logline}</p>}<p className="dossier-status">This confirms receipt, not showcase approval, a funding commitment, or an investment opportunity.</p>{data.project_slug && !activeShowcaseStatus?.hidden && <div className="dossier-actions" style={{ marginTop: 16 }} data-testid="recap-actions"><a href="#section-project-share" className="dossier-button" data-testid="link-recap-share">Share project</a><button type="button" className="dossier-button dossier-button-outline" data-testid="button-recap-copy-link" onClick={() => void navigator.clipboard?.writeText(projectShareUrl(data.project_slug!)).catch(() => undefined)}>Copy link</button></div>}</div>
     <div className="dossier-rule" />
     </div>
      <div className="dossier-main">
         {checkoutReturn === 'cancelled' && <p role="status" className="dossier-notice">You returned without completing this checkout. Your free pitch remains unlisted. If you previously completed another checkout, wait for payment verification before trying again.</p>}
         {checkoutReturn === 'return' && <p role="status" className="dossier-notice">{reviewStatus.isError ? 'We could not verify the checkout yet. Please retry status later and do not complete another checkout.' : reviewStatus.data?.fee_waived ? 'FREE99 verified. Your review fee was waived; no payment was required. Your pitch was submitted for editorial review, not automatically approved for public listing.' : reviewStatus.data?.paid ? 'Payment verified. Your pitch is pending editorial review, not approved for public listing.' : 'We are verifying your checkout. Your pitch stays unlisted until verification completes; do not complete another checkout while it is pending.'}</p>}
         {checkoutReturn !== 'return' && reviewStatus.data?.fee_waived && <p className="dossier-notice" data-testid="status-review-fee-waived">Your editorial review fee was waived with FREE99. No payment was required.</p>}
        <section className="dossier-section" data-testid="section-recap-summary"><span className="dossier-kicker">On file</span><p>{[data.format, data.genre === 'Other' ? data.genre_other || data.genre : data.genre, legacyStage ? `Legacy stage: ${legacyStage}` : stage].filter(Boolean).join(' · ')}</p>
          {(() => { const x = data; const rows: [string, string | null | undefined][] = [['Team', x.team_info || (data.team_links.length ? `${data.team_links.length} link${data.team_links.length === 1 ? '' : 's'}` : null)], ['Distribution plan', data.distribution_plan], ['Planned funding use', data.money_use]]; const shown = rows.filter(([, v]) => v); return shown.length ? <ul className="dossier-links" data-testid="list-recap-specifics">{shown.map(([k, v]) => <li key={k}><strong>{k}:</strong> {v!.length > 120 ? `${v!.slice(0, 117)}...` : v}</li>)}</ul> : null; })()}</section>
           {data.project_slug && !activeShowcaseStatus?.hidden && <ShowcaseForm key={data.project_slug} result={{ ...data, approved: activeShowcaseStatus?.approved ?? data.approved, showcase_requested: activeShowcaseStatus?.showcase_requested ?? data.showcase_requested, hidden: activeShowcaseStatus?.hidden ?? data.hidden }} onSaved={refreshShowcaseStatus} reviewStatus={reviewStatus.data} reviewStatusState={reviewStatus.isSuccess ? 'verified' : reviewStatus.isError ? 'unavailable' : 'checking'} checkoutEnabled={checkoutEnabled} sandboxCheckout={sandboxCheckout} checkoutUnavailableText={checkoutUnavailableText} autoOpenReady={(reviewStatus.isSuccess || reviewStatus.isError) && checkoutReturn === null} reviewTriggerRef={reviewTriggerRef} onRetryStatus={() => { void reviewStatus.refetch(); void checkoutConfig.refetch(); }} statusFetching={reviewStatus.isFetching} />}
          {data.project_slug && activeShowcaseStatus?.hidden && <details className="dossier-fold" data-testid="details-edit-pitch"><summary style={{ cursor: 'pointer', fontWeight: 600 }}>Edit pitch details</summary><PitchMaterialsEntry/></details>}
        {deal && data.budget && repayment && <details className="dossier-section" data-testid="details-proposal"><summary style={{ cursor:'pointer', fontWeight:600 }}>Proposal and illustrative terms</summary><div className="fm-receipt" data-testid="receipt-result-deal"><h3>At a glance</h3><dl>
           <div><dt>{data.budget_from_example ? 'Illustrative example budget' : 'Your estimated project budget'}</dt><dd data-testid="text-result-budget">{money(data.budget)}</dd></div>
          <div><dt>Investor payback target · {money(repayment!)} per $100 of budget</dt><dd data-testid="text-result-investor-target">{money(deal.investorTarget)}</dd></div>
          <div><dt>Platform fee · {money(deal.feeRate)} per $100 of budget</dt><dd data-testid="text-result-platform-fee">{money(deal.platformFee)}</dd></div>
          <div className="fm-total"><dt>Combined payback threshold</dt><dd data-testid="text-result-combined-payback">{money(deal.combinedPayback)}</dd></div>
          {!snapshot && <div><dt>After both targets are satisfied</dt><dd>Backend terms unspecified in this earlier submission</dd></div>}
        </dl>{snapshot && <ProposalSummary proposal={snapshot} budget={data.budget} stage={stage} testId="result-proposal" />}<p className="fm-small" style={{ marginTop: 18 }}>Illustrative terms for conversation only. The investor target and platform fee are separate amounts. This is not a return forecast or an offer to invest.</p></div><p className="dossier-notice">After payment processing fees, project income is split proportionally between the investor payback target and the platform's one-time fee, so neither is paid off first. Income may vary, and investors may not reach their full target.</p></details>}
        {data.project_slug && !activeShowcaseStatus?.hidden && <><div id="section-project-share"><ProjectShare slug={data.project_slug} title={data.title || 'Untitled project'} genre={data.genre} logline={data.logline} approved={activeShowcaseStatus?.approved ?? false} showcaseRequested={activeShowcaseStatus?.showcase_requested ?? false} /></div><FilmmakerInvite/></>}
      </div>
          <aside className="dossier-side">
            <div className="dossier-sticky">
              <div className="dossier-dark">
                <span className="dossier-kicker">Where things stand</span>
                <div className="dossier-value" data-testid="status-project-review">{activeShowcaseStatus?.hidden ? 'Hidden.' : activeShowcaseStatus?.approved && activeShowcaseStatus.showcase_requested ? 'Approved for listing.' : reviewStatus.data?.declined ? 'Review completed.' : activeShowcaseStatus?.showcase_requested ? 'Review pending.' : 'Unlisted.'}</div>
                <p>{activeShowcaseStatus?.hidden ? 'This project is hidden and its page is unavailable to viewers, including people with its link. Contact us if you believe this is an error.' : activeShowcaseStatus?.approved && activeShowcaseStatus.showcase_requested ? 'Showcase review is approved. This project is eligible for discovery while it remains approved and not hidden.' : reviewStatus.data?.declined ? 'Your pitch was not approved. Your free unlisted page remains available.' : activeShowcaseStatus?.showcase_requested ? 'Your showcase review request is pending. The page is accessible to anyone with its link but is not listed for discovery.' : 'Your project page is accessible to anyone with its link but is not listed for discovery. No showcase review has been requested.'}</p>
                 <p className="dossier-line">Investors can pledge non-binding interest from your project page as soon as it’s submitted. Only approved projects appear in Explore, and pledge totals show publicly only after approval. No investment money is collected here. Editorial review is optional and costs $49 once per pitch. {!checkoutEnabled && 'Checkout is currently unavailable; your free pitch remains saved.'}</p>
              </div>
              <div className="dossier-actions" style={{ marginTop: 22 }}>
                <Link href="/me/projects?action=manage" onClick={() => setFilmmakerAction('manage')} data-testid="link-manage-projects" className="dossier-button">Manage projects <ArrowRight size={17}/></Link>
                <Link href="/me/projects?action=start" onClick={() => setFilmmakerAction('start')} data-testid="link-start-another-project" className="dossier-button dossier-button-outline">Start another project <ArrowRight size={17}/></Link>
              </div>
              {!user && <p className="dossier-status">Your final submission is received. Sign in to manage it later or on another device. Either action above will guide you through sign-in.</p>}
            </div>
          </aside>
    </div>
   </div>
   {reviewEligible && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#c8c0b5] bg-[#f4f0e7] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg md:hidden">
     <button type="button" className="dossier-button w-full justify-center" data-testid="button-mobile-open-review-paywall" onClick={() => reviewTriggerRef.current?.click()}>Submit for review · $49 <ArrowRight size={17}/></button>
   </div>}
   </section>;
}