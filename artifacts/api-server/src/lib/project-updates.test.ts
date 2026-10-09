import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emailDecision, milestonesForStage, nextStatus, publicUpdateView, validateUpdateInput, MILESTONES,
} from "./project-updates";

test("there are 18 fixed milestones, and a filmmaker sees their stage plus Any stage", () => {
  assert.equal(MILESTONES.length, 18);
  const production = milestonesForStage("production").map((m) => m.key);
  assert.ok(production.includes("filming_started"));
  assert.ok(production.includes("team_member_joined"));
  assert.ok(!production.includes("script_locked"));
  assert.equal(milestonesForStage("idea").length, 8);
});

test("a milestone from another stage is refused", () => {
  const result = validateUpdateInput("idea", { milestone_key: "released" });
  assert.equal(result.ok, false);
});

test("Team member joined needs a role, and keeps a name only with consent", () => {
  assert.equal(validateUpdateInput("idea", { milestone_key: "team_member_joined" }).ok, false);
  const noConsent = validateUpdateInput("idea", { milestone_key: "team_member_joined", role: "director", person_name: "Ava Lee" });
  assert.ok(noConsent.ok && noConsent.value.person_name === null && noConsent.value.name_consent === false);
  const consent = validateUpdateInput("idea", { milestone_key: "team_member_joined", role: "director", person_name: " Ava  Lee ", name_consent: true });
  assert.ok(consent.ok && consent.value.person_name === "Ava Lee" && consent.value.name_consent);
});

test("Other needs a short label; role and name are ignored for other milestones", () => {
  assert.equal(validateUpdateInput("idea", { milestone_key: "other" }).ok, false);
  assert.equal(validateUpdateInput("idea", { milestone_key: "other", custom_label: "x".repeat(61) }).ok, false);
  const labelled = validateUpdateInput("idea", { milestone_key: "other", custom_label: "Table read done" });
  assert.ok(labelled.ok && labelled.value.custom_label === "Table read done");
  const plain = validateUpdateInput("idea", { milestone_key: "script_locked", role: "writer", person_name: "X", name_consent: true });
  assert.ok(plain.ok && plain.value.role === null && plain.value.person_name === null);
});

test("notes are capped at 500 characters and a blank note is stored as none", () => {
  assert.equal(validateUpdateInput("idea", { milestone_key: "script_locked", note: "x".repeat(501) }).ok, false);
  const ok = validateUpdateInput("idea", { milestone_key: "script_locked", note: "x".repeat(500) });
  assert.ok(ok.ok);
  const blank = validateUpdateInput("idea", { milestone_key: "script_locked", note: "   " });
  assert.ok(blank.ok && blank.value.note === null);
});

test("at most one update email per project every 14 days", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  assert.equal(emailDecision(null, now), "send");
  assert.equal(emailDecision(new Date("2026-10-17T00:00:00Z"), now), "skip_recent"); // 13 days
  assert.equal(emailDecision(new Date("2026-10-15T00:00:00Z"), now), "send"); // 15 days
});

test("only a pending update can be approved or rejected, once", () => {
  assert.equal(nextStatus("pending", "approve"), "approved");
  assert.equal(nextStatus("pending", "reject"), "rejected");
  assert.equal(nextStatus("approved", "approve"), null);
  assert.equal(nextStatus("rejected", "approve"), null);
});

test("the public view hides a name given without consent", () => {
  const base = {
    id: 1, milestone_key: "team_member_joined", role: "director", custom_label: null, note: "Welcome!",
    status: "approved", created_at: new Date("2026-10-01T00:00:00Z"), reviewed_at: new Date("2026-10-02T00:00:00Z"),
  };
  assert.equal(publicUpdateView({ ...base, person_name: "Ava Lee", name_consent: false }).person_name, null);
  const shown = publicUpdateView({ ...base, person_name: "Ava Lee", name_consent: true });
  assert.equal(shown.person_name, "Ava Lee");
  assert.equal(shown.label, "Team member joined");
  assert.equal(shown.role, "Director");
  assert.equal(shown.approved_at, "2026-10-02T00:00:00.000Z");
});
