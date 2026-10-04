import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const visitors = [];
let cookie = "";
const rememberCookie = response => {
  const next = response.headers.get("set-cookie")?.match(/msi_visitor_id=([^;]+)/)?.[1];
  if (next) { cookie = `msi_visitor_id=${next}`; visitors.push(next); }
};
async function call(path, { body, headers = {}, originalCookie = cookie } = {}) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { Cookie: originalCookie, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  return { response, data };
}
try {
  rememberCookie((await call("/price-group")).response);
  const save = { flow: "filmmaker", last_screen: 2, answers: { title: `ResetHttp-${randomUUID()}`, stage: "idea" } };
  assert.equal((await call("/progress", { body: save })).response.status, 200);
  const original = (await call("/progress/filmmaker")).data;
  const originalCookie = cookie;
  const headers = { "X-MSI-Draft-Id": String(original.draft_id) };
  const preview = (await call("/filmmakers/drafts/reset", { headers })).data;
  assert.equal((await call("/filmmakers/drafts/reset", { headers, body: { ...preview, confirm: false } })).response.status, 400);
  assert.equal((await call("/progress/filmmaker")).data.answers.title, save.answers.title);
  const reset = await call("/filmmakers/drafts/reset", { headers, body: { ...preview, confirm: true } });
  assert.equal(reset.response.status, 200);
  rememberCookie(reset.response);
  const fresh = (await call("/progress/filmmaker")).data;
  assert.notEqual(fresh.draft_id, original.draft_id);
  assert.deepEqual(fresh.answers, {});
  assert.equal((await call("/progress", { originalCookie, body: save })).response.status, 409, "A headerless first save cannot resurrect the retired browser context.");
  assert.equal((await call("/progress", { originalCookie, body: save, headers })).response.status, 409);
  assert.equal((await call("/progress/filmmaker", { originalCookie })).data.code, "draft_cleared");
  assert.equal((await call("/progress", { body: save, headers })).response.status, 409);
  assert.equal((await call("/progress", { body: save })).response.status, 409);
  assert.equal((await call("/filmmakers/drafts/reset", { headers })).response.status, 409, "An old form cannot offer a reset of another tab’s fresh draft.");
  assert.deepEqual((await call("/progress/filmmaker")).data.answers, {});
  console.log("PASS: explicit confirmation, fresh cookie/draft, retired old-cookie saves with and without headers, stale form reset refusal, and no fresh-draft overwrite.");
} finally {
  await pool.query("delete from visitors where visitor_id=any($1::text[])", [visitors]);
  await pool.end();
}