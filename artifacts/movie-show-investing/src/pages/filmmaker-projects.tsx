import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  claimFilmmakerProject, getGetFilmmakerProjectsQueryKey,
  getFlowProgress, getGetFilmmakerResultQueryKey, getGetFlowProgressQueryKey,
  getGetPriceGroupQueryKey, getPriceGroup,
  useGetFilmmakerProjects,
  useResumeFilmmakerProject, useSelectFilmmakerProject,
  useStartFilmmakerProject,
} from '@workspace/api-client-react';
import { ProjectHubView, type ProjectHubItem } from '@/components/project-hub-view';
import {
  FilmmakerPhoneVerification,
  phoneSyncErrorMessage,
  synchronizeFilmmakerPhone,
} from '@/components/filmmaker-phone-verification';
import { FilmmakerActivity, useParticipantThreads } from '@/components/filmmaker-activity';
import { useFilmmakerAuth } from '@/hooks/use-filmmaker-auth';
import { clearFilmmakerAction, hasPendingStartAction, pendingFilmmakerAction } from '@/lib/filmmaker-intent';
import { FilmmakerStartOver } from '@/components/filmmaker-start-over';
import { PHONE_VERIFICATION_ENABLED } from '@/lib/features';

function accountError(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error) {
    const response = 'data' in error ? error.data : null;
    const responseError = response && typeof response === 'object' && 'error' in response && typeof response.error === 'string'
      ? response.error : '';
    const responseCode = response && typeof response === 'object' && 'code' in response && typeof response.code === 'string'
      ? response.code : '';
    if (error.status === 409 && responseCode === 'unlinked_browser_draft') {
      return responseError || 'Keep this original browser draft. Connect it here before switching projects. If this account has another unfinished pitch, finish that pitch in another browser or device first, then return here to connect this guest draft.';
    }
    if (error.status === 409 && responseError.toLowerCase().includes('unfinished guest draft')) {
      return `${responseError} Keep this original browser draft; connect it here before switching projects. If this account has another unfinished pitch, finish that pitch in another browser or device first, then return here to connect this guest draft.`;
    }
    if (error.status === 409) return responseError || 'This browser has an earlier submission or an unfinished worksheet that cannot be switched away from yet. Finish that worksheet here before managing another project.';
    if (error.status === 403) return 'This browser’s current worksheet belongs to a different account. Sign in with the Google account associated with that submission. Your other projects have not changed.';
    if (error.status === 401) return 'Your sign-in has expired. Sign in again to manage your projects.';
  }
  return 'We couldn’t complete that action. Your saved projects have not changed. Please try again.';
}

