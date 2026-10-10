import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { transformSync } = require("esbuild");
const source = await readFile(new URL("../lib/db/src/test-project-cleanup.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { loader: "ts", format: "esm" });
const { cleanupConfirmedTestProjects } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

const confirmedProject = {
  id: 16, title: "asdf", logline: "asdf lkjsdf",
  slug: "asdf-448af969-52fc-449c-945b-2e194ed5249e",
};

function fixture(project = confirmedProject, archived = false) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT p.*")) {
        assert.deepEqual(params, [[16]], "Never select historical or unrelated projects");
        return { rows: project ? [project] : [] };
      }
      if (sql.includes("AS pledges") && sql.includes("count(*)")) {
        return { rows: [{ pledges: 0, checkouts: project ? 3 : 0 }] };
      }
      if (sql.includes("SELECT 1 FROM test_project_archive")) {
        return { rowCount: archived ? 1 : 0, rows: [] };
      }
      if (sql.includes("jsonb_agg")) {
        return { rows: [{ pledges: [], checkouts: [{ id: 1 }, { id: 2 }, { id: 3 }] }] };
      }
      if (sql.includes("SELECT count(*)::int AS count FROM projects")) {
        return { rows: [{ count: 2 }] };
      }
      if (sql.includes("FROM investors WHERE call_opt_in")) {
        return { rows: [{ count: 0 }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push({ sql: "RELEASE" }); },
  };
  return { pool: { connect: async () => client }, calls };
}

test("asdf dry run selects only the exact live project and makes no data changes", async () => {
  const { pool, calls } = fixture();
  const result = await cleanupConfirmedTestProjects(pool, "published", true, false, "asdf");
  assert.equal(result.project_scope, "asdf");
  assert.equal(result.candidate_count, 1);
  assert.equal(result.deleted_count, 0);
  assert.equal(calls.some(c => /^(INSERT|DELETE|UPDATE)/.test(c.sql)), false);
});

test("deletion archives all three checkout records before deleting only project 16", async () => {
  const { pool, calls } = fixture();
  const result = await cleanupConfirmedTestProjects(pool, "published", false, false, "asdf");
  assert.deepEqual(result.deleted_ids, [16]);
  assert.equal(result.archived_checkouts, 3);
  const archiveIndex = calls.findIndex(c => c.sql.includes("INSERT INTO test_project_archive"));
  const deleteIndex = calls.findIndex(c => c.sql.startsWith("DELETE FROM projects"));
  assert(archiveIndex >= 0 && deleteIndex > archiveIndex);
  const archive = JSON.parse(calls[archiveIndex].params[2]);
  assert.deepEqual(archive.project, confirmedProject);
  assert.equal(archive.checkouts.length, 3);
  assert.deepEqual(calls[deleteIndex].params, [[16]]);
  assert.equal(calls.some(c => /^(DELETE FROM|UPDATE) (investors|filmmakers|interest_entries|visitors)\b/.test(c.sql)), false);
});

for (const field of ["title", "slug", "logline"]) {
  test(`changed ${field} refuses deletion and rolls back`, async () => {
    const { pool, calls } = fixture({ ...confirmedProject, [field]: "changed" });
    await assert.rejects(cleanupConfirmedTestProjects(pool, "published", false, false, "asdf"));
    assert(calls.some(c => c.sql === "ROLLBACK"));
    assert.equal(calls.some(c => /^(INSERT|DELETE|UPDATE)/.test(c.sql)), false);
  });
}

test("preview and follow-up cleanup are rejected before any database access", async () => {
  const pool = { connect() { throw new Error("Must not access database"); } };
  await assert.rejects(cleanupConfirmedTestProjects(pool, "preview", false, false, "asdf"), /published-only/);
  await assert.rejects(cleanupConfirmedTestProjects(pool, "published", false, true, "asdf"), /published-only/);
});

test("existing archive prevents overwriting historical evidence", async () => {
  const { pool, calls } = fixture(confirmedProject, true);
  await assert.rejects(cleanupConfirmedTestProjects(pool, "published", false, false, "asdf"), /existing deletion archive/);
  assert.equal(calls.some(c => /^(INSERT|DELETE|UPDATE)/.test(c.sql)), false);
});

test("missing project does not expand deletion scope", async () => {
  const { pool, calls } = fixture(null);
  const result = await cleanupConfirmedTestProjects(pool, "published", false, false, "asdf");
  assert.equal(result.deleted_count, 0);
  assert.deepEqual(result.deleted_ids, []);
  for (const call of calls.filter(c => c.sql.startsWith("DELETE FROM"))) {
    assert.deepEqual(call.params, [[]]);
  }
});
