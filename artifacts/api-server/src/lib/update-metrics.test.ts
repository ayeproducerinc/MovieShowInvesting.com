import { test } from "node:test";
import assert from "node:assert/strict";
import { projectProgress, updateImpact, type PledgeRow } from "./update-metrics";

const at = (iso: string) => new Date(iso);
const rows: PledgeRow[] = [
  { investor_id: 1, amount: 100, confirmed_at: at("2026-09-01T00:00:00Z"), source_update_id: null },
  { investor_id: 1, amount: 250, confirmed_at: at("2026-10-05T00:00:00Z"), source_update_id: 7 }, // increase via update 7
  { investor_id: 2, amount: 500, confirmed_at: at("2026-09-10T00:00:00Z"), source_update_id: null },
  { investor_id: 3, amount: 100, confirmed_at: at("2026-10-06T00:00:00Z"), source_update_id: null }, // new after update
  { investor_id: 3, amount: 100, confirmed_at: at("2026-10-20T00:00:00Z"), source_update_id: null }, // their own increase
  { investor_id: 4, amount: 300, confirmed_at: at("2026-11-01T00:00:00Z"), source_update_id: null }, // new, outside 14 days
];

test("filmmaker summary: who increased and by how much, and who is new since the last update", () => {
  assert.deepEqual(projectProgress(rows, at("2026-10-01T00:00:00Z")), {
    increase_count: 2, increase_amount: 350,
    new_since_last_update_count: 2, new_since_last_update_amount: 500,
  });
});

test("with no update posted yet, nothing counts as new since the last update", () => {
  const summary = projectProgress(rows, null);
  assert.equal(summary.new_since_last_update_count, 0);
  assert.equal(summary.increase_count, 2);
});

test("admin, per update: increases from its email button and new pledges in the 14 days after", () => {
  assert.deepEqual(updateImpact(rows, { id: 7, approvedAt: at("2026-10-01T00:00:00Z") }), {
    increase_count: 1, increase_amount: 250,
    new_pledge_count_14d: 1, new_pledge_amount_14d: 100,
  });
});

test("an update that is not approved has no impact window", () => {
  const impact = updateImpact(rows, { id: 9, approvedAt: null });
  assert.equal(impact.new_pledge_count_14d, 0);
  assert.equal(impact.increase_count, 0);
});
