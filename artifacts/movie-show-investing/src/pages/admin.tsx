import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signOut, type Auth, type User,
} from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminMeQueryKey, getGetAdminTableQueryKey, getGetFirebaseConfigQueryKey, getGetAdminConversationsQueryKey,
  leaveFilmmakerAccount, setAuthTokenGetter, useGetAdminMe, useGetAdminTable, useGetFirebaseConfig,
  useGetAdminProjectReview, useReviewAdminProject, useReviewAdminMessage,
  type AdminSection, type AdminTable,
} from '@workspace/api-client-react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Clapperboard, Eye, FileText, LockKeyhole, LogOut, ShieldAlert, X } from 'lucide-react';
import { ProposalSummary } from '@/components/proposal-summary';
import { AdminInvestors } from '@/components/admin-investors';
import { PitchProvenance, ReviewNotesForm } from '@/components/admin-pitch-extras';
import { ReadableValue } from '@/components/admin-readable';
import { AdminConversations } from '@/components/admin-conversations';
import { useAuth } from '@workspace/replit-auth-web';
import { isReplitAuthActive, isReplitAuthLoading } from '@workspace/replit-auth-web';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { customFetch } from '../../../../lib/api-client-react/src/custom-fetch';

const SECTIONS: { id: AdminSection; label: string; description: string }[] = [
  { id: 'summary', label: 'Summary', description: 'A consolidated view of activity recorded across the site.' },
  { id: 'pledges', label: 'Pledges by project', description: 'Non-binding expressions of interest, organized by project.' },
  { id: 'location', label: 'By location', description: 'Where submitted interest and activity are coming from.' },
  { id: 'funnels', label: 'Funnels', description: 'A view of progress through the filmmaker and investor journeys.' },
  { id: 'market', label: 'Market', description: 'Responses that help characterize the emerging market.' },
  { id: 'price-test', label: 'Price test', description: 'Results from the current price-test assignment.' },
  { id: 'queues', label: 'Queues', description: 'Showcase requests awaiting review, alongside other recorded follow-up queues.' },
  { id: 'messages', label: 'Messages', description: 'Messages received through the site.' },
  { id: 'channels', label: 'Channels', description: 'Campaign and referral attribution in one place.' },
  { id: 'email-log', label: 'Email log', description: 'A record of outgoing email activity.' },
];
const APP_NAME = 'movie-show-investing';

