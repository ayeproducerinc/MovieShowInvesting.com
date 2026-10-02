#!/usr/bin/env node
// Run explicitly with node scripts/test-filmmaker-count.mjs.
// Only synthetic UUID-scoped rows are removed; no real users or remote media are touched.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const requireApi = createRequire(path.resolve("artifacts/api-server/package.json"));
const { build } = requireApi("esbuild");
const bundle = path.resolve(`lib/db/.count-test-${randomUUID()}.mjs`);
await build({
  entryPoints: ["lib/db/src/index.ts"], outfile: bundle,
  platform: "node", format: "esm", bundle: true, packages: "external", logLevel: "silent",
});
const m = await import(pathToFileURL(bundle).href);
const visitors = [];
const uid = `count-test-${randomUUID()}`;
const email = "count-test@example.invalid";
const otherUid = `count-test-${randomUUID()}`;
let checks = 0;
async function check(total, description) {
  assert.equal(await m.getFilmmakerCount(), total, description);
  checks++;
  console.log(`PASS ${description}`);
}
async function visitor() {
  const id = randomUUID();
  visitors.push(id);
  await m.ensureVisitor(id);
  return id;
}
const save = (visitorId, answers, flow = "filmmaker") => m.saveVisitorFlowProgress({
  visitorId, flow, answers, lastScreen: 1, completed: false,
});
async function submit(visitorId, identity = {}) {
  return m.createFilmmakerSubmission({
    visitorId, ...identity,
    data: {
      no_project_yet: true, name: "Count fixture", email, city: "New York",
      country: "United States", favorite_genres: [], chat_opt_in: false,
    },
  });
}
try {
  await m.backfillFilmmakerActivity();
  const base = await m.getFilmmakerCount();
  const guest = await visitor();
  await check(base, "ordinary visits do not qualify");
  await save(guest, { stage: null, format: "movie", budget: 0, no_project_yet: false });
  await check(base, "automatic empty worksheet does not qualify");
  const draft = await save(guest, { stage: "idea" });
  await check(base + 1, "first real guest draft qualifies");
  await Promise.all(Array.from({ length: 12 }, () => save(guest, { stage: "idea" })));
  await check(base + 1, "concurrent saves and retries count only once");
  await save(guest, {});
  await check(base + 1, "clearing answers does not erase first activity");
  const investor = await visitor();
  await save(investor, { name: "Investor fixture" }, "investor");
  await check(base + 1, "investor activity is excluded");
  await assert.rejects(save(randomUUID(), { stage: "idea" }));
  await check(base + 1, "failed save does not add an entry");
  await Promise.all(Array.from({ length: 12 }, () => m.recordFilmmakerAccountActivity(uid, "firebase")));
  await check(base + 2, "verified filmmaker entry is idempotent without a draft");
  await m.claimFilmmakerVisitor({ visitorId: guest, firebaseUid: uid, verifiedEmail: email, expectedDraftId: draft.id });
  await check(base + 1, "secure guest claim merges with an already-counted account");
  await assert.rejects(m.claimFilmmakerVisitor({
    visitorId: guest, firebaseUid: otherUid, verifiedEmail: email, expectedDraftId: draft.id,
  }));
  await check(base + 1, "same email and failed cross-account claim cannot merge identities");
  await submit(guest, { firebaseUid: uid, firebaseEmail: email });
  await check(base + 1, "finishing a signed-in no-project-yet submission does not add another count");
  const next = await m.startOrResumeFilmmakerAccountDraft({ firebaseUid: uid, currentVisitorId: guest });
  visitors.push(next.visitorId);
  await check(base + 1, "additional account drafts do not add a filmmaker");
  await m.pool.query("UPDATE visitors SET price_group='A' WHERE visitor_id=$1", [next.visitorId]);
  await m.createFilmmakerSubmission({
    visitorId: next.visitorId, firebaseUid: uid, firebaseEmail: email,
    data: {
      no_project_yet: false, stage: "idea", title: "Synthetic counting pitch",
      format: "movie", genre: "Drama", logline: "Synthetic count verification.",
      budget: 10000, budget_from_example: false, deal_answer: "yes",
      offer_per100: 200, wants_lower: false, payback_terms: "works",
      name: "Count fixture", email, city: "New York", country: "United States",
      favorite_genres: [], chat_opt_in: false,
    },
  });
  await check(base + 1, "a completed pitch from the same account does not add another filmmaker");
  const secondGuest = await visitor();
  const secondDraft = await save(secondGuest, { stage: "production" });
  await check(base + 2, "a different unlinked guest initially qualifies independently");
  await m.claimFilmmakerVisitor({
    visitorId: secondGuest, firebaseUid: uid, verifiedEmail: email, expectedDraftId: secondDraft.id,
  });
  await check(base + 1, "a further original-browser guest claim deduplicates across account projects");
  const completedGuest = await visitor();
  // Legacy guest submissions remain supported in the count; current submission
  // ownership requirements intentionally continue requiring an account.
  const historicalSubmission = await m.pool.query(
    "INSERT INTO filmmakers(visitor_id,email,no_project_yet) VALUES($1,$2,true) RETURNING id",
    [completedGuest, email],
  );
  await m.pool.query(
    "INSERT INTO flow_progress(visitor_id,flow,last_screen,answers,completed) VALUES($1,'filmmaker',6,$2,true)",
    [completedGuest, { _submission: { filmmaker_id: historicalSubmission.rows[0].id, project_id: null } }],
  );
  await check(base + 2, "historical guest completed submissions remain counted");
  await m.claimFilmmakerVisitor({ visitorId: completedGuest, firebaseUid: uid, verifiedEmail: email });
  await check(base + 1, "claiming a completed guest submission does not double count");
  await m.recordFilmmakerAccountActivity(uid, "replit");
  await check(base + 2, "provider-qualified accounts never collide on UID or email");
  const historical = await visitor();
  await m.pool.query("INSERT INTO flow_progress(visitor_id, flow, last_screen, answers) VALUES($1,'filmmaker',1,$2)", [historical, { title: "Historical draft" }]);
  await m.backfillFilmmakerActivity();
  await m.backfillFilmmakerActivity();
  await check(base + 3, "historical meaningful draft backfill is idempotent");
  const materialsOnly = await visitor();
  const materialsDraft = await save(materialsOnly, {});
  await m.updateFilmmakerDraftText({ visitorId: materialsOnly, draftId: materialsDraft.id, synopsis: "A saved synopsis" });
  await check(base + 4, "first meaningful draft material save qualifies");
  await m.updateFilmmakerDraftText({ visitorId: materialsOnly, draftId: materialsDraft.id, synopsis: null });
  await check(base + 4, "removing draft materials preserves the original qualification");
  // Legacy records without visitor/account proof retain independent historical identities.
  const legacy = await m.pool.query("INSERT INTO filmmakers(name,no_project_yet) VALUES('Count fixture',true) RETURNING id");
  try {
    await check(base + 5, "unlinked legacy filmmaker records remain counted");
  } finally {
    await m.pool.query("DELETE FROM filmmakers WHERE id=$1", [legacy.rows[0].id]);
  }
  console.log(`${checks} counting checks passed.`);
} finally {
  // Complete submissions are deliberately deleted before their visitor FK becomes null.
  if (visitors.length) {
    await m.pool.query("DELETE FROM projects WHERE filmmaker_id IN (SELECT id FROM filmmakers WHERE visitor_id=ANY($1::text[]))", [visitors]);
    await m.pool.query("DELETE FROM filmmakers WHERE visitor_id=ANY($1::text[])", [visitors]);
    await m.pool.query("DELETE FROM visitors WHERE visitor_id=ANY($1::text[])", [visitors]);
  }
  await m.pool.query("DELETE FROM filmmaker_activity WHERE identity_key=ANY($1::text[])", [[`firebase:${uid}`, `replit:${uid}`, `firebase:${otherUid}`]]);
  await m.pool.end();
  await unlink(bundle);
}