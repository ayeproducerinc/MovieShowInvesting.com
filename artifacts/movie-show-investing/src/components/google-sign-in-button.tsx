import { useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { Auth, User } from 'firebase/auth';
import { SiGoogle } from 'react-icons/si';
import { leaveFilmmakerAccount, setAuthTokenGetter } from '@workspace/api-client-react';
import { isReplitAuthActive, isReplitAuthLoading } from '@workspace/replit-auth-web';
import { switchToFirebase } from '@/lib/auth-switch';
import { signInWithGoogle } from '@/lib/google-sign-in';

type Props = {
  auth: Auth | null;
  queryClient: QueryClient;
  className: string;
  replitUser?: boolean;
  replitLogout?: (returnTo?: string) => void;
  disabled?: boolean;
  testId?: string;
  label?: string;
};

export function GoogleSignInButton({
  auth, queryClient, className, replitUser = false, replitLogout, disabled = false,
  testId = 'button-continue-google', label,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [preparingSwitch, setPreparingSwitch] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [firebaseUser, setFirebaseUser] = useState<User | null>(() => auth?.currentUser ?? null);
  const [preparedUid, setPreparedUid] = useState<string | null>(null);
  const preparedUidRef = useRef<string | null>(null);
  const googleLinked = Boolean(firebaseUser?.providerData.some(provider => provider.providerId === 'google.com'));

  useEffect(() => {
    if (!auth) {
      setFirebaseUser(null);
      return undefined;
    }
    return auth.onAuthStateChanged(user => {
      setFirebaseUser(user);
      if (preparedUidRef.current && preparedUidRef.current !== (user?.uid ?? null)) {
        preparedUidRef.current = null;
        setPreparedUid(null);
      }
    });
  }, [auth]);

  async function begin() {
    if (busy || disabled) return;
    setFeedback('');
    if (replitUser && replitLogout) {
      switchToFirebase(queryClient, replitLogout);
      setFeedback('Your single sign-on session is being signed out. After sign-out finishes, select this button again to continue with Google.');
      return;
    }
    if (!auth) {
      setFeedback('Google sign-in is not ready yet. Check the connection and try again.');
      return;
    }
    const switchingGoogleAccount = Boolean(auth.currentUser?.providerData.some(provider => provider.providerId === 'google.com'));
    const currentUid = auth.currentUser?.uid;
    const switchPrepared = Boolean(switchingGoogleAccount && currentUid && preparedUidRef.current === currentUid);

    if (switchingGoogleAccount && currentUid && !switchPrepared) {
      setBusy(true);
      setPreparingSwitch(true);
      try {
        // Prepare the browser cookie while the current account's bearer token
        // is still active. A second user click will open the Google popup.
        await leaveFilmmakerAccount();
        if (auth.currentUser?.uid !== currentUid) {
          preparedUidRef.current = null;
          setPreparedUid(null);
          setFeedback('The signed-in account changed while preparing the switch. Nothing was switched; select the account action again.');
          return;
        }
        preparedUidRef.current = currentUid;
        setPreparedUid(currentUid);
        setFeedback('Your browser session is prepared. Select “Choose Google account” again to open Google and select the other account.');
      } catch {
        setFeedback('The current account’s browser session could not be safely prepared for switching. You are still signed in to your current Google account; no account switch was made. Please try again.');
      } finally {
        setBusy(false);
        setPreparingSwitch(false);
      }
      return;
    }

    setFeedback('');
    setBusy(true);
    const switchingPreparedGoogleAccount = Boolean(switchingGoogleAccount && switchPrepared);
    if (switchingPreparedGoogleAccount) {
      // Consume preparation before opening the popup; retries require a fresh
      // cookie rotation and a fresh explicit click.
      preparedUidRef.current = null;
      setPreparedUid(null);
      setAuthTokenGetter(null);
      queryClient.clear();
    } else if (!auth.currentUser) {
      setAuthTokenGetter(null);
      queryClient.clear();
    }
    try {
      // On a prepared switch or a fresh sign-in this call happens in the
      // user-activation task, before the first await, so popup blockers allow it.
      const result = await signInWithGoogle(auth);
      setFirebaseUser(result.user);
      if (!isReplitAuthActive() && !isReplitAuthLoading()) {
        setAuthTokenGetter(() => auth.currentUser?.getIdToken() ?? null);
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Google sign-in could not be completed. Please try again.');
      if (switchingPreparedGoogleAccount && auth.currentUser && !isReplitAuthActive() && !isReplitAuthLoading()) {
        setAuthTokenGetter(() => auth.currentUser?.getIdToken() ?? null);
      }
    } finally {
      setBusy(false);
    }
  }

  const buttonLabel = label ?? (replitUser
    ? 'Continue with Google'
    : googleLinked
      ? preparedUid === firebaseUser?.uid ? 'Choose Google account' : 'Switch Google account'
      : firebaseUser ? 'Link Google account' : 'Continue with Google');

  return <span className="inline-flex flex-col items-stretch gap-2">
    <button
      type="button"
      className={className}
      disabled={disabled || busy}
      onClick={() => void begin()}
      data-testid={testId}
    >
      <SiGoogle aria-hidden="true" size={17} />
      {preparingSwitch ? 'Preparing account switch…' : busy ? 'Opening Google…' : buttonLabel}
    </button>
    {feedback && <span role="alert" className="text-sm leading-relaxed text-[#902f4d]" data-testid="status-google-sign-in">{feedback}</span>}
  </span>;
}