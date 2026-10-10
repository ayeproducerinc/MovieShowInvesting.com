import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  CreateConversationParams,
  CreateConversationResponse,
  GetConversationParams,
  GetConversationResponse,
  GetMessagingConfigResponse,
  GetMyConversationsResponse,
  ReportConversationBody,
  ReportConversationParams,
  ReportConversationResponse,
  SendConversationMessageBody,
  SendConversationMessageParams,
  SendConversationMessageResponse,
} from "@workspace/api-zod";
import { resolveProtectedIdentity, type FilmmakerIdentity } from "../lib/filmmaker-auth";
import { recordTransactionalEmailStatus, sendTransactionalEmail } from "../lib/mailjet";

const router: IRouter = Router();
const MESSAGE_DAILY_LIMIT = 10;
const MESSAGE_DISCLOSURE_ENV = "MESSAGING_APPROVED_NOTICE";
const APPROVED_MESSAGING_NOTICE = "Project messages are visible to the signed-in investor and the filmmaker for that project. Authorized Movie Show Investing administrators can also read messages and reports, review safety concerns, and lock conversations. Messages are stored on the platform. Email notifications, if enabled, contain no message text. Do not share confidential scripts or sensitive personal or financial information.";

type Identity = Pick<FilmmakerIdentity, "uid" | "provider" | "email">;
type ParticipantRole = "investor" | "filmmaker";
type ConversationRow = {
  id: number;
  project_id: number;
  project_slug: string;
  project_title: string;
  other_party_name: string | null;
  viewer_role?: ParticipantRole;
  filmmaker_name?: string;
  investor_name?: string;
  awaiting_reply?: boolean;
  locked: boolean;
  reported: boolean;
  last_message_at: Date | null;
  created_at: Date;
};

function messagingConfig(): { available: boolean; disclosure: string } {
  const approvedNotice = process.env[MESSAGE_DISCLOSURE_ENV] ?? "";
  const available = process.env.MESSAGING_PRIVACY_APPROVED === "true"
    && approvedNotice === APPROVED_MESSAGING_NOTICE;
  return { available, disclosure: available ? APPROVED_MESSAGING_NOTICE : "" };
}

