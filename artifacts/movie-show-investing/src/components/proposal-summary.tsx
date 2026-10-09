import { calculateDeal, money, proposalView, REVENUE_BASIS_NOTE, type Stage } from '@/pages/filmmaker-calculator';
import { illustrateReceipts } from '@/lib/proposal-receipts';

type ProposalLike = Parameters<typeof proposalView>[0];

/** Read-only account of the actual saved proposal. Never substitutes stage defaults for historical records. */
export function ProposalSummary({ proposal, legacyRepayment, budget, developmentAmount, stage, allocation, testId = 'proposal-summary' }: { proposal: ProposalLike; legacyRepayment?: number | null; developmentAmount?: number | null; budget?: number | null; stage?: string | null; allocation?: number; testId?: string }) {
  const view = proposalView(proposal, legacyRepayment);
  if (!view) return <p className="prop-small" data-testid={`${testId}-none`}>Repayment terms not specified.</p>;
  const knownStage = stage === 'distribution' || stage === 'production' || stage === 'idea' ? (stage as Stage) : null;
  const feePct = view.structured ? view.feePercent : null; // stored snapshot only; never today's rate
  const deal = budget && knownStage ? calculateDeal(budget, knownStage, 'A', view.repayment) : null;
  const target = allocation ? Math.round(allocation * view.repayment) / 100 : null;
  const earlyExample = view.structured && view.early !== null && view.investorBackend !== null
    ? illustrateReceipts(1000, deal?.investorTarget ?? 1000, view.early, view.investorBackend)
    : null;
  return <div className="prop-summary" data-testid={testId}>
    <p className="prop-kicker">{view.decision === 'negotiation' ? 'Open to negotiation' : view.decision === 'standard' ? 'Standard terms accepted' : 'Earlier submission'}{view.structured && view.original && view.original !== view.repayment ? ` · platform suggested ${money(view.original)}` : ''}</p>
    <dl>
      <div><dt>Investor repayment target</dt><dd data-testid={`${testId}-repayment`}>{money(view.repayment)} per $100 invested, including original capital</dd></div>
      {view.structured && view.investorBackend !== null
        ? <div><dt>Then backend split</dt><dd data-testid={`${testId}-backend`}>{view.investorBackend}% investors / {100 - view.investorBackend}% filmmaker for {view.years} {view.years === 1 ? 'year' : 'years'}, starting after the full investor target is paid</dd></div>
        : <div><dt>Backend split and duration</dt><dd data-testid={`${testId}-backend`}>Not specified in this earlier submission</dd></div>}
      {view.structured && <div><dt>Payment while investors repay</dt><dd data-testid={`${testId}-early`}>{view.early ? `Filmmaker proposes ${view.early}% / investors ${100 - view.early}% of available receipts while the target is outstanding` : 'Investors first; no early filmmaker revenue share'}</dd></div>}
      {deal && <div><dt>Project budget</dt><dd data-testid={`${testId}-budget`}>{money(budget!)}</dd></div>}
      {developmentAmount != null && <div><dt>Development amount</dt><dd data-testid={`${testId}-development`}>{money(developmentAmount)}</dd></div>}
      {deal && <div><dt>Investor target for that budget</dt><dd>{money(deal.investorTarget)}</dd></div>}
      {deal && feePct !== null && <div><dt>Platform fee, separate · {feePct}% of budget</dt><dd>{money(Math.round(budget! * feePct) / 100)}</dd></div>}
      {target !== null && <div><dt>Your allocation of {money(allocation!)} → repayment target</dt><dd data-testid={`${testId}-allocation`}>{money(target)}</dd></div>}
    </dl>
    {view.note && <p className="prop-small">Filmmaker note: {view.note}</p>}
    {view.structured && <p className="prop-small" data-testid={`${testId}-backend-note`}>{REVENUE_BASIS_NOTE}</p>}
    <p className="prop-small" data-testid={`${testId}-fee-note`}>The platform fee is a separate, one-time amount based on the original project budget, not a recurring percentage of revenue. Available receipts after processing fees go toward the remaining investor target and the platform fee in proportion; neither has priority.{feePct === null ? ' The fee rate for this submission is not itemized here.' : ''}</p>
    {view.structured && view.early && earlyExample ? <p className="prop-small" data-testid={`${testId}-early-example`}>Project-pool example: if $1,000 is available after applicable fees and {deal ? 'the full displayed investor target' : 'an illustrative $1,000 investor target'} is outstanding, {money(earlyExample.earlyFilmmakerPayment)} goes to the filmmaker during repayment and {money(earlyExample.investorRepayment)} reduces that target. {earlyExample.backendReceipts > 0 ? `The target is reached within this payment; only the remaining ${money(earlyExample.backendReceipts)} enters the backend split (${money(earlyExample.investorBackend)} to investors and ${money(earlyExample.filmmakerBackend)} to the filmmaker). ` : ''}The target itself is unchanged. This is one project-pool illustration, not an additional full payment for each investor.</p> : null}
    <p className="prop-small">Illustrative and revenue-dependent. Not a guaranteed return, payment date or offer to invest. {feePct === null ? 'Fee details follow the original submission.' : ''}</p>
  </div>;
}
