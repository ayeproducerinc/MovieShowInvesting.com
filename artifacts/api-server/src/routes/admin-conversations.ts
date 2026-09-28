import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  GetAdminConversationParams,
  GetAdminConversationResponse,
  GetAdminConversationsResponse,
  GetConversationResponse,
  ModerateAdminConversationBody,
  ModerateAdminConversationParams,
  ModerateAdminConversationResponse,
} from "@workspace/api-zod";
import { authorizeAdminIdentity } from "../lib/admin-auth";

const router: IRouter = Router();
type ConversationRow = {
  id: number;
  project_id: number;
  project_slug: string;
  project_title: string;
  other_party_name: string;
  locked: boolean;
  reported: boolean;
  last_message_at: Date | null;
  created_at: Date;
};
type AdminConversationRow = ConversationRow & { report_reason: string | null };

router.get("/admin/conversations", async (req, res): Promise<void> => {
  if (!await authorizeAdminIdentity(req, res)) return;
  const result = await pool.query<ConversationRow>(
    `select c.id, c.project_id, p.slug as project_slug, p.title as project_title,
       coalesce(i.name, 'Investor') as other_party_name,
       c.locked, c.reported, c.last_message_at, c.created_at
     from conversations c
     inner join projects p on p.id = c.project_id
     inner join investors i on i.id = c.investor_id
     order by c.reported desc, c.last_message_at desc nulls last, c.created_at desc`,
  );
  res.json(GetAdminConversationsResponse.parse({ conversations: result.rows }));
});

router.get("/admin/conversations/:id", async (req, res): Promise<void> => {
  if (!await authorizeAdminIdentity(req, res)) return;
  const params = GetAdminConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid conversation ID." });
    return;
  }
  const [conversationResult, auditResult, messagesResult] = await Promise.all([
    pool.query<AdminConversationRow>(
      `select c.id, c.project_id, p.slug as project_slug, p.title as project_title,
         coalesce(i.name, 'Investor') as other_party_name,
         c.locked, c.reported, c.report_reason, c.last_message_at, c.created_at
       from conversations c
       inner join projects p on p.id = c.project_id
       inner join investors i on i.id = c.investor_id
       where c.id = $1 limit 1`,
      [params.data.id],
    ),
    pool.query(
      `select action, note, created_at as at from conversation_moderation_audit
       where conversation_id = $1 order by created_at, id`,
      [params.data.id],
    ),
    pool.query(
      `select id, sender_role, body, created_at
       from conversation_messages where conversation_id = $1 order by created_at, id`,
      [params.data.id],
    ),
  ]);
  const conversation = conversationResult.rows[0];
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }
  const validatedMessages = GetConversationResponse.parse({
    conversation,
    messages: messagesResult.rows,
  }).messages;
  const validated = GetAdminConversationResponse.parse({
    ...conversation,
    report_reason: conversation.report_reason,
    messages: validatedMessages,
    audit: auditResult.rows,
  });
  res.json({
    ...validated,
    report_reason: conversation.report_reason,
    messages: validatedMessages,
  });
});

router.post("/admin/conversations/:id/moderation", async (req, res): Promise<void> => {
  const admin = await authorizeAdminIdentity(req, res);
  if (!admin) return;
  const params = ModerateAdminConversationParams.safeParse(req.params);
  const body = ModerateAdminConversationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Provide a valid conversation ID, moderation action, and note." });
    return;
  }
  const note = body.data.note.trim();
  if (note.length > 4000) {
    res.status(400).json({ error: "Moderation notes must be 4000 characters or fewer." });
    return;
  }

  const client = await pool.connect();
  let locked: boolean | undefined;
  try {
    await client.query("begin");
    const existing = await client.query<{ id: number }>(
      "select id from conversations where id = $1 for update",
      [params.data.id],
    );
    if (!existing.rows[0]) {
      await client.query("rollback");
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    if (body.data.action === "lock") {
      locked = true;
      await client.query("update conversations set locked = true, updated_at = now() where id = $1", [params.data.id]);
    } else if (body.data.action === "unlock") {
      locked = false;
      await client.query("update conversations set locked = false, updated_at = now() where id = $1", [params.data.id]);
    } else {
      const current = await client.query<{ locked: boolean }>(
        "select locked from conversations where id = $1",
        [params.data.id],
      );
      locked = current.rows[0].locked;
      await client.query("update conversations set reported = true, updated_at = now() where id = $1", [params.data.id]);
    }
    await client.query(
      `insert into conversation_moderation_audit (conversation_id, admin_uid, action, note)
       values ($1, $2, $3, $4)`,
      [params.data.id, admin.uid, body.data.action, note || null],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  res.json(ModerateAdminConversationResponse.parse({
    status: body.data.action === "review" ? "reviewed" : body.data.action === "lock" ? "locked" : "unlocked",
    locked,
  }));
});

export default router;