function safeAppBaseUrl(): string | null {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password
      || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
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

function isMessagingBlocked(row: { locked: boolean; reported: boolean }): boolean {
  return row.locked || row.reported;
}

router.get("/messaging/config", (_req, res): void => {
  res.json(GetMessagingConfigResponse.parse(messagingConfig()));
});

router.post("/projects/:slug/conversations", async (req, res): Promise<void> => {
  const identity = await resolveProtectedIdentity(req, res);
  if (!identity) return;
  const parsedParams = CreateConversationParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid project slug." });
    return;
  }
  if (!messagingConfig().available) {
    res.status(503).json({ error: "Messaging is not currently available." });
    return;
  }

  const projectResult = await pool.query<{
    id: number;
    slug: string;
    title: string;
    filmmaker_id: number;
    filmmaker_firebase_uid: string | null;
    filmmaker_replit_uid: string | null;
    filmmaker_name: string | null;
  }>(
    `select p.id, p.slug, p.title, f.id as filmmaker_id,
        f.firebase_uid as filmmaker_firebase_uid, f.replit_uid as filmmaker_replit_uid,
        f.name as filmmaker_name
     from projects p
     inner join filmmakers f on f.id = p.filmmaker_id
     where p.slug = $1 and p.title is not null and p.approved = true
       and p.hidden = false and p.showcase_requested = true
     limit 1`,
    [parsedParams.data.slug],
  );
  const project = projectResult.rows[0];
  const sameProviderOwner = project && (identity.provider === "firebase"
    ? project.filmmaker_firebase_uid === identity.uid
    : project.filmmaker_replit_uid === identity.uid);
  if (!project || (!project.filmmaker_firebase_uid && !project.filmmaker_replit_uid)
    || sameProviderOwner) {
    res.status(404).json({ error: "Project not found or unavailable for messaging." });
    return;
  }

  const client = await pool.connect();
  let conversation: ConversationRow | undefined;
  try {
    await client.query("begin");
    const advisoryKeys = [
      `investor-${identity.provider}-uid:${createHash("sha256").update(identity.uid).digest("hex")}`,
      `investor-email:${createHash("sha256").update(identity.email).digest("hex")}`,
      `conversation-start:${createHash("sha256").update(`${identity.provider}:${identity.uid}`).digest("hex")}:${project.id}`,
    ].sort();
    for (const key of advisoryKeys) {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [key]);
    }

    type InvestorRow = { id: number; name: string | null; email: string | null; firebase_uid: string | null; replit_uid: string | null; investment_amount: number | null };
    const investorUidColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
    const uidInvestors = await client.query<InvestorRow>(
      `select id, name, email, firebase_uid, replit_uid, investment_amount from investors
       where ${investorUidColumn} = $1 order by id for update`,
      [identity.uid],
    );
    const emailInvestors = await client.query<InvestorRow>(
      `select id, name, email, firebase_uid, replit_uid, investment_amount from investors
       where lower(trim(email)) = $1 order by id for update`,
      [identity.email],
    );
    const identityConflict = uidInvestors.rows.length > 1
      || Boolean(uidInvestors.rows[0] && uidInvestors.rows[0].email?.trim().toLowerCase() !== identity.email)
      || emailInvestors.rows.some((row) =>
        identity.provider === "firebase"
          ? (row.firebase_uid != null && row.firebase_uid !== identity.uid) || row.replit_uid != null
          : (row.replit_uid != null && row.replit_uid !== identity.uid) || row.firebase_uid != null
      );
    if (identityConflict) {
      await client.query("rollback");
        res.status(409).json({ error: "This verified account conflicts with an existing investor identity." });
      return;
    }

    const investor = uidInvestors.rows[0];
    if (!investor || investor.investment_amount === null || investor.investment_amount < 100) {
      await client.query("rollback");
      res.status(404).json({ error: "Save your non-binding investor interest before starting a conversation." });
      return;
    }
    const uidClaims = await client.query<{ id: number }>(
      `select id from investors where ${investorUidColumn} = $1 order by id for update`,
      [identity.uid],
    );
    if (uidClaims.rows.length !== 1 || uidClaims.rows[0].id !== investor.id) {
      await client.query("rollback");
      res.status(409).json({ error: "This verified account conflicts with an existing investor identity." });
      return;
    }

    const result = await client.query<ConversationRow>(
      `insert into conversations (project_id, investor_id, filmmaker_id)
       values ($1, $2, $3)
       on conflict (project_id, investor_id) do update set updated_at = conversations.updated_at
         where conversations.filmmaker_id = excluded.filmmaker_id
       returning id, project_id, $4::text as project_slug, $5::text as project_title,
         $6::text as other_party_name, 'investor'::text as viewer_role,
         $6::text as filmmaker_name, $7::text as investor_name, locked, reported,
         last_message_at, created_at`,
      [project.id, investor.id, project.filmmaker_id, project.slug, project.title, project.filmmaker_name ?? "Filmmaker", investor.name ?? "Investor"],
    );
    conversation = result.rows[0];
    if (!conversation) {
      await client.query("rollback");
      res.status(404).json({ error: "Project not found or unavailable for messaging." });
      return;
    }
    if (isMessagingBlocked(conversation)) {
      await client.query("rollback");
      res.status(409).json({ error: "This conversation is locked or under review." });
      return;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  res.status(201).json(CreateConversationResponse.parse(conversation));
});

router.get("/me/conversations", async (req, res): Promise<void> => {
  const identity = await resolveProtectedIdentity(req, res);
  if (!identity) return;
  if (!messagingConfig().available) {
    res.status(503).json({ error: "Messaging is not currently available." });
    return;
  }
  const uidColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
  const result = await pool.query<ConversationRow>(
    `select c.id, c.project_id, p.slug as project_slug, p.title as project_title,
       case when i.${uidColumn} = $1 then coalesce(f.name, 'Filmmaker')
            else coalesce(i.name, 'Investor') end as other_party_name,
       case when i.${uidColumn} = $1 then 'investor' else 'filmmaker' end as viewer_role,
       coalesce(f.name, 'Filmmaker') as filmmaker_name, coalesce(i.name, 'Investor') as investor_name,
       coalesce((select m.sender_role from conversation_messages m where m.conversation_id = c.id
                 order by m.created_at desc, m.id desc limit 1)
         <> case when i.${uidColumn} = $1 then 'investor' else 'filmmaker' end, false) as awaiting_reply,
       c.locked, c.reported,
       c.last_message_at, c.created_at
     from conversations c
     inner join projects p on p.id = c.project_id
     inner join investors i on i.id = c.investor_id
     inner join filmmakers f on f.id = c.filmmaker_id
      where (i.${uidColumn} = $1 or f.${uidColumn} = $1)
        and (i.${uidColumn} is distinct from $1 or f.${uidColumn} is distinct from $1)
     order by c.last_message_at desc nulls last, c.created_at desc`,
    [identity.uid],
  );
  res.json(GetMyConversationsResponse.parse({ conversations: result.rows }));
});

router.get("/conversations/:id", async (req, res): Promise<void> => {
  const identity = await resolveProtectedIdentity(req, res);
  if (!identity) return;
  if (!messagingConfig().available) {
    res.status(503).json({ error: "Messaging is not currently available." });
    return;
  }
  const params = GetConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid conversation ID." });
    return;
  }
  const uidColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
  const result = await pool.query<ConversationRow>(
    `select c.id, c.project_id, p.slug as project_slug, p.title as project_title,
       case when i.${uidColumn} = $2 then coalesce(f.name, 'Filmmaker')
            else coalesce(i.name, 'Investor') end as other_party_name,
       case when i.${uidColumn} = $2 then 'investor' else 'filmmaker' end as viewer_role,
       coalesce(f.name, 'Filmmaker') as filmmaker_name, coalesce(i.name, 'Investor') as investor_name,
       c.locked, c.reported,
       c.last_message_at, c.created_at
     from conversations c
     inner join projects p on p.id = c.project_id
     inner join investors i on i.id = c.investor_id
     inner join filmmakers f on f.id = c.filmmaker_id
      where c.id = $1 and (i.${uidColumn} = $2 or f.${uidColumn} = $2)
        and (i.${uidColumn} is distinct from $2 or f.${uidColumn} is distinct from $2)
     limit 1`,
    [params.data.id, identity.uid],
  );
  const conversation = result.rows[0];
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found for this participant." });
    return;
  }
  const messages = await pool.query(
    `select id, sender_role, body, created_at
     from conversation_messages where conversation_id = $1
     order by created_at, id`,
    [conversation.id],
  );
  res.json(GetConversationResponse.parse({ conversation, messages: messages.rows }));
});

