import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  AnswerFilmmakerQuestionBody,
  AnswerFilmmakerQuestionParams,
  AnswerFilmmakerQuestionResponse,
  AnswerQuestionByTokenBody,
  AnswerQuestionByTokenResponse,
  AskFilmmakerBody,
  AskFilmmakerParams,
  AskFilmmakerResponse,
  GetFilmmakerQuestionsParams,
  GetFilmmakerQuestionsResponse,
  GetQuestionConfigResponse,
  ReportQuestionByTokenBody,
  ReportQuestionByTokenResponse,
} from "@workspace/api-zod";
import { authenticateFilmmaker } from "../lib/filmmaker-auth";
import { sendTransactionalEmail } from "../lib/mailjet";
import { allowedTurnstileHostnames, getTurnstileConfig, verifyTurnstileToken } from "../lib/cloudflare-turnstile";

const router: IRouter = Router();
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ASKER_LIMIT = 5;
const ASKER_WINDOW_MS = 24 * 60 * 60 * 1000;
const IP_LIMIT = 20;
const ASK_TURNSTILE_ACTION = "ask_filmmaker";

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function configuredAppBaseUrl(): string | null {
  const configured = process.env.PUBLIC_APP_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password
      || url.search || url.hash) return null;
    const basePath = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${basePath}`;
  } catch {
    return null;
  }
}

async function allowIpAttempt(ip: string): Promise<boolean> {
  const hashKey = process.env.QUESTION_IP_HASH_SECRET?.trim()
    || process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY
    || process.env.TURNSTILE_SECRET_KEY
    || process.env.DATABASE_URL;
  if (!hashKey) throw new Error("Question IP hashing is not configured.");
  const ipHash = createHmac("sha256", hashKey).update(ip).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('question-ip:' || $1))", [ipHash]);
    await client.query(
      "delete from question_ip_attempts where attempted_at < now() - interval '2 hours'",
    );
    const result = await client.query<{ count: number }>(
      `select count(*)::int as count from question_ip_attempts
       where ip_hash = $1 and attempted_at > now() - interval '1 hour'`,
      [ipHash],
    );
    if (result.rows[0].count >= IP_LIMIT) {
      await client.query("commit");
      return false;
    }
    await client.query("insert into question_ip_attempts (ip_hash) values ($1)", [ipHash]);
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function sendAnswerEmail(
  to: string,
  projectTitle: string,
  question: string,
  answer: string,
  reportUrl: string,
): Promise<"sent" | "failed" | "unconfigured"> {
  return sendTransactionalEmail({
    to,
    type: "filmmaker-question-answer",
    subject: `An answer to your question about ${projectTitle}`,
    text: `Your question: ${question}\n\nAnswer from the filmmaker:\n${answer}\n\nReport this question: ${reportUrl}`,
    html: `<p>Your question:</p><blockquote>${escapeHtml(question)}</blockquote><p>Answer from the filmmaker:</p><p>${escapeHtml(answer).replace(/\n/g, "<br>")}</p><p><a href="${escapeHtml(reportUrl)}">Report this question</a> if it is inappropriate.</p>`,
  });
}

type AnswerReservation = {
  id: number;
  deliveryId: string;
  investorEmail: string;
  question: string;
  projectTitle: string;
};

type ReserveAnswerResult =
  | { status: "reserved"; reservation: AnswerReservation }
  | { status: "busy" | "missing" };

async function reserveAnswerDelivery(
  selectQuery: string,
  selectParams: unknown[],
  reportToken: string,
): Promise<ReserveAnswerResult> {
  const client = await pool.connect();
  const deliveryId = randomUUID();
  try {
    await client.query("begin");
    const result = await client.query<{
      id: number;
      investorEmail: string | null;
      question: string | null;
      projectTitle: string | null;
      answerDeliveryState: string | null;
      answeredAt: Date | null;
    }>(`${selectQuery} for update of m`, selectParams);
    const message = result.rows[0];
    if (!message) {
      await client.query("commit");
      return { status: "missing" };
    }
    if (message.answeredAt || message.answerDeliveryState) {
      await client.query("commit");
      return { status: "busy" };
    }
    if (!message.investorEmail || !message.question || !message.projectTitle) {
      await client.query("commit");
      return { status: "missing" };
    }
    await client.query(
      `update messages set answer_delivery_state = 'sending', answer_delivery_id = $1,
       answer_report_token_hash = $2, answer_report_token_expires_at = $3 where id = $4`,
      [deliveryId, digest(reportToken), new Date(Date.now() + TOKEN_TTL_MS), message.id],
    );
    await client.query("commit");
    return {
      status: "reserved",
      reservation: {
        id: message.id,
        deliveryId,
        investorEmail: message.investorEmail,
        question: message.question,
        projectTitle: message.projectTitle,
      },
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function sendReservedAnswer(
  reservation: AnswerReservation,
  answer: string,
  reportUrl: string,
): Promise<"sent" | "failed" | "uncertain"> {
  let status: "sent" | "failed" | "unconfigured";
  try {
    status = await sendAnswerEmail(
      reservation.investorEmail,
      reservation.projectTitle,
      reservation.question,
      answer,
      reportUrl,
    );
  } catch {
    // A thrown transport error has unknown delivery outcome; leave the reservation closed.
    return "uncertain";
  }

  if (status === "unconfigured") {
    try {
      const reset = await pool.query(
        `update messages set answer_delivery_state = null, answer_delivery_id = null,
         answer_report_token_hash = null, answer_report_token_expires_at = null
         where id = $1 and answer_delivery_id = $2 and answer_delivery_state = 'sending'
         returning id`,
        [reservation.id, reservation.deliveryId],
      );
      return reset.rowCount === 1 ? "failed" : "uncertain";
    } catch {
      // If reset cannot be confirmed, preserve the reservation to prevent duplicate delivery.
      return "uncertain";
    }
  }
  if (status === "failed") {
    // Mailjet's reusable result does not distinguish rejection from transport timeout.
    // Preserve the reservation rather than risk sending a duplicate after ambiguous delivery.
    return "uncertain";
  }

  try {
    const finalized = await pool.query(
      `update messages set answer = $1, answered_at = now(), answer_delivery_state = 'sent',
       answer_delivery_id = null, answer_token_hash = null, answer_token_expires_at = null
       where id = $2 and answer_delivery_id = $3 and answer_delivery_state = 'sending'
       returning id`,
      [answer, reservation.id, reservation.deliveryId],
    );
    return finalized.rowCount === 1 ? "sent" : "uncertain";
  } catch {
    // Mail was confirmed, but an unconfirmed finalization must not allow an automatic resend.
    return "uncertain";
  }
}

router.get("/question-config", (_req, res): void => {
  const { siteKey, secretKey } = getTurnstileConfig();
  const hasMailjet = Boolean(
    process.env.MAILJET_API_KEY?.trim()
    && process.env.MAILJET_SECRET_KEY?.trim()
    && process.env.MAILJET_SENDER_EMAIL?.trim(),
  );
  const available = Boolean(siteKey && secretKey && allowedTurnstileHostnames().length && hasMailjet && configuredAppBaseUrl());
  res.json(GetQuestionConfigResponse.parse({
    available,
    turnstile_site_key: available ? siteKey : null,
  }));
});

router.post("/projects/:slug/questions", async (req, res): Promise<void> => {
  const turnstile = getTurnstileConfig();
  if (!turnstile.siteKey || !turnstile.secretKey || !allowedTurnstileHostnames().length) {
    res.status(503).json({ error: "Questions are unavailable until anti-bot protection is configured." });
    return;
  }
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!await allowIpAttempt(ip)) {
    res.status(429).json({ error: "Too many questions from this network. Please try again later." });
    return;
  }
  const parsedParams = AskFilmmakerParams.safeParse(req.params);
  const parsedBody = AskFilmmakerBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: "Provide a valid first name, email, question, and Turnstile response." });
    return;
  }
  const input = {
    ...parsedBody.data,
    first_name: parsedBody.data.first_name.trim(),
    email: parsedBody.data.email.trim().toLowerCase(),
    question: parsedBody.data.question.trim(),
  };
  if (input.website?.trim()) {
    res.status(400).json({ error: "Invalid question submission." });
    return;
  }
  if (!input.first_name || input.question.length < 5) {
    res.status(400).json({ error: "Provide a valid first name, email, question, and Turnstile response." });
    return;
  }
  if (!await verifyTurnstileToken(input.turnstile_token, { ip, action: ASK_TURNSTILE_ACTION })) {
    res.status(403).json({ error: "The anti-bot verification could not be verified. Please try again." });
    return;
  }

  const appBaseUrl = configuredAppBaseUrl();
  if (!appBaseUrl) {
    res.status(503).json({ error: "Question delivery is temporarily unavailable." });
    return;
  }
  const projectResult = await pool.query<{
    id: number;
    title: string | null;
    slug: string | null;
    filmmakerEmail: string | null;
  }>(
    `select p.id, p.title, p.slug, f.email as "filmmakerEmail"
     from projects p
     inner join filmmakers f on f.id = p.filmmaker_id
     where p.slug = $1 and p.hidden = false
     limit 1`,
    [parsedParams.data.slug],
  );
  const project = projectResult.rows[0];
  if (!project?.title || !project.slug) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const filmmakerEmail = project.filmmakerEmail?.trim();
  if (!filmmakerEmail) {
    res.status(503).json({ error: "Question delivery is temporarily unavailable." });
    return;
  }

  const email = input.email.toLowerCase();
  const askedAt = new Date();
  const answerToken = randomBytes(32).toString("hex");
  const reportToken = randomBytes(32).toString("hex");
  const answerUrl = `${appBaseUrl}/filmmaker/questions#token=${answerToken}`;
  const reportUrl = `${appBaseUrl}/question-report#token=${reportToken}`;
  let messageId: number;
  try {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [email]);
      const countResult = await client.query<{ count: number }>(
        "select count(*)::int as count from messages where lower(trim(investor_email)) = $1 and asked_at > $2",
        [email, new Date(askedAt.getTime() - ASKER_WINDOW_MS)],
      );
      if (countResult.rows[0].count >= ASKER_LIMIT) throw new Error("ASKER_DAILY_LIMIT");
      const inserted = await client.query<{ id: number }>(
        `insert into messages
          (project_id, investor_name, investor_email, question, answer_token_hash,
           answer_token_expires_at, report_token_hash, report_token_expires_at, asked_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id`,
        [
          project.id,
          input.first_name,
          email,
          input.question,
          digest(answerToken),
          new Date(askedAt.getTime() + TOKEN_TTL_MS),
          digest(reportToken),
          new Date(askedAt.getTime() + TOKEN_TTL_MS),
          askedAt,
        ],
      );
      messageId = inserted.rows[0].id;
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof Error && error.message === "ASKER_DAILY_LIMIT") {
      res.status(429).json({ error: "You have reached the limit of 5 questions in 24 hours." });
      return;
    }
    throw error;
  }

  let notifyStatus: "sent" | "failed" | "unconfigured" = "failed";
  try {
    notifyStatus = await sendTransactionalEmail({
      to: filmmakerEmail,
      type: "filmmaker-question-notification",
      subject: `A private question about ${project.title}`,
      text: `${input.first_name} asked about ${project.title}:\n\n${input.question}\n\nAnswer privately: ${answerUrl}`,
      html: `<p>${escapeHtml(input.first_name)} asked about <strong>${escapeHtml(project.title)}</strong>:</p><blockquote>${escapeHtml(input.question)}</blockquote><p><a href="${escapeHtml(answerUrl)}">Answer privately</a></p>`,
    });
  } catch {
    notifyStatus = "failed";
  }
  if (notifyStatus !== "sent") {
    // A transport failure can occur after Mailjet accepted a message. Keep its
    // answer link valid rather than emailing a dead link after an uncertain send.
    if (notifyStatus === "unconfigured") {
      await pool.query("delete from messages where id = $1 and answered_at is null", [messageId]);
    } else {
      req.log.warn({ messageId }, "Question notification outcome is uncertain; message retained");
    }
    res.status(503).json({ error: "The question could not be delivered. Please try again later." });
    return;
  }

  try {
    await sendTransactionalEmail({
        to: email,
        type: "filmmaker-question-receipt",
        subject: `Your question about ${project.title} was sent`,
        text: `Your question was sent to the filmmaker. If you want to report it, use this private link: ${reportUrl}`,
        html: `<p>Your question was sent to the filmmaker.</p><p><a href="${escapeHtml(reportUrl)}">Report this question</a> if it is inappropriate.</p>`,
      });
  } catch {
    // The primary notification was delivered; receipt failure must not undo the question.
  }
  res.status(201).json(AskFilmmakerResponse.parse({ status: "submitted" }));
});

