import { test } from "node:test";
import assert from "node:assert/strict";
import { backerEvidence, backerTotals, filmmakerBackers, publicBackers, type BackerRow } from "./backer-visibility";

test("totals add every confirmed pledge and count each person once", () => {
  assert.deepEqual(backerTotals([
    { investor_id: 1, amount: 100 }, { investor_id: 1, amount: 250 }, { investor_id: 2, amount: 500 },
  ]), { confirmed_pledge_total: 850, backer_count: 2 });
  assert.deepEqual(backerTotals([]), { confirmed_pledge_total: 0, backer_count: 0 });
});

const row = (over: Partial<BackerRow>): BackerRow => ({
  project_id: 1, investor_id: 1, amount: 100, name: "Jane Doe", email: "jane@example.com",
  confirmed_at: new Date("2026-10-01T00:00:00Z"), evidence: backerEvidence(false), source_update_id: null, ...over,
});

test("the filmmaker sees name, email and amount for pledges signed with the notice", () => {
  assert.deepEqual(filmmakerBackers([row({})]), [{
    name: "Jane Doe", email: "jane@example.com", amount: 100,
    confirmed_at: "2026-10-01T00:00:00.000Z", name_shared: true,
  }]);
});

test("pledges signed before the notice existed hide name and email from the filmmaker", () => {
  const [legacy] = filmmakerBackers([row({ evidence: { notice_version: "nonbinding-interest-v1" } })]);
  assert.equal(legacy.name, null);
  assert.equal(legacy.email, null);
  assert.equal(legacy.amount, 100);
  assert.equal(legacy.name_shared, false);
});

test("the filmmaker list is newest first", () => {
  const list = filmmakerBackers([
    row({ name: "Older", confirmed_at: new Date("2026-09-01T00:00:00Z") }),
    row({ name: "Newer", confirmed_at: new Date("2026-10-05T00:00:00Z") }),
  ]);
  assert.deepEqual(list.map((backer) => backer.name), ["Newer", "Older"]);
});

test("public names appear only for backers who opted in, summed per person", () => {
  const rows = [
    row({ investor_id: 1, name: "Jane Doe", amount: 100, evidence: backerEvidence(true) }),
    row({ investor_id: 1, name: "Jane Doe", amount: 150, evidence: backerEvidence(true) }),
    row({ investor_id: 2, name: "Private Person", amount: 500, evidence: backerEvidence(false) }),
    row({ investor_id: 3, name: "Legacy Backer", amount: 900, evidence: { public_display: true } }),
  ];
  assert.deepEqual(publicBackers(rows), [{ name: "Jane Doe", amount: 250 }]);
});
