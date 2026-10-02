import pg from "pg";
import { readFile } from "node:fs/promises";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the filmmaker activity migration.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  // Serialize simultaneous service starts; IF NOT EXISTS alone can race in PostgreSQL.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('msi:filmmaker-activity-migration'))");
  await client.query(await readFile(new URL("./migrations/filmmaker-activity.sql", import.meta.url), "utf8"));
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}