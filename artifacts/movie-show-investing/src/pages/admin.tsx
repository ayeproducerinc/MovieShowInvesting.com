import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { FirebaseError, getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth, isSignInWithEmailLink, onAuthStateChanged, sendSignInLinkToEmail,
  signInWithEmailLink, signOut, type Auth, type User,
} from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminMeQueryKey, getGetAdminTableQueryKey, getGetFirebaseConfigQueryKey, getGetAdminConversationsQueryKey,
  leaveFilmmakerAccount, setAuthTokenGetter, useGetAdminMe, useGetAdminTable, useGetFirebaseConfig,
  useReviewAdminProject, useReviewAdminMessage,
  type AdminSection, type AdminTable,
} from '@workspace/api-client-react';
import { ArrowDownToLine, ArrowRight, Clapperboard, LockKeyhole, LogOut, Mail, RotateCw, ShieldAlert } from 'lucide-react';
import { AdminConversations } from '@/components/admin-conversations';
import { useAuth } from '@workspace/replit-auth-web';
import { isReplitAuthActive, isReplitAuthLoading } from '@workspace/replit-auth-web';
import { switchToFirebase, switchToSso } from '@/lib/auth-switch';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { getInitializedAuth } from '@/components/firebase-bootstrap';

const SECTIONS: { id: AdminSection; label: string; description: string }[] = [
  { id: 'summary', label: 'Summary', description: 'A consolidated view of activity recorded across the site.' },
  { id: 'pledges', label: 'Pledges by project', description: 'Non-binding expressions of interest, organized by project.' },
  { id: 'location', label: 'By location', description: 'Where submitted interest and activity are coming from.' },
  { id: 'funnels', label: 'Funnels', description: 'A view of progress through the filmmaker and investor journeys.' },
  { id: 'market', label: 'Market', description: 'Responses that help characterize the emerging market.' },
  { id: 'price-test', label: 'Price test', description: 'Results from the current price-test assignment.' },
  { id: 'queues', label: 'Queues', description: 'Submissions awaiting the next step.' },
  { id: 'messages', label: 'Messages', description: 'Messages received through the site.' },
  { id: 'channels', label: 'Channels', description: 'Campaign and referral attribution in one place.' },
  { id: 'email-log', label: 'Email log', description: 'A record of outgoing email activity.' },
];
const EMAIL_KEY = 'msi_admin_email_link_address';
const APP_NAME = 'movie-show-investing';

function emailLinkError(error: unknown): string {
  const code = error instanceof FirebaseError ? error.code : null;
  switch (code) {
    case 'auth/operation-not-allowed':
      return 'Email-link sign-in is not enabled in Firebase. In Firebase Authentication → Sign-in method, enable Email/Password and Email link (passwordless sign-in).';
    case 'auth/configuration-not-found':
      return 'Firebase Authentication is not set up for this project. Enable Authentication and Email link (passwordless sign-in) in the Firebase console.';
    case 'auth/unauthorized-domain':
    case 'auth/unauthorized-continue-uri':
    case 'auth/invalid-continue-uri':
      return 'Firebase has not authorized this app’s return address. Add this preview domain under Firebase Authentication → Settings → Authorized domains.';
    case 'auth/invalid-email':
      return 'Firebase says this email address is not valid. Check the spelling and try again.';
    case 'auth/invalid-api-key':
    case 'auth/app-not-authorized':
    case 'auth/project-not-found':
      return `The Firebase web configuration needs attention (${code}). The site owner must check that the configured keys belong to the intended Firebase project.`;
    case 'auth/too-many-requests':
      return 'Firebase has temporarily limited sign-in requests. Please wait before trying again.';
    case 'auth/quota-exceeded':
      return 'This Firebase project has reached its email sign-in sending limit. Try again after the daily quota resets. The project owner can raise the limit by enabling Firebase billing, which may incur charges.';
    case 'auth/network-request-failed':
      return 'The request to Firebase could not connect. Check your connection and try again.';
    default:
      return code
        ? `Firebase could not send the sign-in link (${code}). Please share this error code so we can fix the setup.`
        : 'Firebase could not send the sign-in link. Please share what happened so we can investigate.';
  }
}

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
  const id = numericId(row[row.length - 1]);
  const eligible = !isProject || row[0]?.trim().toLowerCase() === 'approval';
  const { approved, hidden: projectHidden } = reviewStatus(row[5]);
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
      <h2 data-testid="text-table-title">{data?.title || section.label}</h2>
      <span className="admin-mono admin-count" data-testid="text-row-total">{data ? `${data.total.toLocaleString()} ${data.total === 1 ? 'record' : 'records'}` : 'Unavailable'}</span>
    </div>
    {result?.message && <p className={`admin-review-feedback ${result.failed ? 'error' : ''}`} role={result.failed ? 'alert' : 'status'} data-testid="status-review-result">{result.message}</p>}
    {isError ? <Notice icon={<ShieldAlert size={20} />} title="This view could not be loaded" action="Try again" onAction={() => void refetch()}>
      {error?.status === 403 ? 'Access to this data was denied. Your account may no longer have administrator access.' : 'The connection to this section failed. Your other sections are still available.'}
    </Notice> : data?.rows.length ? <div className="admin-table-wrap">
      <table className="admin-table" data-testid={`table-${section.id}`}>
        <thead><tr>{data.columns.map((column, i) => <th scope="col" key={`${column}-${i}`}>{column}</th>)}{(section.id === 'queues' || section.id === 'messages') && <th scope="col">Actions</th>}</tr></thead>
        <tbody>{data.rows.map((row, i) => <tr key={`${row[row.length - 1] ?? ''}-${i}`} data-testid={`row-${section.id}-${i}`}>
          {data.columns.map((_, j) => <td key={j}>{row[j] ?? ''}</td>)}
          {(section.id === 'queues' || section.id === 'messages') && <td><ReviewActions section={section.id} row={row} columns={data.columns} onResult={(message, failed = false) => setResult({ message, failed })} /></td>}
        </tr>)}</tbody>
      </table>
    </div> : <Notice icon={<Clapperboard size={20} />} title="Nothing recorded here yet">
      When submissions reach this section, the actual records will appear here. An empty CSV with the table headers is still available.
    </Notice>}
    <p className="admin-footnote">{isFetching ? 'Checking for updates…' : 'Showing data returned by the administration API.'} Expressions of interest are non-binding; this site does not collect funds.</p>
  </>;
}

