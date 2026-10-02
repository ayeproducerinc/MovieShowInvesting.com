import { eq, sql } from "drizzle-orm";
import { db, hasMeaningfulFilmmakerDraft } from "./index";
import {
  filmmakerActivityTable, filmmakerAccountVisitorsTable, filmmakerDraftMaterialsTable,
  filmmakersTable, flowProgressTable,
} from "./schema";

/** Only call after verified authentication in a filmmaker-specific entry point. */
export async function recordFilmmakerAccountActivity(uid: string, provider: "firebase" | "replit"): Promise<void> {
  await db.insert(filmmakerActivityTable).values({ identityKey: `${provider}:${uid}` }).onConflictDoNothing();
}

/** Idempotent historical draft backfill. Empty automatic worksheet saves do not qualify. */
export async function backfillFilmmakerActivity(): Promise<void> {
  const drafts = await db.select({ progress: flowProgressTable, materials: filmmakerDraftMaterialsTable })
    .from(flowProgressTable)
    .leftJoin(filmmakerDraftMaterialsTable, eq(filmmakerDraftMaterialsTable.visitorId, flowProgressTable.visitorId))
    .where(eq(flowProgressTable.flow, "filmmaker"));
  const entries = drafts.filter(({ progress, materials }) => hasMeaningfulFilmmakerDraft(progress, materials ?? undefined))
    .map(({ progress }) => ({
      identityKey: `visitor:${progress.visitorId}`,
      visitorId: progress.visitorId,
      firstActivityAt: progress.createdAt,
    }));
  // Bound query size for historical data without replacing the existing database.
  for (let offset = 0; offset < entries.length; offset += 500) {
    await db.insert(filmmakerActivityTable).values(entries.slice(offset, offset + 500)).onConflictDoNothing();
  }
}

export async function getFilmmakerCount(): Promise<number> {
  const result = await db.execute(sql`
    with identities as (
      select coalesce('firebase:' || owner.firebase_uid, 'replit:' || owner.replit_uid, activity.identity_key) as identity_key
      from ${filmmakerActivityTable} activity
      left join ${filmmakerAccountVisitorsTable} owner on owner.visitor_id = activity.visitor_id
      union
      select coalesce('firebase:' || firebase_uid, 'replit:' || replit_uid)
      from ${filmmakerAccountVisitorsTable}
      union
      select coalesce(
        'firebase:' || filmmaker.firebase_uid, 'replit:' || filmmaker.replit_uid,
        'firebase:' || owner.firebase_uid, 'replit:' || owner.replit_uid,
        'visitor:' || filmmaker.visitor_id, 'legacy:' || filmmaker.id::text)
      from ${filmmakersTable} filmmaker
      left join ${filmmakerAccountVisitorsTable} owner on owner.visitor_id = filmmaker.visitor_id
    )
    select count(distinct identity_key)::int as total from identities
  `);
  return Number(result.rows[0].total);
}