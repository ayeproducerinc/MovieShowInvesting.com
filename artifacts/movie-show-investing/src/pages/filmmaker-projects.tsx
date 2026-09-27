import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  claimFilmmakerProject, getGetFilmmakerProjectsQueryKey,
  getGetFilmmakerResultQueryKey, getGetFlowProgressQueryKey,
  getGetPriceGroupQueryKey, getPriceGroup,
  useGetFilmmakerProjects, useLeaveFilmmakerAccount,
  useResumeFilmmakerProject, useSelectFilmmakerProject,
  useStartFilmmakerProject,
} from '@workspace/api-client-react';
import { ProjectHubView, type ProjectHubItem } from '@/components/project-hub-view';
import { useFilmmakerEmailLink } from '@/hooks/use-filmmaker-email-link';

function accountError(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error) {
    if (error.status === 409) return 'This browser has an earlier submission or an unfinished worksheet that cannot be switched away from yet. Finish that worksheet here, or sign in with the email used on your completed submission.';
    if (error.status === 403) return 'This browser’s current worksheet belongs to a different account or email. Sign in with the email used on that submission to link it. Your other projects have not changed.';
    if (error.status === 401) return 'Your sign-in has expired. Sign in again to manage your projects.';
  }
  return 'We couldn’t complete that action. Your saved projects have not changed. Please try again.';
}

