import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateDeal, legacyDeal, mapLegacyScreen, parseCustomProposal, proposalView, restoreWorksheet } from "./filmmaker-calculator.js";
import { illustrateReceipts } from "../lib/proposal-receipts.js";
import { filmmakerDestination } from "./filmmaker-calculator.js";

test("repeating the no-project shortcut returns to details, never a sixth screen", () => {
  assert.equal(filmmakerDestination(2, 3, true), 5);
  assert.equal(filmmakerDestination(2, 6, true), 5);
  assert.equal(filmmakerDestination(1, 2, false), 2);
  assert.equal(filmmakerDestination(3, 4, false), 4);
  assert.equal(filmmakerDestination(5, 6, false), 5);
});

test("new fees and targets include capital and preserve cents", () => {
  assert.deepEqual(calculateDeal(10000, "distribution", "A", 125), {
    investorTarget: 12500, platformFee: 1500, combinedPayback: 14000, feeRate: 15,
  });
  assert.equal(calculateDeal(101, "production", "A", 150).investorTarget, 151.5);
  assert.equal(calculateDeal(101, "production", "A", 150).platformFee, 10.1);
  assert.equal(calculateDeal(10000, "idea", "B", 175).platformFee, 500);
});

test("historical fees stay unchanged and unspecified backend is never inferred", () => {
  assert.equal(legacyDeal(10000, "distribution", "A", 125).platformFee, 2500);
  assert.equal(legacyDeal(10000, "production", "A", 150).platformFee, 2000);
  assert.equal(legacyDeal(10000, "idea", "A", 175).platformFee, 1500);
  assert.equal(proposalView(null, 200)?.investorBackend, null);
});

test("old six-step draft screens map safely and answers remain intact", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(mapLegacyScreen), [1, 2, 3, 3, 4, 5]);
  const restored = restoreWorksheet({ name: "", funding_experience: "", offer_per100: 125 },
    { name: "Example", funding_experience: "Saved history", offer_per100: 200 }, 6);
  assert.equal(restored.screen, 5);
  assert.equal(restored.answers.funding_experience, "Saved history");
  assert.equal(restored.answers.offer_per100, 200);
});

test("unsupported custom terms produce errors, not clamped proposals", () => {
  assert.equal(parseCustomProposal({ repayment: "124", investorBackend: "50", years: "5", earlyOn: false, early: "10" }).ok, false);
  assert.equal(parseCustomProposal({ repayment: "175", investorBackend: "50", years: "5", earlyOn: true, early: "100" }).ok, false);
  assert.deepEqual(parseCustomProposal({ repayment: "200", investorBackend: "60", years: "8", earlyOn: true, early: "10" }),
    { ok: true, repayment: 200, investorBackend: 60, years: 8, early: 10 });
});

test("standard repayment receives the full investor target before backend", () => {
  const result = illustrateReceipts(1500, 1000, 0, 50);
  assert.equal(result.investorRepayment, 1000);
  assert.equal(result.earlyFilmmakerPayment, 0);
  assert.equal(result.investorBackend, 250);
  assert.equal(result.filmmakerBackend, 250);
  assert.equal(result.remainingTarget, 0);
});

test("early payments do not lower the target or duplicate project receipts", () => {
  const result = illustrateReceipts(1000, 12500, 10, 50);
  assert.equal(result.earlyFilmmakerPayment, 100);
  assert.equal(result.investorRepayment, 900);
  assert.equal(result.remainingTarget, 11600);
  assert.equal(result.backendReceipts, 0);
});

test("crossing the target applies backend only to residual receipts", () => {
  const result = illustrateReceipts(1500, 900, 10, 60);
  assert.equal(result.investorRepayment, 900);
  assert.equal(result.earlyFilmmakerPayment, 100);
  assert.equal(result.investorBackend, 300);
  assert.equal(result.filmmakerBackend, 200);
  assert.equal(result.investorRepayment + result.earlyFilmmakerPayment + result.investorBackend + result.filmmakerBackend, 1500);
});

test("completed target goes directly to backend and invalid input fails", () => {
  assert.equal(illustrateReceipts(900, 0, 10, 50).investorBackend, 450);
  assert.throws(() => illustrateReceipts(1000, 1000, 100, 50));
});