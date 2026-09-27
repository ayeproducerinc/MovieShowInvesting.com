import { useState } from 'react';
import { ArrowUpRight, Copy, Share2 } from 'lucide-react';
import { getGetProjectShareMetadataUrl } from '@workspace/api-client-react';

export function projectShareUrl(slug: string) {
  return new URL(getGetProjectShareMetadataUrl(slug), window.location.origin).href;
}

export function ProjectShare({ slug, title, genre }: { slug: string; title: string; genre?: string | null; logline?: string | null }) {
  const [feedback, setFeedback] = useState('');
  const url = projectShareUrl(slug);
  const cardTitle = title.replace(/\$\s*[\d,]+(?:\.\d{1,2})?/g, '').replace(/\s{2,}/g, ' ').trim() || 'Untitled project';
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
      await navigator.share({ title: `${title} | Movie Show Investing`, text: `Take a look at ${title}. Investor pledges are not open yet.`, url });
      setFeedback('Share sheet opened.');
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') setFeedback('Sharing was unavailable. You can copy the link instead.');
    }
  }
  return <div className="dossier-section" data-testid="section-project-share">
    <span className="dossier-kicker">The link / your story</span>
    <h2>Pass the story along.</h2>
    <div className="dossier-share" aria-label="Project share card without financial terms">
      <span className="dossier-kicker">Movie Show Investing / An unlisted project</span>
      <div><h2 data-testid="text-share-title">{cardTitle}</h2><p>A story in the making. Investor pledges are not open yet.</p></div>
      <span className="dossier-kicker">{genre || 'Independent film'} / Prelaunch</span>
    </div>
    <p className="dossier-status">This is an unlisted page, not a confidential one. Anyone with the link can view it. No investment is open.</p>
    <div className="dossier-actions" style={{ marginTop: 22 }}>
      <button type="button" data-testid="button-copy-project-link" className="dossier-button" onClick={() => void copy()}><Copy size={16}/> Copy link</button>
      <button type="button" data-testid="button-share-project" className="dossier-button dossier-button-outline" onClick={() => void share()}><Share2 size={16}/> Share page</button>
      <a className="dossier-button dossier-button-outline" data-testid="link-view-project" href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/project/${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer">View page <ArrowUpRight size={16}/></a>
    </div>
    <p className="dossier-status" role="status" data-testid="status-share">{feedback}</p>
    {feedback.startsWith('Could not copy') && <div className="dossier-field"><label htmlFor="share-url">Project link</label><input id="share-url" data-testid="input-share-url" value={url} readOnly onFocus={event => event.currentTarget.select()} /></div>}
  </div>;
}