router.get("/filmmakers/projects/:projectId/questions", async (req, res): Promise<void> => {
  const params = GetFilmmakerQuestionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project ID." });
    return;
  }
  const projectId = params.data.projectId;
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const ownerColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
  const owner = await pool.query(
    `select p.id from projects p
     inner join filmmakers f on f.id = p.filmmaker_id
     where p.id = $1 and f.${ownerColumn} = $2 limit 1`,
    [projectId, identity.uid],
  );
  if (owner.rowCount === 0) {
    res.status(404).json({ error: "Project is not available to this filmmaker account." });
    return;
  }
  const rows = await pool.query(
    `select id, investor_name as first_name, question, answer, asked_at, answered_at, reported,
       coalesce(answer_delivery_state = 'sending', false) as delivery_pending
     from messages
     where project_id = $1 and hidden = false
     order by case when answered_at is null then 0 else 1 end, asked_at desc`,
    [projectId],
  );
  res.json(GetFilmmakerQuestionsResponse.parse({ questions: rows.rows }));
});

router.post("/filmmakers/projects/:projectId/questions/:messageId/answer", async (req, res): Promise<void> => {
  const params = AnswerFilmmakerQuestionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project or question ID." });
    return;
  }
  const parsedBody = AnswerFilmmakerQuestionBody.safeParse(req.body);
  if (!parsedBody.success || !parsedBody.data.answer.trim()) {
    res.status(400).json({ error: "Provide a valid answer." });
    return;
  }
  const { projectId, messageId } = params.data;
  const answer = parsedBody.data.answer.trim();
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const ownerColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
  const owner = await pool.query(
    `select p.id from projects p
     inner join filmmakers f on f.id = p.filmmaker_id
     where p.id = $1 and f.${ownerColumn} = $2 limit 1`,
    [projectId, identity.uid],
  );
  if (owner.rowCount === 0) {
    res.status(404).json({ error: "Project is not available to this filmmaker account." });
    return;
  }
  const appBaseUrl = configuredAppBaseUrl();
  if (!appBaseUrl) {
    res.status(503).json({ error: "Answer delivery is temporarily unavailable." });
    return;
  }
  const reportToken = randomBytes(32).toString("hex");
  const reportUrl = `${appBaseUrl}/question-report#token=${reportToken}`;
  const reserve = await reserveAnswerDelivery(
    `select m.id, m.investor_email as "investorEmail", m.question, p.title as "projectTitle",
       m.answer_delivery_state as "answerDeliveryState", m.answered_at as "answeredAt"
     from messages m inner join projects p on p.id = m.project_id
     where m.id = $1 and m.project_id = $2 and m.answered_at is null and m.hidden = false`,
    [messageId, projectId],
    reportToken,
  );
  if (reserve.status !== "reserved") {
    if (reserve.status === "busy") {
      res.status(503).json({ error: "Answer delivery is already in progress. Do not retry." });
    } else {
      res.status(404).json({ error: "Unanswered question not found." });
    }
    return;
  }
  const deliveryStatus = await sendReservedAnswer(reserve.reservation, answer, reportUrl);
  if (deliveryStatus !== "sent") {
    const error = deliveryStatus === "failed"
      ? "The answer could not be delivered. The question remains unanswered and can be retried."
      : "Answer delivery status is uncertain. Do not retry; automatic duplicate delivery is disabled.";
    res.status(503).json({ error });
    return;
  }
  res.json(AnswerFilmmakerQuestionResponse.parse({ status: "answered" }));
});

