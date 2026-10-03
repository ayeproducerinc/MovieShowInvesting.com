#!/usr/bin/env node
/**
 * Synthetic integration coverage only. Uses the app's effective Firebase web config.
 * --keep-fixtures retains restricted /tmp credentials for one browser handoff.
 * --cleanup removes only this script's fixture records and temporary credentials.
 * Never logs credentials, account email, submitted answers or external service secrets.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { writeFile, readFile, unlink, chmod } from "node:fs/promises";

const requireApi = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const requireDb = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { initializeApp, cert } = requireApi("firebase-admin/app");
const { getAuth } = requireApi("firebase-admin/auth");
const { Pool } = requireDb("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) }, `review-test-${randomUUID()}`);
const auth = getAuth(app);
const fixturePath = "/tmp/msi-admin-review-fixtures.json";
const base = (process.env.MSI_TEST_API_BASE_URL ?? "http://localhost:80/api").replace(/\/$/, "");
let state = { users: [], visitors: [], projectIds: [], filmmakerIds: [] };
async function cleanup() {
  const fixtureUids = state.users.map(user => user.uid);
  const ownedVisitors = await pool.query(
    `select visitor_id from filmmaker_account_visitors where firebase_uid=any($1::text[])
     union select visitor_id from filmmakers where firebase_uid=any($1::text[])
     union select visitor_id from investors where firebase_uid=any($1::text[])`, [fixtureUids],
  );
  state.visitors = [...new Set([...state.visitors, ...ownedVisitors.rows.map(row => row.visitor_id).filter(Boolean)])];
  for (const id of state.projectIds) await pool.query("delete from projects where id=$1", [id]);
  for (const id of state.filmmakerIds) await pool.query("delete from filmmakers where id=$1", [id]);
  for (const user of state.users) {
    await pool.query("delete from investors where firebase_uid=$1", [user.uid]);
    await pool.query("delete from investor_notification_events where provider='firebase' and uid=$1", [user.uid]);
    await pool.query("delete from investor_account_progress where provider='firebase' and uid=$1", [user.uid]);
    await pool.query("delete from age_confirmations where provider='firebase' and uid=$1", [user.uid]);
    await pool.query("delete from filmmaker_account_visitors where firebase_uid=$1", [user.uid]);
    await pool.query("delete from filmmaker_activity where identity_key=$1", [`firebase:${user.uid}`]);
    await auth.deleteUser(user.uid);
  }
  for (const visitor of state.visitors) await pool.query("delete from visitors where visitor_id=$1", [visitor]);
  await unlink(fixturePath).catch(() => {});
}
async function request(path, token, { method = "GET", body, cookie, headers } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: `msi_visitor_id=${cookie}` } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000),
  });
  const content = response.headers.get("content-type")?.includes("json") ? await response.json() : await response.text();
  return { status: response.status, data: content };
}
const pass = name => console.info(`PASS ${name}`);
async function ok(path, token, options) {
  const result = await request(path, token, options);
  assert(result.status >= 200 && result.status < 300, `${path}: unexpected ${result.status}`);
  return result.data;
}
try {
  if (process.argv.includes("--cleanup")) {
    state = JSON.parse(await readFile(fixturePath, "utf8"));
    await cleanup();
    console.info("Synthetic review fixtures and temporary credentials removed.");
  } else {
    const config = await ok("/config");
    assert.equal(typeof config.apiKey, "string");
    async function credential(uid) {
      const customToken = await auth.createCustomToken(uid);
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(config.apiKey)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      });
      const value = await response.json();
      assert(response.ok && value.idToken, "Fixture authentication failed");
      return { customToken, idToken: value.idToken };
    }
    for (const role of ["investor", "filmmaker"]) {
      const email = `review-${randomUUID()}-${role}@example.invalid`;
      const user = await auth.createUser({ email, emailVerified: true, displayName: `Synthetic ${role}` });
      state.users.push({ uid: user.uid, email, role, ...await credential(user.uid) });
    }
    const investor = state.users[0], filmmaker = state.users[1];
    const administrator = await auth.getUserByEmail(process.env.ADMIN_EMAIL);
    const adminCredential = await credential(administrator.uid);
    state.adminCustomToken = adminCredential.customToken;
    const adminToken = adminCredential.idToken;
    assert.equal((await request("/admin/investors")).status, 401);
    assert.equal((await request("/admin/investors", investor.idToken)).status, 403);
    assert.equal((await request("/admin/investors/export", investor.idToken)).status, 403);
    pass("admin review and exports reject anonymous/non-admin access");

    await request("/progress/investor", investor.idToken);
    let list = await ok("/admin/investors?search=" + encodeURIComponent(investor.email), adminToken);
    assert.equal(list.total, 1); assert.equal(list.items[0].status, "signup"); assert.equal(list.items[0].notification_allowed, null);
    pass("authenticated investor sign-up is tracked without a confirmed pledge");
    await ok("/progress", investor.idToken, { method: "POST", body: { flow: "investor", last_screen: 2, expected_investor_owner: `firebase:${investor.uid}`, answers: { name: "Synthetic Investor", email: investor.email, terms_read: true } } });
    list = await ok("/admin/investors?search=" + encodeURIComponent(investor.email), adminToken);
    assert.equal(list.items[0].status, "draft"); assert.equal(list.items[0].confirmed_amount, 0);
    await ok("/participation/age-confirmation", investor.idToken, { method: "POST", body: { age_confirmed: true } });
    await ok("/participation/age-confirmation", filmmaker.idToken, { method: "POST", body: { age_confirmed: true } });
    pass("drafts and self-declared age remain distinct from signed interest");

    const pitch = {
      no_project_yet: false, stage: "distribution", title: `Synthetic Review Pitch ${randomUUID()}`,
      format: "movie", genre: "Drama", logline: "Synthetic preserved submission for admin runtime verification.",
      budget: 100000, budget_from_example: false, deal_answer: "yes", offer_per100: 125, wants_lower: false, payback_terms: "works",
      proposal: { decision: "standard", repayment_per100: 125, investor_backend_percent: 50, backend_years: 5, early_filmmaker_percent: 0 },
      funding_sources: ["Kickstarter / Indiegogo / Seed&Spark"], reached_goal: true, funding_experience: "Synthetic historical campaign.",
      crowdfunding_ran: true, crowdfunding_campaign: "Synthetic reward campaign; no public link", crowdfunding_same_project: false,
      crowdfunding_goal: 5000, crowdfunding_raised: 5500, crowdfunding_obligations: "Rewards; two deliveries outstanding",
      team_info: "Original team information", team_links: ["https://example.com/team"], money_use: "Post-production", distribution_plan: "Festival submission",
      name: "Synthetic Filmmaker", email: filmmaker.email, city: "Detroit", state: "Michigan", country: "US", favorite_genres: ["Drama"], chat_opt_in: false,
    };
    async function submitPitch(data) {
      const visitor = randomUUID(); state.visitors.push(visitor);
      await pool.query("insert into visitors(visitor_id,price_group) values($1,'A')", [visitor]);
      await pool.query("insert into filmmaker_account_visitors(visitor_id,firebase_uid) values($1,$2)", [visitor, filmmaker.uid]);
      const draft = await pool.query("insert into flow_progress(visitor_id,flow,last_screen,answers) values($1,'filmmaker',6,$2::jsonb) returning id", [visitor, JSON.stringify(data)]);
      const response = await ok("/filmmakers", filmmaker.idToken, { method: "POST", cookie: visitor, headers: { "X-MSI-Draft-Id": String(draft.rows[0].id) }, body: data });
      state.projectIds.push(response.project_id); state.filmmakerIds.push(response.filmmaker_id);
      const { rows } = await pool.query("select slug from projects where id=$1", [response.project_id]);
      return { ...response, project_slug: rows[0].slug, visitor };
    }
    const firstPitch = await submitPitch(pitch);
    state.firstPitch = firstPitch;
    const review = await ok(`/admin/projects/${firstPitch.project_id}/review`, adminToken);
    assert.equal(review.original_submission.answers.team_info, "Original team information");
    assert.equal(review.original_submission.answers.crowdfunding_raised, 5500);
    assert.equal(review.project.distribution_plan, "Festival submission");
    assert.equal(review.original_submission.age_confirmation.self_declaration, true);
    assert.equal(review.changes_since_submission, false);
    const secondPitch = await submitPitch({ ...pitch, title: "Different synthetic pitch " + randomUUID(), crowdfunding_raised: 42 });
    const firstAgain = await ok(`/admin/projects/${firstPitch.project_id}/review`, adminToken);
    assert.equal(firstAgain.answers.crowdfunding_raised, 5500);
    await ok("/filmmakers/showcase", filmmaker.idToken, { method: "PATCH", cookie: firstPitch.visitor, headers: { "X-MSI-Project-Id": String(firstPitch.project_id) }, body: { team_info: "Edited current team" } });
    const edited = await ok(`/admin/projects/${firstPitch.project_id}/review`, adminToken);
    assert.equal(edited.original_submission.answers.team_info, "Original team information");
    assert.equal(edited.project.team_info, "Edited current team"); assert.equal(edited.changes_since_submission, true);
    pass("pitch snapshots preserve all answers across multiple projects and later edits");
    const notes = { notes: "Synthetic review notes only.", obligations_checked: true, authority_checked: true, questions_resolved: false, updated_at: null };
    const savedNotes = await ok(`/admin/projects/${firstPitch.project_id}/review-notes`, adminToken, { method: "PUT", body: notes });
    assert.equal((await request(`/admin/projects/${firstPitch.project_id}/review-notes`, adminToken, { method: "PUT", body: notes })).status, 409);
    assert(savedNotes.updated_at);
    pass("dated review notes prevent stale overwrites");

    await pool.query("update projects set approved=true,showcase_requested=true,hidden=false where id=$1", [firstPitch.project_id]);
    const matches = await ok("/investor/matches", investor.idToken, { method: "POST", body: {
      amount: 100, favorite_genres: ["Drama"], stages: ["distribution"],
      minima: { distribution: 125, production: null, idea: null },
    } });
    const matchingProject = matches.projects.find(project => project.id === firstPitch.project_id);
    assert(matchingProject, "Approved project must remain selectable for additional interest");
    assert.equal(matchingProject.pitch_deck_url, null);
    assert.equal(matchingProject.pitch_deck_name, null);
    pass("project matching returns the full public project contract without a deck");
    const intent = {
      name: "Synthetic Investor", email: investor.email, city: "Detroit", state: "Michigan", country: "US",
      amount: 100, allocations: [{ project_id: firstPitch.project_id, amount: 100 }], unallocated: false,
      accredited: false, experience: ["New to investing"], motivations: ["Support independent filmmakers"], favorite_genres: ["Drama"],
      stages: ["distribution"], minima: { distribution: 125, production: null, idea: null },
      call_opt_in: true, ground_rules_accepted: true, expected_investor_owner: `firebase:${investor.uid}`,
    };
    const saved = await ok("/investor/intents", investor.idToken, { method: "POST", body: intent });
    state.investorId = saved.investor_id;
    list = await ok("/admin/investors?search=" + encodeURIComponent(investor.email), adminToken);
    assert.equal(list.items[0].status, "saved"); assert.equal(list.items[0].confirmed_amount, 0);
    await ok("/investor/intents/confirm", investor.idToken, { method: "POST", body: {
      investor_id: saved.investor_id, entry_id: saved.entry_id, signature_name: intent.name, accepted: true, amount: 100, allocations: intent.allocations,
    } });
    const second = await ok("/investor/intents", investor.idToken, { method: "POST", body: { ...intent, new_entry: true, amount: 125, unallocated: true, allocations: [] } });
    await ok("/investor/intents/confirm", investor.idToken, { method: "POST", body: {
      investor_id: second.investor_id, entry_id: second.entry_id, signature_name: intent.name, accepted: true, amount: 125, allocations: [],
    } });
    list = await ok("/admin/investors?search=" + encodeURIComponent(investor.email), adminToken);
    assert.equal(list.total, 1); assert.equal(list.items[0].confirmed_amount, 225);
    assert.deepEqual(list.items[0].project_ids, [firstPitch.project_id]);
    const details = await ok(`/admin/investors/${list.items[0].id}`, adminToken);
    assert.equal(details.entries.length, 2);
    assert.equal(details.entries[0].confirmation_evidence.amount, 100);
    assert.equal(details.entries[1].confirmation_evidence.amount, 125);
    assert.equal(details.verification.legal_identity, "Not verified by this intake");
    assert.equal(details.verification.account_authenticated, true);
    assert.equal(details.age_confirmation.self_declaration, true);
    pass("repeat signatures remain separate with exact questionnaires and term evidence");
    let csv = await ok("/admin/investors/export?search=" + encodeURIComponent(investor.email), adminToken);
    assert(!csv.includes(investor.email), "Chat permission must not become offering notification consent");
    await ok("/investor/notification-permission", investor.idToken, { method: "PUT", body: { allowed: true, expected_owner: `firebase:${investor.uid}` } });
    csv = await ok("/admin/investors/export?search=" + encodeURIComponent(investor.email), adminToken);
    assert(csv.includes(investor.email)); assert(csv.includes("General interest (unallocated)")); assert(csv.includes(firstPitch.project_id ? pitch.title : "impossible"));
    assert.equal(csv.split("\r\n").length, 3, "One person per distinct segment");
    await pool.query("update projects set hidden=true where id=$1", [firstPitch.project_id]);
    const hiddenDetails = await ok(`/admin/investors/${list.items[0].id}`, adminToken);
    assert.equal(hiddenDetails.entries[0].allocations[0].eligible, false);
    assert.equal(hiddenDetails.entries[0].allocations[0].amount, 100);
    await ok("/investor/notification-permission", investor.idToken, { method: "PUT", body: { allowed: false, expected_owner: `firebase:${investor.uid}` } });
    csv = await ok("/admin/investors/export?search=" + encodeURIComponent(investor.email), adminToken);
    assert(!csv.includes(investor.email));
    const history = await ok(`/admin/investors/${list.items[0].id}`, adminToken);
    assert.equal(history.notification_history.length, 2);
    await pool.query("update projects set hidden=false where id=$1", [firstPitch.project_id]);
    state.projectSlug = firstPitch.project_slug;
    pass("notification consent and withdrawal control deduplicated manual outreach exports");
    if (process.argv.includes("--keep-fixtures")) {
      await writeFile(fixturePath, JSON.stringify(state), { mode: 0o600 }); await chmod(fixturePath, 0o600);
      console.info("Restricted synthetic browser handoff ready; no credentials logged.");
    } else await cleanup();
    console.info("All admin/investor integration checks passed.");
  }
} catch (error) {
  // Assert messages contain only test descriptions/statuses, never credential material.
  console.error(error instanceof Error ? error.message : "Integration checks failed");
  if (process.argv.includes("--cleanup")) {
    await unlink(fixturePath).catch(() => {});
    await writeFile("/tmp/msi-admin-review-cleanup.json", JSON.stringify({
      users: state.users.map(user => ({ uid: user.uid })), visitors: state.visitors,
      projectIds: state.projectIds, filmmakerIds: state.filmmakerIds,
      unresolvedMediaPaths: state.unresolvedMediaPaths ?? [],
    }), { mode: 0o600 });
  } else await writeFile(fixturePath, JSON.stringify(state), { mode: 0o600 });
  process.exitCode = 1;
} finally { await pool.end(); }