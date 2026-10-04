import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type Identity = { provider: "firebase" | "replit"; uid: string };
export type DraftResetSelection = { key: string; version: string; label: string };
type Row = {
  visitor_id: string;
  draft_id: number | null;
  firebase_uid: string | null;
  replit_uid: string | null;
  protected: boolean;
  snapshot: unknown;
};
export class DraftResetConflict extends Error {}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Include exact PostgreSQL timestamps, ownership and materials in the version,
// not just millisecond-truncated JS dates. Never send private answers to clients.
async function inventory(connection: Pool | PoolClient): Promise<Row[]> {
  return (await connection.query<Row>(`
    select v.visitor_id, p.id as draft_id, a.firebase_uid, a.replit_uid,
      (coalesce(p.completed,false)
       or exists(select 1 from filmmakers f where f.visitor_id=v.visitor_id)
       or exists(select 1 from pitch_review_checkouts c where c.visitor_id=v.visitor_id)) as protected,
      jsonb_build_object('progress',to_jsonb(p),'materials',to_jsonb(m),
        'owner',to_jsonb(a),'retired',v.filmmaker_draft_reset_at) as snapshot
    from visitors v
    left join flow_progress p on p.visitor_id=v.visitor_id and p.flow='filmmaker'
    left join filmmaker_draft_materials m on m.visitor_id=v.visitor_id
    left join filmmaker_account_visitors a on a.visitor_id=v.visitor_id
    where p.id is not null or m.visitor_id is not null
    order by v.visitor_id
  `)).rows;
}
function selected(row: Row, currentVisitor?: string | null): DraftResetSelection {
  return {
    key: hash(row.visitor_id), version: hash(row.snapshot),
    label: row.visitor_id === currentVisitor ? "This browser’s unfinished pitch" : "Your account’s unfinished pitch",
  };
}
function scoped(rows: Row[], currentVisitor: string | null, identity: Identity | null): Row[] {
  const current = rows.find(row => row.visitor_id === currentVisitor);
  const owns = (row: Row) => Boolean(identity && (
    identity.provider === "firebase"
      ? row.firebase_uid === identity.uid && row.replit_uid === null
      : row.replit_uid === identity.uid && row.firebase_uid === null));
  if (current && (current.firebase_uid || current.replit_uid) && !owns(current)) {
    throw new DraftResetConflict("This browser’s pitch belongs to another account. Sign in with its owner.");
  }
  return rows.filter(row => row.visitor_id === currentVisitor || owns(row));
}
function context(visitor: string | null, identity: Identity | null) {
  return hash([visitor, identity?.provider ?? null, identity?.uid ?? null]);
}
function checkExpectedDraft(rows: Row[], visitor: string | null, expectedDraftId?: number) {
  const actual = rows.find(row => row.visitor_id === visitor)?.draft_id;
  if (expectedDraftId !== undefined && actual != null && actual !== expectedDraftId) {
    throw new DraftResetConflict("A different draft is selected in this browser. Refresh before starting over.");
  }
}
export async function inspectDraftReset(
  pool: Pool, currentVisitor: string | null, identity: Identity | null, expectedDraftId?: number,
) {
  const rows = scoped(await inventory(pool), currentVisitor, identity);
  checkExpectedDraft(rows, currentVisitor, expectedDraftId);
  // A submitted pitch in the current browser is preserved; only unfinished
  // account work is reset. A dependent incomplete draft must not be detached.
  const blocked = rows.filter(row => row.protected && (row.snapshot as {progress?: {completed?: boolean}}).progress?.completed !== true);
  if (blocked.length) throw new DraftResetConflict("This unfinished pitch has submission or checkout records and cannot safely be cleared. Your work has not changed.");
  return { context: context(currentVisitor, identity), drafts: rows.filter(row => !row.protected).map(row => selected(row, currentVisitor)) };
}
async function lockReset(connection: PoolClient) {
  // This rare operation blocks relevant writes during revalidation/deletion,
  // including material-only drafts. It never deletes visitor or evidence rows.
  await connection.query("set local lock_timeout='5s'");
  await connection.query(`lock table visitors, flow_progress, filmmaker_draft_materials,
    filmmaker_account_visitors, filmmakers, projects, pitch_review_checkouts in share row exclusive mode`);
}
async function discard(connection: PoolClient, row: Row) {
  await connection.query("delete from filmmaker_draft_materials where visitor_id=$1", [row.visitor_id]);
  await connection.query("delete from flow_progress where visitor_id=$1 and flow='filmmaker' and not completed", [row.visitor_id]);
  await connection.query("update visitors set filmmaker_draft_reset_at=now() where visitor_id=$1", [row.visitor_id]);
}
export async function resetOwnDrafts(pool: Pool, input: {
  visitor: string | null; identity: Identity | null; context: string; drafts: DraftResetSelection[]; expectedDraftId?: number;
}) {
  const connection = await pool.connect();
  try {
    await connection.query("begin");
    await lockReset(connection);
    if (input.visitor) {
      const owner = (await connection.query<{firebase_uid: string | null; replit_uid: string | null}>(
        "select firebase_uid,replit_uid from filmmaker_account_visitors where visitor_id=$1", [input.visitor],
      )).rows[0];
      if (owner && !(input.identity?.provider === "firebase" && owner.firebase_uid === input.identity.uid && owner.replit_uid === null
        || input.identity?.provider === "replit" && owner.replit_uid === input.identity.uid && owner.firebase_uid === null)) {
        throw new DraftResetConflict("This browser work belongs to another account. Nothing was cleared.");
      }
    }
    if (input.context !== context(input.visitor, input.identity)) throw new DraftResetConflict("Your browser or account changed. Reopen Start over before confirming.");
    const fullInventory = await inventory(connection);
    checkExpectedDraft(fullInventory, input.visitor, input.expectedDraftId);
    const rows = scoped(fullInventory, input.visitor, input.identity).filter(row => !row.protected);
    const actual = rows.map(row => selected(row, input.visitor));
    if (actual.length !== input.drafts.length || actual.some(row => !input.drafts.some(d => d.key === row.key && d.version === row.version))) {
      throw new DraftResetConflict("The drafts changed while confirmation was open. Nothing was cleared. Reopen Start over.");
    }
    // Do not silently ignore a submitted/dependent unfinished draft.
    const allScoped = scoped(fullInventory, input.visitor, input.identity);
    if (allScoped.some(row => row.protected && (row.snapshot as {progress?: {completed?: boolean}}).progress?.completed !== true)) {
      throw new DraftResetConflict("An unfinished pitch has submission or checkout records and cannot safely be cleared.");
    }
    for (const row of rows) await discard(connection, row);
    // Retire even a previously cleared or untouched original browser context;
    // a first queued save without a draft header must not resurrect it.
    if (input.visitor && !allScoped.some(row => row.visitor_id === input.visitor && row.protected)) {
      await connection.query("update visitors set filmmaker_draft_reset_at=now() where visitor_id=$1", [input.visitor]);
    }
    const visitor = randomUUID();
    await connection.query(`insert into visitors(visitor_id,price_group)
      values($1,(select price_group from visitors where visitor_id=$2))`, [visitor, input.visitor]);
    if (input.identity) {
      await connection.query(`insert into filmmaker_account_visitors(visitor_id,firebase_uid,replit_uid)
        values($1,$2,$3)`, [visitor, input.identity.provider === "firebase" ? input.identity.uid : null,
        input.identity.provider === "replit" ? input.identity.uid : null]);
    }
    await connection.query("insert into flow_progress(visitor_id,flow,last_screen,answers,completed) values($1,'filmmaker',1,'{}',false)", [visitor]);
    await connection.query("commit");
    return { visitor, cleared: rows.length };
  } catch (error) {
    await connection.query("rollback");
    throw error;
  } finally { connection.release(); }
}
export async function inspectAllDrafts(pool: Pool) {
  const rows = await inventory(pool);
  return { drafts: rows.filter(row => !row.protected).map(row => ({ ...selected(row), label: "Unfinished filmmaker draft" })),
    protected_count: rows.filter(row => row.protected).length };
}
export async function clearDraftAllowlist(pool: Pool, allowlist: DraftResetSelection[]) {
  const connection = await pool.connect();
  try {
    await connection.query("begin");
    await lockReset(connection);
    const rows = await inventory(connection);
    let cleared = 0;
    for (const target of allowlist) {
      const row = rows.find(row => hash(row.visitor_id) === target.key);
      if (!row || row.protected || hash(row.snapshot) !== target.version) continue;
      await discard(connection, row);
      cleared++;
    }
    await connection.query("commit");
    return { cleared, skipped: allowlist.length - cleared };
  } catch (error) {
    await connection.query("rollback");
    throw error;
  } finally { connection.release(); }
}