export default function FilmmakerProjects() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const auth = useFilmmakerAuth();
  const [actionError, setActionError] = useState('');
  const [claimError, setClaimError] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [acting, setActing] = useState(false);
  const [initialAction] = useState(pendingFilmmakerAction);
  const claimedUid = useRef<string | null>(null);
  const uid = auth.user?.uid;
  const identityId = uid;
  const identityProvider = uid ? 'firebase' : null;
  const user = auth.user;

  const projects = useGetFilmmakerProjects({
    query: {
      queryKey: [...getGetFilmmakerProjectsQueryKey(), identityId],
      enabled: !!identityId && auth.ready,
      retry: (count, error) => error.status !== 401 && error.status !== 403 && count < 2,
      refetchOnMount: 'always',
    },
  });
  const { threads } = useParticipantThreads(identityId ?? '', identityProvider ?? 'firebase');
  const start = useStartFilmmakerProject();
  const resume = useResumeFilmmakerProject();
  const select = useSelectFilmmakerProject();

  useEffect(() => {
    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]') ?? document.createElement('meta');
    const original = meta.content;
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    if (!meta.parentNode) document.head.appendChild(meta);
    return () => { if (original) meta.content = original; else meta.remove(); };
  }, []);

  const linkCurrentVisit = useCallback(async () => {
    if (!identityId) return;
    setClaiming(true);
    setClaimError('');
    try {
      if (user && PHONE_VERIFICATION_ENABLED) {
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
        let draftId: number | null = null;
        try {
          const currentProgress = await getFlowProgress('filmmaker');
          if (!currentProgress.completed) draftId = currentProgress.draft_id ?? null;
        } catch (error) {
          if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 404) throw error;
        }
        await claimFilmmakerProject({
          headers: draftId ? { 'X-MSI-Draft-Id': String(draftId) } : {},
        });
        if (user && PHONE_VERIFICATION_ENABLED) await synchronizeFilmmakerPhone(user);
        await queryClient.invalidateQueries({ queryKey: getGetFilmmakerProjectsQueryKey() });
        const requestedStart = hasPendingStartAction()
          || new URLSearchParams(window.location.search).get('action') === 'start';
        if (initialAction === 'start' && requestedStart) {
          await start.mutateAsync();
          clearVisitorQueries();
          clearFilmmakerAction();
          await queryClient.invalidateQueries({ queryKey: getGetFilmmakerProjectsQueryKey() });
          navigate(new URLSearchParams(window.location.search).get('new') === '1' ? '/start/filmmaker?new=1' : '/start/filmmaker');
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
  }, [queryClient, identityId, user, initialAction, navigate, start]);

  useEffect(() => {
    if (!identityId || !auth.ready || claimedUid.current === identityId) return;
    claimedUid.current = identityId;
    void linkCurrentVisit();
  }, [identityId, auth.ready, linkCurrentVisit]);

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

    if (auth.configPending || (!auth.configError && !auth.ready)) {
    return <section className="dossier"><div className="page-wrap dossier-hero" role="status"><p className="dossier-kicker">Your filmmaker desk</p><h1 className="dossier-title">Finding your<br/><em>projects.</em></h1></div></section>;
  }
  if (auth.configError && !auth.user) {
    return <section className="dossier"><div className="page-wrap dossier-hero"><p className="dossier-kicker">Account sign-in unavailable</p><h1 className="dossier-title">We can’t open<br/><em>your desk yet.</em></h1><p className="dossier-lead" role="alert">{auth.authError || 'Google sign-in isn’t configured right now. Your existing submission has not changed. Please try again later.'}</p>{actionError && <p className="dossier-status" role="alert">{actionError}</p>}<button type="button" className="dossier-button dossier-button-outline" style={{ marginTop: 16 }} onClick={() => void auth.retryConfig()}>Check again <RotateCcw size={17}/></button></div></section>;
  }
  if (!identityId) {
    return <section className="dossier"><div className="page-wrap dossier-hero" style={{ maxWidth: 850 }}>
      <p className="dossier-kicker">Private filmmaker access</p>
      <h1 className="dossier-title">One place for<br/><em>every project.</em></h1>
      <p className="dossier-lead">Use Sign in in the site header to start another film, return to a saved draft, or manage your projects on another device.</p>
      <p className="dossier-notice" style={{ marginTop: 26 }}>Already submitted without signing in? Open this page in the browser where you submitted it and sign in with Google to securely claim submissions saved in that browser. Your saved project and public link will stay intact; accounts are never merged based only on matching email addresses.</p>
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
    pledged_total: project.confirmed_pledge_total,
    backer_count: project.backer_count,
    awaiting_replies: (threads.data?.conversations ?? []).filter(thread => thread.project_id === project.id && thread.awaiting_reply).length,
  }));
  return <>
    {claimError && <div className="page-wrap dossier-notice" role="alert" style={{ marginTop: 24 }}>{claimError} <Link href="/start/filmmaker">Open this browser’s worksheet</Link> · <button type="button" onClick={() => void linkCurrentVisit()}>Try linking again</button></div>}
    {(claimError || actionError) && <div className="page-wrap"><FilmmakerStartOver disabled={acting || claiming}/></div>}
    {actionError && <div className="page-wrap dossier-notice" role="alert" style={{ marginTop: 24 }}>{actionError} {actionError.includes('Keep this original browser draft') && <Link href="/start/filmmaker">Open this browser’s worksheet</Link>}</div>}
    <ProjectHubView
      email={auth.user?.email ?? ''}
      projects={items}
      draftAvailable={projects.data?.has_resumable_draft ?? false}
      loading={projects.isPending || claiming}
      busy={acting || claiming}
      error={projects.isError ? accountError(projects.error) : null}
      draftActions={!claimError && !actionError ? <FilmmakerStartOver disabled={acting || claiming}/> : null}
      phoneVerificationSlot={auth.user && PHONE_VERIFICATION_ENABLED ? <FilmmakerPhoneVerification user={auth.user} verified={projects.data?.phone_verified ?? false} /> : null}
      onStart={() => void perform(() => start.mutateAsync(), '/start/filmmaker')}
      onResume={() => void perform(() => resume.mutateAsync(), '/start/filmmaker')}
      onOpen={id => void perform(() => select.mutateAsync({ projectId: id }), '/start/filmmaker/done')}
      onRetry={() => { void projects.refetch(); void linkCurrentVisit(); }}
    />
    {!projects.isPending && !projects.isError && !claiming && identityId && identityProvider && <FilmmakerActivity key={`${identityProvider}:${identityId}`} uid={identityId} provider={identityProvider} busy={acting} projectIds={(projects.data?.projects ?? []).map(project => project.id)} onOpenProject={id => void perform(() => select.mutateAsync({ projectId: id }), '/start/filmmaker/done')}/>}
  </>;
}
