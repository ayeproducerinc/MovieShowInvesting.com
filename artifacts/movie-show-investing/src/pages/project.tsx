import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, RotateCcw } from 'lucide-react';
import { Link, useLocation, useParams } from 'wouter';
import { getGetCurrentInvestorIntentQueryKey, getGetPublicProjectQueryKey, useGetCurrentInvestorIntent, useGetPublicProject } from '@workspace/api-client-react';
import type { PublicProject } from '@workspace/api-client-react';
import { useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { ProjectShare } from '@/components/project-share';
import { ProjectContactDialog } from '@/components/project-contact-dialog';
import { money } from './filmmaker-calculator';
import { ProposalSummary } from '@/components/proposal-summary';
import { youtubeEmbedUrl } from '@/lib/youtube-embed';
import { bunnyEmbedUrl } from '@/lib/bunny-embed';
import { pledgePanel } from '@/lib/pledge-panel';
import { ProjectTimeline } from '@/components/project-timeline';
import './project.css';

const securitiesNotice = "Pledge your interest in future investment opportunities. If a project opens for investment, it will be offered only in compliance with securities laws, and you'll get full offering documents before you decide.";
type PublicProjectWithPitchDeck = PublicProject & { pitch_deck_url?: string | null; pitch_deck_name?: string | null };
function safeUrl(value: string | null | undefined) {
  if (!value) return null;
  try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; }
  catch { return null; }
}
export default function Project() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug || '';
  const firebaseUser = useFirebaseUser();
  const firebaseReady = useFirebaseSessionReady();
  const authReady = firebaseReady;
  const identityId = firebaseUser ? `firebase:${firebaseUser.uid}` : 'visitor';
  const project = useGetPublicProject(slug, { query: {
    enabled: !!slug && authReady,
    queryKey: [...getGetPublicProjectQueryKey(slug), identityId],
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: (count, error) => error.status !== 404 && count < 2,
  } });
  const data = project.data as PublicProjectWithPitchDeck | undefined;
  const current = useGetCurrentInvestorIntent({ query: {
    queryKey: [...getGetCurrentInvestorIntentQueryKey(), identityId],
    // Same rule as the pledge box: any visible project, listed or not.
    enabled: authReady && !!data && pledgePanel(data).show && !data.is_owner,
    refetchOnMount: 'always',
  } });
  const [dismissed, setDismissed] = useState(false);
  // "Increase my pledge" from an update email lands here with ?increase=<update id>,
  // then continues to the normal one-project pledge (sign-in happens there; no tokens).
  const [, navigate] = useLocation();
  const increaseFrom = Number(new URLSearchParams(window.location.search).get('increase')) || null;
  useEffect(() => {
    if (!increaseFrom || !data || data.is_owner || !pledgePanel(data).show) return;
    navigate(`/invest?project=${encodeURIComponent(data.slug)}&one=1&from_update=${increaseFrom}`, { replace: true });
  }, [increaseFrom, data, navigate]);
  const [storyOpen, setStoryOpen] = useState(false);
  useEffect(() => { setDismissed(false); setStoryOpen(false); }, [slug]);
  useEffect(() => {
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previous = robots?.content;
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = 'noindex, nofollow';
    return () => {
      if (previous !== undefined) robots!.content = previous;
      else robots?.remove();
    };
  }, []);
  useEffect(() => {
    const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (robots) robots.content = data?.approved && data.showcase_requested ? 'index, follow' : 'noindex, nofollow';
  }, [data?.approved, data?.showcase_requested]);
  useEffect(() => {
    if (!data) return;
    document.title = `${data.title} | Movie Show Investing`;
    const description = data.logline || 'An unlisted prelaunch project on Movie Show Investing.';
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (meta) meta.content = description;
    const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
    if (ogTitle) ogTitle.content = `${data.title} | Movie Show Investing`;
    const ogDescription = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
    if (ogDescription) ogDescription.content = description;
    // The server-rendered share endpoint owns crawler-readable metadata.
  }, [data]);
  if (!authReady || project.isPending) return <section className="dossier"><div className="page-wrap"><div className="dossier-hero" aria-label="Loading project"><p className="dossier-kicker">Opening the project dossier</p><div className="dossier-skeleton" style={{ width: 'min(95%, 750px)', height: 95 }}/><div className="dossier-skeleton" style={{ width: 'min(65%, 520px)' }}/></div></div></section>;
  if (project.isError && project.error?.status !== 404) return <section className="dossier"><div className="page-wrap"><div className="dossier-hero"><p className="dossier-kicker">Connection interrupted</p><h1 className="dossier-title">The page is<br/><em>out of reach.</em></h1><p className="dossier-lead" role="alert">We couldn’t load this project right now. Please try again.</p><button type="button" className="dossier-button" data-testid="button-retry-project" style={{ marginTop: 32 }} onClick={() => void project.refetch()}><RotateCcw size={16}/> Try again</button></div></div></section>;
  if (!data) return <section className="dossier"><div className="page-wrap"><div className="dossier-hero"><p className="dossier-kicker">Project unavailable</p><h1 className="dossier-title">Not every story<br/><em>has a page.</em></h1><p className="dossier-lead">This project link is unavailable. It may have changed or been removed.</p><Link href="/explore" data-testid="link-project-home" className="dossier-button" style={{ marginTop: 32 }}><ArrowLeft size={17}/> Back to Explore</Link></div></div></section>;
  const poster = safeUrl(data.poster_url);
  const thumbnail = safeUrl(data.trailer_thumbnail_url);
  const trailer = safeUrl(data.trailer_url);
   const bunnyEmbed = bunnyEmbedUrl(data.trailer_url);
  const youtubeEmbed = youtubeEmbedUrl(data.trailer_url);
  const trailerEmbed = bunnyEmbed || youtubeEmbed;
  const filmmakerName = data.public_filmmaker_name?.trim() || null;
  const labels = [data.format, data.genre, data.stage].filter(Boolean).join(' / ');
  const panel = pledgePanel(data);
  const intent = current.data?.intent;
  const previousHere = current.data?.history.some(entry => entry.allocations.some(row => row.project_id === data.id));
  // one=1 opens the two-screen, single-project pledge (DECISIONS.md › Investor pledge limits).
  const target = `/invest?project=${encodeURIComponent(data.slug)}&one=1`;
  const pitchDeckUrl = panel.show ? safeUrl(data.pitch_deck_url) : null;
  const published = data.approved && data.showcase_requested;
  const synopsis = data.synopsis?.trim() || '';
  const longStory = synopsis.length > 700;
  const storyText = longStory && !storyOpen ? `${synopsis.slice(0, 640).trimEnd()}…` : synopsis;
  const terms = panel.show && (data.proposal || data.budget);
  return <section className="dossier pj"><div className="pj-wrap">
    <div className="pj-nav"><Link href="/explore" className="pj-back" data-testid="link-project-back"><ArrowLeft size={15}/> Back to Explore</Link></div>
    <header className="pj-head"><p className="dossier-kicker">{labels || 'Independent project'} / Prelaunch</p><h1 className="pj-title" data-testid="text-project-title">{data.title}</h1>{data.logline && <p className="pj-logline" data-testid="text-project-logline">{data.logline}</p>}<div className="pj-by" data-testid="row-project-filmmaker">{filmmakerName ? <p className="pj-by-name" data-testid="text-project-filmmaker">Filmmaker: <strong>{filmmakerName}</strong></p> : <p className="pj-by-name pj-by-missing" data-testid="text-project-filmmaker-missing">Filmmaker: public name not provided</p>}{data.is_owner ? <Link href="/messages" className="dossier-button dossier-button-outline pj-contact-btn" data-testid="link-project-messages">View messages <ArrowUpRight size={16}/></Link> : <ProjectContactDialog key={`${data.slug}:${identityId}`} resetKey={`${data.slug}:${identityId}`} slug={data.slug} title={data.title} filmmakerName={filmmakerName}/>}</div>{data.is_owner && <p className="dossier-status" data-testid="badge-owned-project">Your project · This is how visitors see its public page.</p>}{data.is_owner && <div style={{ marginTop: 14 }}><Link href="/me/projects" className="dossier-button" data-testid="link-project-manage">Manage project <ArrowUpRight size={16}/></Link></div>}</header>
    <div className="pj-media">
      {trailerEmbed ? <><div className="dossier-video"><iframe key={trailerEmbed} src={trailerEmbed} title={`${data.title} trailer`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; gyroscope; encrypted-media; picture-in-picture; fullscreen" allowFullScreen data-testid="iframe-project-trailer" /></div><p className="dossier-status">Player not working? <a href={youtubeEmbed ? trailer! : bunnyEmbed!} target="_blank" rel="noopener noreferrer" data-testid="link-project-trailer">{youtubeEmbed ? 'Open on YouTube' : 'Open the trailer in a new tab'} <ArrowUpRight size={14} style={{ display: 'inline' }}/></a></p></>
      : trailer ? <a className="pj-external" href={trailer} target="_blank" rel="noopener noreferrer" data-testid="link-project-trailer"><span className="dossier-kicker">The trailer</span><strong>Watch the trailer in a new tab <ArrowUpRight size={15} style={{ display: 'inline' }}/></strong><small>This trailer can’t be played on this page.</small></a>
      : (poster || thumbnail) ? <img className="pj-poster" src={poster || thumbnail || ''} alt={`${data.title} project artwork`} data-testid="img-project-artwork" loading="lazy"/> : null}
    </div>
    {synopsis && <section className="dossier-section pj-sec"><span className="dossier-kicker">The story</span><h2>Synopsis.</h2><p>{storyText}</p>{longStory && <button type="button" className="pj-linkbtn" aria-expanded={storyOpen} onClick={() => setStoryOpen(v => !v)} data-testid="button-toggle-story">{storyOpen ? 'Show less' : 'Read the full story'}</button>}</section>}
    {panel.show && <div className="pj-panel" data-testid="project-interest-action">
      <span className="dossier-kicker">Pledge interest</span>
      {panel.showTotal && <div className="pj-total"><p className="pj-total-num" data-testid="text-confirmed-pledge-total">{money(data.confirmed_pledge_total)}</p><p>Confirmed, non-binding interest.</p>{panel.ownerOnlyTotal && <p data-testid="text-owner-only-total">Only you can see this total until your project is approved and listed.</p>}</div>}
      {!!data.public_backers?.length && <div data-testid="list-public-backers"><p className="pj-fine">Backers who chose to be named</p><ul>{data.public_backers.map(backer => <li key={backer.name} style={{overflowWrap:'anywhere'}}>{backer.name} · {money(backer.amount)}</li>)}</ul></div>}
      {data.is_owner ? <p>You can manage this project, but you can’t pledge interest in your own project.</p> :
        current.isPending || current.isFetching ? <p role="status">Checking your saved interest…</p> :
        current.isError ? <p role="alert">We couldn’t check your saved interest. <button type="button" className="pj-linkbtn" onClick={() => void current.refetch()}>Try again</button></p> :
        intent?.status === 'saved' ? <div><p>You have saved non-binding interest that is not yet confirmed. No new interest has been recorded for this project.</p><div className="pj-actions"><Link href="/lineup" className="dossier-button pj-primary" data-testid="link-project-continue-interest">Continue saved interest <ArrowUpRight size={16}/></Link></div><p><Link href={`${target}&revise=1`} className="pj-linkbtn" data-testid="link-project-revise-interest">Or revise it for this project</Link></p></div> :
        intent?.status === 'confirmed' && previousHere && !dismissed ? <div data-testid="prompt-project-more-interest"><p>You are on the waitlist for this project: your confirmed, non-binding interest is on record. A new amount will be a separate non-binding entry, reviewed and signed again; your earlier interest stays unchanged.</p><div className="pj-actions"><Link href={`${target}&new=1`} className="dossier-button pj-primary" data-testid="link-project-add-more">Add more interest to this project <ArrowUpRight size={16}/></Link><Link href="/lineup" className="dossier-button dossier-button-outline">View my lineup <ArrowUpRight size={16}/></Link><button type="button" className="dossier-button dossier-button-outline" onClick={() => setDismissed(true)} data-testid="button-dismiss-project-interest">Dismiss</button></div></div> :
        <div className="pj-actions"><Link href={`${target}${intent?.status === 'confirmed' ? '&new=1' : ''}`} className="dossier-button pj-primary" data-testid="link-project-pledge">{intent?.status === 'confirmed' ? 'Add more interest to this project' : 'Pledge to this project'} <ArrowUpRight size={18}/></Link></div>}
      <p className="pj-fine" role="note" data-testid="text-securities-notice">{securitiesNotice} <strong>Returns aren’t guaranteed. You may get back less, or nothing.</strong></p>
    </div>}
    <div className="pj-facts"><span className="dossier-kicker">Showcase status</span><p className="pj-status" data-testid="status-public-project-review">{published ? 'Approved.' : data.showcase_requested ? 'Pending review.' : 'Not requested.'}</p><p>{published ? 'This project has been approved for showcase.' : data.showcase_requested ? 'A showcase request is pending review. This page is unlisted but anyone with its link can view it.' : 'No showcase review has been requested. This page is unlisted but anyone with its link can view it.'}</p>{data.phone_verified && <p data-testid="badge-public-project-phone-verified"><strong>Phone verified.</strong> The filmmaker has verified a phone number with Firebase.</p>}</div>
    <ProjectTimeline slug={data.slug} />
    {(data.money_use || data.distribution_plan || data.team_links.length > 0 || data.team_info) && <details className="dossier-section pj-sec" data-testid="details-more-about-project"><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 20 }}>More about this project</summary>
      {data.team_info && <><span className="dossier-kicker">The team</span><p>{data.team_info}</p></>}
      {data.team_links.length > 0 && <ul className="dossier-links">{data.team_links.map((link, i) => {
        const url = safeUrl(link);
        return url && <li key={`${link}-${i}`}><a href={url} target="_blank" rel="noopener noreferrer" data-testid={`link-project-team-${i}`}>{url} <ArrowUpRight size={14} style={{ display: 'inline' }}/></a></li>;
      })}</ul>}
      {data.distribution_plan && <><span className="dossier-kicker">Distribution</span><p>{data.distribution_plan}</p></>}
      {data.money_use && <><span className="dossier-kicker">Planned use of funds</span><p>{data.money_use}</p></>}
    </details>}
    {pitchDeckUrl && <section className="dossier-section pj-sec"><a href={pitchDeckUrl} target="_blank" rel="noopener noreferrer" className="dossier-button dossier-button-outline" data-testid="link-project-pitch-deck">View pitch deck <ArrowUpRight size={16}/></a><p className="dossier-status">{data.pitch_deck_name || 'Pitch deck'} · Viewable by anyone with this page’s link while the project is available.</p></section>}
    {terms && <section className="dossier-section pj-sec" data-testid="section-project-proposal"><span className="dossier-kicker">The filmmaker’s proposed terms</span><h2>Budget and repayment.</h2>{data.budget != null && <p>Project budget: <strong>{money(data.budget)}</strong></p>}{data.development_amount != null && <p data-testid="text-project-development">Development amount: <strong>{money(data.development_amount)}</strong></p>}<div className="dossier-notice" role="note">These are the filmmaker’s proposed terms, not an offer. They are illustrative, revenue-dependent and not guaranteed.</div><details className="pj-terms"><summary>View full proposed terms</summary><ProposalSummary proposal={data.proposal} budget={data.budget} stage={data.stage} testId="project-proposal"/></details></section>}
    {panel.show && !data.is_owner && <div id="section-project-share"><ProjectShare audience="recipient" slug={data.slug} title={data.title} genre={data.genre} logline={data.logline} approved={data.approved} showcaseRequested={data.showcase_requested}/></div>}
    <p className="dossier-status pj-disc">Project information is supplied by the filmmaker and may change.</p>
  </div></section>;
}