router.post("/conversations/:id/messages", async (req, res): Promise<void> => {
  const identity = await resolveProtectedIdentity(req, res);
  if (!identity) return;
  const params = SendConversationMessageParams.safeParse(req.params);
  const parsedBody = SendConversationMessageBody.safeParse(req.body);
  if (!params.success || !parsedBody.success) {
    res.status(400).json({ error: "Provide a conversation ID and message text." });
    return;
  }
  const body = parsedBody.data.body.trim();
  if (!body || body.length > 2000) {
    res.status(400).json({ error: "Message text must contain 1 to 2000 characters." });
    return;
  }
  const uidColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
  const client = await pool.connect();
  let inserted: { id: number; sender_role: ParticipantRole; body: string; created_at: Date } | undefined;
  let notification: { email: string | null } | undefined;
  try {
    await client.query("begin");
    const conversationResult = await client.query<{
      id: number;
      investor_uid: string;
      filmmaker_uid: string;
      locked: boolean;
      reported: boolean;
      recipient_email: string | null;
    }>(
      `select c.id, i.${uidColumn} as investor_uid, f.${uidColumn} as filmmaker_uid,
         c.locked, c.reported,
         case when i.${uidColumn} = $2 then f.email else i.email end as recipient_email
       from conversations c
       inner join investors i on i.id = c.investor_id
       inner join filmmakers f on f.id = c.filmmaker_id
       where c.id = $1 and (i.${uidColumn} = $2 or f.${uidColumn} = $2)
       for update of c`,
      [params.data.id, identity.uid],
    );
    const conversation = conversationResult.rows[0];
    if (!conversation) {
      await client.query("rollback");
      res.status(404).json({ error: "Conversation not found for this participant." });
      return;
    }
    if (!messagingConfig().available || isMessagingBlocked(conversation)) {
      await client.query("rollback");
      res.status(409).json({ error: "Messaging is disabled or this conversation is locked or under review." });
      return;
    }
    const isInvestor = conversation.investor_uid === identity.uid;
    const isFilmmaker = conversation.filmmaker_uid === identity.uid;
    if (isInvestor === isFilmmaker) {
      await client.query("rollback");
      res.status(403).json({ error: "A unique verified investor or filmmaker account is required." });
      return;
    }
    const senderRole: ParticipantRole = isInvestor ? "investor" : "filmmaker";
    const senderUid = `${identity.provider}:${identity.uid}`;
    const rateKey = createHash("sha256").update(`${identity.provider}:${identity.uid}`).digest("hex");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`conversation-message-sender:${rateKey}`]);
    const count = await client.query<{ count: number }>(
      `select count(*)::int as count from conversation_messages
       where sender_uid in ($1, $2) and created_at > now() - interval '24 hours'`,
       [identity.uid, senderUid],
    );
    if (count.rows[0].count >= MESSAGE_DAILY_LIMIT) {
      await client.query("rollback");
      res.status(429).json({ error: "You have reached the limit of 10 messages in 24 hours." });
      return;
    }
    const message = await client.query<{ id: number; sender_role: ParticipantRole; body: string; created_at: Date }>(
      `insert into conversation_messages (conversation_id, sender_uid, sender_role, body)
       values ($1, $2, $3, $4)
       returning id, sender_role, body, created_at`,
      [conversation.id, senderUid, senderRole, body],
    );
    inserted = message.rows[0];
    notification = { email: conversation.recipient_email };
    await client.query("update conversations set last_message_at = now(), updated_at = now() where id = $1", [conversation.id]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  try {
    const appBaseUrl = safeAppBaseUrl();
    if (notification?.email && appBaseUrl) {
      const emailType = "conversation-message-notification";
      if (!process.env.MAILJET_API_KEY?.trim()
        || !process.env.MAILJET_SECRET_KEY?.trim()
        || !process.env.MAILJET_SENDER_EMAIL?.trim()) {
        await recordTransactionalEmailStatus(notification.email, emailType, "unconfigured");
      } else {
        const status = await sendTransactionalEmail({
          to: notification.email,
          type: emailType,
          subject: "You have a new private message",
          text: `Sign in to Movie Show Investing to view your new private message: ${appBaseUrl}/messages`,
          html: `<p>You have a new private message.</p><p><a href="${escapeHtml(appBaseUrl)}/messages">Sign in to view it</a>.</p>`,
        });
        if (status !== "sent") req.log.warn({ conversationId: params.data.id, status }, "Conversation message notification was not delivered");
      }
    } else if (notification?.email) {
      await recordTransactionalEmailStatus(notification.email, "conversation-message-notification", "unconfigured");
    }
  } catch {
    req.log.warn({ conversationId: params.data.id }, "Conversation message notification or email logging failed");
  }
  res.status(201).json(SendConversationMessageResponse.parse(inserted));
});