function clearPrivateData(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.cancelQueries({ queryKey: getGetAdminMeQueryKey() });
  queryClient.removeQueries({ queryKey: getGetAdminMeQueryKey() });
  queryClient.removeQueries({ queryKey: getGetAdminConversationsQueryKey() });
  queryClient.removeQueries({ predicate: query => typeof query.queryKey[0] === 'string' && /^\/api\/admin\/conversations\/\d+$/.test(query.queryKey[0]) });
  queryClient.removeQueries({ predicate: query => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/admin/investors') });
  queryClient.removeQueries({ queryKey: ['admin-project-pitch-details'] });
  for (const section of SECTIONS) {
    void queryClient.cancelQueries({ queryKey: getGetAdminTableQueryKey(section.id) });
    queryClient.removeQueries({ queryKey: getGetAdminTableQueryKey(section.id) });
  }
}

function Frame({ children, email, onSignOut }: { children: ReactNode; email?: string; onSignOut?: () => void }) {
  return <div className="admin-room">
    <header className="admin-header">
      <div className="admin-brand-wrap">
        <div className="admin-brand-mark" aria-hidden="true"><Clapperboard size={18} strokeWidth={1.4} /></div>
        <a className="admin-brand" href={import.meta.env.BASE_URL} data-testid="link-admin-brand">Movie Show<br />Investing</a>
      </div>
      <div className="admin-header-right">
        <span className="admin-mono">{email ? 'Private workspace' : 'Administration'}</span>
        {onSignOut ? <button className="admin-link admin-mono" type="button" onClick={onSignOut} data-testid="button-sign-out"><LogOut size={12} style={{ display: 'inline', marginRight: 6 }} />Sign out</button> : <a className="admin-link admin-mono" href={import.meta.env.BASE_URL} data-testid="link-public-site">View site ↗</a>}
      </div>
    </header>
    {children}
    <footer className="admin-legal" data-testid="text-admin-legal">Pledges are non-binding. No money is collected. This is not an offer to sell securities.</footer>
  </div>;
}

function Notice({ icon, title, children, action, onAction }: { icon: ReactNode; title: string; children: ReactNode; action?: string; onAction?: () => void }) {
  return <div className="admin-state" role="status" data-testid="status-admin-state">
    <div className="admin-state-icon">{icon}</div>
    <h2>{title}</h2><p>{children}</p>
    {action && onAction && <button type="button" className="admin-button secondary" onClick={onAction} data-testid="button-retry-admin">{action}<ArrowRight size={15} /></button>}
  </div>;
}

function Skeleton({ compact = false }: { compact?: boolean }) {
  return <div className="admin-state" role="status" aria-label="Loading administration data" data-testid="status-admin-loading" style={{ minHeight: compact ? 230 : 350, display: 'block' }}>
    <div className="admin-skeleton" style={{ width: 115, height: 11 }} />
    <div className="admin-skeleton" style={{ width: '44%', height: 32, marginTop: 35 }} />
    <div className="admin-skeleton" style={{ width: '78%', marginTop: 40 }} />
    <div className="admin-skeleton" style={{ width: '93%' }} />
    <div className="admin-skeleton" style={{ width: '69%' }} />
  </div>;
}

function csvCell(value: string) {
  // Do not allow a spreadsheet to interpret submitted text as a formula.
  const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function downloadCsv(table: AdminTable, section: AdminSection) {
  const csv = [table.columns, ...table.rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `movie-show-investing-${section}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function numericId(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value.trim())) return null;
  const id = Number(value.trim());
  return Number.isSafeInteger(id) ? id : null;
}

function columnIndex(columns: string[], pattern: RegExp): number {
  return columns.findIndex(column => pattern.test(column.trim()));
}

function reviewStatus(value: string | undefined) {
  const status = (value ?? '').trim().toLowerCase();
  return { approved: status.includes('approved'), hidden: status.includes('hidden') };
}

function MessageHidden({ row, columns }: { row: string[]; columns: string[] }) {
  const hiddenIndex = columns.findIndex(column => /^(hidden|status|visibility)$/i.test(column.trim()));
  const value = hiddenIndex >= 0 ? (row[hiddenIndex] ?? '').trim().toLowerCase() : '';
  return value === 'yes' || value === 'true' || value === '1' || value === 'hidden' || value.includes('hidden');
}

function ReviewActions({ section, row, columns, onResult }: {
  section: AdminSection; row: string[]; columns: string[]; onResult: (message: string, failed?: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const project = useReviewAdminProject();
  const message = useReviewAdminMessage();
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const isProject = section === 'queues';
  const queueIndex = columnIndex(columns, /^queue$/i);
  const statusIndex = columnIndex(columns, /^(status|visibility)$/i);
  const idIndex = columnIndex(columns, isProject ? /^project id$/i : /^message id$/i);
  const queueType = queueIndex >= 0 ? (row[queueIndex] ?? '').trim().toLowerCase() : '';
  const id = numericId(idIndex >= 0 ? row[idIndex] : undefined);
  const eligible = !isProject || (queueType === 'approval' || queueType === 'showcase request');
  const { approved, hidden: projectHidden } = reviewStatus(statusIndex >= 0 ? row[statusIndex] : undefined);
  // Messages may expose a "Hidden", "Status", or "Visibility" column.
  const messageHidden = MessageHidden({ row, columns });
  if (!eligible || id === null) return <span className="admin-action-na">—</span>;

  async function review(action: 'approve' | 'decline' | 'hide' | 'unhide') {
    if (id === null || lock.current) return;
    lock.current = true;
    setWorking(true);
    onResult('');
    try {
      if (isProject) {
        await project.mutateAsync({
          projectId: id,
          data: action === 'approve' ? { approved: true, hidden: false } : action === 'decline' ? { approved: false } : { hidden: action === 'hide' },
        });
      } else {
        await message.mutateAsync({ messageId: id, data: { hidden: action === 'hide' } });
      }
      onResult(isProject
        ? action === 'approve' ? `Project ${id} approved.` : action === 'decline' ? `Project ${id} declined after review.` : `Project ${id} ${action === 'hide' ? 'hidden' : 'unhidden'}.`
        : `Message ${id} ${action === 'hide' ? 'hidden' : 'unhidden'}.`);
      // These views reflect moderation state; refresh all three, including the current table.
      await Promise.all((['summary', 'queues', 'messages'] as AdminSection[]).map(sectionId =>
        queryClient.invalidateQueries({ queryKey: getGetAdminTableQueryKey(sectionId) })
      ));
    } catch {
      onResult(`Could not update ${isProject ? 'project' : 'message'} ${id}. Please try again.`, true);
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }

  return <div className="admin-row-actions">
    {isProject && !approved && !projectHidden && <button type="button" disabled={working} onClick={() => void review('approve')} data-testid={`button-approve-project-${id}`}>Approve</button>}
    {isProject && !approved && !projectHidden && (row[statusIndex] ?? '').toLowerCase() !== 'declined' && <button type="button" disabled={working} onClick={() => void review('decline')} data-testid={`button-decline-project-${id}`}>Decline</button>}
    <button type="button" disabled={working} onClick={() => void review((isProject ? projectHidden : messageHidden) ? 'unhide' : 'hide')} data-testid={`button-${(isProject ? projectHidden : messageHidden) ? 'unhide' : 'hide'}-${isProject ? 'project' : 'message'}-${id}`}>
      {(isProject ? projectHidden : messageHidden) ? 'Unhide' : 'Hide'}
    </button>
    {working && <span className="admin-action-progress" role="status">Saving…</span>}
  </div>;
}

type AdminReviewAnswer = string | number | boolean | string[] | null;
type AdminPitchReviewResponse = {
  project: {
    id: number;
    title?: string | null;
    format?: string | null;
    genre?: string | null;
    genre_other?: string | null;
    stage?: string | null;
    stage_other?: string | null;
    logline?: string | null;
    team_links?: string[] | null;
    team_info?: string | null;
    money_use?: string | null;
    distribution_plan?: string | null;
    pilot_url?: string | null;
    short_pilot_url?: string | null;
    budget?: number | null;
    budget_from_example?: boolean | null;
    deal_answer?: string | null;
    offer_per100?: number | null;
    proposal?: Parameters<typeof ProposalSummary>[0]['proposal'];
    offer_other_text?: string | null;
    wants_lower?: boolean | null;
    payback_terms?: string | null;
    payback_terms_other?: string | null;
    funding_sources?: string[] | null;
    funding_other?: string | null;
    reached_goal?: boolean | null;
    funding_experience?: string | null;
  };
  filmmaker: {
    [key: string]: unknown;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    favorite_genres?: string[] | null;
    chat_opt_in?: boolean | null;
  };
  materials: {
    synopsis?: string | null;
    trailer_url?: string | null;
    pilot_url?: string | null;
    short_pilot_url?: string | null;
    uploaded_video_url?: string | null;
    trailer_thumbnail_url?: string | null;
    poster_url?: string | null;
    share_image_url?: string | null;
    pitch_deck_url?: string | null;
    pitch_deck_name?: string | null;
    pitch_deck_status?: string | null;
  };
  answers: Record<string, AdminReviewAnswer>;
};

function safeAdminMediaUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function AdminImageAttachment({ label, value }: { label: string; value: string | null | undefined }) {
  const [failed, setFailed] = useState(false);
  const url = safeAdminMediaUrl(value);
  if (!url) return <div className="admin-detail-attachment"><strong>{label}</strong><p>{value ? 'Attachment URL is unavailable or invalid.' : 'No file attached.'}</p></div>;
  return <div className="admin-detail-attachment">
    <strong>{label}</strong>
    {failed ? <p role="status">Preview unavailable. Open the image directly to check it.</p> : <img src={url} alt={`${label} attachment`} onError={() => setFailed(true)} style={{ display: 'block', maxWidth: '100%', maxHeight: 360, objectFit: 'contain', margin: '12px 0' }}/>}
    <a href={url} target="_blank" rel="noopener noreferrer">Open {label.toLowerCase()} <ArrowUpRight size={13} style={{ display: 'inline' }}/></a>
  </div>;
}

function AdminLinkAttachment({ label, value }: { label: string; value: string | null | undefined }) {
  const url = safeAdminMediaUrl(value);
  return <div className="admin-detail-attachment">
    <strong>{label}</strong>
    {url
      ? <a href={url} target="_blank" rel="noopener noreferrer">Open {label.toLowerCase()} <ArrowUpRight size={13} style={{ display: 'inline' }}/></a>
      : <p>{value ? `${label} attachment is unavailable or invalid.` : `No ${label.toLowerCase()} attached.`}</p>}
  </div>;
}

function adminDeckPath(value: string) {
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
    throw new Error('The protected deck URL is not an application API route.');
  }
  return `${url.pathname}${url.search}`;
}

function AdminPitchReview({ projectId }: { projectId: number }) {
  const [open, setOpen] = useState(false);
  const [deckError, setDeckError] = useState('');
  const [openingDeck, setOpeningDeck] = useState(false);
  const details = useGetAdminProjectReview(projectId, {
    query: {
      queryKey: ['admin-project-pitch-details', projectId],
      enabled: open,
      retry: false,
    },
  });

  async function viewDeck() {
    const deckUrl = details.data?.materials.pitch_deck_url;
    if (!deckUrl || openingDeck) return;
    setDeckError('');
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setDeckError('Your browser blocked the pitch deck tab. Allow pop-ups for this site and try again.');
      return;
    }
    setOpeningDeck(true);
    tab.document.title = 'Loading protected pitch deck…';
    try {
      const blob = await customFetch<Blob>(adminDeckPath(deckUrl), { responseType: 'blob' });
      if (!blob.size) throw new Error('The deck response was empty.');
      const objectUrl = URL.createObjectURL(blob);
      tab.location.href = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60_000);
    } catch {
      tab.close();
      setDeckError('The protected pitch deck could not be loaded. Your administrator access may have expired; refresh this review and try again.');
    } finally {
      setOpeningDeck(false);
    }
  }

  // Generated schema catches up with this admin-only payload as the contract is regenerated.
  const data = details.data as unknown as AdminPitchReviewResponse | undefined;
  const project = data?.project;
  const filmmaker = data?.filmmaker;
  const materials = data?.materials;
  const answerRows: [string, unknown][] = project ? [
    ['Title', project.title], ['Format', project.format], ['Genre', project.genre_other || project.genre],
    ['Stage', project.stage_other ? `${project.stage || 'Other'} — ${project.stage_other}` : project.stage],
    ['Logline', project.logline], ['Team information', project.team_info], ['Team links', project.team_links],
    ['How the money would be used', project.money_use], ['Distribution plan', project.distribution_plan],
    ['Budget', project.budget == null ? null : `${project.budget_from_example ? 'Illustrative example' : 'Submitted'} · ${project.budget}`],
    ['Deal answer', project.deal_answer], ['Offer per $100', project.offer_per100],
    ['Other offer terms', project.offer_other_text], ['Wants lower offer', project.wants_lower],
    ['Payback terms', project.payback_terms_other || project.payback_terms],
    ['Funding sources', project.funding_sources], ['Other funding source', project.funding_other],
    ['Reached funding goal', project.reached_goal], ['Funding experience', project.funding_experience],
  ] : [];
  const adminAnswerRows = Object.entries(data?.answers ?? {});
  const filmmakerAdditionalRows = Object.entries(filmmaker ?? {}).filter(([key]) =>
    !['name', 'email', 'phone', 'city', 'state', 'country', 'favorite_genres', 'chat_opt_in'].includes(key)
  );

  return <>
    <button type="button" className="admin-button secondary" data-testid={`button-open-pitch-review-${projectId}`} onClick={() => setOpen(true)}><Eye size={14}/> Review pitch</button>
    {open && <div role="dialog" aria-modal="true" aria-label={`Pitch review ${projectId}`} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#18202b]/80 p-3 md:p-8" data-testid={`dialog-pitch-review-${projectId}`}>
      <div className="my-auto w-full max-w-5xl bg-[#f7f4ed] p-5 shadow-2xl md:p-9">
        <div className="flex items-start justify-between gap-5">
          <div><p className="admin-overline admin-mono">Authorized pitch review / {projectId}</p><h2 className="admin-page-title">{project?.title || 'Submitted pitch details'}</h2><p>Private administration view. These details and attachments are only loaded after server authorization.</p></div>
          <button type="button" className="admin-button secondary" aria-label="Close pitch review" data-testid={`button-close-pitch-review-${projectId}`} onClick={() => setOpen(false)}><X size={17}/></button>
        </div>
        {details.isPending && <Skeleton compact/>}
        {details.isError && <Notice icon={<ShieldAlert size={20}/>} title="Submitted pitch details unavailable" action="Try again" onAction={() => void details.refetch()}>The protected review record could not be retrieved. No details are being shown until the authenticated request succeeds.</Notice>}
        {data && <>
          <section className="mt-7">
            <h3 className="admin-overline admin-mono">Submitted answers</h3>
            <dl className="grid gap-4 md:grid-cols-2">
              {answerRows.map(([label, value]) => <div key={label} className="border-b border-[#c8c0b5] py-3"><dt className="admin-mono text-xs uppercase tracking-wider">{label}</dt><dd className="mt-2"><ReadableValue value={value} /></dd></div>)}
            </dl>
            <h3 className="admin-overline admin-mono mt-6">Saved proposal</h3>
            <ProposalSummary proposal={project?.proposal} legacyRepayment={project?.offer_per100} budget={project?.budget} stage={project?.stage} testId="admin-proposal"/>
            <p className="mt-3" data-testid="text-no-repayment-schedule">
              {!project?.payback_terms_other && !project?.offer_other_text && !project?.proposal?.note
                ? 'No fixed repayment schedule provided; repayment is revenue-dependent.'
                : 'No fixed repayment schedule is recorded in the structured proposal; repayment is revenue-dependent. Any proposed timing in notes is shown verbatim and must be reviewed separately.'}
              {' '}Backend years are not a repayment deadline.
            </p>
          </section>
          <section className="mt-8">
            <h3 className="admin-overline admin-mono">Filmmaker contact details</h3>
            <dl className="grid gap-4 md:grid-cols-2">
              {([['Name', filmmaker?.name], ['Email', filmmaker?.email], ['Phone', filmmaker?.phone], ['City', filmmaker?.city], ['State / region', filmmaker?.state], ['Country', filmmaker?.country], ['Favorite genres', filmmaker?.favorite_genres], ['Chat opt-in', filmmaker?.chat_opt_in]] as [string, AdminReviewAnswer | undefined][]).map(([label, value]) => {
                if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
                return <div key={label} className="border-b border-[#c8c0b5] py-3"><dt className="admin-mono text-xs uppercase tracking-wider">{label}</dt><dd className="mt-2 whitespace-pre-wrap break-words">{Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value)}</dd></div>;
              })}
            </dl>
          </section>
          {adminAnswerRows.length > 0 && <details className="admin-evidence-fold mt-8" data-testid="details-admin-raw-answers">
            <summary>All submitted answers · full record</summary>
            <dl className="grid gap-4 md:grid-cols-2">
              {adminAnswerRows.map(([key, value]) => <div key={key} className="border-b border-[#c8c0b5] py-3"><dt className="admin-mono text-xs uppercase tracking-wider">{key.replace(/_/g, ' ')}</dt><dd className="mt-2"><ReadableValue value={value}/></dd></div>)}
            </dl>
          </details>}
          {filmmakerAdditionalRows.length > 0 && <section className="mt-8">
            <h3 className="admin-overline admin-mono">Additional filmmaker details</h3>
            <dl className="grid gap-4 md:grid-cols-2">
              {filmmakerAdditionalRows.map(([key, value]) => <div key={key} className="border-b border-[#c8c0b5] py-3"><dt className="admin-mono text-xs uppercase tracking-wider">{key.replace(/_/g, ' ')}</dt><dd className="mt-2"><ReadableValue value={value}/></dd></div>)}
            </dl>
          </section>}
          <section className="mt-8">
            <h3 className="admin-overline admin-mono">Submitted attachments</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="admin-detail-attachment"><strong>Full synopsis</strong><p className="whitespace-pre-wrap">{materials?.synopsis || 'No synopsis provided.'}</p></div>
              <AdminImageAttachment label="Poster" value={materials?.poster_url}/>
              <AdminImageAttachment label="Share image" value={materials?.share_image_url}/>
              <AdminLinkAttachment label="Trailer" value={materials?.trailer_url}/>
              <AdminLinkAttachment label="Uploaded video" value={materials?.uploaded_video_url}/>
              <AdminLinkAttachment label="Short-pilot link" value={materials?.pilot_url || materials?.short_pilot_url || project?.pilot_url || project?.short_pilot_url || null}/>
              <div className="admin-detail-attachment">
                <strong>Pitch deck</strong>
                {materials?.pitch_deck_url
                  ? <><p>{materials.pitch_deck_name || 'Pitch deck PDF'}{materials.pitch_deck_status ? ` · ${materials.pitch_deck_status}` : ''}</p><button type="button" className="admin-button secondary" data-testid={`button-view-admin-pitch-deck-${projectId}`} disabled={openingDeck} onClick={() => void viewDeck()}><FileText size={14}/>{openingDeck ? 'Loading protected PDF…' : 'View pitch deck'}</button>{deckError && <p role="alert" className="admin-feedback">{deckError}</p>}</>
                  : <p>{materials?.pitch_deck_status ? `Pitch deck unavailable · ${materials.pitch_deck_status}` : 'No pitch deck attached.'}</p>}
              </div>
              <AdminImageAttachment label="Trailer preview image" value={materials?.trailer_thumbnail_url}/>
            </div>
          </section>
          <PitchProvenance projectId={projectId} data={data as unknown as Record<string, unknown>}/>
          <ReviewNotesForm key={projectId} projectId={projectId} notes={((data as unknown as Record<string, unknown>).review_notes as Record<string, unknown> | null) ?? null}/>
        </>}
      </div>
    </div>}
  </>;
}

function SectionData({ section, userId }: { section: (typeof SECTIONS)[number]; userId: string }) {
  const [result, setResult] = useState<{ message: string; failed: boolean } | null>(null);
  const { data, isPending, isError, error, refetch, isFetching } = useGetAdminTable(section.id, {
    query: { queryKey: [...getGetAdminTableQueryKey(section.id), userId], retry: false, staleTime: 20_000, refetchOnWindowFocus: true },
  });
  if (isPending) return <div style={{ paddingTop: 30 }}><Skeleton /></div>;
  return <>
    <div className="admin-data-head">
      <h2 data-testid="text-table-title">{section.id === 'queues' ? 'Showcase requests and other queues' : data?.title || section.label}</h2>
      <span className="admin-mono admin-count" data-testid="text-row-total">{data ? `${data.total.toLocaleString()} ${data.total === 1 ? 'record' : 'records'}` : 'Unavailable'}</span>
    </div>
    {section.id === 'queues' && <p data-testid="text-showcase-queue-guidance">Paid pitch reviews appear as “Showcase request” with status “Awaiting review.” Earlier requests remain available without retroactive fees. Approval adds a pitch to public discovery; declining keeps its free page unlisted.</p>}
    {result?.message && <p className={`admin-review-feedback ${result.failed ? 'error' : ''}`} role={result.failed ? 'alert' : 'status'} data-testid="status-review-result">{result.message}</p>}
    {isError ? <Notice icon={<ShieldAlert size={20} />} title="This view could not be loaded" action="Try again" onAction={() => void refetch()}>
      {error?.status === 403 ? 'Access to this data was denied. Your account may no longer have administrator access.' : 'The connection to this section failed. Your other sections are still available.'}
    </Notice> : data?.rows.length ? <div className="admin-table-wrap">
      <table className="admin-table" data-testid={`table-${section.id}`}>
        <thead><tr>{data.columns.map((column, i) => <th scope="col" key={`${column}-${i}`}>{column}</th>)}{(section.id === 'queues' || section.id === 'messages') && <th scope="col">Actions</th>}{section.id === 'queues' && <th scope="col">Pitch review</th>}</tr></thead>
        <tbody>{data.rows.map((row, i) => <tr key={`${row[row.length - 1] ?? ''}-${i}`} data-testid={`row-${section.id}-${i}`}>
          {data.columns.map((column, j) => {
            const value = row[j] ?? '';
            const isShowcaseQueue = section.id === 'queues' && column.trim().toLowerCase() === 'queue' && value.trim().toLowerCase() === 'approval';
            const isWaitingShowcase = section.id === 'queues' && column.trim().toLowerCase() === 'status' && row[columnIndex(data.columns, /^queue$/i)]?.trim().toLowerCase() === 'approval' && value.trim().toLowerCase() === 'pending';
            return <td key={j}>{isShowcaseQueue ? 'Showcase request' : isWaitingShowcase ? 'Awaiting review' : value}</td>;
          })}
          {(section.id === 'queues' || section.id === 'messages') && <td><ReviewActions section={section.id} row={row} columns={data.columns} onResult={(message, failed = false) => setResult({ message, failed })} /></td>}
          {section.id === 'queues' && <td>{row[columnIndex(data.columns, /^queue$/i)]?.trim().toLowerCase() === 'approval' && numericId(row[columnIndex(data.columns, /^project id$/i)]) !== null
            ? <AdminPitchReview projectId={numericId(row[columnIndex(data.columns, /^project id$/i)])!}/>
            : <span className="admin-action-na">—</span>}</td>}
        </tr>)}</tbody>
      </table>
    </div> : <Notice icon={<Clapperboard size={20} />} title="Nothing recorded here yet">
      When submissions reach this section, the actual records will appear here. An empty CSV with the table headers is still available.
    </Notice>}
    <p className="admin-footnote">{isFetching ? 'Checking for updates…' : 'Showing data returned by the administration API.'} Expressions of interest are non-binding; this site does not collect funds.</p>
  </>;
}

function Dashboard({ userId, email, onSignOut }: { userId: string; email: string; onSignOut: () => void }) {
  const [active, setActive] = useState<AdminSection>('summary');
  const [conversationMode, setConversationMode] = useState(false);
  const [investorMode, setInvestorMode] = useState(false);
  const section = SECTIONS.find(item => item.id === active)!;
  // The active table is read here for the export control; SectionData shares its query cache.
  const { data, isFetching } = useGetAdminTable(active, {
    query: { queryKey: [...getGetAdminTableQueryKey(active), userId], retry: false, staleTime: 20_000, refetchOnWindowFocus: true },
  });
  return <Frame email={email} onSignOut={onSignOut}>
    <div className="admin-stage">
      <aside className="admin-sidebar" aria-label="Administration sections">
        <div className="admin-sidebar-label admin-mono">Index / 12 views</div>
        <nav className="admin-nav" aria-label="Data sections">
          {SECTIONS.map((item, i) => <button key={item.id} type="button" aria-current={!conversationMode && active === item.id ? 'page' : undefined} onClick={() => { setActive(item.id); setConversationMode(false); setInvestorMode(false); }} data-testid={`button-section-${item.id}`}>
            <span className="admin-nav-number">{String(i + 1).padStart(2, '0')}</span>{item.label}
          </button>)}
          <button type="button" aria-current={conversationMode ? 'page' : undefined} onClick={() => { setConversationMode(true); setInvestorMode(false); }} data-testid="button-section-conversations"><span className="admin-nav-number">11</span>Conversations</button>
          <button type="button" aria-current={investorMode ? 'page' : undefined} onClick={() => { setInvestorMode(true); setConversationMode(false); }} data-testid="button-section-investors"><span className="admin-nav-number">12</span>Investors</button>
        </nav>
          <div className="admin-sidebar-foot">Private administration<br />{email}<br /><br />No payments are collected here.</div>
      </aside>
      <main className="admin-main">
        <div className="admin-main-inner">
          <div className="admin-title-row">
            <div>
               <div className="admin-overline admin-mono">Administration / {investorMode ? '12' : conversationMode ? '11' : String(SECTIONS.indexOf(section) + 1).padStart(2, '0')}</div>
               <h1 className="admin-page-title" data-testid="text-section-heading">{investorMode ? 'Investors' : conversationMode ? 'Conversations' : section.label}</h1>
               <p className="admin-lede">{investorMode ? 'Private self-reported intake and non-binding interest. Not KYC, accreditation verification or approval to invest.' : conversationMode ? 'Project threads, reports, and auditable moderation actions.' : section.description}</p>
            </div>
             {!conversationMode && !investorMode && <button type="button" className="admin-button" disabled={!data || isFetching} onClick={() => data && downloadCsv(data, active)} data-testid={`button-download-${active}`} title={!data ? 'Available when this section loads' : `Download ${section.label} as CSV`}>
              <ArrowDownToLine size={16} /> Download CSV
             </button>}
          </div>
            {investorMode ? <AdminInvestors key={userId} userId={userId}/> : conversationMode ? <AdminConversations uid={userId}/> : <SectionData key={`${active}-${userId}`} section={section} userId={userId} />}
        </div>
      </main>
    </div>
  </Frame>;
}

export default function Admin() {
  const queryClient = useQueryClient();
  const replitAuth = useAuth();
  const { data: config, isPending: configPending, isError: configError, refetch: retryConfig } = useGetFirebaseConfig({
    query: { queryKey: getGetFirebaseConfigQueryKey(), retry: false, staleTime: 300_000 },
  });
  const [auth, setAuth] = useState<Auth | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [feedback, setFeedback] = useState('');
  const previousUid = useRef<string | null>(null);

  useEffect(() => {
    document.title = 'Administration | Movie Show Investing';
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'robots'; document.head.append(meta); }
    meta.content = 'noindex, nofollow';
    return () => { meta?.remove(); };
  }, []);

  useEffect(() => {
    if (!config?.apiKey || !config.authDomain || !config.projectId || !config.appId) return;
    try {
      const app = getApps().some(existing => existing.name === APP_NAME)
        ? getApp(APP_NAME)
        : initializeApp({ apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId, appId: config.appId }, APP_NAME);
      setAuth(getAuth(app));
    } catch {
      setFeedback('Firebase could not be initialized. Check the web configuration and try again.');
    }
  }, [config]);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, next => {
      if (previousUid.current !== next?.uid) {
        if (previousUid.current !== null || next) queryClient.clear();
        previousUid.current = next?.uid ?? null;
      }
      setAuthTokenGetter(next && !isReplitAuthActive() && !isReplitAuthLoading() ? () => auth.currentUser?.getIdToken() ?? null : null);
      setUser(next);
      setAuthReady(true);
    }, () => {
      setAuthTokenGetter(null);
      setAuthReady(true);
      setFeedback('The sign-in session could not be restored. Please try signing in again.');
    });
  }, [auth, queryClient]);

  useEffect(() => {
    if (!replitAuth.user) return;
    setAuthTokenGetter(null);
    queryClient.clear();
  }, [replitAuth.user?.id, queryClient]);

  useEffect(() => {
    if (replitAuth.isLoading) {
      setAuthTokenGetter(null);
    } else if (!replitAuth.user && auth?.currentUser) {
      setAuthTokenGetter(() => auth.currentUser?.getIdToken() ?? null);
    }
  }, [auth, replitAuth.isLoading, replitAuth.user?.id]);

  const identityId = replitAuth.user?.id ?? user?.uid;
  const identityEmail = replitAuth.user?.email ?? user?.email ?? '';
  const identityReady = !replitAuth.isLoading && (Boolean(replitAuth.user) || (Boolean(user) && authReady));
  const me = useGetAdminMe({
    query: { queryKey: [...getGetAdminMeQueryKey(), identityId], enabled: !!identityId && identityReady, retry: false, staleTime: 30_000, refetchOnWindowFocus: true },
  });

  async function leave() {
    if (replitAuth.user) {
      queryClient.clear();
      replitAuth.logout('/admin');
      return;
    }
    if (auth) {
      try {
        await leaveFilmmakerAccount();
      } catch {
        setFeedback('Your browser session could not be safely rotated, so sign-out was stopped. You are still signed in; please try again.');
        return;
      }
      try {
        await signOut(auth);
        setAuthTokenGetter(null);
        clearPrivateData(queryClient);
        setUser(null);
      }
      catch { setFeedback('Sign-out could not be completed. Please try again.'); }
    }
  }

  if (replitAuth.isLoading) return <Frame><div className="admin-auth-panel" style={{ minHeight: 'calc(100dvh - 76px)' }}><div style={{ width: 'min(100%, 520px)' }}><Skeleton /></div></div></Frame>;
  if (!replitAuth.user && !user && configPending) return <Frame><div className="admin-auth-panel" style={{ minHeight: 'calc(100dvh - 76px)' }}><div style={{ width: 'min(100%, 520px)' }}><Skeleton /></div></div></Frame>;
  if (!replitAuth.user && !user && (configError || (config && (!config.apiKey || !config.authDomain || !config.projectId || !config.appId)))) return <Frame><div className="admin-auth-panel" style={{ minHeight: 'calc(100dvh - 76px)' }}><div style={{ width: 'min(100%, 520px)' }}>
    <Notice icon={<ShieldAlert size={20} />} title="Sign-in is not configured" action="Check again" onAction={() => void retryConfig()}>
      The administration room needs the site's Firebase web configuration before Google sign-in can work. Public pages remain available.
    </Notice>
    {feedback && <p className="admin-feedback" role="alert">{feedback}</p>}
    <GoogleSignInButton auth={auth} queryClient={queryClient} className="admin-button" testId="button-admin-google-sign-in" />
  </div></div></Frame>;
  if (!replitAuth.user && !user && (!auth || !authReady)) return <Frame><div className="admin-auth-panel" style={{ minHeight: 'calc(100dvh - 76px)' }}><div style={{ width: 'min(100%, 520px)' }}>{feedback ? <Notice icon={<ShieldAlert size={20} />} title="Sign-in unavailable">{feedback}</Notice> : <Skeleton />}<GoogleSignInButton auth={auth} queryClient={queryClient} disabled={replitAuth.isLoading} className="admin-button" testId="button-admin-google-sign-in" label="Sign in" /></div></div></Frame>;
  if (identityReady && identityId) {
    if (me.isPending) return <Frame email={identityEmail || undefined} onSignOut={leave}><div className="admin-auth-panel" style={{ minHeight: 'calc(100dvh - 76px)' }}><div style={{ width: 'min(100%, 520px)' }}><Skeleton /></div></div></Frame>;
    if (me.isError) return <Frame email={identityEmail || undefined} onSignOut={leave}><div className="admin-auth-panel" style={{ minHeight: 'calc(100dvh - 76px)' }}><div style={{ width: 'min(100%, 520px)' }}>
      <Notice icon={<ShieldAlert size={20} />} title={me.error?.status === 403 ? 'Access not granted' : 'Access could not be verified'} action={me.error?.status === 403 ? undefined : 'Try again'} onAction={me.error?.status === 403 ? undefined : () => void me.refetch()}>
        {me.error?.status === 403 ? 'This signed-in address does not have administrator access. Only the server can grant access to the private workspace. Use Sign out in the header to try another account.' : 'We could not confirm your administrator access right now. No private data has been shown.'}
      </Notice>
      {feedback && <p className="admin-feedback" role="alert">{feedback}</p>}
    </div></div></Frame>;
    if (me.data?.role === 'admin') return <Dashboard userId={identityId} email={me.data.email} onSignOut={leave} />;
    return <Frame email={identityEmail || undefined} onSignOut={leave}><div className="admin-auth-panel" style={{ minHeight: 'calc(100dvh - 76px)' }}><div style={{ width: 'min(100%, 520px)' }}><Notice icon={<ShieldAlert size={20} />} title="Access not granted">This account does not have administrator access. Use Sign out in the header to try another account.</Notice>{feedback && <p className="admin-feedback" role="alert">{feedback}</p>}</div></div></Frame>;
  }

  return <Frame>
    <div className="admin-auth">
      <div className="admin-auth-art">
        <span className="admin-mono" style={{ color: '#d9b777' }}>Private access / Movie Show Investing</span>
        <h1>Behind<br />the <em>frame.</em></h1>
        <p>A focused place to understand the signals behind independent film. Private, measured, and grounded in real submissions.</p>
        <span className="admin-mono" style={{ color: '#a9abb0' }}>No investments or payments take place here.</span>
      </div>
      <div className="admin-auth-panel">
        <div className="admin-auth-card">
          <div className="admin-overline admin-mono">Restricted access</div>
          <h2>Welcome back.</h2>
          <p>Sign in with Google to continue. Administrator access is verified by the server after sign-in.</p>
          {feedback && <p className="admin-feedback" role="alert" data-testid="status-auth-error">{feedback}</p>}
          <GoogleSignInButton auth={auth} queryClient={queryClient} className="admin-button" testId="button-admin-google-sign-in" label="Sign in" />
          <p className="admin-auth-note"><LockKeyhole size={13} style={{ display: 'inline', marginRight: 8 }} />Access is verified by the server after you sign in.</p>
        </div>
      </div>
    </div>
  </Frame>;
}