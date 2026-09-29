import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { getFilmmakerResult, getGetFilmmakerResultQueryKey, useGetFilmmakerResult, useGetPitchReviewCheckoutConfig, useGetPitchReviewCheckoutStatus, useStartPitchReviewCheckout, useUpdateFilmmakerShowcase } from '@workspace/api-client-react';
import type { FilmmakerResult, FilmmakerShowcaseUpdate } from '@workspace/api-client-react';
import { useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { closeGuestConfirmation, guestConfirmationVisible } from '@/lib/filmmaker-confirmation';
import { setFilmmakerAction } from '@/lib/filmmaker-intent';
import { consumePitchReviewChoice, getPitchReviewProof } from '@/lib/pitch-review-intent';
import { ProjectShare } from '@/components/project-share';
import { FilmmakerMedia } from '@/components/filmmaker-media';
import { calculateDeal, money, type Stage } from './filmmaker-calculator';
import { useAuth } from '@workspace/replit-auth-web';

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

function ShowcaseForm({ result, onSaved, reviewStatus, reviewStatusState, checkoutEnabled, checkoutUnavailableText, autoOpenReady }: { result: FilmmakerResult; onSaved: (updated: ShowcaseStatus) => Promise<ShowcaseStatus>; reviewStatus?: { paid: boolean; pending: boolean; approved: boolean; declined: boolean }; reviewStatusState: 'checking' | 'verified' | 'unavailable'; checkoutEnabled: boolean; checkoutUnavailableText: string; autoOpenReady: boolean }) {
  const update = useUpdateFilmmakerShowcase({ request: { headers: result.project_id ? { 'X-MSI-Project-Id': String(result.project_id) } : {} } });
  const checkoutProof = result.checkout_proof || getPitchReviewProof(result.project_id);
  const checkout = useStartPitchReviewCheckout({ request: { headers: result.project_id ? {
    'X-MSI-Project-Id': String(result.project_id),
    ...(checkoutProof ? { 'X-MSI-Checkout-Proof': checkoutProof } : {}),
  } : {} } });
  const [showPaywall, setShowPaywall] = useState(false);
  const paywallRef = useRef<HTMLDivElement>(null);
  const [checkoutError, setCheckoutError] = useState('');
  const [checking, setChecking] = useState(false);
  const [needsReselect, setNeedsReselect] = useState(false);
  const [synopsis, setSynopsis] = useState(result.synopsis || '');
  const [links, setLinks] = useState(result.team_links.join('\n'));
  const [moneyUse, setMoneyUse] = useState(result.money_use || '');
  const [distribution, setDistribution] = useState(result.distribution_plan || '');
  const [trailer, setTrailer] = useState(result.trailer_url || '');
  const trailerDirty = useRef(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [savedStatus, setSavedStatus] = useState<ShowcaseStatus | null>(null);
  const [approvalMayHavePaused, setApprovalMayHavePaused] = useState(false);
  const canCheckout = checkoutEnabled && reviewStatusState === 'verified';
  const paymentNotice = reviewStatusState === 'unavailable'
    ? 'We could not verify whether this pitch has already been paid. Please try again later; do not pay again until its status can be checked.'
    : reviewStatusState === 'checking'
      ? 'Checking this pitch’s payment status before checkout is available…'
      : checkoutUnavailableText;
  const unsavedDetails = clean(synopsis) !== (result.synopsis || null)
    || JSON.stringify(validLinks(links)) !== JSON.stringify(result.team_links)
    || clean(moneyUse) !== (result.money_use || null)
    || clean(distribution) !== (result.distribution_plan || null)
    || clean(trailer) !== (result.trailer_url || null);
  useEffect(() => {
    if (autoOpenReady && result.project_id && !result.showcase_requested
      && !result.hidden && !reviewStatus?.paid && !reviewStatus?.pending
      && consumePitchReviewChoice(result.project_id)) {
      setShowPaywall(true);
    }
  }, [result.project_id, result.showcase_requested, result.hidden, reviewStatus?.paid, reviewStatus?.pending, autoOpenReady]);
  useEffect(() => {
    if (result.showcase_requested || result.hidden || reviewStatus?.paid || reviewStatus?.pending) setShowPaywall(false);
  }, [result.showcase_requested, result.hidden, reviewStatus?.paid, reviewStatus?.pending]);
  useEffect(() => {
    if (showPaywall) paywallRef.current?.focus();
  }, [showPaywall]);
  useEffect(() => {
    if (!trailerDirty.current) setTrailer(result.trailer_url || '');
  }, [result.trailer_url]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checking || update.isPending || needsReselect) return;
    const teamLinks = validLinks(links);
    if (!teamLinks) { setError('Add up to eight full http:// or https:// team links, one per line.'); return; }
    const trailerValue = clean(trailer);
    if (trailerValue && (trailerValue.length > 2048 || !safeTrailerUrl(trailerValue))) { setError('Use a full http:// or https:// trailer URL, up to 2,048 characters.'); return; }
    setError(''); setSaved(false);
    setSavedStatus(null);
    setApprovalMayHavePaused(Boolean(result.approved && result.showcase_requested && !result.hidden));
    const data: FilmmakerShowcaseUpdate = {
      showcase_requested: Boolean(result.showcase_requested),
      synopsis: clean(synopsis),
      team_links: teamLinks,
      money_use: clean(moneyUse),
      distribution_plan: clean(distribution),
      trailer_url: trailerValue,
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
      trailerDirty.current = false;
      setTrailer(updated.trailer_url || '');
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
    <span className="dossier-kicker">Optional / pitch details</span>
    <h2>{result.showcase_requested ? 'Your showcase details.' : 'Tell more of the story.'}</h2>
    <p>{result.approved && result.showcase_requested && !result.hidden
      ? 'This project is approved for showcase listing. Saving changes to approved showcase content may pause approval and require another review before it is listed. Share a synopsis, not a full script.'
      : result.showcase_requested
        ? 'Your showcase review is pending; requesting review is not approval. The page remains accessible to anyone with its link. Share a synopsis, not a full script. You can revise these optional details later.'
         : 'Your project is free and unlisted. Save optional details here, then choose Submit for review when you are ready. Saving details alone does not request review. Share a synopsis, not a full script.'}</p>
    <form onSubmit={event => void submit(event)} style={{ marginTop: 30 }}>
      <div className="dossier-field"><label htmlFor="showcase-synopsis">Synopsis <small>· optional</small></label><textarea id="showcase-synopsis" data-testid="input-showcase-synopsis" maxLength={5000} value={synopsis} onChange={e => setSynopsis(e.target.value)} placeholder="The story beyond the logline" /></div>
      <div className="dossier-field"><label htmlFor="showcase-links">Team links <small>· optional, one full URL per line, up to 8</small></label><textarea id="showcase-links" data-testid="input-showcase-links" value={links} onChange={e => setLinks(e.target.value)} placeholder={'https://example.com/team'} /></div>
      <div className="dossier-field"><label htmlFor="showcase-money-use">How the money would be used <small>· optional</small></label><textarea id="showcase-money-use" data-testid="input-showcase-money-use" maxLength={3000} value={moneyUse} onChange={e => setMoneyUse(e.target.value)} /></div>
      <div className="dossier-field"><label htmlFor="showcase-distribution">Distribution plan <small>· optional</small></label><textarea id="showcase-distribution" data-testid="input-showcase-distribution" maxLength={3000} value={distribution} onChange={e => setDistribution(e.target.value)} /></div>
      <div className="dossier-field"><label htmlFor="showcase-trailer">External trailer URL <small>· optional; paste a full http:// or https:// link. Clear to remove. Saving a new link replaces any uploaded trailer.</small></label><input id="showcase-trailer" data-testid="input-showcase-trailer" type="url" maxLength={2048} value={trailer} onChange={e => { trailerDirty.current = true; setTrailer(e.target.value); setError(''); }} placeholder="https://" /></div>
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
    {!result.showcase_requested && !reviewStatus?.paid && !reviewStatus?.pending && !result.hidden && <>
      <div className="dossier-notice" style={{ marginTop: 24 }}>
         <strong>Submit for editorial review · $49 once per pitch</strong>
        <p>The free unlisted page and share link remain yours. If approved, your pitch will join Explore’s public Pitch Collection with no preset expiration date. Investors will be able to browse when they join.</p>
         <button type="button" className="dossier-button" data-testid="button-open-review-paywall" onClick={() => { if (result.project_id) consumePitchReviewChoice(result.project_id); setCheckoutError(''); setShowPaywall(true); }}>Submit for review <ArrowRight size={17}/></button>
         {!canCheckout && <p role="status">{paymentNotice}</p>}
      </div>
      {showPaywall && <div ref={paywallRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Pitch review checkout" className="fixed inset-0 z-50 flex items-center justify-center bg-[#202936]/75 p-4">
        <div className="w-full max-w-lg bg-[#f4f0e7] p-7 shadow-2xl md:p-10">
            <p className="dossier-kicker">Editorial review · $49 per pitch</p>
          <h2 className="serif mt-3 text-4xl">Submit your pitch for review</h2>
          <p className="mt-5 leading-relaxed"><strong>$49 one time.</strong> This pays for editorial review of this pitch. Approval is not guaranteed. If approved, we’ll list it in the public Pitch Collection with no preset expiration date.</p>
           <p className="mt-3 text-sm">After we complete your review, a declined pitch is not automatically refunded. If we cannot deliver the review, we’ll refund the payment, subject to applicable law. You can leave checkout before paying; cancelling checkout does not submit the pitch for review.</p>
          <p className="mt-3 text-sm">We’re building the Pitch Collection that investors will be able to browse when they join.</p>
            {!canCheckout && <p role="status" className="dossier-notice mt-4">{paymentNotice}</p>}
          {unsavedDetails && <p role="alert" className="dossier-error mt-4">You have unsaved pitch details. Close this window and save them before checkout so they are included in your review.</p>}
          {checkoutError && <p role="alert" className="dossier-error mt-4">{checkoutError}</p>}
          <div className="mt-7 flex flex-wrap gap-3">
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
            <button type="button" className="dossier-button dossier-button-outline" disabled={checkout.isPending} onClick={() => setShowPaywall(false)}>Not now</button>
            {needsReselect && <Link href="/me/projects" className="underline">Open My projects</Link>}
          </div>
        </div>
      </div>}
    </>}
    {reviewStatus?.declined && <p role="status" className="dossier-notice">Your pitch was reviewed and was not approved for the public Pitch Collection. Your free unlisted page remains available.</p>}
  </section>;
}

function safeTrailerUrl(value: string) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

export default function FilmmakerDone() {
  const replitAuth = useAuth();
  const firebaseUser = useFirebaseUser();
  const identityId = replitAuth.user?.id ?? firebaseUser?.uid ?? 'visitor';
  return <FilmmakerDoneContent key={identityId} identityId={identityId} authLoading={replitAuth.isLoading} ssoSignedIn={Boolean(replitAuth.user)} />;
}

function FilmmakerDoneContent({ identityId, authLoading, ssoSignedIn }: { identityId: string; authLoading: boolean; ssoSignedIn: boolean }) {
  const [, navigate] = useLocation();
  const authReady = useFirebaseSessionReady();
  const user = useFirebaseUser();
  const [guestVisible] = useState(guestConfirmationVisible);
  const result = useGetFilmmakerResult({ query: { queryKey: [...getGetFilmmakerResultQueryKey(), identityId], enabled: authReady && !authLoading, refetchOnMount: 'always', retry: (count, error) => error.status !== 404 && count < 2 } });
  const checkoutConfig = useGetPitchReviewCheckoutConfig({ query: { queryKey: ['/api/filmmakers/review-checkout/config'], retry: false, staleTime: 0, refetchOnMount: 'always' } });
  const checkoutEnabled = checkoutConfig.isSuccess && checkoutConfig.data.mode === 'live' && checkoutConfig.data.enabled;
  const checkoutUnavailableText = checkoutConfig.isLoading
    ? 'Checking editorial review checkout availability…'
    : checkoutConfig.isSuccess && checkoutConfig.data.mode !== 'live'
      ? 'This workspace preview cannot accept real payments. Your free pitch and share link remain saved.'
      : 'Live editorial review checkout is temporarily unavailable. Your free pitch and share link remain saved. Please try again later.';
  const data = result.data;
  const checkoutProof = data?.checkout_proof || getPitchReviewProof(data?.project_id ?? null);
  const reviewStatus = useGetPitchReviewCheckoutStatus({
    request: { headers: data?.project_id ? {
      'X-MSI-Project-Id': String(data.project_id),
      ...(checkoutProof ? { 'X-MSI-Checkout-Proof': checkoutProof } : {}),
    } : {} },
    query: { queryKey: ['/api/filmmakers/review-checkout/status', identityId, data?.project_id], enabled: authReady && !authLoading && !!data?.project_id, refetchOnMount: 'always', refetchInterval: 20_000, retry: false },
  });
  const checkoutReturn = new URLSearchParams(window.location.search).get('review_checkout');
  useEffect(() => {
    if (checkoutReturn && data?.project_id) consumePitchReviewChoice(data.project_id);
  }, [checkoutReturn, data?.project_id]);
  useEffect(() => {
    if (reviewStatus.data?.paid && !data?.showcase_requested) void result.refetch();
  }, [reviewStatus.data?.paid, data?.showcase_requested]);
  const [showcaseStatusOverride, setShowcaseStatusOverride] = useState<ShowcaseStatus | null>(null);
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
    if (!authReady || user || ssoSignedIn) return;
    if ((data?.completed && !guestVisible) || result.error?.status === 401) navigate('/me/projects');
  }, [authReady, user, ssoSignedIn, data?.completed, guestVisible, result.error, navigate]);
  useEffect(() => {
    if (data?.completed) sessionStorage.removeItem('filmmaker-submitted-no-project');
  }, [data?.completed]);
  if (authLoading || !authReady || result.isLoading || (!user && !ssoSignedIn && data?.completed && !guestVisible)) return <section className="dossier"><div className="page-wrap dossier-hero" aria-label="Loading your saved submission"><p className="dossier-kicker">Retrieving your submission</p><div className="dossier-skeleton" style={{ width: 'min(90%, 660px)', height: 95 }} /><div className="dossier-skeleton" style={{ width: 'min(60%, 420px)' }} /></div></section>;
  if (result.isError && result.error?.status === 404 && identityId !== 'visitor') return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker">Select your project</p><h1 className="dossier-title">Your project is <em>still saved.</em></h1><p className="dossier-lead" role="alert">There is no submitted project selected for this visit. Open My projects and select the project you want to edit before submitting it for paid review.</p><Link href="/me/projects?action=manage" onClick={() => setFilmmakerAction('manage')} data-testid="link-reselect-result-project" className="dossier-button" style={{ marginTop: 30 }}>Open My projects <ArrowRight size={17}/></Link></div></section>;
  if (result.isError && result.error?.status !== 404) return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker">Connection interrupted</p><h1 className="dossier-title">Your story is <em>still here.</em></h1><p className="dossier-lead" role="alert">We couldn’t retrieve your saved submission right now. Please try again.</p><button type="button" className="dossier-button" data-testid="button-retry-result" style={{ marginTop: 30 }} onClick={() => void refreshResult()}><RotateCcw size={16}/> Try again</button></div></section>;
   if (!data?.completed) return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker">Not submitted</p><h1 className="dossier-title">The beginning<br/><em>comes first.</em></h1><p className="dossier-lead">No final submission is attached to this visit. If you saved a draft, open the worksheet to continue it; otherwise, start your answers. Saving a draft does not submit it.</p><Link href="/start/filmmaker" data-testid="link-return-to-worksheet" className="dossier-button" style={{ marginTop: 32 }}>Open the worksheet <ArrowRight size={17}/></Link></div></section>;
   if (data.no_project_yet) return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker"><Check size={15} style={{ display: 'inline', marginRight: 9 }}/> Answers received / No project yet</p><h1 className="dossier-title" data-testid="text-confirmation">There’s room<br/><em>for what’s next.</em></h1><p className="dossier-lead">We received your contact details and your interest in participating in the future. No project or deal terms were submitted.</p><div className="dossier-notice" style={{ maxWidth: 680, marginTop: 42 }}>We’re still building this experience. There’s no investment available or money collected here today. If there’s a relevant next step, we’ll reach out using the information you shared.</div>{!user && !ssoSignedIn && <p className="dossier-status">Your answers are saved. Sign in to manage future projects across devices.</p>}<div className="dossier-actions" style={{ marginTop: 38 }}><Link href="/me/projects?action=start" onClick={() => setFilmmakerAction('start')} data-testid="link-start-another-project" className="dossier-button">Start a project <ArrowRight size={17}/></Link><Link href="/me/projects?action=manage" onClick={() => setFilmmakerAction('manage')} className="dossier-button dossier-button-outline">Manage projects <ArrowRight size={17}/></Link></div></div></section>;
  const stageValue = data.stage as string | null | undefined;
  const stage = (['distribution', 'production', 'idea'].includes(stageValue || '') ? stageValue : null) as Stage | null;
  const legacyStage = stageValue && !stage ? stageValue : null;
  const legacyStageDetail = (data as FilmmakerResult & { stage_other?: string | null }).stage_other;
  const deal = stage && data.budget && data.offer_per100 && data.price_group ? calculateDeal(data.budget, stage, data.price_group, data.offer_per100) : null;
  return <section className="dossier"><div className="page-wrap">
     <div className="dossier-head"><Link href="/" className="dossier-kicker" data-testid="link-result-home">Movie Show Investing / Filmmakers</Link><span className="dossier-kicker">Final submission received</span></div>
     <div className="dossier-hero"><p className="dossier-kicker" data-testid="status-final-submission"><Check size={15} style={{ display: 'inline', marginRight: 9 }}/> Final submission received</p><h1 className="dossier-title" data-testid="text-confirmation">The story<br/><em>takes shape.</em></h1><p className="dossier-lead">We received the final submission for {data.title ? <strong>{data.title}</strong> : 'your project'} and your thoughts on illustrative terms. This confirms receipt, not showcase approval, a funding commitment, or an investment opportunity.</p></div>
    <div className="dossier-rule" />
    <div className="dossier-grid">
      <div>
         {checkoutReturn === 'cancelled' && <p role="status" className="dossier-notice">You returned without completing this checkout. Your free pitch remains unlisted. If you previously completed another checkout, wait for payment verification before trying again.</p>}
         {checkoutReturn === 'return' && <p role="status" className="dossier-notice">{reviewStatus.isError ? 'We could not verify the payment yet. Please retry status later and do not pay again.' : reviewStatus.data?.paid ? 'Payment verified. Your pitch is pending editorial review, not approved for public listing.' : 'We are verifying your payment. Your pitch stays unlisted until verification completes; do not pay again while it is pending.'}</p>}
        <section className="dossier-section"><span className="dossier-kicker">01 / Project on file</span><h2 data-testid="text-result-title">{data.title || 'Untitled project'}</h2><p>{[data.format, data.genre === 'Other' ? data.genre_other || data.genre : data.genre, legacyStage ? `${legacyStage === 'other' ? 'Other stage (legacy)' : `Legacy stage: ${legacyStage}`}${legacyStageDetail ? ` — ${legacyStageDetail}` : ''}` : stage].filter(Boolean).join(' · ')}</p>{data.logline && <p data-testid="text-result-logline" style={{ fontSize: 18, color: '#202936' }}>{data.logline}</p>}</section>
        {deal && data.budget && data.offer_per100 && <section className="dossier-section"><span className="dossier-kicker">02 / Your selected offer</span><h2>The illustrative deal.</h2><div className="fm-receipt" data-testid="receipt-result-deal"><h3>At a glance</h3><dl>
           <div><dt>{data.budget_from_example ? 'Illustrative example budget' : 'Your estimated project budget'}</dt><dd data-testid="text-result-budget">{money(data.budget)}</dd></div>
          <div><dt>Investor payback target · {money(data.offer_per100)} per $100 of budget</dt><dd data-testid="text-result-investor-target">{money(deal.investorTarget)}</dd></div>
          <div><dt>Platform fee · {money(deal.feeRate)} per $100 of budget</dt><dd data-testid="text-result-platform-fee">{money(deal.platformFee)}</dd></div>
          <div className="fm-total"><dt>Combined payback threshold</dt><dd data-testid="text-result-combined-payback">{money(deal.combinedPayback)}</dd></div>
          <div><dt>After both targets are satisfied</dt><dd>{stage === 'idea' ? 'you keep it all' : `You keep ${money(deal.filmmakerAfter)} of every $100`}</dd></div>
        </dl><p className="fm-small" style={{ marginTop: 18 }}>Illustrative terms for conversation only. The investor target and platform fee are separate amounts. This is not a return forecast or an offer to invest.</p></div><p className="dossier-notice">All available receipts after processing fees go into a pool allocated proportionally between the outstanding investor payback target and separate platform fee. Neither has payment priority. These are examples, not forecasts or guarantees. Actual receipts may differ, and the payback threshold may never be reached.</p></section>}
        {data.project_slug && !activeShowcaseStatus?.hidden && <ProjectShare slug={data.project_slug} title={data.title || 'Untitled project'} genre={data.genre} logline={data.logline} approved={activeShowcaseStatus?.approved ?? false} showcaseRequested={activeShowcaseStatus?.showcase_requested ?? false} />}
         {data.project_slug && !activeShowcaseStatus?.hidden && <ShowcaseForm key={data.project_slug} result={{ ...data, approved: activeShowcaseStatus?.approved ?? data.approved, showcase_requested: activeShowcaseStatus?.showcase_requested ?? data.showcase_requested, hidden: activeShowcaseStatus?.hidden ?? data.hidden }} onSaved={refreshShowcaseStatus} reviewStatus={reviewStatus.data} reviewStatusState={reviewStatus.isSuccess ? 'verified' : reviewStatus.isError ? 'unavailable' : 'checking'} checkoutEnabled={checkoutEnabled} checkoutUnavailableText={checkoutUnavailableText} autoOpenReady={(reviewStatus.isSuccess || reviewStatus.isError) && checkoutReturn === null} />}
        {data.project_slug && !activeShowcaseStatus?.hidden && <FilmmakerMedia result={data} onSaved={() => void refreshResult()} />}
      </div>
          <aside className="dossier-side">
            <div className="dossier-sticky">
              <div className="dossier-dark">
                <span className="dossier-kicker">Where things stand</span>
                <div className="dossier-value" data-testid="status-project-review">{activeShowcaseStatus?.hidden ? 'Hidden.' : activeShowcaseStatus?.approved && activeShowcaseStatus.showcase_requested ? 'Approved for listing.' : reviewStatus.data?.declined ? 'Review completed.' : activeShowcaseStatus?.showcase_requested ? 'Review pending.' : 'Unlisted.'}</div>
                <p>{activeShowcaseStatus?.hidden ? 'This project is hidden and its page is unavailable to viewers, including people with its link. Contact us if you believe this is an error.' : activeShowcaseStatus?.approved && activeShowcaseStatus.showcase_requested ? 'Showcase review is approved. This project is eligible for discovery while it remains approved and not hidden.' : reviewStatus.data?.declined ? 'Your pitch was not approved. Your free unlisted page remains available.' : activeShowcaseStatus?.showcase_requested ? 'Your showcase review request is pending. The page is accessible to anyone with its link but is not listed for discovery.' : 'Your project page is accessible to anyone with its link but is not listed for discovery. No showcase review has been requested.'}</p>
                 <p className="dossier-line">Filmmakers are here first. Investor signup and pledges open later, after approved projects are available. No investment money is collected here. Editorial review is optional and costs $49 once per pitch. {!checkoutEnabled && 'Checkout is currently unavailable; your free pitch remains saved.'}</p>
              </div>
              <div className="dossier-actions" style={{ marginTop: 22 }}>
                <Link href="/me/projects?action=start" onClick={() => setFilmmakerAction('start')} data-testid="link-start-another-project" className="dossier-button">Start another project <ArrowRight size={17}/></Link>
                <Link href="/me/projects?action=manage" onClick={() => setFilmmakerAction('manage')} data-testid="link-manage-projects" className="dossier-button dossier-button-outline">Manage projects <ArrowRight size={17}/></Link>
              </div>
              {!user && !ssoSignedIn && <p className="dossier-status">Your final submission is received. Sign in to manage it later or on another device. Either action above will guide you through sign-in.</p>}
            </div>
          </aside>
    </div>
  </div></section>;
}