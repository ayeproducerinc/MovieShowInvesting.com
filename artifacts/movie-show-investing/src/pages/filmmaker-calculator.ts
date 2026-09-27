export type Stage = 'distribution' | 'production' | 'idea' | 'other';
export type Format = 'movie' | 'show';

export const phase = (stage: Stage) => stage === 'other' ? 'idea' : stage;
export const examples = (stage: Stage, format: Format): number[] => {
  if (phase(stage) === 'distribution') return [25000, 50000, 100000];
  if (phase(stage) === 'production') return format === 'movie' ? [200000] : [350000, 450000];
  return [format === 'movie' ? 50000 : 65000];
};
export const standardOffer = (stage: Stage) => phase(stage) === 'distribution' ? 125 : phase(stage) === 'production' ? 150 : 175;
export const validListedOffer = (amount: number | null) => amount !== null && Number.isSafeInteger(amount) && amount >= 125;
export const money = (value: number) => '$' + Math.floor(value).toLocaleString('en-US');

export function restoreWorksheet<T extends object>(defaults: T, saved: Record<string, unknown>, lastScreen: number) {
  return {
    answers: { ...defaults, ...saved } as T,
    screen: Number.isFinite(lastScreen) ? Math.min(6, Math.max(1, Math.trunc(lastScreen))) : 1,
  };
}

/** Illustrative amounts only; not a financial projection or an offer. */
export function calculateDeal(budget: number, stage: Stage, group: 'A' | 'B', offer: number) {
  const safeBudget = Number.isSafeInteger(budget) && budget > 0 ? budget : 0;
  const feeRate = phase(stage) === 'distribution' ? group === 'B' ? 15 : 25 : phase(stage) === 'production' ? 20 : 15;
  const investorTarget = Math.floor(safeBudget * offer / 100);
  const platformFee = Math.floor(safeBudget * feeRate / 100);
  return {
    investorTarget,
    platformFee,
    combinedPayback: investorTarget + platformFee,
    feeRate,
    filmmakerAfter: phase(stage) === 'distribution' ? 67 : phase(stage) === 'production' ? 60 : 100,
  };
}