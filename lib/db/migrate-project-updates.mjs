import pg from "pg";
import { readFile } from "node:fs/promises";

// Run by the owner (not on deploy): pnpm --filter @workspace/db run migrate:project-updates
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the project updates migration.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  // Serialize simultaneous runs; IF NOT EXISTS alone can race in PostgreSQL.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('msi:project-updates-migration'))");
  await client.query(await readFile(new URL("./migrations/project-updates.sql", import.meta.url), "utf8"));
  await client.query("COMMIT");
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_name in ('project_updates', 'project_update_emails') order by table_name",
  );
  console.log(`Project updates migration complete. Tables present: ${rows.map((row) => row.table_name).join(", ")}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
