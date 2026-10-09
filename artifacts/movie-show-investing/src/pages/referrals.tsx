import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetMyReferralsQueryKey, useCaptureReferral, useGetMyReferrals } from '@workspace/api-client-react';
import { getInitializedAuth, useFirebaseSessionReady } from '@/components/firebase-bootstrap';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { filmmakerInviteUrl } from '@/components/project-share';
import { useReferralIdentity } from '@/components/referral-claim';
import { REFERRAL_CODE_PATTERN, useReferralClaim, referralCaptureSaved } from '@/lib/referral-attribution';
import '../referrals.css';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const date = (v: string | null) => v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null;
const LABEL: Record<string, string> = { pending: 'Pending', eligible: 'Eligible', paid: 'Paid', cancelled: 'Cancelled', review_required: 'Under review' };

function Rules({ folded = false }: { folded?: boolean }) {
  const rules = <div className="ref-note" data-testid="text-referral-rules">
    <p>Earn $10 for each new person who signs up through your link and gets their first paid project approved and listed.</p>
    <p><strong className="font-bold">New accounts only</strong>. Existing members and your own signup don't count.</p>
    <p><strong className="font-bold">One reward per person</strong>. Declined and repeat projects don't count.</p>
    <p><strong className="font-bold">30-day window</strong>. Your link is remembered for 30 days from their first visit.</p>
    <p><strong className="font-bold">Paid by our team</strong>. Rewards are sent manually, not automatically.</p>
  </div>;
  return folded ? <details className="ref-box"><summary className="ref-kicker" style={{ cursor: 'pointer' }}>How rewards work</summary>{rules}</details> : rules;
}

function SignedOut() {
  const queryClient = useQueryClient();
  const ready = useFirebaseSessionReady();
  const capture = useCaptureReferral({ mutation: { retry: false } });
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ text: string; failed: boolean } | null>(null);
  const valid = REFERRAL_CODE_PATTERN.test(code.trim());
  async function save() {
    setMsg(null);
    try {
      const r = await capture.mutateAsync({ data: { code: code.trim(), manual: true } });
      if (r.saved) referralCaptureSaved();
      setMsg(r.saved ? { text: `Code saved until ${date(r.expires_at)}. Sign in below to finish.`, failed: false } : { text: 'That code was not saved. A code already used for a signup cannot be replaced.', failed: true });
    } catch { setMsg({ text: 'We could not save that code. Check it and try again.', failed: true }); }
  }
  return <>
    <h1 className="serif ref-title">Bring a filmmaker. <em>Earn $10.</em></h1>
    <p className="ref-lede">Sign in to get a personal referral link. Already have a code from a friend? Enter it before you sign up; once you have an account it cannot be changed.</p>
    <Rules />
    <div className="ref-box">
      <label htmlFor="ref-code-input" className="ref-kicker">Have a referral code? (optional)</label>
      <div className="ref-row">
        <input id="ref-code-input" className="ref-input" value={code} onChange={e => setCode(e.target.value)} maxLength={32} autoComplete="off" placeholder="Enter code" data-testid="input-referral-code" />
        <button type="button" className="ref-btn alt" disabled={!valid || capture.isPending} onClick={() => void save()} data-testid="button-save-referral-code">{capture.isPending ? 'Saving…' : 'Save code'}</button>
      </div>
      {msg && <p className={msg.failed ? 'ref-err' : 'ref-note'} role={msg.failed ? 'alert' : 'status'} data-testid="status-referral-code">{msg.text}</p>}
    </div>
    <div className="ref-row"><GoogleSignInButton auth={getInitializedAuth()} queryClient={queryClient} disabled={!ready} className="ref-btn" testId="button-referrals-sign-in" label="Sign in to get my link" /></div>
  </>;
}

