#!/usr/bin/env node
// Explicit live API/browser fixtures: --setup, then --cleanup.
// Restricted tokens exist only in /tmp and are never logged or committed.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, unlink } from "node:fs/promises";
const fixturePath = "/tmp/msi-homepage-count-fixtures.json";
const api = "http://localhost:80/api";
const requireApi = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const requireDb = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { cert, initializeApp, deleteApp } = requireApi("firebase-admin/app");
const { getAuth } = requireApi("firebase-admin/auth");
const app = initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) }, `home-count-${randomUUID()}`);
const auth = getAuth(app);
async function request(route, { token, cookie, data } = {}) {
  const response = await fetch(`${api}/${route}`, {
    method: data ? "POST" : "GET",
    headers: { ...(data ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return { response, body: await response.json() };
}
async function cleanup(fixture) {
  const { Pool } = requireDb("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (fixture.visitors.length) {
      await pool.query("DELETE FROM visitors WHERE visitor_id=ANY($1::text[])", [fixture.visitors]);
    }
    const keys = fixture.users.map((u) => `firebase:${u.uid}`);
    await pool.query("DELETE FROM filmmaker_activity WHERE identity_key=ANY($1::text[])", [keys]);
    for (const user of fixture.users) {
      assert(user.uid.startsWith("home-count-"));
      await auth.deleteUser(user.uid).catch(error => {
        if (error.code !== "auth/user-not-found") throw error;
      });
    }
  } finally { await pool.end(); }
}
try {
  if (process.argv.includes("--cleanup")) {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    await cleanup(fixture);
    await unlink(fixturePath);
    console.log("Homepage count fixtures and temporary credentials removed.");
  } else if (process.argv.includes("--reset-browser-joins")) {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const uids = fixture.users.filter(u => u.purpose !== "api").map(u => u.uid);
    assert(uids.every(uid => uid.startsWith("home-count-")));
    const { Pool } = requireDb("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const linked = await pool.query("SELECT visitor_id FROM filmmaker_account_visitors WHERE firebase_uid=ANY($1::text[])", [uids]);
      assert.equal(linked.rowCount, 0, "Cannot reset browser fixtures that have linked work.");
      await pool.query("DELETE FROM filmmaker_activity WHERE identity_key=ANY($1::text[])", [uids.map(uid => `firebase:${uid}`)]);
      console.log("Only synthetic browser-join records reset for focused display verification.");
    } finally { await pool.end(); }
  } else if (process.argv.includes("--setup")) {
    try { await readFile(fixturePath); throw new Error("Clean up the existing homepage fixture first."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const fixture = { users: [], visitors: [] };
    const persist = () => writeFile(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
    await persist();
    try {
      const config = (await request("config")).body;
      const base = (await request("stats")).body.filmmakers;
      for (const purpose of ["api", "desktop", "mobile", "recovery"]) {
        const uid = `home-count-${randomUUID()}`;
        await auth.createUser({ uid, email: `${uid}@example.invalid`, emailVerified: true });
        const user = { uid, purpose };
        fixture.users.push(user);
        await persist();
        user.customToken = await auth.createCustomToken(uid);
        const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(config.apiKey)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: user.customToken, returnSecureToken: true }),
        });
        if (!response.ok) throw new Error(`Fixture authentication failed (HTTP ${response.status}).`);
        user.idToken = (await response.json()).idToken;
        await persist();
      }
      const token = fixture.users[0].idToken;
      assert.equal((await request("filmmakers/community/join", { data: { source: "homepage" } })).response.status, 401);
      assert.equal((await request("filmmakers/community/join", { token, data: { source: "investor" } })).response.status, 400);
      assert.equal((await request("stats")).body.filmmakers, base);
      const joined = await request("filmmakers/community/join", { token, data: { source: "homepage" } });
      assert.equal(joined.response.status, 200);
      assert.equal(joined.body.filmmakers, base + 1);
      const repeated = await Promise.all(Array.from({ length: 6 }, () => request("filmmakers/community/join", { token, data: { source: "homepage" } })));
      assert(repeated.every(r => r.response.status === 200 && r.body.filmmakers === base + 1));
      const visit = await request("visit", { data: {} });
      const cookie = visit.response.headers.get("set-cookie")?.match(/msi_visitor_id=[^;]+/)?.[0];
      assert(cookie);
      const visitorId = cookie.split("=")[1];
      fixture.visitors.push(visitorId);
      await persist();
      const draft = await request("progress", { cookie, data: { flow: "filmmaker", last_screen: 1, answers: { stage: "idea" } } });
      assert.equal(draft.response.status, 200);
      const context = await request("progress/filmmaker", { cookie });
      assert(context.body.draft_id);
      assert.equal((await request("stats")).body.filmmakers, base + 2);
      assert.equal((await request("filmmakers/community/join", { token, cookie, data: { source: "homepage", draft_id: context.body.draft_id + 1 } })).response.status, 409);
      const merged = await request("filmmakers/community/join", { token, cookie, data: { source: "homepage", draft_id: context.body.draft_id } });
      assert.equal(merged.response.status, 200);
      assert.equal(merged.body.filmmakers, base + 1);
      assert.equal((await request("filmmakers/community/join", { token: fixture.users[1].idToken, cookie, data: { source: "homepage", draft_id: context.body.draft_id } })).response.status, 403);
      assert.equal((await request("stats")).body.filmmakers, base + 1);
      console.log("PASS live API: verified registration, concurrent retries, guest merge, stale draft rejection, wrong-owner rejection, unauthenticated and investor-source exclusions.");
      console.log("Browser fixtures ready in the restricted temporary file.");
    } catch (error) {
      await cleanup(fixture);
      await unlink(fixturePath);
      throw error;
    }
  } else throw new Error("Use --setup or --cleanup.");
} finally { await deleteApp(app); }