router.post("/questions/answer-token", async (req, res): Promise<void> => {
  const parsedBody = AnswerQuestionByTokenBody.safeParse(req.body);
  if (!parsedBody.success || !parsedBody.data.answer.trim()) {
    res.status(400).json({ error: "Provide a valid answer token and answer." });
    return;
  }
  const appBaseUrl = configuredAppBaseUrl();
  if (!appBaseUrl) {
    res.status(503).json({ error: "Answer delivery is temporarily unavailable." });
    return;
  }
  const answer = parsedBody.data.answer.trim();
  const hash = digest(parsedBody.data.token);
  const reportToken = randomBytes(32).toString("hex");
  const reportUrl = `${appBaseUrl}/question-report#token=${reportToken}`;
  const reserve = await reserveAnswerDelivery(
    `select m.id, m.investor_email as "investorEmail", m.question, p.title as "projectTitle",
       m.answer_delivery_state as "answerDeliveryState", m.answered_at as "answeredAt"
     from messages m inner join projects p on p.id = m.project_id
     where m.answer_token_hash = $1 and m.answer_token_expires_at > now()
       and m.answered_at is null and m.hidden = false`,
    [hash],
    reportToken,
  );
  if (reserve.status !== "reserved") {
    if (reserve.status === "busy") {
      res.status(503).json({ error: "Answer delivery is already in progress. Do not retry." });
    } else {
      res.status(404).json({ error: "This private answer link is invalid, expired, or already used." });
    }
    return;
  }
  const deliveryStatus = await sendReservedAnswer(reserve.reservation, answer, reportUrl);
  if (deliveryStatus !== "sent") {
    const error = deliveryStatus === "failed"
      ? "The answer could not be delivered. The question remains unanswered and can be retried."
      : "Answer delivery status is uncertain. Do not retry; automatic duplicate delivery is disabled.";
    res.status(503).json({ error });
    return;
  }
  res.json(AnswerQuestionByTokenResponse.parse({ status: "answered" }));
});

router.post("/questions/report-token", async (req, res): Promise<void> => {
  const parsedBody = ReportQuestionByTokenBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Provide a valid report token." });
    return;
  }
  const reported = await pool.query(
    `update messages set reported = true,
       report_token_hash = null, report_token_expires_at = null,
       answer_report_token_hash = null, answer_report_token_expires_at = null
     where (report_token_hash = $1 and report_token_expires_at > now())
        or (answer_report_token_hash = $1 and answer_report_token_expires_at > now())
     returning id`,
    [digest(parsedBody.data.token)],
  );
  if (reported.rowCount === 0) {
    res.status(404).json({ error: "This report link is invalid, expired, or already used." });
    return;
  }
  res.json(ReportQuestionByTokenResponse.parse({ reported: true }));
});

export default router;