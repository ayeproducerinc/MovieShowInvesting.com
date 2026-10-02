import { useEffect, useState, useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { Auth, User } from 'firebase/auth';
import { SiGoogle } from 'react-icons/si';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { isReplitAuthActive, isReplitAuthLoading } from '@workspace/replit-auth-web';
import { signInWithGoogle } from '@/lib/google-sign-in';
import { clearPrivateAuthQueries } from '@/lib/homepage-community';
import { canPrepareRegisteredFilmmakerHandoff, clearFilmmakerAuthHandoff, prepareRegisteredFilmmakerHandoff, subscribeFilmmakerAuthPreparation } from '@/lib/filmmaker-auth-handoff';

type Props = {
  auth: Auth | null;
  queryClient: QueryClient;
  className: string;
  disabled?: boolean;
  testId?: string;
  label?: string;
  onBeforeSignIn?: () => boolean | void;
  onSignInError?: (message: string) => void;
  onSignedIn?: (user: User) => void;
};

export function GoogleSignInButton({
  auth, queryClient, className, disabled = false,
  testId = 'button-continue-google', label, onBeforeSignIn, onSignInError, onSignedIn,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [firebaseSignedIn, setFirebaseSignedIn] = useState(() => Boolean(auth?.currentUser));
  const filmmakerHandoffReady = useSyncExternalStore(
    subscribeFilmmakerAuthPreparation,
    canPrepareRegisteredFilmmakerHandoff,
    () => true,
  );

  useEffect(() => {
    if (!auth) {
      setFirebaseSignedIn(false);
      return undefined;
    }
    return auth.onAuthStateChanged(user => {
      setFirebaseSignedIn(Boolean(user));
    });
  }, [auth]);

  async function begin() {
    if (busy || disabled) return;
    setFeedback('');
    if (!auth) {
      const message = 'Google sign-in is not ready yet. Check the connection and try again.';
      setFeedback(message);
      onSignInError?.(message);
      return;
    }
    if (auth.currentUser) {
      setFirebaseSignedIn(true);
      const message = 'You are already signed in. Sign out before signing in again.';
      setFeedback(message);
      onSignInError?.(message);
      return;
    }

    let preparation: boolean | void | Promise<boolean> | null;
    try {
      preparation = onBeforeSignIn ? onBeforeSignIn() : prepareRegisteredFilmmakerHandoff();
      if (preparation === false) {
        const message = 'We could not prepare this saved work for sign-in. Your answers are still saved; try again.';
        setFeedback(message);
        onSignInError?.(message);
        return;
      }
    } catch {
      const message = 'We could not prepare this saved work for sign-in. Your answers are still saved; try again.';
      setFeedback(message);
      onSignInError?.(message);
      return;
    }

    setBusy(true);
    setAuthTokenGetter(null);
    clearPrivateAuthQueries(queryClient);
    const signIn = signInWithGoogle(auth);
    try {
      const [result, prepared] = await Promise.all([signIn, Promise.resolve(preparation)]);
      if (prepared === false) {
        throw new Error('Your latest worksheet changes could not be saved before account linking. You are signed in, but the original browser draft has not been linked. Return to the worksheet and retry.');
      }
      setFirebaseSignedIn(Boolean(result.user));
      if (!isReplitAuthActive() && !isReplitAuthLoading()) {
        setAuthTokenGetter(() => auth.currentUser?.getIdToken() ?? null);
        onSignedIn?.(result.user);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google sign-in could not be completed. Please try again.';
      setFeedback(message);
      if (!onBeforeSignIn && preparation && typeof preparation === 'object') clearFilmmakerAuthHandoff();
      onSignInError?.(message);
    } finally {
      setBusy(false);
    }
  }

  if (firebaseSignedIn || auth?.currentUser) return null;

  return <span className="inline-flex flex-col items-stretch gap-2">
    <button
      type="button"
      className={className}
      disabled={disabled || busy || !onBeforeSignIn && !filmmakerHandoffReady}
      onClick={() => void begin()}
      data-testid={testId}
    >
      <SiGoogle aria-hidden="true" size={17} />
      {busy ? 'Opening Google…' : label ?? 'Sign in'}
    </button>
    {feedback && <span role="alert" className="text-sm leading-relaxed text-[#902f4d]" data-testid="status-google-sign-in">{feedback}</span>}
  </span>;
}