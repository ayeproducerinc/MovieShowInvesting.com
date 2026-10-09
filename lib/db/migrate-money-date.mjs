import pg from "pg";
import { readFile } from "node:fs/promises";

// Run by the owner (not on deploy): pnpm --filter @workspace/db run migrate:money-date
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the money date migration.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('msi:money-date-migration'))");
  await client.query(await readFile(new URL("./migrations/money-date.sql", import.meta.url), "utf8"));
  await client.query("COMMIT");
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_name = 'project_money_dates'",
  );
  console.log(`Money date migration complete. Tables present: ${rows.map((row) => row.table_name).join(", ")}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
