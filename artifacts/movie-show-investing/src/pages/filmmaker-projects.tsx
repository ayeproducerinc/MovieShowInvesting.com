import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  claimFilmmakerProject, getGetFilmmakerProjectsQueryKey, getGetFilmmakerQuestionsQueryKey,
  getGetFilmmakerResultQueryKey, getGetFlowProgressQueryKey,
  getGetPriceGroupQueryKey, getPriceGroup,
  useGetFilmmakerProjects, useLeaveFilmmakerAccount,
  useResumeFilmmakerProject, useSelectFilmmakerProject,
  useStartFilmmakerProject,
} from '@workspace/api-client-react';
import { ProjectHubView, type ProjectHubItem } from '@/components/project-hub-view';
import {
  FilmmakerPhoneVerification,
  phoneSyncErrorMessage,
  synchronizeFilmmakerPhone,
} from '@/components/filmmaker-phone-verification';
import { FilmmakerQuestionsDesk } from '@/components/filmmaker-questions-desk';
import { FilmmakerConversationsDesk } from '@/components/filmmaker-conversations-desk';
import { useFilmmakerAuth } from '@/hooks/use-filmmaker-auth';
import { clearFilmmakerAction, hasPendingStartAction, pendingFilmmakerAction } from '@/lib/filmmaker-intent';
import { useAuth } from '@workspace/replit-auth-web';
import { getInitializedAuth } from '@/components/firebase-bootstrap';
import { GoogleSignInButton } from '@/components/google-sign-in-button';

function accountError(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error) {
    if (error.status === 409) return 'This browser has an earlier submission or an unfinished worksheet that cannot be switched away from yet. Finish that worksheet here before managing another project.';
    if (error.status === 403) return 'This browser’s current worksheet belongs to a different account. Sign in with the Google account associated with that submission. Your other projects have not changed.';
    if (error.status === 401) return 'Your sign-in has expired. Sign in again to manage your projects.';
  }
  return 'We couldn’t complete that action. Your saved projects have not changed. Please try again.';
}

