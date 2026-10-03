/**
 * A single project-pool illustration, not a payment engine or forecast.
 * available is already net of applicable cost/fee allocations. This function
 * must not deduct processing, distribution, or platform fees a second time.
 */
export function illustrateReceipts(
  available: number,
  outstandingInvestorTarget: number,
  earlyFilmmakerPercent: number,
  investorBackendPercent: number,
) {
  if (![available, outstandingInvestorTarget, earlyFilmmakerPercent, investorBackendPercent].every(Number.isFinite)
    || available < 0 || outstandingInvestorTarget < 0
    || earlyFilmmakerPercent < 0 || earlyFilmmakerPercent >= 100
    || investorBackendPercent < 0 || investorBackendPercent > 100) {
    throw new Error("Use non-negative available receipts and target, an early share below 100%, and a backend share from 0–100%.");
  }
  const investorFraction = 1 - earlyFilmmakerPercent / 100;
  const repaymentReceipts = Math.min(available, outstandingInvestorTarget / investorFraction);
  const investorRepayment = Math.min(outstandingInvestorTarget, repaymentReceipts * investorFraction);
  const earlyFilmmakerPayment = repaymentReceipts - investorRepayment;
  const backendReceipts = Math.max(0, available - repaymentReceipts);
  const investorBackend = backendReceipts * investorBackendPercent / 100;
  const filmmakerBackend = backendReceipts - investorBackend;
  return {
    investorRepayment, earlyFilmmakerPayment, investorBackend, filmmakerBackend,
    remainingTarget: Math.max(0, outstandingInvestorTarget - investorRepayment),
    backendReceipts,
  };
}