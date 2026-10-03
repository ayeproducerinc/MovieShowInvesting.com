/** Only new submissions receive these snapshots; legacy terms are never inferred. */
export type ProposalInput = {
  decision: "standard" | "negotiation";
  repayment_per100: number;
  investor_backend_percent: number;
  backend_years: number;
  early_filmmaker_percent: number;
  note?: string;
};
export type Proposal = ProposalInput & {
  original_repayment_per100: number;
  platform_fee_percent: number;
  fee_priority: "existing_proportional";
  backend_revenue_basis: "after_processing_and_distribution_fees";
  backend_clock: "after_investor_target";
  version: 1;
};

export function snapshotProposal(stage: "distribution" | "production" | "idea", input: ProposalInput): Proposal {
  const original = stage === "distribution" ? 125 : stage === "production" ? 150 : 175;
  const validInteger = (value: number, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max;
  if (!["standard", "negotiation"].includes(input.decision)
    || !validInteger(input.repayment_per100, 125, 10000)
    || !validInteger(input.investor_backend_percent, 0, 100)
    || !validInteger(input.backend_years, 1, 100)
    || !validInteger(input.early_filmmaker_percent, 0, 99)
    || (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 2000))) {
    throw new Error("Use a whole-number repayment target from $125 to $10,000 per $100, a backend share from 0–100%, a duration from 1–100 years, and an early filmmaker share from 0–99%.");
  }
  if (input.decision === "standard" && (input.repayment_per100 !== original
    || input.investor_backend_percent !== 50 || input.backend_years !== 5 || input.early_filmmaker_percent !== 0)) {
    throw new Error("Standard terms must use the stage repayment target, 50/50 backend for five years, and no early filmmaker revenue payments. Select negotiation for custom terms.");
  }
  return {
    ...input,
    original_repayment_per100: original,
    platform_fee_percent: stage === "distribution" ? 15 : stage === "production" ? 10 : 5,
    fee_priority: "existing_proportional",
    backend_revenue_basis: "after_processing_and_distribution_fees",
    backend_clock: "after_investor_target",
    version: 1,
  };
}