/**
 * Backer names (DECISIONS.md › Backer names). The filmmaker and admins see each
 * backer's name, email and amount; the public sees a name only when the backer
 * opted in at signing, and only on approved, listed projects. Pledges signed
 * before this notice existed never reveal a name or email.
 */
export const BACKER_NOTICE_VERSION = "backer-visibility-v1";
export const BACKER_NOTICE = "The filmmaker will see your name, email and pledge amount.";
export const PUBLIC_DISPLAY_LABEL = "Show my name and pledge amount publicly on this project's page and in Explore.";

/** Confirmed pledges with the signed record's name, email and evidence. */
export const CONFIRMED_BACKERS_SQL = `
  select pl.project_id, pl.investor_id, pl.amount,
    coalesce(nullif(trim(e.name), ''), nullif(trim(i.name), '')) as name, i.email,
    case when pl.entry_id is null then i.confirmed_at else e.confirmed_at end as confirmed_at,
    case when pl.entry_id is null then i.confirmation_evidence else e.confirmation_evidence end as evidence
  from pledges pl
  join investors i on i.id = pl.investor_id
  left join interest_entries e on e.id = pl.entry_id
  where pl.project_id = any($1::int[]) and pl.confirmed = true`;

export type BackerRow = {
  project_id: number;
  investor_id: number;
  amount: number;
  name: string | null;
  email: string | null;
  confirmed_at: Date | null;
  evidence: Record<string, unknown> | null;
};

function sawNotice(row: BackerRow): boolean {
  return row.evidence?.backer_notice_version === BACKER_NOTICE_VERSION;
}

/** Shown at signing: update emails are on by default for backers (rule d, revised 2026-10-09). */
export const UPDATE_EMAILS_NOTICE = "You'll get an email when a project you back posts an update. You can turn these off anytime.";

/** Evidence fields recorded with a new signature. */
export function backerEvidence(publicDisplay: boolean) {
  return {
    backer_notice_version: BACKER_NOTICE_VERSION, backer_notice: BACKER_NOTICE, public_display: publicDisplay,
    update_emails_notice: UPDATE_EMAILS_NOTICE,
  };
}

/** The filmmaker's private list: one row per signed pledge, newest first. */
export function filmmakerBackers(rows: BackerRow[]) {
  return [...rows]
    .sort((a, b) => (b.confirmed_at?.getTime() ?? 0) - (a.confirmed_at?.getTime() ?? 0))
    .map((row) => {
      const shared = sawNotice(row);
      return {
        name: shared ? row.name ?? "Backer" : null,
        email: shared ? row.email : null,
        amount: row.amount,
        confirmed_at: row.confirmed_at?.toISOString() ?? null,
        name_shared: shared,
      };
    });
}

/** Private totals for the filmmaker: confirmed amount and distinct people. */
export function backerTotals(rows: { investor_id: number; amount: number }[]) {
  return {
    confirmed_pledge_total: rows.reduce((sum, row) => sum + row.amount, 0),
    backer_count: new Set(rows.map((row) => row.investor_id)).size,
  };
}

/** Public names for one project: opted-in backers only, summed per person, largest first. */
export function publicBackers(rows: BackerRow[]) {
  const byInvestor = new Map<number, { name: string; amount: number }>();
  for (const row of rows) {
    if (!sawNotice(row) || row.evidence?.public_display !== true || !row.name) continue;
    const current = byInvestor.get(row.investor_id);
    byInvestor.set(row.investor_id, { name: current?.name ?? row.name, amount: (current?.amount ?? 0) + row.amount });
  }
  return [...byInvestor.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}
