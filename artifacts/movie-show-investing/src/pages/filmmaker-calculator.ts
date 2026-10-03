export type Stage = 'distribution' | 'production' | 'idea';
export type Format = 'movie' | 'show';

export const phase = (stage: Stage) => stage;
export const examples = (stage: Stage, format: Format): number[] => {
  if (phase(stage) === 'distribution') return [25000, 50000, 100000];
  if (phase(stage) === 'production') return format === 'movie' ? [200000] : [350000, 450000];
  return [format === 'movie' ? 50000 : 65000];
};
export const standardOffer = (stage: Stage) => phase(stage) === 'distribution' ? 125 : phase(stage) === 'production' ? 150 : 175;
export const validListedOffer = (amount: number | null) => amount !== null && Number.isSafeInteger(amount) && amount >= 125;
export const money = (value: number) => {
  const cents = Math.round(value * 100) / 100;
  const whole = Number.isInteger(cents);
  return '$' + cents.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
};
const toCents = (n: number) => Math.round(n * 100) / 100;

export const FLOW_VERSION = 2;
/** Every forward transition stays in the five-step flow, including a repeated shortcut. */
export function filmmakerDestination(current: number, requested: number, noProject: boolean): number {
  return noProject && current <= 2 ? 5 : Math.min(5, Math.max(1, requested));
}
export const REVENUE_BASIS_NOTE = 'Backend revenue splits are calculated and paid from project revenue remaining after payment-processing fees and distribution fees have been deducted. The agreed investor–filmmaker percentages apply to that remaining amount, not to gross revenue.';
export const BACKEND_EXAMPLE = 'Illustration only: $1,000 in project revenue minus $100 in payment-processing and distribution fees leaves $900. At a 50/50 backend split, investors receive $450 and the filmmaker receives $450. The $100 is an example, not a fee rate or forecast.';
export const platformFeePercent = (stage: Stage) => stage === 'distribution' ? 15 : stage === 'production' ? 10 : 5;
export const STANDARD_BACKEND = { investorPercent: 50, years: 5 } as const;
export const MAX_BUDGET = 2147483647;
export const MIN_REPAYMENT = 125;
export const MAX_REPAYMENT = 10000;
export const EARLY_EXAMPLE = 10;

/** Legacy six-step drafts: old 4 (offer) -> new 3, old 5 -> 4, old 6 -> 5. */
export function mapLegacyScreen(oldScreen: number): number {
  const s = Number.isFinite(oldScreen) ? Math.trunc(oldScreen) : 1;
  if (s <= 3) return Math.max(1, s);
  return Math.min(5, s - 1);
}

export function restoreWorksheet<T extends object>(defaults: T, saved: Record<string, unknown>, lastScreen: number) {
  const isV2 = saved.flow_version === FLOW_VERSION;
  const raw = Number.isFinite(lastScreen) ? Math.trunc(lastScreen) : 1;
  return {
    answers: { ...defaults, ...saved, flow_version: FLOW_VERSION } as T,
    screen: isV2 ? Math.min(5, Math.max(1, raw)) : mapLegacyScreen(Math.min(6, Math.max(1, raw))),
    legacy: !isV2,
  };
}

export type ProposalFields = { repayment: string; investorBackend: string; years: string; earlyOn: boolean; early: string };
export type ParsedProposal = { ok: true; repayment: number; investorBackend: number; years: number; early: number } | { ok: false; errors: Partial<Record<'repayment' | 'backend' | 'years' | 'early', string>> };
const intOf = (v: string) => (/^\d+$/.test(v.trim()) && Number.isSafeInteger(Number(v)) ? Number(v) : null);

/** Validates custom terms. Unsupported values produce specific errors; nothing is clamped. */
export function parseCustomProposal(f: ProposalFields): ParsedProposal {
  const errors: Partial<Record<'repayment' | 'backend' | 'years' | 'early', string>> = {};
  const repayment = intOf(f.repayment);
  if (repayment === null || repayment < MIN_REPAYMENT || repayment > MAX_REPAYMENT) errors.repayment = `Enter a whole number from $${MIN_REPAYMENT} to $${MAX_REPAYMENT.toLocaleString('en-US')} per $100 invested, including original capital.`;
  const investorBackend = intOf(f.investorBackend);
  if (investorBackend === null || investorBackend > 100) errors.backend = 'Investor backend share must be a whole percentage from 0 to 100. The filmmaker share is the remainder.';
  const years = intOf(f.years);
  if (years === null || years < 1 || years > 100) errors.years = 'Backend duration must be a whole number of years from 1 to 100.';
  let early = 0;
  if (f.earlyOn) {
    const e = intOf(f.early);
    if (e === null || e < 1 || e > 99) errors.early = 'Early filmmaker share must be a whole percentage from 1 to 99 so investors keep a positive share.';
    else early = e;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, repayment: repayment!, investorBackend: investorBackend!, years: years!, early };
}

export type ProposalView = { repayment: number; investorBackend: number | null; years: number | null; early: number | null; decision: 'standard' | 'negotiation' | null; original: number | null; feePercent: number | null; structured: boolean; note?: string | null };
/** Normalise a saved API proposal (or historical fields without one) for display. */
export function proposalView(proposal: { decision: 'standard' | 'negotiation'; repayment_per100: number; investor_backend_percent: number; backend_years: number; early_filmmaker_percent: number; original_repayment_per100?: number; platform_fee_percent?: number; note?: string } | null | undefined, legacyRepayment: number | null | undefined): ProposalView | null {
  if (proposal) return { repayment: proposal.repayment_per100, investorBackend: proposal.investor_backend_percent, years: proposal.backend_years, early: proposal.early_filmmaker_percent, decision: proposal.decision, original: proposal.original_repayment_per100 ?? null, feePercent: proposal.platform_fee_percent ?? null, structured: true, note: proposal.note } as ProposalView;
  if (legacyRepayment) return { repayment: legacyRepayment, investorBackend: null, years: null, early: null, decision: null, original: null, feePercent: null, structured: false };
  return null;
}

/** Illustrative amounts only; not a financial projection or an offer. Fee = budget * rate; target = budget * repayment/100. */
export function calculateDeal(budget: number, stage: Stage, _group: 'A' | 'B' | string, offer: number) {
  void _group;
  const safeBudget = Number.isSafeInteger(budget) && budget > 0 ? budget : 0;
  const feeRate = platformFeePercent(stage);
  const investorTarget = toCents(safeBudget * offer / 100);
  const platformFee = toCents(safeBudget * feeRate / 100);
  return { investorTarget, platformFee, combinedPayback: toCents(investorTarget + platformFee), feeRate };
}

/** Historical submissions without a proposal snapshot keep their original fee rates and after-share. */
export function legacyDeal(budget: number, stage: Stage, group: 'A' | 'B', offer: number) {
  const feeRate = stage === 'distribution' ? (group === 'B' ? 15 : 25) : stage === 'production' ? 20 : 15;
  const investorTarget = toCents(budget * offer / 100);
  const platformFee = toCents(budget * feeRate / 100);
  return { investorTarget, platformFee, combinedPayback: toCents(investorTarget + platformFee), feeRate, filmmakerAfter: stage === 'distribution' ? 67 : stage === 'production' ? 60 : 100 };
}