function Member({ identity }: { identity: string }) {
  const claim = useReferralClaim();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const q = useGetMyReferrals({ query: { queryKey: [...getGetMyReferralsQueryKey(), identity], enabled: claim.identity === identity && claim.status === 'done', retry: false, staleTime: 30_000, refetchOnWindowFocus: true } });
  const d = q.data;
  const link = d ? filmmakerInviteUrl(d.code) : '';
  async function copy() {
    setCopyFailed(false);
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); setCopyFailed(true); }
  }
  return <>
    <h1 className="serif ref-title">My referrals</h1>
    {claim.identity === identity && claim.status === 'error' && <p className="ref-err" role="alert" data-testid="error-referral-claim">We could not apply a referral to your account. <button type="button" className="underline font-semibold" onClick={claim.retry} data-testid="button-retry-claim">Try again</button></p>}
    {claim.identity === identity && claim.status === 'pending' && <p className="ref-note" role="status">Checking for a referral…</p>}
    {q.isPending ? <div role="status" aria-label="Loading referrals" data-testid="status-referrals-loading"><div className="ref-skel" /><div className="ref-skel" style={{ height: 120 }} /><div className="ref-skel" /></div>
    : q.isError ? <div className="ref-box" role="alert" data-testid="error-referrals"><p>Your referrals could not be loaded.</p><button type="button" className="ref-btn" onClick={() => void q.refetch()} data-testid="button-retry-referrals">Try again</button></div>
    : d && <>
      <div className="ref-box">
        <p className="ref-kicker">Your code</p>
        <p className="ref-code" data-testid="text-referral-code">{d.code}</p>
        <p className="ref-note" data-testid="text-referral-link" style={{ wordBreak: 'break-all' }}>{link}</p>
        <div className="ref-row"><button type="button" className="ref-btn" onClick={() => void copy()} data-testid="button-copy-referral-link">{copied ? 'Link copied' : 'Copy link'}</button></div>
         {copyFailed && <p role="alert" className="ref-err">Copy was blocked by your browser. Select and copy the link above.</p>}
        {d.referred_by && <p className="ref-note" data-testid="text-referred-by">You joined through someone else's referral.</p>}
      </div>
      <div className="ref-grid">
        <div className="ref-stat"><span className="ref-kicker">Signups</span><b data-testid="text-signup-count">{d.signup_count}</b></div>
        <div className="ref-stat"><span className="ref-kicker">Pending</span><b data-testid="text-pending-count">{d.pending_count}</b></div>
        <div className="ref-stat"><span className="ref-kicker">Eligible</span><b data-testid="text-eligible-amount">{money(d.eligible_cents)}</b></div>
        <div className="ref-stat"><span className="ref-kicker">Paid</span><b data-testid="text-paid-amount">{money(d.paid_cents)}</b></div>
      </div>
      <h2 className="ref-kicker">Reward history</h2>
      {d.rewards.length === 0 ? <div className="ref-box" data-testid="status-rewards-empty"><p>No rewards yet. Share your link to get started.</p></div>
      : <ul className="ref-hist" data-testid="list-rewards">{d.rewards.map(r => <li key={r.id} data-testid={`row-reward-${r.id}`}>
        <span>{money(r.amount_cents)}{r.paid_at ? ` · paid ${date(r.paid_at)}` : r.payment_checked_at ? ` · checked ${date(r.payment_checked_at)}` : ''}{r.review_flag ? ' · being reviewed by our team' : ''}</span>
        <span className="ref-pill">{LABEL[r.status] ?? r.status}</span></li>)}</ul>}
      <Rules folded />
    </>}
  </>;
}

export default function Referrals() {
  const identity = useReferralIdentity();
  const ready = useFirebaseSessionReady();
  return <section className="ref-page"><div className="page-wrap">
    <p className="ref-kicker">Referrals</p>
    {identity ? <Member key={identity} identity={identity} /> : !ready ? <div className="ref-skel" role="status" aria-label="Loading" /> : <SignedOut />}
  </div></section>;
}
