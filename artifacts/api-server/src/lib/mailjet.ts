import { db, emailLogTable } from "@workspace/db";
import { logger } from "./logger";

export type TransactionalEmailStatus = "sent" | "failed" | "unconfigured";

export interface TransactionalEmail {
  to: string;
  type: string;
  subject: string;
  text: string;
  html: string;
}

async function logEmail(to: string, type: string, status: TransactionalEmailStatus): Promise<void> {
  try {
    await db.insert(emailLogTable).values({ to, type, status });
  } catch {
    // Logging must not turn a successful submission or provider call into a failure.
    logger.warn({ type, status }, "Unable to write transactional email log");
  }
}

export async function recordTransactionalEmailStatus(
  to: string,
  type: string,
  status: TransactionalEmailStatus,
): Promise<void> {
  await logEmail(to, type, status);
}

/**
 * Sends a transactional email through Mailjet and records a body-free status
 * entry. The function is intentionally reusable by later transactional flows.
 */
export async function sendTransactionalEmailDetailed(email: TransactionalEmail): Promise<{ status: TransactionalEmailStatus; uncertain: boolean }> {
  const apiKey = process.env.MAILJET_API_KEY;
  const secretKey = process.env.MAILJET_SECRET_KEY;
  const senderEmail = process.env.MAILJET_SENDER_EMAIL;

  if (!apiKey || !secretKey || !senderEmail) {
    await logEmail(email.to, email.type, "unconfigured");
    return { status: "unconfigured", uncertain: false };
  }

  let status: TransactionalEmailStatus = "failed";
  let uncertain = false;
  try {
    const credentials = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");
    const response = await fetch("https://api.mailjet.com/v3.1/send", {
      method: "POST",
      headers: {
        authorization: `Basic ${credentials}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        Messages: [{
          From: { Email: senderEmail, Name: "Movie Show Investing" },
          To: [{ Email: email.to }],
          Subject: email.subject,
          TextPart: email.text,
          HTMLPart: email.html,
        }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const result: unknown = await response.json();
    const messages = result && typeof result === "object" && "Messages" in result
      ? result.Messages : null;
    const message = Array.isArray(messages) ? messages[0] : null;
    const accepted = response.ok && Array.isArray(messages) && messages.length === 1 && message
      && typeof message === "object" && message.Status === "success"
      && Array.isArray(message.To)
      && message.To.some((recipient: unknown) =>
        recipient !== null && typeof recipient === "object" && "Email" in recipient
        && typeof recipient.Email === "string"
        && recipient.Email.toLowerCase() === email.to.toLowerCase())
      && (!Array.isArray(message.Errors) || message.Errors.length === 0);
    status = accepted ? "sent" : "failed";
    if (!accepted) logger.warn({ type: email.type, httpStatus: response.status }, "Mailjet did not accept transactional email");
  } catch {
    // A timeout or unreadable response does not prove Mailjet rejected the send.
    uncertain = true;
    logger.warn({ type: email.type }, "Mailjet transactional email request failed");
  }

  await logEmail(email.to, email.type, status);
  return { status, uncertain };
}

export async function sendTransactionalEmail(email: TransactionalEmail): Promise<TransactionalEmailStatus> {
  return (await sendTransactionalEmailDetailed(email)).status;
}