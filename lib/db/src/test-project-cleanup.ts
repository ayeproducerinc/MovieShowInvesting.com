import type { Pool } from "pg";

export type CleanupEnvironment = "preview" | "published";
export const TEST_PROJECT_DELETE_CONFIRMATION = "DELETE CONFIRMED TEST PROJECTS";

// Owner-confirmed inventory. Never select all projects or add later-created IDs.
export const confirmedTestProjects: Record<CleanupEnvironment, Record<number, string>> = {
  preview: {
    2: "asd", 4: "asdasdfjk", 5: "hblkhjlkjh", 6: "asl;jksadf;lk",
    7: "kjhlkj hlkj", 8: "okjh lkjhlkj hljh", 9: "kjhgkjh kjh", 10: "123v tih",
    11: "test 123", 12: "Test 123", 13: "Test 1031", 14: "Test a bc 123",
    15: "Fguy", 16: "Tre", 17: "Dghj", 18: "asdj a;skldj f;laskdjf",
    19: "a;lksdj flkj", 20: "Hshd", 27: "bdb", 28: "Fgg",
    30: "G g j", 34: "Ghh", 35: "Cvb",
  },
  published: {
    2: "asd", 4: "asdasdfjk", 5: "hblkhjlkjh", 6: "asl;jksadf;lk",
    7: "kjhlkj hlkj", 8: "okjh lkjhlkj hljh", 9: "kjhgkjh kjh",
    10: "123v tih", 11: "test 123", 12: "aasildfj plaks jfdtest",
    13: "asdf hlasdf jtest 123",
  },
};

export class TestProjectCleanupConflict extends Error {}

// Separately confirmed test follow-ups. Do not include later requests or accounts.
const confirmedTestFollowups: Record<CleanupEnvironment, { calls: number[]; chats: number[] }> = {
  preview: { calls: [1, 2], chats: [4, 6, 7, 8, 9, 11, 12, 14, 29, 38, 39] },
  published: { calls: [1, 2], chats: [4, 6, 7, 8, 9, 11, 12] },
};

