import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useClaimReferral } from '@workspace/api-client-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { claimForIdentity, useReferralCaptureStatus, retryReferralCapture } from '@/lib/referral-attribution';

export function useReferralIdentity(): string | null {
  const replit = useAuth();
  const user = useFirebaseUser();
  const ready = useFirebaseSessionReady();
  if (replit.isLoading) return null;
  if (replit.user) return `r:${replit.user.id}`;
  return ready && user ? `f:${user.uid}` : null;
}

export function ReferralClaim() {
  const identity = useReferralIdentity();
  const captureStatus = useReferralCaptureStatus();
  const queryClient = useQueryClient();
  const { mutateAsync } = useClaimReferral({ mutation: { retry: false } });
  const claimRef = useRef(mutateAsync);
  claimRef.current = mutateAsync;
  const idRef = useRef(identity);
  idRef.current = identity;
  useEffect(() => {
    claimForIdentity(identity, () => claimRef.current(), queryClient, () => idRef.current);
  }, [identity, queryClient, captureStatus]);
  return captureStatus === 'error'
    ? <div role="alert" className="page-wrap py-3 text-sm" data-testid="error-incoming-referral">Your referral link could not be saved. Please retry before signing up. <button type="button" className="underline" onClick={retryReferralCapture}>Retry referral</button> · <a className="underline" href={`${import.meta.env.BASE_URL}referrals`}>Check or enter a code</a></div>
    : null;
}
