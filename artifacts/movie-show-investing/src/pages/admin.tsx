import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signOut, type Auth, type User,
} from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminMeQueryKey, getGetAdminTableQueryKey, getGetFirebaseConfigQueryKey, getGetAdminConversationsQueryKey,
  leaveFilmmakerAccount, setAuthTokenGetter, useGetAdminMe, useGetAdminTable, useGetFirebaseConfig,
  useReviewAdminProject, useReviewAdminMessage,
  type AdminSection, type AdminTable,
} from '@workspace/api-client-react';
import { ArrowDownToLine, ArrowRight, Clapperboard, LockKeyhole, LogOut, ShieldAlert } from 'lucide-react';
import { AdminConversations } from '@/components/admin-conversations';
import { useAuth } from '@workspace/replit-auth-web';
import { isReplitAuthActive, isReplitAuthLoading } from '@workspace/replit-auth-web';
import { GoogleSignInButton } from '@/components/google-sign-in-button';

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

  async function review(action: 'approve' | 'hide' | 'unhide') {
    if (id === null || lock.current) return;
    lock.current = true;
    setWorking(true);
    onResult('');
    try {
      if (isProject) {
        await project.mutateAsync({
          projectId: id,
          data: action === 'approve' ? { approved: true, hidden: false } : { hidden: action === 'hide' },
        });
      } else {
        await message.mutateAsync({ messageId: id, data: { hidden: action === 'hide' } });
      }
      onResult(isProject
        ? action === 'approve' ? `Project ${id} approved.` : `Project ${id} ${action === 'hide' ? 'hidden' : 'unhidden'}.`
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
    <button type="button" disabled={working} onClick={() => void review((isProject ? projectHidden : messageHidden) ? 'unhide' : 'hide')} data-testid={`button-${(isProject ? projectHidden : messageHidden) ? 'unhide' : 'hide'}-${isProject ? 'project' : 'message'}-${id}`}>
      {(isProject ? projectHidden : messageHidden) ? 'Unhide' : 'Hide'}
    </button>
    {working && <span className="admin-action-progress" role="status">Saving…</span>}
  </div>;
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
    {section.id === 'queues' && <p data-testid="text-showcase-queue-guidance">Showcase requests awaiting review appear as “Showcase request” with status “Awaiting review.” Approved requests are eligible for discovery only while the project is not hidden.</p>}
    {result?.message && <p className={`admin-review-feedback ${result.failed ? 'error' : ''}`} role={result.failed ? 'alert' : 'status'} data-testid="status-review-result">{result.message}</p>}
    {isError ? <Notice icon={<ShieldAlert size={20} />} title="This view could not be loaded" action="Try again" onAction={() => void refetch()}>
      {error?.status === 403 ? 'Access to this data was denied. Your account may no longer have administrator access.' : 'The connection to this section failed. Your other sections are still available.'}
    </Notice> : data?.rows.length ? <div className="admin-table-wrap">
      <table className="admin-table" data-testid={`table-${section.id}`}>
        <thead><tr>{data.columns.map((column, i) => <th scope="col" key={`${column}-${i}`}>{column}</th>)}{(section.id === 'queues' || section.id === 'messages') && <th scope="col">Actions</th>}</tr></thead>
        <tbody>{data.rows.map((row, i) => <tr key={`${row[row.length - 1] ?? ''}-${i}`} data-testid={`row-${section.id}-${i}`}>
          {data.columns.map((column, j) => {
            const value = row[j] ?? '';
            const isShowcaseQueue = section.id === 'queues' && column.trim().toLowerCase() === 'queue' && value.trim().toLowerCase() === 'approval';
            const isWaitingShowcase = section.id === 'queues' && column.trim().toLowerCase() === 'status' && row[columnIndex(data.columns, /^queue$/i)]?.trim().toLowerCase() === 'approval' && value.trim().toLowerCase() === 'pending';
            return <td key={j}>{isShowcaseQueue ? 'Showcase request' : isWaitingShowcase ? 'Awaiting review' : value}</td>;
          })}
          {(section.id === 'queues' || section.id === 'messages') && <td><ReviewActions section={section.id} row={row} columns={data.columns} onResult={(message, failed = false) => setResult({ message, failed })} /></td>}
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
  const section = SECTIONS.find(item => item.id === active)!;
  // The active table is read here for the export control; SectionData shares its query cache.
  const { data, isFetching } = useGetAdminTable(active, {
    query: { queryKey: [...getGetAdminTableQueryKey(active), userId], retry: false, staleTime: 20_000, refetchOnWindowFocus: true },
  });
  return <Frame email={email} onSignOut={onSignOut}>
    <div className="admin-stage">
      <aside className="admin-sidebar" aria-label="Administration sections">
        <div className="admin-sidebar-label admin-mono">Index / 10 views</div>
        <nav className="admin-nav" aria-label="Data sections">
          {SECTIONS.map((item, i) => <button key={item.id} type="button" aria-current={!conversationMode && active === item.id ? 'page' : undefined} onClick={() => { setActive(item.id); setConversationMode(false); }} data-testid={`button-section-${item.id}`}>
            <span className="admin-nav-number">{String(i + 1).padStart(2, '0')}</span>{item.label}
          </button>)}
          <button type="button" aria-current={conversationMode ? 'page' : undefined} onClick={() => setConversationMode(true)} data-testid="button-section-conversations"><span className="admin-nav-number">11</span>Conversations</button>
        </nav>
          <div className="admin-sidebar-foot">Private administration<br />{email}<br /><br />No payments are collected here.</div>
      </aside>
      <main className="admin-main">
        <div className="admin-main-inner">
          <div className="admin-title-row">
            <div>
               <div className="admin-overline admin-mono">Administration / {conversationMode ? '11' : String(SECTIONS.indexOf(section) + 1).padStart(2, '0')}</div>
               <h1 className="admin-page-title" data-testid="text-section-heading">{conversationMode ? 'Conversations' : section.label}</h1>
               <p className="admin-lede">{conversationMode ? 'Project threads, reports, and auditable moderation actions.' : section.description}</p>
            </div>
             {!conversationMode && <button type="button" className="admin-button" disabled={!data || isFetching} onClick={() => data && downloadCsv(data, active)} data-testid={`button-download-${active}`} title={!data ? 'Available when this section loads' : `Download ${section.label} as CSV`}>
              <ArrowDownToLine size={16} /> Download CSV
             </button>}
          </div>
            {conversationMode ? <AdminConversations uid={userId}/> : <SectionData key={`${active}-${userId}`} section={section} userId={userId} />}
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