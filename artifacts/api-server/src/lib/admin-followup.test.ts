import { test } from "node:test";
import assert from "node:assert/strict";
import { quietProjects, researchRows, RESEARCH_NOTE, RESEARCH_QUESTION, type QuietCandidate } from "./admin-followup";

const now = new Date("2026-10-31T00:00:00Z");
const base: QuietCandidate = {
  id: 1, title: "A", createdAt: new Date("2026-08-01T00:00:00Z"), hidden: false,
  filmmakerName: "F", filmmakerEmail: "f@example.com", lastApprovedUpdateAt: null, backerCount: 0,
};

test("a project is quiet after 30 days without an approved update; new and hidden projects are not", () => {
  const list = quietProjects([
    { ...base, id: 1, lastApprovedUpdateAt: new Date("2026-10-20T00:00:00Z") }, // updated 11 days ago
    { ...base, id: 2, lastApprovedUpdateAt: new Date("2026-09-15T00:00:00Z") }, // 46 days ago: quiet
    { ...base, id: 3 },                                                       // never updated, 3 months old: quiet
    { ...base, id: 4, createdAt: new Date("2026-10-20T00:00:00Z") },          // too new to be quiet
    { ...base, id: 5, hidden: true },                                         // hidden: left out
  ], now);
  assert.deepEqual(list.map((project) => project.id), [3, 2]);
});

test("research counts list every answer and a total", () => {
  assert.deepEqual(researchRows([{ answer: "yes", count: 3 }, { answer: "not_sure", count: 1 }]),
    [["Yes", 3], ["No", 0], ["Not sure", 1], ["Total answers", 4]]);
});

test("the research question and note are the approved wording", () => {
  assert.equal(RESEARCH_QUESTION, "If you could set this money aside today and earn interest until the offering opens, would you?");
  assert.equal(RESEARCH_NOTE, "This is a research question. No account is being offered.");
});
