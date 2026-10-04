import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminReferralsQueryKey, getGetMyReferralsQueryKey, useGetAdminReferrals,
  useRecordReferralPayout, useVerifyReferralReward,
} from '@workspace/api-client-react';
import type { ReferralLedgerRow } from '@workspace/api-client-react';
import '../referrals.css';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const MILESTONE: Record<string, string> = {
  signed_up: 'Signed up', paid_pending_review: 'Paid, awaiting review', declined: 'Project declined', not_public: 'Approved, not public', listed: 'Publicly listed',
};
const STATUS_FILTERS = ['all', 'no_reward', 'pending', 'eligible', 'paid', 'cancelled', 'review_required'] as const;
const when = (v: string | null) => v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

export function AdminReferrals({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('all');
  const [search, setSearch] = useState('');
  const [payoutFor, setPayoutFor] = useState<ReferralLedgerRow | null>(null);
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [sent, setSent] = useState(false);
  const [result, setResult] = useState<{ message: string; failed: boolean } | null>(null);
  const verify = useVerifyReferralReward();
  const payout = useRecordReferralPayout();
  const ledger = useGetAdminReferrals({ page }, {
    query: { queryKey: [...getGetAdminReferralsQueryKey({ page }), userId], retry: false, staleTime: 20_000, refetchOnWindowFocus: true, placeholderData: prev => prev },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (ledger.data?.rows ?? []).filter(r => {
      if (status === 'no_reward' ? r.reward : status !== 'all' && r.reward?.status !== status) return false;
      return !q || r.referrer_email.toLowerCase().includes(q) || r.referred_email.toLowerCase().includes(q);
    });
  }, [ledger.data, status, search]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: getGetAdminReferralsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetMyReferralsQueryKey() });
  }
  async function doVerify(rewardId: number) {
    setResult(null);
    try { await verify.mutateAsync({ rewardId }); setResult({ message: `Reward ${rewardId} re-checked with the server.`, failed: false }); await refresh(); }
    catch { setResult({ message: `Could not verify reward ${rewardId}. Try again.`, failed: true }); }
  }
  async function openPayout(row: ReferralLedgerRow) {
    if (!row.reward) return;
    setResult(null);
    try {
      const checked = await verify.mutateAsync({ rewardId: row.reward.id });
      await refresh();
      if (checked.status !== 'eligible') {
        setResult({ message: 'This reward is not currently eligible. Do not send a payout.', failed: true });
        return;
      }
      setPayoutFor({ ...row, reward: checked });
      setReference(''); setPaidOn(''); setSent(false);
    } catch {
      setResult({ message: 'Payment could not be verified. Do not send a payout; try verification again.', failed: true });
    }
  }
  async function doPayout() {
    if (!payoutFor?.reward) return;
    setResult(null);
    try {
      await payout.mutateAsync({ rewardId: payoutFor.reward.id, data: { reference: reference.trim(), paid_on: paidOn, confirmed_sent: sent } });
      setResult({ message: `Payout record saved for reward ${payoutFor.reward.id}. No money was sent by this site.`, failed: false });
      setPayoutFor(null); setReference(''); setPaidOn(''); setSent(false);
      await refresh();
    } catch { setResult({ message: 'The payout record was not saved. The server may have found the reward is no longer eligible. Verify it and try again.', failed: true }); }
  }

  const data = ledger.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return <div data-testid="section-admin-referrals">
    <p data-testid="text-referral-rules">Rule: $10 once per new person, only after they sign up and their first paid project is approved and publicly listed. Payment alone, declined or repeat projects earn nothing; existing users and self-referrals do not qualify. Payouts are manual. Recording a payout sends no money; it only records money you already sent yourself.</p>
    {result && <p className={`admin-review-feedback ${result.failed ? 'error' : ''}`} role={result.failed ? 'alert' : 'status'} data-testid="status-referral-result">{result.message}</p>}
    <div className="ref-admin-bar">
      <input type="search" aria-label="Search emails on this page" placeholder="Search emails on this page" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-referral-search" />
      <select aria-label="Filter by reward status" value={status} onChange={e => setStatus(e.target.value as typeof status)} data-testid="select-referral-status">
        {STATUS_FILTERS.map(s => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s === 'no_reward' ? 'No reward yet' : s.replace('_', ' ')}</option>)}
      </select>
    </div>
    {ledger.isPending ? <div role="status" aria-label="Loading referrals" data-testid="status-referrals-loading"><div className="admin-skeleton" style={{ height: 30 }} /><div className="admin-skeleton" /><div className="admin-skeleton" /></div>
    : ledger.isError ? <div className="admin-state" role="alert" data-testid="status-referrals-error"><h2>Referrals could not be loaded</h2><p>{(ledger.error as { status?: number } | null)?.status === 403 ? 'Access was denied.' : 'The connection failed.'}</p><button type="button" className="admin-button secondary" onClick={() => void ledger.refetch()} data-testid="button-retry-referrals">Try again</button></div>
    : !data || data.rows.length === 0 ? <div className="admin-state" data-testid="status-referrals-empty"><h2>No referrals yet</h2><p>Signups that arrive through a referral link will appear here with their milestones.</p></div>
    : <>
      {rows.length === 0 ? <p data-testid="status-referrals-no-match">No rows on this page match the filters.</p> : <div className="admin-table-wrap"><table className="admin-table" data-testid="table-referrals">
        <thead><tr><th scope="col">Referrer</th><th scope="col">Referred</th><th scope="col">Signed up</th><th scope="col">Project</th><th scope="col">Milestone</th><th scope="col">Reward</th><th scope="col">Actions</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.referral_id} data-testid={`row-referral-${r.referral_id}`}>
          <td>{r.referrer_email}</td><td>{r.referred_email}</td><td>{when(r.signed_up_at)}</td>
          <td>{r.project_id ?? '—'}</td><td>{MILESTONE[r.milestone] ?? r.milestone}</td>
          <td>{r.reward ? <>{money(r.reward.amount_cents)} · {r.reward.status.replace('_', ' ')}{r.reward.review_flag ? ' · flagged' : ''}{r.reward.paid_at ? ` · paid ${when(r.reward.paid_at)}` : ''}{r.reward.payout_reference ? ` · ref ${r.reward.payout_reference}` : ''}</> : '—'}</td>
          <td>{r.reward ? <div className="ref-cell-actions">
            <button type="button" disabled={verify.isPending} onClick={() => void doVerify(r.reward!.id)} data-testid={`button-verify-reward-${r.reward.id}`}>Verify</button>
            {r.reward.status === 'eligible' && <button type="button" disabled={verify.isPending || payout.isPending} onClick={() => void openPayout(r)} data-testid={`button-payout-reward-${r.reward.id}`}>Record payout</button>}
          </div> : <span className="admin-action-na">—</span>}</td>
        </tr>)}</tbody></table></div>}
      <div className="ref-admin-bar" style={{ alignItems: 'center' }}>
        <button type="button" className="admin-button secondary" disabled={page <= 1 || ledger.isFetching} onClick={() => setPage(p => p - 1)} data-testid="button-referrals-prev">Previous</button>
        <span className="admin-mono" data-testid="text-referrals-page">Page {data.page} of {pages} · {data.total.toLocaleString()} total</span>
        <button type="button" className="admin-button secondary" disabled={page >= pages || ledger.isFetching} onClick={() => setPage(p => p + 1)} data-testid="button-referrals-next">Next</button>
      </div>
    </>}
    {payoutFor?.reward && <form className="ref-payout" onSubmit={e => { e.preventDefault(); void doPayout(); }} data-testid="form-referral-payout">
      <h3 className="admin-overline admin-mono">Record payout / reward {payoutFor.reward.id}</h3>
      <p>{money(payoutFor.reward.amount_cents)} to {payoutFor.referrer_email}. Payment and listing were checked {when(payoutFor.reward.payment_checked_at)}. <strong>This only records a payout. It sends no money.</strong> Send the funds yourself first.</p>
      <label>Payout reference<input type="text" required minLength={3} maxLength={120} value={reference} onChange={e => setReference(e.target.value)} data-testid="input-payout-reference" /></label>
      <label>Date sent<input type="date" required value={paidOn} onChange={e => setPaidOn(e.target.value)} data-testid="input-payout-date" /></label>
      <label className="chk"><input type="checkbox" checked={sent} onChange={e => setSent(e.target.checked)} data-testid="checkbox-payout-sent" /><span>I confirm this money has already been sent outside this site.</span></label>
      <div className="ref-cell-actions">
        <button type="submit" className="admin-button" disabled={payout.isPending || !sent || reference.trim().length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)} data-testid="button-submit-payout">{payout.isPending ? 'Saving…' : 'Record payout'}</button>
        <button type="button" className="admin-button secondary" onClick={() => setPayoutFor(null)} data-testid="button-cancel-payout">Cancel</button>
      </div>
    </form>}
  </div>;
}