router.post("/conversations/:id/report", async (req, res): Promise<void> => {
  const identity = await resolveProtectedIdentity(req, res);
  if (!identity) return;
  const params = ReportConversationParams.safeParse(req.params);
  const parsedBody = ReportConversationBody.safeParse(req.body);
  if (!params.success || !parsedBody.success) {
    res.status(400).json({ error: "Provide a conversation ID and report reason." });
    return;
  }
  const reason = parsedBody.data.reason.trim();
  if (!reason || reason.length > 2000) {
    res.status(400).json({ error: "Report reason must contain 1 to 2000 characters." });
    return;
  }
  const uidColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
  const result = await pool.query(
    `update conversations c
     set reported = true,
       report_reason = case when c.reported then c.report_reason else $3 end,
       reporter_role = case when c.reported then c.reporter_role
         else case when i.${uidColumn} = $2 then 'investor' else 'filmmaker' end end,
       reported_at = case when c.reported then c.reported_at else now() end,
       updated_at = now()
     from investors i, filmmakers f
     where c.id = $1 and i.id = c.investor_id and f.id = c.filmmaker_id
        and (i.${uidColumn} = $2 or f.${uidColumn} = $2)
        and (i.${uidColumn} is distinct from $2 or f.${uidColumn} is distinct from $2)
     returning c.id`,
    [params.data.id, identity.uid, reason],
  );
  if (!result.rowCount) {
    res.status(404).json({ error: "Conversation not found for this participant." });
    return;
  }
  res.json(ReportConversationResponse.parse({ reported: true }));
});

export default router;