function Dashboard({ userId, email, onSignOut, onSwitchIdentity, replitUser, replitLogout, authFeedback }: { userId: string; email: string; onSignOut: () => void; onSwitchIdentity: () => void; replitUser: boolean; replitLogout: (returnTo?: string) => void; authFeedback: string }) {
  const queryClient = useQueryClient();
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
         <div className="admin-sidebar-foot">Private administration<br />{email}<br /><br /><GoogleSignInButton auth={getInitializedAuth()} queryClient={queryClient} replitUser={replitUser} replitLogout={replitLogout} className="admin-link admin-mono" testId="button-admin-google-link" /><br /><br /><button type="button" className="admin-link admin-mono" onClick={onSwitchIdentity}>Use another sign-in method</button>{authFeedback && <p role="alert" className="admin-feedback">{authFeedback}</p>}<br />No payments are collected here.</div>
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
  const [email, setEmail] = useState('');
  const [completionEmail, setCompletionEmail] = useState(() => typeof window !== 'undefined' ? window.localStorage.getItem(EMAIL_KEY) : null);
  const [sentTo, setSentTo] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkHandled, setLinkHandled] = useState(false);
  const [completionAttempted, setCompletionAttempted] = useState(false);
  const previousUid = useRef<string | null>(null);
  const completionInFlight = useRef(false);
  const linkPresent = auth ? isSignInWithEmailLink(auth, window.location.href) && !linkHandled : false;
  const savedEmail = completionEmail;
  const adminUrl = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/admin`;

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

  useEffect(() => {
    if (!auth || !authReady || !linkPresent || !savedEmail || completionInFlight.current || completionAttempted) return;
    completionInFlight.current = true;
    setBusy(true);
    setFeedback('');
    signInWithEmailLink(auth, savedEmail, window.location.href).then(() => {
      window.localStorage.removeItem(EMAIL_KEY);
      setCompletionEmail(null);
      window.history.replaceState({}, '', `${window.location.origin}${window.location.pathname}`);
      setLinkHandled(true);
    }).catch(() => {
      setFeedback('This sign-in link could not be completed. It may have expired or been used already. Request a new link to continue.');
      setCompletionAttempted(true);
    }).finally(() => {
      setBusy(false);
      completionInFlight.current = false;
    });
  }, [auth, authReady, linkPresent, savedEmail, completionAttempted]);

  const identityId = replitAuth.user?.id ?? user?.uid;
  const identityEmail = replitAuth.user?.email ?? user?.email ?? '';
  const identityReady = !replitAuth.isLoading && (Boolean(replitAuth.user) || (Boolean(user) && authReady && !linkPresent && !busy));
  const me = useGetAdminMe({
    query: { queryKey: [...getGetAdminMeQueryKey(), identityId], enabled: !!identityId && identityReady, retry: false, staleTime: 30_000, refetchOnWindowFocus: true },
  });

  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !email.trim()) return;
    setBusy(true); setFeedback('');
    const normalized = email.trim();
    const previousEmail = window.localStorage.getItem(EMAIL_KEY);
    try {
      // Save before requesting the link: the callback can open as soon as it is delivered.
      window.localStorage.setItem(EMAIL_KEY, normalized);
      setCompletionEmail(normalized);
      await sendSignInLinkToEmail(auth, normalized, {
        url: adminUrl,
        handleCodeInApp: true,
      });
      setSentTo(normalized);
      if (linkPresent) {
        window.history.replaceState({}, '', `${window.location.origin}${window.location.pathname}`);
        setLinkHandled(true);
      }
      setCompletionAttempted(false);
    } catch (error) {
      if (previousEmail === null) window.localStorage.removeItem(EMAIL_KEY);
      else window.localStorage.setItem(EMAIL_KEY, previousEmail);
      setCompletionEmail(previousEmail);
      setFeedback(emailLinkError(error));
    } finally { setBusy(false); }
  }

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

  async function beginSso() {
    setFeedback('');
    const result = await switchToSso(auth, queryClient, replitAuth.login);
    if (!result.ok) setFeedback(result.message);
  }

  if (replitAuth.isLoading) return <Frame><div className="admin-auth-panel" style={{ minHeight: 'calc(100dvh - 76px)' }}><div style={{ width: 'min(100%, 520px)' }}><Skeleton /></div></div></Frame>;
  if (!replitAuth.user && configPending) return <Frame><div className="admin-auth-panel" style={{ minHeight: 'calc(100dvh - 76px)' }}><div style={{ width: 'min(100%, 520px)' }}><Skeleton /></div></div></Frame>;
  if (!replitAuth.user && (configError || (config && (!config.apiKey || !config.authDomain || !config.projectId || !config.appId)))) return <Frame><div className="admin-auth-panel" style={{ minHeight: 'calc(100dvh - 76px)' }}><div style={{ width: 'min(100%, 520px)' }}>
    <Notice icon={<ShieldAlert size={20} />} title="Sign-in is not configured" action="Check again" onAction={() => void retryConfig()}>
      The administration room needs the site's Firebase web configuration before Google or email-link sign-in can work. Public pages remain available.
    </Notice>
    {feedback && <p className="admin-feedback" role="alert">{feedback}</p>}
    <GoogleSignInButton auth={auth} queryClient={queryClient} className="admin-button" testId="button-admin-google-sign-in" />
    <button type="button" className="admin-button secondary" style={{ marginTop: 18 }} onClick={() => void beginSso()}>Continue with single sign-on <ArrowRight size={16}/></button>
  </div></div></Frame>;
  if (!replitAuth.user && (!auth || !authReady)) return <Frame><div className="admin-auth-panel" style={{ minHeight: 'calc(100dvh - 76px)' }}><div style={{ width: 'min(100%, 520px)' }}>{feedback ? <Notice icon={<ShieldAlert size={20} />} title="Sign-in unavailable">{feedback}</Notice> : <Skeleton />}<GoogleSignInButton auth={auth} queryClient={queryClient} disabled={replitAuth.isLoading} className="admin-button" testId="button-admin-google-sign-in" /><button type="button" className="admin-button secondary" style={{ marginTop: 18 }} disabled={replitAuth.isLoading} onClick={() => void beginSso()}>Continue with single sign-on <ArrowRight size={16}/></button></div></div></Frame>;
  if (identityReady && identityId) {
    if (me.isPending) return <Frame email={identityEmail || undefined} onSignOut={leave}><div className="admin-auth-panel" style={{ minHeight: 'calc(100dvh - 76px)' }}><div style={{ width: 'min(100%, 520px)' }}><Skeleton /></div></div></Frame>;
    if (me.isError) return <Frame email={identityEmail || undefined} onSignOut={leave}><div className="admin-auth-panel" style={{ minHeight: 'calc(100dvh - 76px)' }}><div style={{ width: 'min(100%, 520px)' }}>
      <Notice icon={<ShieldAlert size={20} />} title={me.error?.status === 403 ? 'Access not granted' : 'Access could not be verified'} action={me.error?.status === 403 ? 'Sign out' : 'Try again'} onAction={me.error?.status === 403 ? leave : () => void me.refetch()}>
        {me.error?.status === 403 ? 'This signed-in address does not have administrator access. Only the server can grant access to the private workspace.' : 'We could not confirm your administrator access right now. No private data has been shown.'}
      </Notice>
      {feedback && <p className="admin-feedback" role="alert">{feedback}</p>}
      <GoogleSignInButton auth={auth} queryClient={queryClient} replitUser={Boolean(replitAuth.user)} replitLogout={replitAuth.logout} className="admin-button secondary" testId="button-admin-google-sign-in" label={replitAuth.user ? 'Switch to Google sign-in' : undefined} />
      {!replitAuth.user && <button type="button" className="admin-link" style={{ marginTop: 18 }} onClick={() => void beginSso()}>Continue with single sign-on</button>}
    </div></div></Frame>;
    if (me.data?.role === 'admin') return <Dashboard userId={identityId} email={me.data.email} replitUser={Boolean(replitAuth.user)} replitLogout={replitAuth.logout} authFeedback={feedback} onSignOut={leave} onSwitchIdentity={() => replitAuth.user
      ? switchToFirebase(queryClient, replitAuth.logout)
      : void beginSso()} />;
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
          <div className="admin-overline admin-mono">{linkPresent ? 'Complete access' : 'Restricted access'}</div>
           <h2>{linkPresent ? savedEmail && !completionAttempted ? 'Signing you in.' : 'Finish signing in.' : sentTo ? 'Check your inbox.' : 'Welcome back.'}</h2>
          <p>{linkPresent
             ? savedEmail ? 'We are verifying your email link. If it does not complete, request a new link below.' : 'This link cannot access the saved email from where you requested it. Enter the address that received the link to continue.'
            : sentTo ? `A sign-in link was sent to ${sentTo}. Keep this tab open. Your email app may open the link in another tab; this page will update when your browser shares the sign-in session.` : 'Sign in with Google to continue. Existing email-link accounts can use the recovery option below to sign in and then link Google.'}</p>
          {feedback && <p className="admin-feedback" role="alert" data-testid="status-auth-error">{feedback}</p>}
          {sentTo && !linkPresent && !feedback && <p className="admin-feedback success" role="status" data-testid="status-email-sent"><Mail size={15} style={{ display: 'inline', marginRight: 9 }} />Email sent. Check your inbox and spam folder.</p>}
          {busy && linkPresent && <div className="admin-skeleton" role="status" aria-label="Completing sign-in" style={{ height: 50, width: '100%' }} />}
          <GoogleSignInButton auth={auth} queryClient={queryClient} replitUser={Boolean(replitAuth.user)} replitLogout={replitAuth.logout} disabled={busy} className="admin-button" testId="button-admin-google-sign-in" />
          <details style={{ marginTop: 20 }} open={linkPresent}>
            <summary className="admin-mono" style={{ cursor: 'pointer' }}>{linkPresent ? 'Complete or recover email-link sign-in' : 'Use email-link recovery instead'}</summary>
          {(!linkPresent || !savedEmail || completionAttempted) && <form onSubmit={async event => {
            if (linkPresent && !completionAttempted) {
              event.preventDefault();
              if (email.trim()) {
                window.localStorage.setItem(EMAIL_KEY, email.trim());
                setCompletionEmail(email.trim());
              }
              return;
            }
            await sendLink(event);
          }}>
            <div className="admin-field"><label className="admin-mono" htmlFor="admin-email">Email address</label><input id="admin-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@yourstudio.com" data-testid="input-admin-email" /></div>
            <button className="admin-button" type="submit" disabled={busy} data-testid="button-send-email-link">{busy ? 'Working…' : linkPresent && !completionAttempted ? 'Complete sign-in' : sentTo ? 'Send another link' : 'Send sign-in link'}<ArrowRight size={16} /></button>
          </form>}
          </details>
          <button type="button" className="admin-button secondary" style={{ marginTop: 14 }} disabled={replitAuth.isLoading} onClick={() => void beginSso()}>Continue with single sign-on <ArrowRight size={16}/></button>
          {replitAuth.user && <button type="button" className="admin-link" style={{ marginTop: 12 }} onClick={() => switchToFirebase(queryClient, replitAuth.logout)}>Sign out of single sign-on</button>}
          {linkPresent && !savedEmail && <p className="admin-auth-note">For your security, use the exact address that received this link.</p>}
          {!linkPresent && <p className="admin-auth-note"><LockKeyhole size={13} style={{ display: 'inline', marginRight: 8 }} />Access is verified by the server after you sign in. Having a link alone does not grant administrator access.</p>}
          {completionAttempted && linkPresent && <button className="admin-link" type="button" onClick={() => { setLinkHandled(true); setFeedback(''); }} data-testid="button-dismiss-expired-link"><RotateCw size={13} style={{ display: 'inline', marginRight: 6 }} />Start a fresh sign-in</button>}
        </div>
      </div>
    </div>
  </Frame>;
}