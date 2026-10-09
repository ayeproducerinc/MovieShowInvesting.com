import { test } from "node:test";
import assert from "node:assert/strict";
import { hasMoneyDateFields, validateMoneyDate } from "./money-date";

test("only Idea and Production projects are asked when filming starts; Distribution answers are dropped", () => {
  const production = validateMoneyDate({ filming_start_month: "2027-03" }, "production");
  assert.ok(production.ok && production.value.filming_start_month === "2027-03");
  const idea = validateMoneyDate({ filming_start_skipped: true }, "idea");
  assert.ok(idea.ok && idea.value.filming_start_skipped === true);
  const distribution = validateMoneyDate({ filming_start_month: "2027-03", filming_start_skipped: true, money_needed_by_month: "2027-01" }, "distribution");
  assert.ok(distribution.ok && distribution.value.filming_start_month === null && distribution.value.filming_start_skipped === false);
  assert.ok(distribution.ok && distribution.value.money_needed_by_month === "2027-01");
});

test("a skip is recorded separately from a blank", () => {
  const blank = validateMoneyDate({});
  assert.ok(blank.ok && blank.value.money_needed_by_month === null && blank.value.money_needed_by_skipped === false);
  const skipped = validateMoneyDate({ money_needed_by_skipped: true, money_needed_by_month: "2027-03" });
  assert.ok(skipped.ok && skipped.value.money_needed_by_month === null && skipped.value.money_needed_by_skipped === true);
});

test("months must be a real month and year", () => {
  const ok = validateMoneyDate({ filming_start_month: "2027-03", money_needed_by_month: "2026-12" }, "idea");
  assert.ok(ok.ok && ok.value.filming_start_month === "2027-03" && ok.value.money_needed_by_month === "2026-12");
  assert.equal(validateMoneyDate({ filming_start_month: "2027-13" }, "idea").ok, false);
  assert.equal(validateMoneyDate({ money_needed_by_month: "March 2027" }).ok, false);
});

test("the development amount is optional whole dollars", () => {
  const ok = validateMoneyDate({ development_amount: 15000 });
  assert.ok(ok.ok && ok.value.development_amount === 15000);
  assert.equal(validateMoneyDate({ development_amount: -1 }).ok, false);
  assert.equal(validateMoneyDate({ development_amount: 10.5 }).ok, false);
});

test("an Edit pitch save without money-date fields leaves them alone", () => {
  assert.equal(hasMoneyDateFields({ synopsis: "x" }), false);
  assert.equal(hasMoneyDateFields({ money_needed_by_skipped: false }), true);
});
