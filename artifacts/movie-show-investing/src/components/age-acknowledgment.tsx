import { useState } from 'react';
import { useFirebaseUser } from '@/components/firebase-bootstrap';
import { useQueryClient } from '@tanstack/react-query';
import { getGetAgeConfirmationQueryKey, useConfirmAge, useGetAgeConfirmation } from '@workspace/api-client-react';

export type AgeRole = 'investor' | 'filmmaker';
export const AGE_LABEL = 'I confirm that I am 18 years of age or older.';
export const AGE_INTRO = 'You must be 18 or older to submit a film project or register investment interest.';
const KYC_CAPACITY: Record<AgeRole, string> = {
  investor: 'investing as an investor',
  filmmaker: 'receiving investment funding as a filmmaker',
};
export const kycParagraphs = (role: AgeRole): [string, string] => [
  `You must be 18 or older to participate. If an investment offering opens, you will be required to verify your date of birth and identity using a government-issued photo ID through a Know Your Customer (KYC) process before ${KYC_CAPACITY[role]}.`,
  'We are not collecting your date of birth or ID during this onboarding. Completing onboarding does not guarantee that an offering will open or that you will be eligible to participate.',
];

/** Provider-qualified identity (firebase:uid); raw ids can collide across providers. */
export function useAgeIdentityKey() {
  const firebaseUser = useFirebaseUser();
  return firebaseUser ? `firebase:${firebaseUser.uid}` : 'visitor';
}

/** Account-scoped age status. The key always includes the provider-qualified identity so accounts never share an acknowledgment. */
export function useAgeStatus() {
  const identityKey = useAgeIdentityKey();
  const enabled = identityKey !== 'visitor';
  const queryKey = [...getGetAgeConfirmationQueryKey(), identityKey];
  const query = useGetAgeConfirmation({ query: { queryKey, enabled, retry: false } });
  return { confirmed: enabled && query.data?.age_confirmed === true, confirmedAt: enabled ? query.data?.confirmed_at ?? null : null, loading: enabled && query.isLoading, queryKey, query };
}

/** Presentational checkbox + role-specific future-verification disclosure. Self-declared only. */
export function AgeAcknowledgment({ role, checked, onChange, disabled, savedAt, error }: { role: AgeRole; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; savedAt?: string | null; error?: string }) {
  const [p1, p2] = kycParagraphs(role);
  return <section className="age-ack" data-testid={`section-age-${role}`} aria-labelledby={`age-h-${role}`}>
    <p className="age-ack-intro">{AGE_INTRO}</p>
    <label className="age-ack-check">
      <input type="checkbox" data-testid="checkbox-age-confirmed" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} aria-invalid={Boolean(error)} />
      <span>{AGE_LABEL}</span>
    </label>
    {savedAt && <p className="age-ack-small" data-testid="text-age-saved">Saved to your account on {new Date(savedAt).toLocaleDateString('en-US')}. This is a self-declaration, not verified.</p>}
    {error && <p className="age-ack-error" role="alert">{error}</p>}
    <h3 id={`age-h-${role}`} className="age-ack-heading">Future identity verification</h3>
    <p className="age-ack-small" data-testid="text-kyc-1">{p1}</p>
    <p className="age-ack-small" data-testid="text-kyc-2">{p2}</p>
  </section>;
}

/**
 * Stand-alone gate for returning accounts without a saved confirmation (signature, review checkout).
 * Posts the explicit acknowledgment from the same screen; renders children once confirmed.
 */
export function AgeGate({ role, children }: { role: AgeRole; children: React.ReactNode }) {
  const identityKey = useAgeIdentityKey();
  return <AgeGateContent key={identityKey} role={role}>{children}</AgeGateContent>;
}

function AgeGateContent({ role, children }: { role: AgeRole; children: React.ReactNode }) {
  const status = useAgeStatus();
  const confirm = useConfirmAge();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  if (status.loading) return <div className="age-ack-small" role="status">Checking your age confirmation…</div>;
  if (status.confirmed) return <>{children}</>;
  async function save() {
    setError('');
    try {
      await confirm.mutateAsync({ data: { age_confirmed: true } });
      await queryClient.invalidateQueries({ queryKey: status.queryKey });
    } catch {
      setError('We could not save your confirmation. Your work is unchanged; check your connection and try again.');
    }
  }
  return <div data-testid="gate-age">
    {status.query.isError && <p className="age-ack-error" role="alert">We could not check your saved confirmation. <button type="button" className="underline" data-testid="button-retry-age" onClick={() => void status.query.refetch()}>Retry</button> or confirm below.</p>}
    <AgeAcknowledgment role={role} checked={checked} onChange={v => { setChecked(v); setError(''); }} error={error} />
    <button type="button" className="age-ack-button" data-testid="button-save-age" disabled={!checked || confirm.isPending} onClick={() => void save()}>{confirm.isPending ? 'Saving…' : 'Save my confirmation'}</button>
    <p className="age-ack-small">Saving your confirmation does not complete the step. Come back to the action below once it is saved.</p>
  </div>;
}

export const AgeGateForCurrentUser = AgeGate;