export default function FilmmakerProjects() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const auth = useFilmmakerAuth();
  const replitAuth = useAuth();
  const ssoUser = replitAuth.user;
  const [actionError, setActionError] = useState('');
  const [claimError, setClaimError] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [acting, setActing] = useState(false);
  const [initialAction] = useState(pendingFilmmakerAction);
  const claimedUid = useRef<string | null>(null);
  const uid = auth.user?.uid;
  const identityId = ssoUser?.id ?? uid;
  const user = auth.user;

  const projects = useGetFilmmakerProjects({
    query: {
      queryKey: [...getGetFilmmakerProjectsQueryKey(), identityId],
      enabled: !!identityId && !replitAuth.isLoading && (Boolean(ssoUser) || auth.ready),
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
    if (!identityId || replitAuth.isLoading) return;
    setClaiming(true);
    setClaimError('');
    try {
      if (user && !ssoUser) {
        try {
          await synchronizeFilmmakerPhone(user);
        } catch (error) {
          setClaimError(`We couldn’t refresh this account’s phone-verification status, so the current visit was not linked. ${phoneSyncErrorMessage(error)}`);
          return;
        }
      }
      const linkAndContinue = async () => {
        // Serialize visitor-cookie changes and a one-time action across tabs.
        await getPriceGroup();
        await claimFilmmakerProject();
        if (user && !ssoUser) await synchronizeFilmmakerPhone(user);
        await queryClient.invalidateQueries({ queryKey: getGetFilmmakerProjectsQueryKey() });
        if (initialAction === 'start' && navigator.locks && hasPendingStartAction()) {
          await start.mutateAsync();
          clearVisitorQueries();
          clearFilmmakerAction();
          await queryClient.invalidateQueries({ queryKey: getGetFilmmakerProjectsQueryKey() });
          navigate('/start/filmmaker');
        } else {
          if (initialAction === 'manage') clearFilmmakerAction();
        }
      };
      if (navigator.locks) await navigator.locks.request(`msi-filmmaker-account-${identityId}`, linkAndContinue);
      else await linkAndContinue();
    } catch (error) {
      setClaimError(accountError(error));
    } finally {
      setClaiming(false);
    }
  }, [queryClient, identityId, user, ssoUser, replitAuth.isLoading, initialAction, navigate, start]);

  useEffect(() => {
    if (!identityId || replitAuth.isLoading || (!ssoUser && !auth.ready) || claimedUid.current === identityId) return;
    claimedUid.current = identityId;
    void linkCurrentVisit();
  }, [identityId, ssoUser, replitAuth.isLoading, auth.ready, linkCurrentVisit]);

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
      clearFilmmakerAction();
      await queryClient.invalidateQueries({ queryKey: getGetFilmmakerProjectsQueryKey() });
      navigate(destination);
    } catch (error) {
      setActionError(accountError(error));
    } finally {
      setActing(false);
    }
  }

  async function signOut() {
    if (ssoUser) {
      clearFilmmakerAction();
      queryClient.clear();
      replitAuth.logout('/me/projects');
      return;
    }
    setActing(true);
    setActionError('');
    try {
      // Rotate an account-owned visitor cookie before leaving the Firebase session.
      // An unclaimed guest submission keeps its original-browser claim proof.
      await leave.mutateAsync();
      await auth.leave();
      clearVisitorQueries();
      for (const project of projects.data?.projects ?? []) queryClient.removeQueries({ queryKey: getGetFilmmakerQuestionsQueryKey(project.id) });
      queryClient.removeQueries({ queryKey: getGetFilmmakerProjectsQueryKey() });
      claimedUid.current = null;
      clearFilmmakerAction();
    } catch (error) {
      setActionError(accountError(error));
    } finally {
      setActing(false);
    }
  }

    if (replitAuth.isLoading || (!ssoUser && (auth.configPending || (!auth.configError && !auth.ready)))) {
    return <section className="dossier"><div className="page-wrap dossier-hero" role="status"><p className="dossier-kicker">Your filmmaker desk</p><h1 className="dossier-title">Finding your<br/><em>projects.</em></h1></div></section>;
  }
  if (!ssoUser && auth.configError && !auth.user) {
    return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker">Account sign-in unavailable</p><h1 className="dossier-title">We can’t open<br/><em>your desk yet.</em></h1><p className="dossier-lead" role="alert">{auth.authError || 'Google sign-in isn’t configured right now. Your existing submission has not changed. Please try again later.'}</p>{actionError && <p className="dossier-status" role="alert">{actionError}</p>}<GoogleSignInButton auth={getInitializedAuth()} queryClient={queryClient} className="dossier-button" testId="button-filmmaker-google-sign-in" label="Sign in" /><button type="button" className="dossier-button dossier-button-outline" style={{ marginTop: 16 }} onClick={() => void auth.retryConfig()}>Check again <RotateCcw size={17}/></button></div></section>;
  }
  if (!identityId) {
    return <section className="dossier"><div className="page-wrap dossier-hero" style={{ maxWidth: 850 }}>
      <p className="dossier-kicker">Private filmmaker access</p>
      <h1 className="dossier-title">One place for<br/><em>every project.</em></h1>
      <p className="dossier-lead">Sign in with Google to start another film, return to a saved draft, or manage your projects on another device.</p>
      <p className="dossier-notice" style={{ marginTop: 26 }}>Already submitted without signing in? Open this page in the browser where you submitted it and sign in with Google to securely claim submissions saved in that browser. Your saved project and public link will stay intact; accounts are never merged based only on matching email addresses.</p>
      <div style={{ marginTop: 28 }}>
        <GoogleSignInButton
          auth={getInitializedAuth()}
          queryClient={queryClient}
          disabled={replitAuth.isLoading}
          className="dossier-button"
          testId="button-filmmaker-google-sign-in"
          label="Sign in"
        />
      </div>
      <p className="dossier-status" style={{ marginTop: 28 }}><Link href="/">Back to the site</Link></p>
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
    {(ssoUser || user) && <div className="page-wrap" style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
      <GoogleSignInButton auth={getInitializedAuth()} queryClient={queryClient} replitUser={Boolean(ssoUser)} replitLogout={replitAuth.logout} disabled={replitAuth.isLoading} className="dossier-button dossier-button-outline" testId="button-filmmaker-google-link" label={ssoUser ? 'Sign in' : undefined} />
      {ssoUser && <p className="dossier-notice">An existing session is active. Sign out before signing in with Google.</p>}
    </div>}
    {claimError && <div className="page-wrap dossier-notice" role="alert" style={{ marginTop: 24 }}>{claimError} <Link href="/start/filmmaker">Open this browser’s worksheet</Link> · <button type="button" onClick={() => void linkCurrentVisit()}>Try linking again</button></div>}
    {actionError && <div className="page-wrap dossier-notice" role="alert" style={{ marginTop: 24 }}>{actionError}</div>}
    <ProjectHubView
      email={ssoUser?.email ?? auth.user?.email ?? ''}
      initiallyOpen={initialAction === 'manage'}
      projects={items}
      draftAvailable={projects.data?.has_resumable_draft ?? false}
      loading={projects.isPending || claiming}
      busy={acting || claiming}
      error={projects.isError ? accountError(projects.error) : null}
      phoneVerificationSlot={auth.user && !ssoUser ? <FilmmakerPhoneVerification user={auth.user} verified={projects.data?.phone_verified ?? false} /> : ssoUser ? <p className="dossier-notice">Phone verification is available after signing in with Google.</p> : null}
      onStart={() => void perform(() => start.mutateAsync(), '/start/filmmaker')}
      onResume={() => void perform(() => resume.mutateAsync(), '/start/filmmaker')}
      onOpen={id => void perform(() => select.mutateAsync({ projectId: id }), '/start/filmmaker/done')}
      onSignOut={() => void signOut()}
      onRetry={() => { void projects.refetch(); if (!ssoUser) void linkCurrentVisit(); }}
    />
    {!projects.isPending && !projects.isError && !claiming && <FilmmakerQuestionsDesk projects={projects.data?.projects ?? []}/>}
    {!projects.isPending && !projects.isError && !claiming && identityId && <FilmmakerConversationsDesk uid={identityId} projectIds={(projects.data?.projects ?? []).map(project => project.id)}/>}
  </>;
}