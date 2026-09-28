import { useEffect, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { Auth } from 'firebase/auth';
import { SiGoogle } from 'react-icons/si';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { isReplitAuthActive, isReplitAuthLoading } from '@workspace/replit-auth-web';
import { signInWithGoogle } from '@/lib/google-sign-in';

type Props = {
  auth: Auth | null;
  queryClient: QueryClient;
  className: string;
  disabled?: boolean;
  testId?: string;
  label?: string;
};

export function GoogleSignInButton({
  auth, queryClient, className, disabled = false,
  testId = 'button-continue-google', label,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [firebaseSignedIn, setFirebaseSignedIn] = useState(() => Boolean(auth?.currentUser));

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
      setFeedback('Google sign-in is not ready yet. Check the connection and try again.');
      return;
    }
    if (auth.currentUser) {
      setFirebaseSignedIn(true);
      setFeedback('You are already signed in. Sign out before signing in again.');
      return;
    }

    setBusy(true);
    setAuthTokenGetter(null);
    queryClient.clear();
    try {
      const result = await signInWithGoogle(auth);
      setFirebaseSignedIn(Boolean(result.user));
      if (!isReplitAuthActive() && !isReplitAuthLoading()) {
        setAuthTokenGetter(() => auth.currentUser?.getIdToken() ?? null);
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Google sign-in could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (firebaseSignedIn || auth?.currentUser) return null;

  return <span className="inline-flex flex-col items-stretch gap-2">
    <button
      type="button"
      className={className}
      disabled={disabled || busy}
      onClick={() => void begin()}
      data-testid={testId}
    >
      <SiGoogle aria-hidden="true" size={17} />
      {busy ? 'Opening Google…' : label ?? 'Sign in'}
    </button>
    {feedback && <span role="alert" className="text-sm leading-relaxed text-[#902f4d]" data-testid="status-google-sign-in">{feedback}</span>}
  </span>;
}