export default function FilmmakerProjects() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const auth = useFilmmakerEmailLink();
  const [email, setEmail] = useState('');
  const [actionError, setActionError] = useState('');
  const [claimError, setClaimError] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [acting, setActing] = useState(false);
  const claimedUid = useRef<string | null>(null);
  const uid = auth.user?.uid;

  const projects = useGetFilmmakerProjects({
    query: {
      queryKey: [...getGetFilmmakerProjectsQueryKey(), uid],
      enabled: !!uid && auth.ready && !auth.linkPresent,
      retry: (count, error) => error.status !== 401 && error.status !== 403 && count < 2,
      refetchOnMount: 'always',
    },
  });
  const start = useStartFilmmakerProject();
  const resume = useResumeFilmmakerProject();
  const select = useSelectFilmmakerProject();
  const leave = useLeaveFilmmakerAccount();

  useEffect(() => {
    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]') ?? document.createElement('meta');
    const original = meta.content;
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    if (!meta.parentNode) document.head.appendChild(meta);
    return () => { if (original) meta.content = original; else meta.remove(); };
  }, []);

  const linkCurrentVisit = useCallback(async () => {
    setClaiming(true);
    setClaimError('');
    try {
      // Establish a recorded visitor on a new device before linking its draft.
      await getPriceGroup();
      await claimFilmmakerProject();
      await queryClient.invalidateQueries({ queryKey: getGetFilmmakerProjectsQueryKey() });
    } catch (error) {
      setClaimError(accountError(error));
    } finally {
      setClaiming(false);
    }
  }, [queryClient]);

  useEffect(() => {
    if (!uid || !auth.ready || auth.linkPresent || claimedUid.current === uid) return;
    claimedUid.current = uid;
    void linkCurrentVisit();
  }, [uid, auth.ready, auth.linkPresent, linkCurrentVisit]);

  function clearVisitorQueries() {
    queryClient.removeQueries({ queryKey: getGetFilmmakerResultQueryKey() });
    queryClient.removeQueries({ queryKey: getGetFlowProgressQueryKey('filmmaker') });
    queryClient.removeQueries({ queryKey: getGetPriceGroupQueryKey() });
  }

  async function perform(action: () => Promise<unknown>, destination: string) {
    setActing(true);
    setActionError('');
    try {
      await action();
      clearVisitorQueries();
      await queryClient.invalidateQueries({ queryKey: getGetFilmmakerProjectsQueryKey() });
      navigate(destination);
    } catch (error) {
      setActionError(accountError(error));
    } finally {
      setActing(false);
    }
  }

  async function signOut() {
    setActing(true);
    setActionError('');
    try {
      // Rotate an account-owned visitor cookie before leaving the Firebase session.
      // An unclaimed guest submission keeps its original-browser claim proof.
      await leave.mutateAsync();
      await auth.leave();
      clearVisitorQueries();
      queryClient.removeQueries({ queryKey: getGetFilmmakerProjectsQueryKey() });
      claimedUid.current = null;
    } catch (error) {
      setActionError(accountError(error));
    } finally {
      setActing(false);
    }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (auth.linkPresent) await auth.complete(email);
    else await auth.requestLink(email);
  }

  if (auth.configPending || (!auth.configError && !auth.ready)) {
    return <section className="dossier"><div className="page-wrap dossier-hero" role="status"><p className="dossier-kicker">Your filmmaker desk</p><h1 className="dossier-title">Finding your<br/><em>projects.</em></h1></div></section>;
  }
  if (auth.configError) {
    return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker">Email sign-in unavailable</p><h1 className="dossier-title">We can’t open<br/><em>your desk yet.</em></h1><p className="dossier-lead" role="alert">Sign-in isn’t configured right now. Your existing submission has not changed. Please try again later.</p><button type="button" className="dossier-button" onClick={() => void auth.retryConfig()}>Check again <RotateCcw size={17}/></button></div></section>;
  }
  if (!auth.user || auth.linkPresent || auth.busy) {
    return <section className="dossier"><div className="page-wrap dossier-hero" style={{ maxWidth: 850 }}>
      <p className="dossier-kicker">Private filmmaker access</p>
      <h1 className="dossier-title">One place for<br/><em>every project.</em></h1>
      <p className="dossier-lead">{auth.linkPresent
        ? 'Confirm the email address that received this link to finish signing in.'
        : 'Sign in by email to start another film, return to a saved draft, or manage your projects on another device.'}</p>
      <p className="dossier-notice" style={{ marginTop: 26 }}>Already submitted without signing in? Open this page in the browser where you submitted it and sign in with the same email once to add it to your account. Your saved project and public link will stay intact.</p>
      <form onSubmit={event => void submitEmail(event)} style={{ maxWidth: 480, marginTop: 28 }}>
        <label htmlFor="filmmaker-sign-in-email" className="dossier-kicker">Your email address</label>
        <input id="filmmaker-sign-in-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" data-testid="input-filmmaker-email" style={{ display: 'block', width: '100%', minHeight: 52, border: '1px solid #a6a4a0', padding: '12px 15px', margin: '10px 0 16px', color: '#202936', background: '#fff' }} />
        <button type="submit" className="dossier-button" disabled={auth.busy}>{auth.linkPresent ? 'Finish sign-in' : 'Email me a sign-in link'} <ArrowRight size={17}/></button>
      </form>
      {auth.busy && <p className="dossier-status" role="status">Working on your sign-in…</p>}
      {auth.sentTo && <p className="dossier-status" role="status">Check {auth.sentTo} for your sign-in link. You can keep this page open.</p>}
      {auth.feedback && <p className="dossier-status" role="alert">{auth.feedback}</p>}
      {auth.linkPresent && auth.feedback && <button type="button" className="dossier-button dossier-button-outline" style={{ marginTop: 16 }} disabled={auth.busy || !email.trim()} onClick={() => void auth.requestLink(email)}>Request a new link <ArrowRight size={17}/></button>}
      <p className="dossier-status" style={{ marginTop: 28 }}><Link href="/start/filmmaker/done">Back to your current submission</Link></p>
    </div></section>;
  }

  const items: ProjectHubItem[] = (projects.data?.projects ?? []).map(project => ({
    project_id: project.id,
    project_slug: project.slug,
    title: project.title ?? 'Untitled project',
    approved: project.review_state === 'approved',
    hidden: project.review_state === 'hidden',
    created_at: project.created_at,
  }));
  return <>
    {claimError && <div className="page-wrap dossier-notice" role="alert" style={{ marginTop: 24 }}>{claimError} <Link href="/start/filmmaker">Open this browser’s worksheet</Link> · <button type="button" onClick={() => void linkCurrentVisit()}>Try linking again</button></div>}
    {actionError && <div className="page-wrap dossier-notice" role="alert" style={{ marginTop: 24 }}>{actionError}</div>}
    <ProjectHubView
      email={auth.user.email ?? ''}
      projects={items}
      draftAvailable={projects.data?.has_resumable_draft ?? false}
      loading={projects.isPending || claiming}
      busy={acting || claiming}
      error={projects.isError ? accountError(projects.error) : null}
      onStart={() => void perform(() => start.mutateAsync(), '/start/filmmaker')}
      onResume={() => void perform(() => resume.mutateAsync(), '/start/filmmaker')}
      onOpen={id => void perform(() => select.mutateAsync({ projectId: id }), '/start/filmmaker/done')}
      onSignOut={() => void signOut()}
      onRetry={() => { void projects.refetch(); void linkCurrentVisit(); }}
    />
  </>;
}