#!/usr/bin/env node
/**
 * Explicit operator command; never runs on startup or publication.
 * Uses the existing canonical admin identity without creating users, storing
 * credentials, printing tokens, or obtaining a production database connection.
 * Production base URL must be obtained from the deployment metadata.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const apiRequire = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { initializeApp, cert, deleteApp } = apiRequire("firebase-admin/app");
const { getAuth } = apiRequire("firebase-admin/auth");
const args = process.argv.slice(2);
const option = key => args[args.indexOf(key) + 1];
const environment = args.includes("--environment") ? option("--environment") : null;
const base = args.includes("--base") ? option("--base").replace(/\/$/, "") : null;
const execute = args.includes("--execute");
const cleanupMedia = args.includes("--cleanup-media");
const cleanupFollowups = args.includes("--cleanup-followups");
const asdfOnly = args.includes("--asdf-only");
let app;
let pool;
let stage = "configuration";
try {
  assert(["preview", "published"].includes(environment), "Choose preview or published explicitly.");
  assert(base, "An explicit API base URL is required.");
  const target = new URL(base);
  assert(target.protocol === "https:" || ["localhost", "127.0.0.1"].includes(target.hostname), "API URL must use HTTPS.");
  assert(!target.username && !target.password && !target.search && !target.hash, "API URL must not contain credentials or query parameters.");
  assert(!cleanupMedia || execute, "Media cleanup requires --execute.");
  assert(!asdfOnly || (environment === "published" && !cleanupMedia && !cleanupFollowups),
    "Asdf-only cleanup must target published without media or follow-up cleanup.");
  const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  async function request(path, token, body) {
    const response = await fetch(`${base}${path}`, {
      method: body ? "POST" : "GET",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(120_000),
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  }
  const config = await request("/config");
  assert(config.response.ok && config.data?.projectId === account.project_id, "Target Firebase project does not match.");
  stage = "administrator authentication";
  app = initializeApp({ credential: cert(account) }, "confirmed-project-cleanup");
  const auth = getAuth(app);
  const administrator = await auth.getUserByEmail(process.env.ADMIN_EMAIL);
  const customToken = await auth.createCustomToken(administrator.uid);
  const exchange = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(config.data.apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(20_000),
  });
  const credential = await exchange.json();
  assert(exchange.ok && credential.idToken, "Administrator authentication failed.");
  const token = credential.idToken;
  const payload = { environment, dry_run: true, confirmation: "DELETE CONFIRMED TEST PROJECTS", cleanup_media: cleanupMedia, cleanup_followups: cleanupFollowups,
    ...(asdfOnly ? { project_scope: "asdf" } : {}) };
  const path = "/admin/confirmed-test-project-cleanup";
  stage = "authorization and environment safeguards";
  assert.equal((await request(path, null, payload)).response.status, 401, "Anonymous cleanup must be rejected.");
  assert.equal((await request(path, token, { ...payload, confirmation: "wrong" })).response.status, 400, "Missing confirmation must be rejected.");
  assert.equal((await request(path, token, { ...payload, environment: environment === "preview" ? "published" : "preview" })).response.status, 409, "Wrong environment must be rejected.");
  const dry = await request(path, token, payload);
  stage = "admin dry run";
  assert.equal(dry.response.status, 200, "Admin dry run must succeed.");
  if (asdfOnly) {
    stage = "live asdf-only scope verification (publish the scoped cleanup before executing)";
    assert.equal(dry.data?.project_scope, "asdf", "The live server must support the exact asdf-only scope before execution.");
    assert.equal(dry.data.candidate_count, 1, "The exact confirmed project must be present before execution.");
  }
  if (cleanupFollowups) {
    assert.equal(typeof dry.data?.followup_candidate_count, "number", "This server must have the follow-up cleanup update before execution.");
  }
  console.log("Dry run:", JSON.stringify(dry.data));

  // Local development verification: immutable signatures/account rows must remain
  // byte-for-byte unchanged. Never use this connection for published cleanup.
  async function preservedEvidence() {
    const result = await pool.query(`SELECT
      (SELECT md5(coalesce(jsonb_agg(to_jsonb(x)-'call_opt_in' ORDER BY id)::text,'[]')) FROM investors x) AS investors,
      (SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY id)::text,'[]')) FROM interest_entries x) AS signatures,
      (SELECT md5(coalesce(jsonb_agg(to_jsonb(x)-'chat_opt_in' ORDER BY id)::text,'[]')) FROM filmmakers x) AS filmmakers,
      (SELECT count(*)::int FROM filmmaker_account_visitors) AS account_links,
      (SELECT count(*)::int FROM visitors) AS visitors`);
    return result.rows[0];
  }
  let before;
  if (execute && environment === "preview") {
    const dbRequire = createRequire(new URL("../lib/db/package.json", import.meta.url));
    const { Pool } = dbRequire("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    before = await preservedEvidence();
  }
  if (execute) {
    stage = "deletion and post-deletion verification";
    const deleted = await request(path, token, { ...payload, dry_run: false });
    assert.equal(deleted.response.status, 200, "Deletion must succeed; inspect archive before retrying if a request failed.");
    assert.equal(deleted.data.deleted_count, dry.data.candidate_count, "Deleted count must match the confirmed dry run.");
    if (asdfOnly) assert.deepEqual(deleted.data.deleted_ids, [16], "Only the confirmed asdf project may be deleted.");
    assert.equal(deleted.data.cleared_followups, dry.data.followup_candidate_count, "Cleared follow-ups must match the dry run.");
    console.log("Deletion result:", JSON.stringify(deleted.data));
    if (pool) {
      assert.deepEqual(await preservedEvidence(), before, "Accounts and signed evidence must remain unchanged.");
      console.log("PASS accounts and immutable investor history preserved");
    }
    const explore = await request("/explore");
    assert(explore.response.ok && Array.isArray(explore.data?.projects), "Explore must return actual results.");
    const allowed = new Set(asdfOnly ? [16] : environment === "preview" ? [2,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,27,28,30,34,35] : [2,4,5,6,7,8,9,10,11,12,13]);
    assert(!explore.data.projects.some(project => allowed.has(project.id)), "Confirmed test projects must not remain in Explore.");
    console.log("PASS confirmed test projects absent from Explore");
    const queues = await request("/admin/tables/queues", token);
    assert(queues.response.ok && Array.isArray(queues.data?.rows), "Admin queue must return actual results.");
    const queueColumn = queues.data.columns.findIndex(label => /^queue$/i.test(label));
    const projectColumn = queues.data.columns.findIndex(label => /^project id$/i.test(label));
    assert(queueColumn >= 0 && projectColumn >= 0);
    assert(!queues.data.rows.some(row => allowed.has(Number(row[projectColumn]))), "Confirmed projects must not remain in the admin queue.");
    if (cleanupFollowups && deleted.data.remaining_followups === 0 && deleted.data.remaining_projects === 0) {
      assert.equal(queues.data.rows.length, 0, "The cleared admin queue must be empty.");
    }
    console.log("PASS admin queue verified:", queues.data.rows.length, "remaining entries");
  }
} catch {
  // SDK errors can contain personal information. Do not print raw error objects.
  console.error(`Cleanup command stopped at ${stage}. Check the dry-run/deletion result and private archive before retrying.`);
  process.exitCode = 1;
} finally {
  await pool?.end();
  if (app) await deleteApp(app);
}