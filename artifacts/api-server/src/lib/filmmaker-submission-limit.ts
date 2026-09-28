import { createHmac } from "node:crypto";
import { pool } from "@workspace/db";

const IP_HOURLY_LIMIT = 30;
const VISITOR_HOURLY_LIMIT = 10;

/** Reserve an attempt before creating a submission. Raw IPs and visitor IDs are never stored. */
export async function reserveFilmmakerSubmissionAttempt(ip: string, visitorId: string): Promise<boolean> {
  const key = process.env.SESSION_SECRET?.trim() || process.env.DATABASE_URL;
  if (!key) throw new Error("Filmmaker submission hashing is not configured.");
  const ipHash = createHmac("sha256", key).update(ip).digest("hex");
  const visitorHash = createHmac("sha256", key).update(`visitor:${visitorId}`).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Always lock IP then visitor so concurrent cookies on one network cannot evade
    // the IP limit and the two counters cannot deadlock each other.
    await client.query("select pg_advisory_xact_lock(hashtext('filmmaker-ip:' || $1))", [ipHash]);
    await client.query("select pg_advisory_xact_lock(hashtext('filmmaker-visitor:' || $1))", [visitorHash]);
    await client.query(
      "delete from filmmaker_submission_attempts where attempted_at < now() - interval '2 hours'",
    );
    const result = await client.query<{ ip_count: number; visitor_count: number }>(
      `select
         (select count(*)::int from filmmaker_submission_attempts
          where ip_hash = $1 and attempted_at > now() - interval '1 hour') as ip_count,
         (select count(*)::int from filmmaker_submission_attempts
          where visitor_hash = $2 and attempted_at > now() - interval '1 hour') as visitor_count`,
      [ipHash, visitorHash],
    );
    if (result.rows[0].ip_count >= IP_HOURLY_LIMIT
      || result.rows[0].visitor_count >= VISITOR_HOURLY_LIMIT) {
      await client.query("commit");
      return false;
    }
    await client.query(
      "insert into filmmaker_submission_attempts (ip_hash, visitor_hash) values ($1, $2)",
      [ipHash, visitorHash],
    );
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}