export async function cleanupConfirmedTestProjects(
  pool: Pool, environment: CleanupEnvironment, dryRun: boolean,
  cleanupFollowups = false,
) {
  const confirmed = confirmedTestProjects[environment];
  const ids = Object.keys(confirmed).map(Number);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SELECT pg_advisory_xact_lock(730184221)");
    // Prevent concurrent writes from creating dependencies between archive and delete.
    await client.query(`LOCK TABLE projects, pledges, pitch_review_checkouts, messages,
      conversations, conversation_messages, conversation_moderation_audit,
      interest_alerts, flow_progress, investors, filmmakers IN SHARE ROW EXCLUSIVE MODE`);
    const projects = await client.query(
      `SELECT p.*, f.visitor_id AS cleanup_visitor_id
       FROM projects p LEFT JOIN filmmakers f ON f.id=p.filmmaker_id
       WHERE p.id=ANY($1::int[]) ORDER BY p.id FOR UPDATE OF p`, [ids],
    );
    for (const project of projects.rows) {
      if (project.title !== confirmed[project.id]) {
        throw new TestProjectCleanupConflict("A confirmed project's title has changed. No projects were deleted.");
      }
    }
    const activeIds = projects.rows.map(project => Number(project.id));
    const dependencies = await client.query(
      `SELECT
        (SELECT count(*)::int FROM pledges WHERE project_id=ANY($1::int[])) AS pledges,
        (SELECT count(*)::int FROM pitch_review_checkouts WHERE project_id=ANY($1::int[])) AS checkouts`,
      [activeIds],
    );
    const followups = confirmedTestFollowups[environment];
    const followupCandidates = cleanupFollowups ? await client.query(
      `SELECT
        (SELECT count(*)::int FROM investors i WHERE i.call_opt_in=true AND i.id=ANY($1::int[])
          AND NOT EXISTS (SELECT 1 FROM test_followup_archive a WHERE a.kind='investor_call' AND a.record_id=i.id))
        + (SELECT count(*)::int FROM filmmakers f WHERE f.chat_opt_in=true AND f.id=ANY($2::int[])
          AND NOT EXISTS (SELECT 1 FROM test_followup_archive a WHERE a.kind='filmmaker_chat' AND a.record_id=f.id)) AS count`,
      [followups.calls, followups.chats],
    ) : null;
    let clearedFollowups = 0;
    if (!dryRun) {
      for (const project of projects.rows) {
        const existingArchive = await client.query("SELECT 1 FROM test_project_archive WHERE project_id=$1", [project.id]);
        if (existingArchive.rowCount) {
          throw new TestProjectCleanupConflict("A live project conflicts with an existing deletion archive. No projects were deleted.");
        }
        const evidence = await client.query(
          `SELECT
            coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM pledges x WHERE x.project_id=$1), '[]'::jsonb) AS pledges,
            coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM pitch_review_checkouts x WHERE x.project_id=$1), '[]'::jsonb) AS checkouts,
            coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM messages x WHERE x.project_id=$1), '[]'::jsonb) AS messages,
            coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM conversations x WHERE x.project_id=$1), '[]'::jsonb) AS conversations,
            coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM conversation_messages x JOIN conversations c ON c.id=x.conversation_id WHERE c.project_id=$1), '[]'::jsonb) AS conversation_messages,
            coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM conversation_moderation_audit x JOIN conversations c ON c.id=x.conversation_id WHERE c.project_id=$1), '[]'::jsonb) AS moderation,
            coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM flow_progress x WHERE x.flow='filmmaker' AND x.answers#>>'{_submission,project_id}'=$2), '[]'::jsonb) AS filmmaker_submissions`,
          [project.id, String(project.id)],
        );
        await client.query(
          `INSERT INTO test_project_archive(project_id, environment, snapshot)
           VALUES ($1, $2, $3::jsonb)`,
          [project.id, environment, JSON.stringify({ project, ...evidence.rows[0] })],
        );
      }
      // Signed interest_entries and financial/account identities are unchanged.
      // Archive then remove allocations, rather than letting SET NULL turn them into
      // unallocated interest. Archive retains the original project/entry linkage.
      await client.query("DELETE FROM pledges WHERE project_id=ANY($1::int[])", [activeIds]);
      await client.query("DELETE FROM pitch_review_checkouts WHERE project_id=ANY($1::int[])", [activeIds]);
      await client.query("DELETE FROM messages WHERE project_id=ANY($1::int[])", [activeIds]);
      await client.query(`DELETE FROM flow_progress WHERE flow='filmmaker' AND completed=true
        AND answers#>>'{_submission,project_id}'=ANY($1::text[])`, [activeIds.map(String)]);
      await client.query(`UPDATE flow_progress SET answers=answers-'_submission', updated_at=now()
        WHERE flow='filmmaker' AND completed=false
        AND answers#>>'{_submission,project_id}'=ANY($1::text[])`, [activeIds.map(String)]);
      await client.query("DELETE FROM projects WHERE id=ANY($1::int[])", [activeIds]);
      if (cleanupFollowups) {
        // Preserve the original test request. Only IDs newly archived in THIS
        // transaction can be cleared, making repeat execution safe for new requests.
        const calls = await client.query(
          `INSERT INTO test_followup_archive(kind, record_id, environment, snapshot)
           SELECT 'investor_call', i.id, $2, to_jsonb(i) FROM investors i
           WHERE i.call_opt_in=true AND i.id=ANY($1::int[])
           ON CONFLICT DO NOTHING RETURNING record_id`, [followups.calls, environment],
        );
        const chats = await client.query(
          `INSERT INTO test_followup_archive(kind, record_id, environment, snapshot)
           SELECT 'filmmaker_chat', f.id, $2, to_jsonb(f) FROM filmmakers f
           WHERE f.chat_opt_in=true AND f.id=ANY($1::int[])
           ON CONFLICT DO NOTHING RETURNING record_id`, [followups.chats, environment],
        );
        await client.query("UPDATE investors SET call_opt_in=false WHERE id=ANY($1::int[])",
          [calls.rows.map(row => Number(row.record_id))]);
        await client.query("UPDATE filmmakers SET chat_opt_in=false WHERE id=ANY($1::int[])",
          [chats.rows.map(row => Number(row.record_id))]);
        clearedFollowups = calls.rows.length + chats.rows.length;
      }
    }
    const remaining = await client.query("SELECT count(*)::int AS count FROM projects");
    const remainingFollowups = await client.query(`SELECT
      (SELECT count(*)::int FROM investors WHERE call_opt_in=true)
      + (SELECT count(*)::int FROM filmmakers WHERE chat_opt_in=true) AS count`);
    await client.query("COMMIT");
    return {
      environment, candidate_count: activeIds.length, deleted_count: dryRun ? 0 : activeIds.length,
      deleted_ids: dryRun ? [] : activeIds,
      archived_pledges: dryRun ? 0 : Number(dependencies.rows[0].pledges),
      archived_checkouts: dryRun ? 0 : Number(dependencies.rows[0].checkouts),
      remaining_projects: Number(remaining.rows[0].count),
      followup_candidate_count: Number(followupCandidates?.rows[0].count ?? 0),
      cleared_followups: clearedFollowups,
      remaining_followups: Number(remainingFollowups.rows[0].count),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}