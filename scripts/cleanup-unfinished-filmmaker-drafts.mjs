#!/usr/bin/env node
// Explicit operator command only. No startup cleanup, production DB connection,
// new accounts, credential files, or printed tokens. Obtain --base from current
// deployment metadata before invoking this for the published app.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { initializeApp, cert, deleteApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const args = process.argv.slice(2);
const option = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
const base = option("--base")?.replace(/\/$/, "");
const environment = option("--environment");
const inventoryPath = option("--inventory");
const execute = args.includes("--execute");
let app;
try {
  assert(base && inventoryPath && ["published", "preview"].includes(environment), "Explicit --base, --environment and --inventory are required.");
  const target = new URL(base);
  assert(target.protocol === "https:" || ["localhost", "127.0.0.1"].includes(target.hostname), "Use HTTPS.");
  assert(!target.username && !target.password && !target.search && !target.hash, "Do not put credentials in the URL.");
  const service = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const request = async (path, token, body) => {
    const response = await fetch(`${base}${path}`, {
      method: body ? "POST" : "GET",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120000),
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  };
  const config = await request("/config");
  assert(config.response.ok && config.data?.projectId === service.project_id, "Target Firebase project does not match.");
  app = initializeApp({ credential: cert(service) }, "unfinished-draft-cleanup");
  const auth = getAuth(app);
  const administrator = await auth.getUserByEmail(process.env.ADMIN_EMAIL);
  const customToken = await auth.createCustomToken(administrator.uid);
  const exchange = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(config.data.apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(20000),
  });
  const credentials = await exchange.json();
  assert(exchange.ok && credentials.idToken, "Administrator authentication failed.");
  const token = credentials.idToken;
  const path = "/admin/unfinished-draft-cleanup";
  assert.equal((await request(path, null, { environment, dry_run: true })).response.status, 401, "Anonymous cleanup must be rejected. Publish the new capability first if this route is missing.");
  assert.equal((await request(path, token, { environment, dry_run: false })).response.status, 400, "Unconfirmed cleanup must be rejected.");
  const preview = await request(path, token, { environment, dry_run: true });
  assert.equal(preview.response.status, 200, "Cleanup inventory is unavailable.");
  if (!execute) {
    await writeFile(inventoryPath, JSON.stringify({ base, environment, captured_at: new Date().toISOString(), ...preview.data }, null, 2), { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ eligible: preview.data.drafts.length, protected: preview.data.protected_count, inventory: inventoryPath, executed: false }));
  } else {
    const frozen = JSON.parse(await readFile(inventoryPath, "utf8"));
    assert(frozen.base === base && frozen.environment === environment && Array.isArray(frozen.drafts), "Frozen allowlist target mismatch.");
    const result = await request(path, token, {
      environment, dry_run: false, confirmation: "CLEAR ALL UNFINISHED FILMMAKER DRAFTS", drafts: frozen.drafts,
    });
    assert.equal(result.response.status, 200, "Cleanup did not return success. Inspect live state before retrying.");
    console.log(JSON.stringify({ cleared: result.data.cleared, skipped: result.data.skipped, remaining_eligible: result.data.drafts.length, protected: result.data.protected_count }));
  }
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message : "Cleanup could not complete. No credentials were logged.");
  process.exitCode = 1;
} finally { if (app) await deleteApp(app); }