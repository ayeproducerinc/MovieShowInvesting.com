import { pool } from "@workspace/db";

type Row = Record<string, unknown>;
export type ReviewAccount = { provider: string; uid: string } | null;
type ReviewRecord = {
  row: Row | null; draft: Row | null; account: ReviewAccount;
  summary: {
    id: string; name: string | null; email: string | null;
    status: "signup" | "draft" | "saved" | "confirmed";
    first_seen_at: string | null; last_activity_at: string | null; confirmed_amount: number;
    notification_allowed: boolean | null; project_ids: number[];
  };
};
export const NOTIFICATION_VERSION = "offering-notifications-v1";
const privateFields = new Set(["firebase_uid", "replit_uid", "visitor_id", "uid", "provider", "expected_investor_owner", "entry_context", "website"]);
export function reviewAnswers(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !privateFields.has(key) && !key.startsWith("_")));
}
function text(value: unknown): string | null { return typeof value === "string" ? value : null; }
function date(value: unknown): string | null { return value instanceof Date ? value.toISOString() : text(value); }
function number(value: unknown): number { return Number(value) || 0; }
export function rowIdentity(row: Row): ReviewAccount {
  return row.firebase_uid ? { provider: "firebase", uid: String(row.firebase_uid) }
    : row.replit_uid ? { provider: "replit", uid: String(row.replit_uid) }
    : row.provider && row.uid ? { provider: String(row.provider), uid: String(row.uid) } : null;
}
function identityKey(account: ReviewAccount): string { return account ? `${account.provider}:${account.uid}` : ""; }

export async function notificationHistory(account: ReviewAccount) {
  if (!account) return [];
  const { rows } = await pool.query("select allowed, recorded_at, version from investor_notification_events where provider = $1 and uid = $2 order by id desc", [account.provider, account.uid]);
  return rows.map(row => ({ allowed: row.allowed as boolean, recorded_at: date(row.recorded_at), version: String(row.version) }));
}

export async function loadInvestorReview() {
  const [investors, progress, entries, pledges, projects, notifications] = await Promise.all([
    pool.query("select * from investors order by id desc"),
    pool.query("select * from investor_account_progress order by id desc"),
    pool.query("select * from interest_entries order by id"),
    pool.query("select * from pledges order by id"),
    pool.query("select id, title, approved, showcase_requested, hidden from projects order by title"),
    pool.query("select distinct on (provider, uid) provider, uid, allowed from investor_notification_events order by provider, uid, id desc"),
  ]);
  const projectMap = new Map(projects.rows.map(row => [number(row.id), row]));
  const progressMap = new Map(progress.rows.map(row => [identityKey(rowIdentity(row)), row]));
  const permissionMap = new Map(notifications.rows.map(row => [identityKey(rowIdentity(row)), row.allowed as boolean]));
  const seen = new Set<string>();
  const records: ReviewRecord[] = investors.rows.map(row => {
    const account = rowIdentity(row); const key = identityKey(account);
    if (key) seen.add(key);
    const draft = progressMap.get(key) ?? null;
    const signedEntries = entries.rows.filter(entry => entry.investor_id === row.id && entry.confirmed_at);
    const confirmedPledges = pledges.rows.filter(pledge => pledge.investor_id === row.id && pledge.confirmed);
    const isConfirmed = Boolean(row.confirmed_at || signedEntries.length);
    return {
      row, draft, account,
      summary: {
        id: `investor:${row.id}`, name: text(row.name), email: text(row.email),
        status: isConfirmed ? "confirmed" as const : "saved" as const,
        first_seen_at: date(draft?.first_seen_at) ?? date(row.created_at),
        last_activity_at: date(draft?.updated_at) ?? date(row.confirmed_at) ?? date(row.created_at),
        confirmed_amount: (row.confirmed_at ? number(row.investment_amount ?? row.amount_choice) : 0) + signedEntries.reduce((sum, entry) => sum + number(entry.amount), 0),
        notification_allowed: permissionMap.get(key) ?? null,
        project_ids: [...new Set(confirmedPledges.map(pledge => number(pledge.project_id)).filter(Boolean))],
      },
    };
  });
  for (const row of progress.rows) {
    const account = rowIdentity(row); const key = identityKey(account);
    if (seen.has(key)) continue;
    seen.add(key);
    const answers = reviewAnswers((row.answers ?? {}) as Row);
    const meaningful = number(row.last_screen) > 1 || answers.terms_read === true
      || Boolean(text(answers.name)?.trim()) || (Array.isArray(answers.lineup) && answers.lineup.length > 0);
    records.push({
      row: null, draft: row, account,
      summary: {
        id: `account:${row.id}`, name: text(answers.name), email: text(row.verified_email),
        status: meaningful ? "draft" as const : "signup" as const,
        first_seen_at: date(row.first_seen_at),
        last_activity_at: date(row.updated_at), confirmed_amount: 0,
        notification_allowed: permissionMap.get(key) ?? null, project_ids: [],
      },
    });
  }
  return {
    records, entries: entries.rows, pledges: pledges.rows, projectMap,
    projects: projects.rows.map(row => ({ id: number(row.id), title: text(row.title), eligible: Boolean(row.approved && row.showcase_requested && !row.hidden) })),
  };
}
export function filterInvestorRecords<T extends { summary: { name: string | null; email: string | null; status: string; project_ids: number[] } }>(
  records: T[], input: { search?: string; status?: string; project_id?: number },
): T[] {
  const search = input.search?.trim().toLocaleLowerCase();
  return records.filter(({ summary }) => (!search || `${summary.name ?? ""} ${summary.email ?? ""}`.toLocaleLowerCase().includes(search))
    && (!input.status || input.status === summary.status)
    && (!input.project_id || summary.project_ids.includes(input.project_id)));
}
export function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const safe = /^[\s]*[=+\-@]/.test(raw) || /^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}