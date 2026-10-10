import { useState } from 'react';
import { ArrowUpRight, Copy, Share2 } from 'lucide-react';
import { Link } from 'wouter';
import { getGetMyReferralsQueryKey, getGetProjectShareMetadataUrl, useGetMyReferrals } from '@workspace/api-client-react';
import { useReferralIdentity } from '@/components/referral-claim';
import { useReferralClaim } from '@/lib/referral-attribution';

export function projectShareUrl(slug: string) {
  return new URL(getGetProjectShareMetadataUrl(slug), window.location.origin).href;
}

/** Copy and native-share actions for a project's public link. */
function useProjectShare({ slug, title, genre, logline }: { slug: string; title: string; genre?: string | null; logline?: string | null }) {
  const [feedback, setFeedback] = useState('');
  const url = projectShareUrl(slug);
  const cardTitle = title.replace(/\$\s*[\d,]+(?:\.\d{1,2})?/g, '').replace(/\s{2,}/g, ' ').trim() || 'Untitled project';
  const shortLine = logline ? (logline.length > 140 ? `${logline.slice(0, 137)}...` : logline) : '';
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
      await navigator.share({ title: `${cardTitle} | Movie Show Investing`, text: `${cardTitle}${genre ? ` (${genre})` : ''}${shortLine ? `: ${shortLine}` : ''} View the project and pledge non-binding interest. No investment or payment happens now.`, url });
      setFeedback('Share sheet opened.');
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') setFeedback('Sharing was unavailable. You can copy the link instead.');
    }
  }
  return { url, cardTitle, shortLine, feedback, copy, share };
}

/** Compact share controls for the public project page. */
export function ProjectShareButtons(props: { slug: string; title: string; genre?: string | null; logline?: string | null }) {
  const { url, feedback, copy, share } = useProjectShare(props);
  return <div className="pj-share-buttons">
    <button type="button" className="pj-share" data-testid="button-copy-project-link" onClick={() => void copy()}><Copy size={14}/> Copy link</button>
    <button type="button" className="pj-share" data-testid="button-share-project" onClick={() => void share()}><Share2 size={14}/> Share</button>
    {feedback && <p className="dossier-status pj-share-feedback" role="status" data-testid="status-share">{feedback}</p>}
    {feedback.startsWith('Could not copy') && <input className="pj-share-url" aria-label="Project link" data-testid="input-share-url" value={url} readOnly onFocus={event => event.currentTarget.select()} />}
  </div>;
}

export function ProjectShare({ slug, title, genre, logline, approved = false, showcaseRequested = false, audience = 'owner' }: {
  audience?: 'owner' | 'recipient';
  slug: string;
  title: string;
  genre?: string | null;
  logline?: string | null;
  approved?: boolean;
  showcaseRequested?: boolean;
}) {
  const { url, cardTitle, shortLine, feedback, copy, share } = useProjectShare({ slug, title, genre, logline });
  const owner = audience === 'owner';
  const listed = approved && showcaseRequested;
  return <div className="dossier-section" data-testid="section-project-share">
    <span className="dossier-kicker">{owner ? 'Share this pitch with potential investors' : 'Know someone who would like this?'}</span>
    <h2>{owner ? 'Send investors to this project.' : 'Share this project.'}</h2>
    <div className="dossier-share" aria-label="Project share card without financial terms">
      <span className="dossier-kicker">Movie Show Investing / {listed ? 'Showcase listing' : 'Unlisted project'}</span>
       <div><h2 data-testid="text-share-title">{cardTitle}</h2><p>{shortLine || 'A story in the making.'} Pledge non-binding interest. No investment or payment is available.</p></div>
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
    {owner && !showcaseRequested && <a href="#section-showcase" className="dossier-button dossier-button-outline" data-testid="link-request-showcase-review" style={{ marginTop: 18 }}>
      Save details or submit for paid review <ArrowUpRight size={16}/>
    </a>}
    <p className="dossier-status" role="status" data-testid="status-share">{feedback}</p>
    {feedback.startsWith('Could not copy') && <div className="dossier-field"><label htmlFor="share-url">Project link</label><input id="share-url" data-testid="input-share-url" value={url} readOnly onFocus={event => event.currentTarget.select()} /></div>}
  </div>;
}

export function filmmakerInviteUrl(referralCode?: string | null) {
  const url = new URL(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/start/filmmaker`, window.location.origin);
  if (referralCode) url.searchParams.set('ref', referralCode);
  return url.href;
}

export function FilmmakerInvite() {
  const [feedback, setFeedback] = useState('');
  // Same query and cache as My referrals; the plain link is used until a code is available.
  const identity = useReferralIdentity();
  const claim = useReferralClaim();
  const referrals = useGetMyReferrals({ query: { queryKey: [...getGetMyReferralsQueryKey(), identity], enabled: !!identity && claim.identity === identity && claim.status === 'done', retry: false, staleTime: 30_000 } });
  const referralCode = identity ? referrals.data?.code ?? null : null;
  const url = filmmakerInviteUrl(referralCode);
  const text = 'Working on a film or show? Post your project on Movie Show Investing and let potential investors pledge non-binding interest. No investment or payment is made.';
  async function copy() {
    try { await navigator.clipboard.writeText(url); setFeedback('Invitation link copied.'); }
    catch { setFeedback('Could not copy automatically. Select the link below to copy it.'); }
  }
  async function share() {
    if (!navigator.share) { await copy(); return; }
    try { await navigator.share({ title: 'Post your project | Movie Show Investing', text, url }); setFeedback('Share sheet opened.'); }
    catch (error) { if ((error as DOMException).name !== 'AbortError') setFeedback('Sharing was unavailable. You can copy the link instead.'); }
  }
  return <div className="dossier-notice" data-testid="section-filmmaker-invite" style={{ marginTop: 0 }}>
    <strong>Invite a filmmaker</strong>
    <p>Share the filmmaker entry page so another filmmaker can post a project they are working on. It does not open your pitch or draft.</p>
    {referralCode && <p data-testid="text-filmmaker-invite-referral">This link includes your referral code. See <Link href="/referrals">My referrals</Link> for rewards.</p>}
    <div className="dossier-actions" style={{ marginTop: 12 }}>
      <button type="button" className="dossier-button dossier-button-outline" data-testid="button-share-filmmaker-invite" onClick={() => void share()}><Share2 size={16}/> Invite a filmmaker</button>
      <button type="button" className="dossier-button dossier-button-outline" data-testid="button-copy-filmmaker-invite" onClick={() => void copy()}><Copy size={16}/> Copy invite link</button>
    </div>
    <p className="dossier-status" role="status" data-testid="status-filmmaker-invite">{feedback}</p>
    {feedback.startsWith('Could not copy') && <input aria-label="Filmmaker invitation link" data-testid="input-filmmaker-invite-url" value={url} readOnly onFocus={event => event.currentTarget.select()} />}
  </div>;
}
