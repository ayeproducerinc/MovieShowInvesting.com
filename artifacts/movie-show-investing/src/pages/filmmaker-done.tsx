import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { getGetFilmmakerResultQueryKey, useGetFilmmakerResult, useUpdateFilmmakerShowcase } from '@workspace/api-client-react';
import type { FilmmakerResult, FilmmakerShowcaseUpdate } from '@workspace/api-client-react';
import { useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { closeGuestConfirmation, guestConfirmationVisible } from '@/lib/filmmaker-confirmation';
import { setFilmmakerAction } from '@/lib/filmmaker-intent';
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

function ShowcaseForm({ result, onSaved }: { result: FilmmakerResult; onSaved: () => void }) {
  const update = useUpdateFilmmakerShowcase({ request: { headers: result.project_id ? { 'X-MSI-Project-Id': String(result.project_id) } : {} } });
  const [synopsis, setSynopsis] = useState(result.synopsis || '');
  const [links, setLinks] = useState(result.team_links.join('\n'));
  const [moneyUse, setMoneyUse] = useState(result.money_use || '');
  const [distribution, setDistribution] = useState(result.distribution_plan || '');
  const [trailer, setTrailer] = useState(result.trailer_url || '');
  const trailerDirty = useRef(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!trailerDirty.current) setTrailer(result.trailer_url || '');
  }, [result.trailer_url]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const teamLinks = validLinks(links);
    if (!teamLinks) { setError('Add up to eight full http:// or https:// team links, one per line.'); return; }
    const trailerValue = clean(trailer);
    if (trailerValue && (trailerValue.length > 2048 || !safeTrailerUrl(trailerValue))) { setError('Use a full http:// or https:// trailer URL, up to 2,048 characters.'); return; }
    setError(''); setSaved(false);
    const data: FilmmakerShowcaseUpdate = {
      showcase_requested: true,
      synopsis: clean(synopsis),
      team_links: teamLinks,
      money_use: clean(moneyUse),
      distribution_plan: clean(distribution),
      trailer_url: trailerValue,
    };
    try { const updated = await update.mutateAsync({ data }); trailerDirty.current = false; setTrailer(updated.trailer_url || ''); setSaved(true); onSaved(); }
    catch { setError('We could not save your showcase request. Please try again.'); }
  }
  return <section className="dossier-section" data-testid="section-showcase">
    <span className="dossier-kicker">Optional / showcase review</span>
    <h2>{result.showcase_requested ? 'Your showcase details.' : 'Tell more of the story.'}</h2>
    <p>Request a review for a future showcase. A request is not approval; your page remains accessible by its link. Share a synopsis, not a full script. You can revise these details later.</p>
    <form onSubmit={event => void submit(event)} style={{ marginTop: 30 }}>
      <div className="dossier-field"><label htmlFor="showcase-synopsis">Synopsis <small>· optional</small></label><textarea id="showcase-synopsis" data-testid="input-showcase-synopsis" maxLength={5000} value={synopsis} onChange={e => setSynopsis(e.target.value)} placeholder="The story beyond the logline" /></div>
      <div className="dossier-field"><label htmlFor="showcase-links">Team links <small>· optional, one full URL per line, up to 8</small></label><textarea id="showcase-links" data-testid="input-showcase-links" value={links} onChange={e => setLinks(e.target.value)} placeholder={'https://example.com/team'} /></div>
      <div className="dossier-field"><label htmlFor="showcase-money-use">How the money would be used <small>· optional</small></label><textarea id="showcase-money-use" data-testid="input-showcase-money-use" maxLength={3000} value={moneyUse} onChange={e => setMoneyUse(e.target.value)} /></div>
      <div className="dossier-field"><label htmlFor="showcase-distribution">Distribution plan <small>· optional</small></label><textarea id="showcase-distribution" data-testid="input-showcase-distribution" maxLength={3000} value={distribution} onChange={e => setDistribution(e.target.value)} /></div>
      <div className="dossier-field"><label htmlFor="showcase-trailer">External trailer URL <small>· optional; paste a full http:// or https:// link. Clear to remove. Saving a new link replaces any uploaded trailer.</small></label><input id="showcase-trailer" data-testid="input-showcase-trailer" type="url" maxLength={2048} value={trailer} onChange={e => { trailerDirty.current = true; setTrailer(e.target.value); setError(''); }} placeholder="https://" /></div>
      {error && <p className="dossier-error" role="alert" data-testid="error-showcase">{error}</p>}
      {saved && <p className="dossier-notice" role="status" data-testid="status-showcase-saved">Your details and showcase request were saved. Review is still pending unless approved.</p>}
      <button type="submit" data-testid="button-request-showcase" className="dossier-button" disabled={update.isPending} style={{ marginTop: 18 }}>{update.isPending ? 'Saving request…' : result.showcase_requested ? 'Save showcase details' : 'Request showcase review'} <ArrowRight size={17}/></button>
    </form>
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
  const result = useGetFilmmakerResult({ query: { queryKey: [...getGetFilmmakerResultQueryKey(), identityId], enabled: authReady && !authLoading, retry: (count, error) => error.status !== 404 && count < 2 } });
  const data = result.data;
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
  if (authLoading || !authReady || result.isLoading || (!user && data?.completed && !guestVisible)) return <section className="dossier"><div className="page-wrap dossier-hero" aria-label="Loading your saved submission"><p className="dossier-kicker">Retrieving your submission</p><div className="dossier-skeleton" style={{ width: 'min(90%, 660px)', height: 95 }} /><div className="dossier-skeleton" style={{ width: 'min(60%, 420px)' }} /></div></section>;
  if (result.isError && result.error?.status !== 404) return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker">Connection interrupted</p><h1 className="dossier-title">Your story is <em>still here.</em></h1><p className="dossier-lead" role="alert">We couldn’t retrieve your saved submission right now. Please try again.</p><button type="button" className="dossier-button" data-testid="button-retry-result" style={{ marginTop: 30 }} onClick={() => void result.refetch()}><RotateCcw size={16}/> Try again</button></div></section>;
  if (!data?.completed) return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker">Filmmaker worksheet</p><h1 className="dossier-title">The beginning<br/><em>comes first.</em></h1><p className="dossier-lead">There’s no completed submission attached to this visit. Open the worksheet to get started or continue your saved answers.</p><Link href="/start/filmmaker" data-testid="link-return-to-worksheet" className="dossier-button" style={{ marginTop: 32 }}>Open the worksheet <ArrowRight size={17}/></Link></div></section>;
   if (data.no_project_yet) return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker"><Check size={15} style={{ display: 'inline', marginRight: 9 }}/> Answers received / No project yet</p><h1 className="dossier-title" data-testid="text-confirmation">There’s room<br/><em>for what’s next.</em></h1><p className="dossier-lead">We received your contact details and your interest in participating in the future. No project or deal terms were submitted.</p><div className="dossier-notice" style={{ maxWidth: 680, marginTop: 42 }}>We’re still building this experience. There’s no investment available or money collected here today. If there’s a relevant next step, we’ll reach out using the information you shared.</div>{!user && !ssoSignedIn && <p className="dossier-status">Your answers are saved. Sign in to manage future projects across devices.</p>}<div className="dossier-actions" style={{ marginTop: 38 }}><Link href="/me/projects?action=start" onClick={() => setFilmmakerAction('start')} data-testid="link-start-another-project" className="dossier-button">Start a project <ArrowRight size={17}/></Link><Link href="/me/projects?action=manage" onClick={() => setFilmmakerAction('manage')} className="dossier-button dossier-button-outline">Manage projects <ArrowRight size={17}/></Link></div></div></section>;
  const stageValue = data.stage as string | null | undefined;
  const stage = (['distribution', 'production', 'idea'].includes(stageValue || '') ? stageValue : null) as Stage | null;
  const legacyStage = stageValue && !stage ? stageValue : null;
  const legacyStageDetail = (data as FilmmakerResult & { stage_other?: string | null }).stage_other;
  const deal = stage && data.budget && data.offer_per100 && data.price_group ? calculateDeal(data.budget, stage, data.price_group, data.offer_per100) : null;
  return <section className="dossier"><div className="page-wrap">
    <div className="dossier-head"><Link href="/" className="dossier-kicker" data-testid="link-result-home">Movie Show Investing / Filmmakers</Link><span className="dossier-kicker">Submission received</span></div>
    <div className="dossier-hero"><p className="dossier-kicker"><Check size={15} style={{ display: 'inline', marginRight: 9 }}/> Your worksheet is saved</p><h1 className="dossier-title" data-testid="text-confirmation">The story<br/><em>takes shape.</em></h1><p className="dossier-lead">We received {data.title ? <strong>{data.title}</strong> : 'your project'} and your thoughts on illustrative terms. Nothing here is an approval, a funding commitment, or an investment opportunity.</p></div>
    <div className="dossier-rule" />
    <div className="dossier-grid">
      <div>
        <section className="dossier-section"><span className="dossier-kicker">01 / Project on file</span><h2 data-testid="text-result-title">{data.title || 'Untitled project'}</h2><p>{[data.format, data.genre === 'Other' ? data.genre_other || data.genre : data.genre, legacyStage ? `${legacyStage === 'other' ? 'Other stage (legacy)' : `Legacy stage: ${legacyStage}`}${legacyStageDetail ? ` — ${legacyStageDetail}` : ''}` : stage].filter(Boolean).join(' · ')}</p>{data.logline && <p data-testid="text-result-logline" style={{ fontSize: 18, color: '#202936' }}>{data.logline}</p>}</section>
        {deal && data.budget && data.offer_per100 && <section className="dossier-section"><span className="dossier-kicker">02 / Your selected offer</span><h2>The illustrative deal.</h2><div className="fm-receipt" data-testid="receipt-result-deal"><h3>At a glance</h3><dl>
          <div><dt>You raise · illustrative project budget</dt><dd data-testid="text-result-budget">{money(data.budget)}</dd></div>
          <div><dt>Investor payback target · {money(data.offer_per100)} per $100 of budget</dt><dd data-testid="text-result-investor-target">{money(deal.investorTarget)}</dd></div>
          <div><dt>Platform fee · {money(deal.feeRate)} per $100 of budget</dt><dd data-testid="text-result-platform-fee">{money(deal.platformFee)}</dd></div>
          <div className="fm-total"><dt>Combined payback threshold</dt><dd data-testid="text-result-combined-payback">{money(deal.combinedPayback)}</dd></div>
          <div><dt>After both targets are satisfied</dt><dd>{stage === 'idea' ? 'you keep it all' : `You keep ${money(deal.filmmakerAfter)} of every $100`}</dd></div>
        </dl><p className="fm-small" style={{ marginTop: 18 }}>Illustrative terms for conversation only. The investor target and platform fee are separate amounts. This is not a return forecast or an offer to invest.</p></div><p className="dossier-notice">All available receipts after processing fees go into a pool allocated proportionally between the outstanding investor payback target and separate platform fee. Neither has payment priority. These are examples, not forecasts or guarantees. Actual receipts may differ, and the payback threshold may never be reached.</p></section>}
        {data.project_slug && !data.hidden && <ProjectShare slug={data.project_slug} title={data.title || 'Untitled project'} genre={data.genre} logline={data.logline} />}
        {data.project_slug && !data.hidden && <ShowcaseForm key={data.project_slug} result={data} onSaved={() => void result.refetch()} />}
        {data.project_slug && !data.hidden && <FilmmakerMedia result={data} onSaved={() => void result.refetch()} />}
      </div>
        <aside className="dossier-side"><div className="dossier-sticky"><div className="dossier-dark"><span className="dossier-kicker">Where things stand</span><div className="dossier-value" data-testid="status-project-review">{data.hidden ? 'Hidden.' : data.approved ? 'Approved.' : data.showcase_requested ? 'In review.' : 'Unlisted.'}</div><p>{data.hidden ? 'This project page is unavailable. Contact us if you believe this is an error.' : data.approved ? 'Showcase review is approved. The page is still viewable by anyone with the link.' : data.showcase_requested ? 'Your showcase request is pending review. The project page can still be viewed by anyone with the link.' : 'Your project page is accessible to anyone with its link, but it is not listed for discovery.'}</p><p className="dossier-line">Filmmakers are here first. Investor signup and pledges open later, after approved projects are available. No money is collected now.</p></div><div className="dossier-actions" style={{ marginTop: 22 }}><Link href="/me/projects?action=start" onClick={() => setFilmmakerAction('start')} data-testid="link-start-another-project" className="dossier-button">Start another project <ArrowRight size={17}/></Link><Link href="/me/projects?action=manage" onClick={() => setFilmmakerAction('manage')} data-testid="link-manage-projects" className="dossier-button dossier-button-outline">Manage projects <ArrowRight size={17}/></Link></div>{!user && !ssoSignedIn && <p className="dossier-status">Your project is saved. Sign in to manage it later or on another device. Either action above will guide you through sign-in.</p>}</div></aside>
    </div>
  </div></section>;
}