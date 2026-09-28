import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FirebaseError } from 'firebase/app';
import { isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink } from 'firebase/auth';
import { getGetFirebaseConfigQueryKey, useGetFirebaseConfig } from '@workspace/api-client-react';
import { getInitializedAuth, useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';

const EMAIL_KEY = 'msi_messaging_email_link';

function describe(error: unknown) {
  const code = error instanceof FirebaseError ? error.code : '';
  if (code === 'auth/quota-exceeded') return 'The email-link sending limit has been reached. Please try again after the daily quota resets. No message was sent.';
  if (code === 'auth/too-many-requests') return 'Too many sign-in attempts. Wait a while before requesting another link.';
  if (code === 'auth/network-request-failed') return 'Firebase could not connect. Check your connection and try again.';
  if (code === 'auth/unauthorized-domain' || code === 'auth/unauthorized-continue-uri') return 'This return address is not authorized for email sign-in. Please contact the site owner.';
  if (code === 'auth/invalid-email') return 'Check the email address and try again.';
  return code ? `Email sign-in could not be completed (${code}). Try a new link.` : 'Email sign-in could not be completed. Try again.';
}

export function useMessagingEmailLink() {
  const queryClient = useQueryClient();
  const user = useFirebaseUser();
  const ready = useFirebaseSessionReady();
  const config = useGetFirebaseConfig({ query: { queryKey: getGetFirebaseConfigQueryKey(), retry: false, staleTime: 300_000 } });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [handled, setHandled] = useState(false);
  const attempted = useRef(false);
  const previousUid = useRef<string | null | undefined>(undefined);
  const auth = getInitializedAuth();
  const linkPresent = !!auth && !handled && isSignInWithEmailLink(auth, window.location.href);

  useEffect(() => {
    if (!ready || previousUid.current === user?.uid) return;
    if (previousUid.current !== undefined) {
      queryClient.removeQueries({ predicate: query => typeof query.queryKey[0] === 'string' && (/^\/api\/conversations(?:\/\d+)?$/.test(query.queryKey[0]) || /^\/api\/me\/conversations$/.test(query.queryKey[0])) });
    }
    previousUid.current = user?.uid ?? null;
  }, [ready, user?.uid, queryClient]);

  async function complete(address: string) {
    if (!auth || !linkPresent || !address.trim()) return;
    setBusy(true); setFeedback('');
    try {
      await signInWithEmailLink(auth, address.trim(), window.location.href);
      window.localStorage.removeItem(EMAIL_KEY);
      window.history.replaceState({}, '', window.location.pathname + window.location.search);
      setHandled(true);
    } catch (error) {
      setFeedback(describe(error));
    } finally { setBusy(false); }
  }

  useEffect(() => {
    const saved = window.localStorage.getItem(EMAIL_KEY);
    if (!ready || !linkPresent || !saved || attempted.current) return;
    attempted.current = true;
    void complete(saved);
    // A link is completed once; the user can manually retry with an email.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, linkPresent]);

  async function requestLink(address: string) {
    if (!auth || !address.trim()) return;
    const normalized = address.trim();
    const previous = window.localStorage.getItem(EMAIL_KEY);
    setBusy(true); setFeedback('');
    try {
      window.localStorage.setItem(EMAIL_KEY, normalized);
      await sendSignInLinkToEmail(auth, normalized, {
        url: `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/messages${window.location.search}`,
        handleCodeInApp: true,
      });
      setSentTo(normalized);
      if (linkPresent) {
        window.history.replaceState({}, '', window.location.pathname + window.location.search);
        setHandled(true);
      }
    } catch (error) {
      if (previous === null) window.localStorage.removeItem(EMAIL_KEY);
      else window.localStorage.setItem(EMAIL_KEY, previous);
      setFeedback(describe(error));
    } finally { setBusy(false); }
  }
  return {
    user, ready, busy, feedback, sentTo, linkPresent, complete, requestLink,
    configPending: config.isPending,
    configError: config.isError || (!!config.data && (!config.data.apiKey || !config.data.authDomain || !config.data.projectId || !config.data.appId)),
    retryConfig: config.refetch,
  };
}