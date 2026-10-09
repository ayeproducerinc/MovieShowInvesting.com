import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptsPledges, allocationLimitError, maxProjectsFor, PROJECT_MINIMUM, MAX_PROJECTS } from "./pledge-policy";

test("a submitted, non-hidden project accepts pledges whether or not it is approved", () => {
  assert.equal(acceptsPledges({ hidden: false, stage: "idea" }), true);
  assert.equal(acceptsPledges({ hidden: false, stage: "production" }), true);
  assert.equal(acceptsPledges({ hidden: false, stage: "distribution" }), true);
  assert.equal(acceptsPledges({ hidden: true, stage: "idea" }), false);
  assert.equal(acceptsPledges({ hidden: false, stage: null }), false);
  assert.equal(acceptsPledges({ hidden: false, stage: "other" }), false);
});

test("new pledges need $100 per project and allow up to 5 projects", () => {
  assert.equal(PROJECT_MINIMUM, 100);
  assert.equal(MAX_PROJECTS, 5);
  assert.equal(allocationLimitError(100, [100]), null);
  assert.equal(allocationLimitError(500, [100, 100, 100, 100, 100]), null);
  assert.equal(allocationLimitError(125, [100, 25]), "Each project needs at least $100.");
  assert.equal(allocationLimitError(150, [99, 51]), "Each project needs at least $100.");
});

test("the old 4-project rule under $150 no longer applies; 5 is the only cap", () => {
  assert.equal(maxProjectsFor(100), 1);
  assert.equal(maxProjectsFor(149), 1);
  assert.equal(maxProjectsFor(400), 4);
  assert.equal(maxProjectsFor(500), 5);
  assert.equal(maxProjectsFor(10_000), 5);
  assert.equal(allocationLimitError(600, [100, 100, 100, 100, 100, 100]), "A pledge can include up to 5 projects.");
});

test("a just-pledge total with no projects passes the per-project rule", () => {
  assert.equal(allocationLimitError(100, []), null);
});
