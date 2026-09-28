import { useEffect, useRef, useState } from 'react';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth, isSignInWithEmailLink, onAuthStateChanged,
  sendSignInLinkToEmail, signInWithEmailLink, signOut,
  type Auth, type User,
} from 'firebase/auth';
import {
  getGetFirebaseConfigQueryKey, setAuthTokenGetter, useGetFirebaseConfig,
} from '@workspace/api-client-react';
import { pendingFilmmakerAction } from '@/lib/filmmaker-intent';

const APP_NAME = 'movie-show-investing';
const EMAIL_KEY = 'msi_filmmaker_sign_in_email';

export function useFilmmakerEmailLink() {
  const config = useGetFirebaseConfig({
    query: { queryKey: getGetFirebaseConfigQueryKey(), retry: false, staleTime: 300_000 },
  });
  const [auth, setAuth] = useState<Auth | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [handled, setHandled] = useState(false);
  const [savedEmail, setSavedEmail] = useState(() => window.localStorage.getItem(EMAIL_KEY));
  const attempted = useRef(false);
  const linkPresent = !!auth && !handled && isSignInWithEmailLink(auth, window.location.href);

  useEffect(() => {
    const web = config.data;
    if (!web?.apiKey || !web.authDomain || !web.projectId || !web.appId) return;
    try {
      const app = getApps().some(existing => existing.name === APP_NAME)
        ? getApp(APP_NAME)
        : initializeApp({
            apiKey: web.apiKey, authDomain: web.authDomain,
            projectId: web.projectId, appId: web.appId,
          }, APP_NAME);
      setAuth(getAuth(app));
    } catch {
      setFeedback('Email sign-in could not be initialized. Please try again.');
    }
  }, [config.data]);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, next => {
      setAuthTokenGetter(next ? () => auth.currentUser?.getIdToken() ?? null : null);
      setUser(next);
      setReady(true);
    }, () => {
      setAuthTokenGetter(null);
      setReady(true);
      setFeedback('Your sign-in session could not be restored. Please try again.');
    });
  }, [auth]);

  async function complete(address: string) {
    if (!auth || !linkPresent || !address.trim()) return;
    setBusy(true);
    setFeedback('');
    try {
      await signInWithEmailLink(auth, address.trim(), window.location.href);
      window.localStorage.removeItem(EMAIL_KEY);
      setSavedEmail(null);
      window.history.replaceState({}, '', window.location.pathname);
      setHandled(true);
    } catch {
      setFeedback('This sign-in link could not be completed. It may have expired or been used already. Request a new link to continue.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!auth || !ready || !linkPresent || !savedEmail || attempted.current) return;
    attempted.current = true;
    void complete(savedEmail);
  // The link is attempted once automatically. A user can enter an address to retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, ready, linkPresent, savedEmail]);

  async function requestLink(address: string) {
    if (!auth || !address.trim()) return;
    setBusy(true);
    setFeedback('');
    const previous = window.localStorage.getItem(EMAIL_KEY);
    const normalized = address.trim();
    try {
      window.localStorage.setItem(EMAIL_KEY, normalized);
      setSavedEmail(normalized);
      await sendSignInLinkToEmail(auth, normalized, {
        url: `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/me/projects${pendingFilmmakerAction() ? `?action=${pendingFilmmakerAction()}` : ''}`,
        handleCodeInApp: true,
      });
      setSentTo(normalized);
      if (linkPresent) {
        window.history.replaceState({}, '', window.location.pathname);
        setHandled(true);
      }
      attempted.current = false;
    } catch {
      if (previous === null) window.localStorage.removeItem(EMAIL_KEY);
      else window.localStorage.setItem(EMAIL_KEY, previous);
      setSavedEmail(previous);
      setFeedback('We couldn’t send the sign-in link. Check the address and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!auth) return;
    try {
      await signOut(auth);
      setAuthTokenGetter(null);
      setUser(null);
    } catch {
      setFeedback('Sign-out could not be completed. Please try again.');
      throw new Error('Sign-out could not be completed.');
    }
  }

  return {
    user, ready: ready && !!auth, busy, feedback, sentTo, linkPresent,
    configPending: config.isPending,
    configError: config.isError || (!!config.data && (!config.data.apiKey || !config.data.authDomain || !config.data.projectId || !config.data.appId)),
    retryConfig: config.refetch,
    requestLink, complete, leave,
  };
}