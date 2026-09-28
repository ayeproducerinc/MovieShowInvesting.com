import { useState } from 'react';
import { Check, Copy, Share2, RotateCcw } from 'lucide-react';
import { getGetExploreQueryKey, getGetProjectShareMetadataUrl, useGetExplore } from '@workspace/api-client-react';
import type { InvestorInterestHistoryItem } from '@workspace/api-client-react';
import { trackInvestorEvent } from '@/lib/analytics';
import '../investor-result.css';

const dollars = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);

/**
 * This record is private. Sharing deliberately uses only a currently public
 * Explore project, never a receipt, investor identity or pledge information.
 */
export function InvestorResultCard({ entry }: { entry: InvestorInterestHistoryItem }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [showCopyFallback, setShowCopyFallback] = useState(false);
  const publicProjects = useGetExplore(undefined, { query: { queryKey: getGetExploreQueryKey(), refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 60_000 } });
  const shareable = entry.allocations.flatMap(row => {
    if (!row.project_visible || !row.project_slug) return [];
    const publicProject = publicProjects.data?.projects.find(project => project.id === row.project_id && project.slug === row.project_slug);
    return publicProject?.slug && publicProject.title ? [publicProject] : [];
  });
  const selected = shareable.find(project => project.id === selectedId) ?? shareable[0];
  const url = selected ? new URL(getGetProjectShareMetadataUrl(selected.slug), window.location.origin).href : '';
  const date = new Date(entry.confirmed_at);
  const confirmedDate = Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);

  async function copy() {
    if (!selected || publicProjects.isFetching || publicProjects.isError) return;
    try {
      await navigator.clipboard.writeText(url);
      trackInvestorEvent('inv_share_click', { method: 'copy', project_slug: selected.slug });
      setShowCopyFallback(false);
      setFeedback('Public project link copied.');
    } catch {
      setShowCopyFallback(true);
      setFeedback('Automatic copy is unavailable. Select the public link below to copy it.');
    }
  }

  async function share() {
    if (!selected || publicProjects.isFetching || publicProjects.isError) return;
    if (!navigator.share) { await copy(); return; }
    try {
      await navigator.share({ title: selected.title, url });
      trackInvestorEvent('inv_share_click', { method: 'share', project_slug: selected.slug });
      setFeedback('Public project page shared.');
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') {
        setShowCopyFallback(true);
        setFeedback('Sharing is unavailable. Copy the public link below instead.');
      }
    }
  }

  return <article className="investor-result" data-testid="investor-result-card" aria-label="Private confirmed interest record">
    <div className="investor-result__top"><p className="inv-kicker">Movie Show Investing / Private record</p><span className="investor-result__seal"><Check size={13} aria-hidden="true" className="inline"/> Signed interest</span></div>
    <div className="investor-result__main">
      <div><h2>Interest, on record.</h2><p>{confirmedDate ? `Confirmed ${confirmedDate}` : 'Confirmed interest'}</p></div>
      <strong className="investor-result__amount" data-testid="investor-result-amount">{dollars(entry.amount)}</strong>
      <p className="investor-result__risk">Returns aren’t guaranteed. You may get back less, or nothing.</p>
    </div>
    <ul className="investor-result__list" data-testid="done-confirmed-allocations" aria-label="Confirmed allocation details">
      {entry.unallocated ? <li className="investor-result__unallocated"><span>Not allocated to a project</span><strong>{dollars(entry.amount)}</strong></li> :
        entry.allocations.length ? entry.allocations.map(row => <li key={row.project_id} data-testid={`done-allocation-${row.project_id}`}><span>{row.project_title ?? `Project #${row.project_id}`}</span><strong>{dollars(row.amount)}</strong></li>) :
        <li><span>No project allocations are on record.</span></li>}
    </ul>
     <p className="investor-result__legal">This is a private record of non-binding interest, not an investment or offer of securities. No money has been collected. If a project opens for investment, full offering documents will be provided before you decide.</p>
    <div className="investor-result__share">
      <p className="inv-kicker">Separate from your private record</p>
      <h3>Share a story, not your interest.</h3>
      <p>Only a currently public project page can be shared. Your name, signed amount, allocations and this private record are never included.</p>
      {publicProjects.isPending || publicProjects.isFetching ? <div role="status" aria-label="Checking public projects"><div className="inv-skeleton" style={{ height: 43, maxWidth: 290 }}/></div> :
        publicProjects.isError ? <div><p role="alert" className="investor-result__feedback">We couldn’t check which projects are public. Sharing is unavailable for now.</p><button type="button" className="inv-button secondary" onClick={() => void publicProjects.refetch()}><RotateCcw size={15}/> Try again</button></div> :
        shareable.length === 0 ? <p className="investor-result__feedback">No project from this entry is currently public to share.</p> :
        <>
          {shareable.length > 1 && <div className="investor-result__share-options" role="group" aria-label="Choose a public project to share">{shareable.map(project => <button type="button" key={project.id} className="investor-result__share-option" aria-pressed={selected?.id === project.id} onClick={() => { setSelectedId(project.id); setFeedback(''); setShowCopyFallback(false); }}>{project.title}</button>)}</div>}
          {shareable.length === 1 && <p className="investor-result__feedback">Public page: {selected.title}</p>}
          <div className="investor-result__share-actions">
            <button type="button" className="inv-button" data-testid="button-share-public-project" onClick={() => void share()}><Share2 size={16}/> Share project page</button>
            <button type="button" className="inv-button secondary" data-testid="button-copy-public-project" onClick={() => void copy()}><Copy size={16}/> Copy public link</button>
          </div>
          <p className="investor-result__feedback" role="status">{feedback}</p>
          {showCopyFallback && <label className="investor-result__fallback">Public project link<input readOnly value={url} onFocus={event => event.currentTarget.select()} aria-label="Select and copy public project link" /></label>}
        </>}
    </div>
  </article>;
}