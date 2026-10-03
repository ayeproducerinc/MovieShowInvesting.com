import assert from "node:assert/strict";
import { test } from "node:test";
import { snapshotProposal, type ProposalInput } from "./proposal.js";

const standard = (repayment: number): ProposalInput => ({
  decision: "standard", repayment_per100: repayment,
  investor_backend_percent: 50, backend_years: 5, early_filmmaker_percent: 0,
});

test("new stage snapshots use approved investor targets and 15/10/5 platform spreads", () => {
  for (const [stage, target, fee] of [
    ["distribution", 125, 15], ["production", 150, 10], ["idea", 175, 5],
  ] as const) {
    const result = snapshotProposal(stage, standard(target));
    assert.equal(result.repayment_per100, target);
    assert.equal(result.original_repayment_per100, target);
    assert.equal(result.platform_fee_percent, fee);
    assert.equal(result.investor_backend_percent, 50);
    assert.equal(result.backend_years, 5);
    assert.equal(result.backend_revenue_basis, "after_processing_and_distribution_fees");
    assert.equal(result.backend_clock, "after_investor_target");
  }
});

test("counterproposals retain numeric terms and original suggestion independently", () => {
  const input: ProposalInput = {
    decision: "negotiation", repayment_per100: 200, investor_backend_percent: 60,
    backend_years: 8, early_filmmaker_percent: 10, note: "Discuss early filmmaker receipts",
  };
  const before = structuredClone(input);
  const result = snapshotProposal("production", input);
  assert.deepEqual(input, before);
  assert.equal(result.original_repayment_per100, 150);
  assert.equal(result.repayment_per100, 200);
  assert.equal(result.backend_years, 8);
  assert.equal(result.early_filmmaker_percent, 10);
  assert.equal(result.investor_backend_percent, 60);
});

test("standard selection cannot accidentally activate drafted custom terms", () => {
  assert.throws(() => snapshotProposal("distribution", { ...standard(125), early_filmmaker_percent: 10 }));
  assert.throws(() => snapshotProposal("distribution", { ...standard(125), investor_backend_percent: 60 }));
  assert.throws(() => snapshotProposal("production", standard(125)));
});

test("invalid values fail explicitly, never clamp to defaults", () => {
  for (const input of [
    { ...standard(125), decision: "negotiation" as const, repayment_per100: 124 },
    { ...standard(125), decision: "negotiation" as const, repayment_per100: 125.5 },
    { ...standard(125), decision: "negotiation" as const, backend_years: 0 },
    { ...standard(125), decision: "negotiation" as const, investor_backend_percent: 101 },
    { ...standard(125), decision: "negotiation" as const, early_filmmaker_percent: 100 },
    { ...standard(125), decision: "negotiation" as const, repayment_per100: NaN },
  ]) assert.throws(() => snapshotProposal("distribution", input));
});

test("the investor's share remains positive during early repayment", () => {
  const result = snapshotProposal("idea", {
    ...standard(175), decision: "negotiation", early_filmmaker_percent: 99,
  });
  assert.equal(100 - result.early_filmmaker_percent, 1);
  assert.equal(result.repayment_per100, 175);
});