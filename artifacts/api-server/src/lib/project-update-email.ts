import { pool } from "@workspace/db";
import { recordTransactionalEmailStatus, sendTransactionalEmailDetailed } from "./mailjet";
import { logger } from "./logger";
import { CONSENTING_BACKERS_SQL, emailDecision, milestoneLabel, TEAM_ROLES } from "./project-updates";
import { buildUpdateEmail, EMAIL_TYPE, increaseUrl } from "./project-update-email-content";
import { optOutUrl } from "./update-email-preference";

/** Any connected client (pool or transaction client) that can run queries. */
type DbClient = Pick<typeof pool, "query">;

/**
 * Inside the approval transaction: apply the 14-day rule and create one pending
 * row per consenting confirmed backer (the unique index stops duplicates).
 * Returns the new row ids to deliver after commit.
 */
export async function queueUpdateEmails(client: DbClient, updateId: number, projectId: number): Promise<number[]> {
  await client.query("select pg_advisory_xact_lock(hashtext('msi:project-update-email:' || $1::text))", [projectId]);
  const { rows: [last] } = await client.query<{ last: Date | null }>(
    "select max(emails_queued_at) as last from project_updates where project_id = $1", [projectId],
  );
  if (emailDecision(last?.last ?? null, new Date()) !== "send") return [];
  const { rows: backers } = await client.query<{ investor_id: number }>(CONSENTING_BACKERS_SQL, [projectId]);
  if (!backers.length) return [];
  const { rows } = await client.query<{ id: number }>(
    `insert into project_update_emails (update_id, investor_id)
     select $1, unnest($2::int[]) on conflict (update_id, investor_id) do nothing returning id`,
    [updateId, backers.map((backer) => backer.investor_id)],
  );
  if (rows.length) await client.query("update project_updates set emails_queued_at = now() where id = $1", [updateId]);
  return rows.map((row) => row.id);
}

type ClaimedRow = {
  id: number; email: string | null; project_title: string | null; project_slug: string | null;
  milestone_key: string; custom_label: string | null; role: string | null; person_name: string | null;
  name_consent: boolean; note: string | null; update_id: number; investor_id: number; pledge_amount: number;
};

/** After commit. Claims each row before contacting the provider; never retries an uncertain send. */
export async function deliverUpdateEmails(emailIds: number[]): Promise<void> {
  if (!emailIds.length) return;
  const { rows } = await pool.query<ClaimedRow>(
    `with claimed as (
       update project_update_emails set email_status = 'sending'
       where id = any($1::int[]) and email_status = 'pending'
       returning id, update_id, investor_id)
     select c.id, c.update_id, c.investor_id, i.email, p.title as project_title, p.slug as project_slug,
       u.milestone_key, u.custom_label, u.role, u.person_name, u.name_consent, u.note,
       coalesce((select sum(pl.amount) from pledges pl
         where pl.investor_id = c.investor_id and pl.project_id = u.project_id and pl.confirmed = true), 0)::int as pledge_amount
     from claimed c
     join investors i on i.id = c.investor_id
     join project_updates u on u.id = c.update_id
     join projects p on p.id = u.project_id`,
    [emailIds],
  );
  for (const row of rows) {
    const email = row.email?.trim() ?? "";
    const buttonUrl = row.project_slug ? increaseUrl(process.env.PUBLIC_APP_URL, row.project_slug, row.update_id) : null;
    // Every email carries a one-click way to turn update emails off; never send without it.
    const turnOffUrl = optOutUrl(process.env.PUBLIC_APP_URL, row.investor_id, process.env.SESSION_SECRET);
    let status: "sent" | "failed" | "unconfigured" = "unconfigured";
    let uncertain = false;
    try {
      if (email && buttonUrl && turnOffUrl) {
        const content = buildUpdateEmail({
          projectTitle: row.project_title || "A project you backed",
          milestone: milestoneLabel(row.milestone_key, row.custom_label),
          role: row.role ? TEAM_ROLES.find((role) => role.key === row.role)?.label ?? null : null,
          personName: row.name_consent ? row.person_name : null,
          note: row.note,
          pledgeAmount: row.pledge_amount,
          buttonUrl,
          turnOffUrl,
        });
        const outcome = await sendTransactionalEmailDetailed({ to: email, type: EMAIL_TYPE, ...content });
        status = outcome.status;
        uncertain = outcome.uncertain;
      } else if (email) {
        // No public app URL or secret for the links: log as unconfigured rather than send a broken email.
        await recordTransactionalEmailStatus(email, EMAIL_TYPE, "unconfigured");
      }
    } catch {
      status = "failed";
      uncertain = true;
      logger.warn({ emailId: row.id }, "Project update email outcome uncertain; not retried");
    }
    try {
      await pool.query(
        "update project_update_emails set email_status = $2, email_uncertain = $3 where id = $1 and email_status = 'sending'",
        [row.id, status, uncertain],
      );
    } catch {
      logger.warn({ emailId: row.id }, "Project update email status could not be finalized; requires manual review");
    }
  }
}
