import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FirebaseError } from 'firebase/app';
import {
  PhoneAuthProvider,
  RecaptchaVerifier,
  linkWithCredential,
  type User,
} from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFilmmakerProjectsQueryKey,
  verifyFilmmakerPhone,
  useVerifyFilmmakerPhone,
} from '@workspace/api-client-react';
import { getInitializedAuth } from '@/components/firebase-bootstrap';

const syncsByUid = new Map<string, Promise<boolean>>();

export async function synchronizeFilmmakerPhone(user: User): Promise<boolean> {
  const inProgress = syncsByUid.get(user.uid);
  if (inProgress) return inProgress;
  const sync = (async () => {
    await user.reload();
    const auth = getInitializedAuth();
    if (!auth || auth.currentUser?.uid !== user.uid) {
      throw new Error('Your sign-in session changed. Reload the page and sign in again before syncing phone verification.');
    }
    await auth.currentUser.getIdToken(true);
    const result = await verifyFilmmakerPhone();
    return result.phone_verified;
  })();
  syncsByUid.set(user.uid, sync);
  try {
    return await sync;
  } finally {
    if (syncsByUid.get(user.uid) === sync) syncsByUid.delete(user.uid);
  }
}

export function phoneSyncErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) return firebasePhoneError(error);
  if (error && typeof error === 'object' && 'status' in error) {
    const apiError = error as { status?: unknown; data?: unknown };
    const serverMessage = apiError.data && typeof apiError.data === 'object' && 'error' in apiError.data
      ? (apiError.data as { error?: unknown }).error
      : null;
    if (typeof serverMessage === 'string') return serverMessage;
    return `Phone status could not be synced (HTTP ${String(apiError.status)}). Please retry.`;
  }
  return error instanceof Error ? error.message : 'Phone status could not be synced. Please try again.';
}

function firebasePhoneError(error: unknown): string {
  const code = error instanceof FirebaseError ? error.code : null;
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'Enter a valid phone number in international format, such as +14155552671.';
    case 'auth/operation-not-allowed':
    case 'auth/configuration-not-found':
      return `Firebase phone sign-in is not enabled for this project (${code}).`;
    case 'auth/unauthorized-domain':
      return 'This site domain is not authorized for Firebase phone verification. The Firebase project owner must add it to Authorized domains.';
    case 'auth/too-many-requests':
      return 'Firebase has temporarily limited phone verification attempts. Please wait before trying again.';
    case 'auth/quota-exceeded':
      return 'The Firebase phone verification quota has been reached. Please try again later.';
    case 'auth/invalid-verification-code':
      return 'That code is incorrect or has expired. Check the SMS and try again.';
    case 'auth/code-expired':
      return 'That code has expired. Request a new verification code.';
    case 'auth/provider-already-linked':
      return 'A phone number is already linked to this Firebase account.';
    case 'auth/credential-already-in-use':
      return 'That phone number is linked to another Firebase account. Use a different number.';
    case 'auth/network-request-failed':
      return 'Firebase could not connect. Check your internet connection and try again.';
    default:
      return code
        ? `Firebase phone verification failed (${code}). Please share this error code with support.`
        : 'Phone verification failed before Firebase returned an error code. Please try again.';
  }
}

