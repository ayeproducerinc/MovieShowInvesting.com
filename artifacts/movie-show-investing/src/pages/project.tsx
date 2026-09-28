import { useEffect } from 'react';
import { ArrowUpRight, RotateCcw } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { getGetPublicProjectQueryKey, useGetPublicProject } from '@workspace/api-client-react';
import { ProjectShare } from '@/components/project-share';
import { ProjectQuestionForm } from '@/components/project-question-form';
import { ProjectConversationEntry } from '@/components/project-conversation-entry';
import { money } from './filmmaker-calculator';

const securitiesNotice = "Pledge your interest in future investment opportunities. If a project opens for investment, it will be offered only in compliance with securities laws, and you'll get full offering documents before you decide.";
function safeUrl(value: string | null | undefined) {
  if (!value) return null;
  try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; }
  catch { return null; }
}
function safeBunnyEmbed(value: string | null | undefined) {
  const href = safeUrl(value);
  if (!href) return null;
  const url = new URL(href);
  return url.hostname === 'iframe.mediadelivery.net' && url.pathname.startsWith('/embed/') ? href : null;
}
function ProjectDetail({ label, title, value }: { label: string; title: string; value: string | null }) {
  if (!value?.trim()) return null;
  return <section className="dossier-section"><span className="dossier-kicker">{label}</span><h2>{title}</h2><p>{value}</p></section>;
}
export default function Project() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug || '';
  const project = useGetPublicProject(slug, { query: { enabled: !!slug, queryKey: getGetPublicProjectQueryKey(slug), retry: (count, error) => error.status !== 404 && count < 2 } });
  const data = project.data;
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
  if (project.isLoading) return <section className="dossier"><div className="page-wrap dossier-hero" aria-label="Loading project"><p className="dossier-kicker">Opening the project dossier</p><div className="dossier-skeleton" style={{ width: 'min(95%, 750px)', height: 95 }}/><div className="dossier-skeleton" style={{ width: 'min(65%, 520px)' }}/></div></section>;
  if (project.isError && project.error?.status !== 404) return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker">Connection interrupted</p><h1 className="dossier-title">The page is<br/><em>out of reach.</em></h1><p className="dossier-lead" role="alert">We couldn’t load this project right now. Please try again.</p><button type="button" className="dossier-button" data-testid="button-retry-project" style={{ marginTop: 32 }} onClick={() => void project.refetch()}><RotateCcw size={16}/> Try again</button></div></section>;
  if (!data) return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker">Project unavailable</p><h1 className="dossier-title">Not every story<br/><em>has a page.</em></h1><p className="dossier-lead">This project link is unavailable. It may have changed or been removed.</p><Link href="/" data-testid="link-project-home" className="dossier-button" style={{ marginTop: 32 }}>Return to the site <ArrowUpRight size={17}/></Link></div></section>;
  const poster = safeUrl(data.poster_url);
  const thumbnail = safeUrl(data.trailer_thumbnail_url);
  const trailer = safeUrl(data.trailer_url);
  const bunnyEmbed = safeBunnyEmbed(data.trailer_url);
  const labels = [data.format, data.genre, data.stage].filter(Boolean).join(' / ');
  return <section className="dossier"><div className="page-wrap">
    <div className="dossier-head"><Link href="/" className="dossier-kicker" data-testid="link-project-brand">Movie Show Investing / Projects</Link><span className="dossier-kicker">{data.approved && data.showcase_requested ? 'Showcase approved' : 'Unlisted / shared by link'}</span></div>
    <div className="dossier-notice" data-testid="text-securities-notice" style={{ marginTop: 30 }}>{securitiesNotice}</div>
    <div className="dossier-hero"><p className="dossier-kicker">{labels || 'Independent project'} / Prelaunch</p><h1 className="dossier-title" data-testid="text-project-title">{data.title}<em>.</em></h1>{data.logline && <p className="dossier-lead" data-testid="text-project-logline">{data.logline}</p>}</div>
    <div className="dossier-rule"/>
    <div className="dossier-grid">
      <div>
        {(poster || thumbnail) && <div className="dossier-section"><span className="dossier-kicker">A first look</span><img className="dossier-poster" src={poster || thumbnail || ''} alt={`${data.title} project artwork`} data-testid="img-project-artwork" loading="lazy"/></div>}
        {bunnyEmbed ? <div className="dossier-section"><span className="dossier-kicker">The trailer</span><h2>See it in motion.</h2><div className="dossier-video"><iframe src={bunnyEmbed} title={`${data.title} trailer`} loading="lazy" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen data-testid="iframe-project-trailer" /></div><p className="dossier-status">Player not working? <a href={bunnyEmbed} target="_blank" rel="noopener noreferrer" data-testid="link-project-trailer">Open the trailer in a new tab <ArrowUpRight size={14} style={{ display: 'inline' }}/></a></p></div> : trailer && <div className="dossier-section"><span className="dossier-kicker">The trailer</span><h2>See it in motion.</h2><a className="dossier-media-link" href={trailer} target="_blank" rel="noopener noreferrer" data-testid="link-project-trailer">Watch the trailer <ArrowUpRight size={15} style={{ display: 'inline' }}/></a></div>}
        <ProjectDetail label="01 / The story" title="Synopsis." value={data.synopsis}/>
        <ProjectDetail label="02 / The plan" title="Use of funds." value={data.money_use}/>
        <ProjectDetail label="03 / The path forward" title="Distribution." value={data.distribution_plan}/>
        {data.team_links.length > 0 && <section className="dossier-section"><span className="dossier-kicker">04 / The people</span><h2>Meet the team.</h2><ul className="dossier-links">{data.team_links.map((link, i) => {
          const url = safeUrl(link);
          return url && <li key={`${link}-${i}`}><a href={url} target="_blank" rel="noopener noreferrer" data-testid={`link-project-team-${i}`}>{url} <ArrowUpRight size={14} style={{ display: 'inline' }}/></a></li>;
        })}</ul></section>}
        <ProjectQuestionForm slug={data.slug} title={data.title}/>
        <ProjectConversationEntry slug={data.slug}/>
        <ProjectShare slug={data.slug} title={data.title} genre={data.genre} logline={data.logline}/>
      </div>
      <aside className="dossier-side"><div className="dossier-sticky"><div className="dossier-dark"><span className="dossier-kicker">Showcase status</span><p className="dossier-value" data-testid="status-public-project-review" style={{ fontSize: 49 }}>{data.approved && data.showcase_requested ? 'Approved.' : data.showcase_requested ? 'Pending review.' : 'Not requested.'}</p><p>{data.approved && data.showcase_requested ? 'This project has been approved for showcase. Investor pledges are not open during the filmmaker-first launch.' : data.showcase_requested ? 'A showcase request is pending review. This page is unlisted but anyone with its link can view it.' : 'No showcase review has been requested. This page is unlisted but anyone with its link can view it.'} This is not a live investment opportunity.</p>{data.phone_verified && <p className="dossier-line" data-testid="badge-public-project-phone-verified"><strong>✓ Phone verified</strong><br/>The filmmaker has verified a phone number with Firebase.</p>}<div className="dossier-line"><span className="dossier-kicker">Confirmed pledges only</span><p className="dossier-value" data-testid="text-confirmed-pledge-total" style={{ fontSize: 48 }}>{money(data.confirmed_pledge_total)}</p><p>Only confirmed, non-binding pledges are counted. Investor pledges are not open during the filmmaker-first launch.</p><p><strong>Returns aren’t guaranteed. You may get back less, or nothing.</strong></p></div><p className="dossier-line">No money is collected. If investment opens later, full offering documents will be provided before any decision.</p></div><p className="dossier-status">Project information is supplied by the filmmaker and may change. This page does not offer securities.</p></div></aside>
    </div>
  </div></section>;
}