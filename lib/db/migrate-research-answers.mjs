import pg from "pg";
import { readFile } from "node:fs/promises";

// Run by the owner (not on deploy): pnpm --filter @workspace/db run migrate:research-answers
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the research answers migration.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('msi:research-answers-migration'))");
  await client.query(await readFile(new URL("./migrations/research-answers.sql", import.meta.url), "utf8"));
  await client.query("COMMIT");
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_name = 'investor_research_answers'",
  );
  console.log(`Research answers migration complete. Tables present: ${rows.map((row) => row.table_name).join(", ")}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
