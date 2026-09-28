import { pool } from "@workspace/db";
import { recordTransactionalEmailStatus, sendTransactionalEmailDetailed } from "./mailjet";
import { logger } from "./logger";

const EMAIL_TYPE = "confirmed-nonbinding-interest";

function projectAreaUrl(): string | null {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}/me/projects`;
  } catch {
    return null;
  }
}

export async function deliverInterestAlertEmail(alertIds: number[]): Promise<void> {
  if (!alertIds.length) return;
  // Claim once before contacting the provider. A crashed/uncertain request stays
  // "sending" for review rather than being sent again on confirmation retry.
  const { rows } = await pool.query<{ email: string | null }>(
    `update interest_alerts a set email_status = 'sending'
     from filmmakers f, projects p
     where a.id = any($1::int[]) and a.email_status = 'pending'
       and f.id = a.filmmaker_id
       and p.id = a.project_id and p.filmmaker_id = f.id
     returning f.email`,
    [alertIds],
  );
  if (!rows.length) return;
  const email = rows[0].email?.trim() ?? "";
  const url = projectAreaUrl();
  let status: "sent" | "failed" | "unconfigured" = "unconfigured";
  let uncertain = false;
  try {
    if (email && url) {
      const outcome = await sendTransactionalEmailDetailed({
        to: email,
        type: EMAIL_TYPE,
        subject: "New confirmed non-binding interest in your project",
        text: `Your project received confirmed non-binding investor interest. This is not an investment or payment. Sign in to view your private project alerts: ${url}`,
        html: `<p>Your project received confirmed non-binding investor interest. This is not an investment or payment.</p><p><a href="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}">Sign in to view your private project alerts</a>.</p>`,
      });
      status = outcome.status;
      uncertain = outcome.uncertain;
    } else if (email) {
      await recordTransactionalEmailStatus(email, EMAIL_TYPE, "unconfigured");
    }
  } catch {
    status = "failed";
    uncertain = true;
    logger.warn({ alertId: alertIds[0] }, "Interest notification delivery outcome uncertain");
  }
  try {
    await pool.query(
      `update interest_alerts set email_status = $2, email_uncertain = $3
       where id = any($1::int[]) and email_status = 'sending'`,
      [alertIds, status, uncertain],
    );
  } catch {
    logger.warn({ alertId: alertIds[0] }, "Interest notification status could not be finalized; delivery requires manual review");
  }
}