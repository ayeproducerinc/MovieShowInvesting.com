import { useState } from 'react';
import { ArrowUpRight, Copy, Share2 } from 'lucide-react';
import { getGetProjectShareMetadataUrl } from '@workspace/api-client-react';

export function projectShareUrl(slug: string) {
  return new URL(getGetProjectShareMetadataUrl(slug), window.location.origin).href;
}

export function ProjectShare({ slug, title, genre, approved = false, showcaseRequested = false }: {
  slug: string;
  title: string;
  genre?: string | null;
  logline?: string | null;
  approved?: boolean;
  showcaseRequested?: boolean;
}) {
  const [feedback, setFeedback] = useState('');
  const url = projectShareUrl(slug);
  const cardTitle = title.replace(/\$\s*[\d,]+(?:\.\d{1,2})?/g, '').replace(/\s{2,}/g, ' ').trim() || 'Untitled project';
  const listed = approved && showcaseRequested;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setFeedback('Link copied. Anyone with this link can view the page.');
    } catch {
      setFeedback('Could not copy automatically. Select the link below to copy it.');
    }
  }
  async function share() {
    if (!navigator.share) { await copy(); return; }
    try {
      await navigator.share({ title: `${cardTitle} | Movie Show Investing`, text: `Take a look at ${cardTitle}. No investment or payment is available.`, url });
      setFeedback('Share sheet opened.');
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') setFeedback('Sharing was unavailable. You can copy the link instead.');
    }
  }
  return <div className="dossier-section" data-testid="section-project-share">
    <span className="dossier-kicker">The link / your story</span>
    <h2>Pass the story along.</h2>
    <div className="dossier-share" aria-label="Project share card without financial terms">
      <span className="dossier-kicker">Movie Show Investing / {listed ? 'Showcase listing' : 'Unlisted project'}</span>
       <div><h2 data-testid="text-share-title">{cardTitle}</h2><p>A story in the making. No investment or payment is available.</p></div>
      <span className="dossier-kicker">{genre || 'Independent film'} / Prelaunch</span>
    </div>
    <p className="dossier-status" data-testid="status-project-share">
      {listed
        ? 'Approved for showcase discovery. The project is listed while it remains approved and not hidden; anyone can view its page. It is not confidential, and no investment or payment is available.'
        : showcaseRequested
          ? 'Showcase review is pending. Until approved, the project is unlisted but anyone with the link can view it. It is not confidential, and no investment or payment is available.'
          : 'This project is unlisted and has not been submitted for showcase review. Anyone with the link can view it; the page is not confidential. No investment or payment is available.'}
    </p>
    <div className="dossier-actions" style={{ marginTop: 22 }}>
      <button type="button" data-testid="button-copy-project-link" className="dossier-button" onClick={() => void copy()}><Copy size={16}/> Copy link</button>
      <button type="button" data-testid="button-share-project" className="dossier-button dossier-button-outline" onClick={() => void share()}><Share2 size={16}/> Share page</button>
      <a className="dossier-button dossier-button-outline" data-testid="link-view-project" href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/project/${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer">View page <ArrowUpRight size={16}/></a>
    </div>
    <a href="#section-showcase" className="dossier-button dossier-button-outline" data-testid="link-request-showcase-review" style={{ marginTop: 18 }}>
      {showcaseRequested ? 'Edit showcase details' : 'Save details or submit for paid review'} <ArrowUpRight size={16}/>
    </a>
    <p className="dossier-status" role="status" data-testid="status-share">{feedback}</p>
    {feedback.startsWith('Could not copy') && <div className="dossier-field"><label htmlFor="share-url">Project link</label><input id="share-url" data-testid="input-share-url" value={url} readOnly onFocus={event => event.currentTarget.select()} /></div>}
  </div>;
}