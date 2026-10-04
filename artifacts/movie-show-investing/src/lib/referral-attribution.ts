import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { captureReferral, getGetMyReferralsQueryKey } from '@workspace/api-client-react';
import type { ReferralMember } from '@workspace/api-client-react';

export const REFERRAL_CODE_PATTERN = /^[A-Fa-f0-9]{12}$/;
export type ClaimStatus = 'idle' | 'pending' | 'done' | 'error';
type ClaimState = { identity: string | null; status: ClaimStatus };

function incomingCode(): string | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('ref')?.trim() ?? '';
  return REFERRAL_CODE_PATTERN.test(value) ? value : null;
}

// Runs at module load, before any sign-in or account attribution can finalize.
// The server owns the 30-day cookie; nothing credential-like is kept here.
const code = incomingCode();
let captureState: 'idle' | 'pending' | 'saved' | 'error' = code ? 'pending' : 'idle';
let capturePromise: Promise<void> = Promise.resolve();
const captureListeners = new Set<() => void>();
function reportCapture(next: typeof captureState) {
  captureState = next;
  captureListeners.forEach(listener => listener());
}
export function useReferralCaptureStatus() {
  return useSyncExternalStore(listener => {
    captureListeners.add(listener); return () => captureListeners.delete(listener);
  }, () => captureState, () => 'idle');
}
export function referralCaptureSaved() {
  capturePromise = Promise.resolve();
  reportCapture('saved');
}
export function retryReferralCapture() {
  if (!code) return;
  reportCapture('pending');
  capturePromise = captureReferral({ code }).then(
    () => reportCapture('saved'), () => reportCapture('error'));
}
if (code) retryReferralCapture();

let state: ClaimState = { identity: null, status: 'idle' };
let retryRunner: (() => void) | null = null;
const claimed = new Set<string>();
const pendingClaims = new Set<string>();
const listeners = new Set<() => void>();
function setState(next: ClaimState) { state = next; listeners.forEach(l => l()); }

export function useReferralClaim() {
  const snap = useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
  return { ...snap, retry: () => retryRunner?.() };
}

/** Once per identity, after the incoming capture settled. Non-blocking. */
export function claimForIdentity(
  identity: string | null,
  claim: () => Promise<ReferralMember>,
  queryClient: QueryClient,
  currentIdentity: () => string | null,
) {
  if (!identity) { retryRunner = null; if (state.identity !== null) setState({ identity: null, status: 'idle' }); return; }
  if (claimed.has(identity)) {
    if (state.identity !== identity || state.status !== 'done') setState({ identity, status: 'done' });
    return;
  }
  if (pendingClaims.has(identity)) return;
  const run = () => {
    pendingClaims.add(identity);
    setState({ identity, status: 'pending' });
    void capturePromise.then(() => {
      if (captureState === 'error') throw new Error('Referral capture failed');
      if (currentIdentity() !== identity) throw new Error('Account changed');
      return claim();
    }).then(result => {
      pendingClaims.delete(identity);
      claimed.add(identity);
      if (currentIdentity() !== identity) return;
      queryClient.setQueryData([...getGetMyReferralsQueryKey(), identity], result);
      setState({ identity, status: 'done' });
    }, () => {
      pendingClaims.delete(identity);
      if (currentIdentity() === identity) setState({ identity, status: 'error' });
    });
  };
  retryRunner = run;
  run();
}
