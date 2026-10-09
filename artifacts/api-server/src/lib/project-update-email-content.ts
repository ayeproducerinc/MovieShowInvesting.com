/** Pure email content for project updates; no database access (tested on its own). */
/**
 * Backer update email (DECISIONS.md › Project updates › Email content). Exactly
 * one action: "Increase my pledge". Never call the payback goal a return,
 * earnings or an expectation, and never name The AYeList.
 */
export const EMAIL_TYPE = "project-update";
export const RISK_LINE = "Returns aren't guaranteed. You may get back less, or nothing.";
export const FOOTER_LINE = "Pledges are non-binding. No money is collected. This is not an offer to sell securities.";
export const BUTTON_LABEL = "Increase my pledge";

const dollars = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type UpdateEmailContent = {
  projectTitle: string;
  milestone: string;
  role: string | null;
  personName: string | null;
  note: string | null;
  pledgeAmount: number;
  buttonUrl: string;
};

export function buildUpdateEmail(content: UpdateEmailContent) {
  const who = [content.role, content.personName].filter(Boolean).join(": ");
  const headline = `${content.milestone}${who ? ` (${who})` : ""}`;
  const pledge = `Your confirmed non-binding pledge to this project: ${dollars(content.pledgeAmount)}. ${RISK_LINE}`;
  const settings = "You're getting this because you allowed update emails for projects you've backed. You can turn them off on My lineup.";
  const subject = `${content.projectTitle}: ${headline}`;
  const text = [
    `${content.projectTitle} has a new update: ${headline}.`,
    content.note ?? "",
    pledge,
    `${BUTTON_LABEL}: ${content.buttonUrl}`,
    settings,
    FOOTER_LINE,
  ].filter(Boolean).join("\n\n");
  const html = [
    `<p><strong>${escape(content.projectTitle)}</strong> has a new update: <strong>${escape(headline)}</strong>.</p>`,
    content.note ? `<p>${escape(content.note).replace(/\n/g, "<br>")}</p>` : "",
    `<p>${escape(pledge)}</p>`,
    `<p><a href="${escape(content.buttonUrl)}" style="display:inline-block;padding:12px 20px;background:#7a3f4c;color:#ffffff;text-decoration:none;font-weight:700">${BUTTON_LABEL}</a></p>`,
    `<p style="color:#6d6b66;font-size:13px">${escape(settings)}</p>`,
    `<p style="color:#6d6b66;font-size:13px">${escape(FOOTER_LINE)}</p>`,
  ].filter(Boolean).join("");
  return { subject, text, html };
}

/** Project page link with the update marker; no login token. Sign-in happens on the site. */
export function increaseUrl(appUrl: string | undefined, slug: string, updateId: number): string | null {
  const configured = appUrl?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}/project/${encodeURIComponent(slug)}?increase=${updateId}`;
  } catch {
    return null;
  }
}