export function FilmmakerPhoneVerification({
  user,
  verified,
}: {
  user: User;
  verified: boolean;
}) {
  const auth = getInitializedAuth();
  const queryClient = useQueryClient();
  const verifierElement = useRef<HTMLDivElement>(null);
  const verifier = useRef<RecaptchaVerifier | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [verificationId, setVerificationId] = useState('');
  const [linkedPhone, setLinkedPhone] = useState(user.phoneNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState('');
  const verifyPhone = useVerifyFilmmakerPhone();

  async function syncExistingPhone() {
    setSyncing(true);
    setFeedback('');
    try {
      const isVerified = await synchronizeFilmmakerPhone(user);
      await queryClient.invalidateQueries({ queryKey: getGetFilmmakerProjectsQueryKey() });
      setFeedback(isVerified
        ? 'Your existing Firebase phone credential is now synced to your filmmaker account.'
        : 'No phone credential is currently linked to this Firebase account. The account verification badge has been removed.');
    } catch (error) {
      setFeedback(phoneSyncErrorMessage(error));
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (!auth || verified || !verifierElement.current) return;
    let instance: RecaptchaVerifier;
    try {
      instance = new RecaptchaVerifier(auth, verifierElement.current, { size: 'invisible' });
      verifier.current = instance;
      void instance.render().catch((error: unknown) => {
        setFeedback(firebasePhoneError(error));
      });
    } catch (error) {
      setFeedback(firebasePhoneError(error));
      return;
    }
    return () => {
      instance.clear();
      if (verifier.current === instance) verifier.current = null;
    };
  }, [auth, verified]);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !verifier.current) {
      setFeedback('Firebase phone verification is not initialized. Check the Firebase web configuration and try again.');
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      const id = await new PhoneAuthProvider(auth).verifyPhoneNumber(phone.trim(), verifier.current);
      setVerificationId(id);
      setFeedback('A verification code was sent by SMS.');
    } catch (error) {
      setFeedback(firebasePhoneError(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !verificationId || !user) return;
    setBusy(true);
    setFeedback('');
    try {
      // If Firebase already linked this number, this also lets an interrupted
      // server sync be retried without attempting to link it a second time.
      if (linkedPhone !== phone.trim()) {
        const credential = PhoneAuthProvider.credential(verificationId, code.trim());
        const linked = await linkWithCredential(user, credential);
        setLinkedPhone(linked.user.phoneNumber ?? phone.trim());
      }
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Firebase sign-in session is no longer available.');
      await currentUser.getIdToken(true);
      const result = await verifyPhone.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: getGetFilmmakerProjectsQueryKey() });
      if (!result.phone_verified) {
        setFeedback('Firebase did not confirm a linked phone in the refreshed ID token. No verification badge was saved.');
        return;
      }
      setVerificationId('');
      setCode('');
      setFeedback('Your phone number is verified for your filmmaker account.');
    } catch (error) {
      if (error instanceof FirebaseError) {
        setFeedback(firebasePhoneError(error));
      } else if (error && typeof error === 'object' && 'status' in error) {
        const apiError = error as { status?: unknown; data?: unknown };
        const serverMessage = apiError.data && typeof apiError.data === 'object' && 'error' in apiError.data
          ? (apiError.data as { error?: unknown }).error
          : null;
        setFeedback(typeof serverMessage === 'string'
          ? serverMessage
          : `The phone was linked with Firebase, but server confirmation failed (HTTP ${String(apiError.status)}). Retry to finish saving verification.`);
      } else {
        setFeedback(error instanceof Error
          ? error.message
          : 'Phone verification could not be completed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (verified) {
    return <section aria-label="Phone verification" style={{ margin: '0 0 34px', padding: '18px 21px', border: '1px solid #87948a', background: '#eef1e9', color: '#455c50' }}>
      <p className="project-hub__eyebrow" style={{ color: '#455c50' }}>Contact verification</p>
      <p data-testid="badge-phone-verified" style={{ margin: '7px 0 0', fontWeight: 700 }}>✓ Phone verified for your filmmaker account</p>
    </section>;
  }

  return <section aria-label="Phone verification" style={{ margin: '0 0 34px', padding: '22px 24px', border: '1px solid #c9c0b2', background: '#faf7f0', color: '#202936' }}>
    <p className="project-hub__eyebrow">Contact verification / Optional</p>
    <h2 style={{ font: '400 30px/1.1 var(--app-font-serif, Georgia, serif)', margin: '8px 0' }}>Verify a phone number.</h2>
    <p style={{ margin: '0 0 16px', maxWidth: 700, color: '#62676a', fontSize: 13, lineHeight: 1.6 }}>Confirm your phone with an SMS code. The verified number is saved across your filmmaker records and shown as a verification badge on project pages.</p>
    {user.phoneNumber && <button type="button" className="project-hub__action project-hub__action--outline" data-testid="button-sync-linked-phone" disabled={syncing || busy} onClick={() => void syncExistingPhone()}>{syncing ? 'Syncing…' : 'Sync existing Firebase phone'}</button>}
    {!verificationId ? (
      <form onSubmit={event => void sendCode(event)} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 10 }}>
        <label style={{ display: 'grid', gap: 6, flex: '1 1 260px', maxWidth: 420, fontSize: 12, fontWeight: 700 }}>
          Phone number (include country code)
          <input type="tel" autoComplete="tel" required value={phone} onChange={event => setPhone(event.target.value)} placeholder="+14155552671" data-testid="input-filmmaker-phone" style={{ minHeight: 46, padding: '10px 12px', border: '1px solid #a6a4a0', color: '#202936', background: '#fff', font: 'inherit' }} />
        </label>
        <button type="submit" disabled={busy} className="project-hub__action" data-testid="button-send-phone-code">{busy ? 'Sending…' : 'Send SMS code'}</button>
      </form>
    ) : (
      <form onSubmit={event => void confirmCode(event)} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 10 }}>
        <label style={{ display: 'grid', gap: 6, flex: '1 1 220px', maxWidth: 320, fontSize: 12, fontWeight: 700 }}>
          SMS verification code
          <input type="text" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={event => setCode(event.target.value)} placeholder="123456" data-testid="input-filmmaker-phone-code" style={{ minHeight: 46, padding: '10px 12px', border: '1px solid #a6a4a0', color: '#202936', background: '#fff', font: 'inherit' }} />
        </label>
        <button type="submit" disabled={busy} className="project-hub__action" data-testid="button-confirm-phone-code">{busy ? 'Verifying…' : 'Verify phone'}</button>
        <button type="button" className="project-hub__text-button" disabled={busy} onClick={() => { setVerificationId(''); setCode(''); setFeedback(''); }}>Use another number</button>
      </form>
    )}
    <div ref={verifierElement} aria-hidden="true" />
    {feedback && <p role={feedback.includes('sent') || feedback.includes('verified') ? 'status' : 'alert'} data-testid="status-phone-verification" style={{ margin: '13px 0 0', color: feedback.includes('sent') || feedback.includes('verified') ? '#455c50' : '#853c4d', fontSize: 13 }}>{feedback}</p>}
  </section>;
}