import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { filmmakersTable } from "./filmmakers";
import { investorsTable } from "./investors";
import { projectsTable } from "./projects";

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  investorId: integer("investor_id").notNull().references(() => investorsTable.id, { onDelete: "cascade" }),
  filmmakerId: integer("filmmaker_id").notNull().references(() => filmmakersTable.id, { onDelete: "cascade" }),
  locked: boolean("locked").notNull().default(false),
  reported: boolean("reported").notNull().default(false),
  reportReason: text("report_reason"),
  reporterRole: text("reporter_role"),
  reportedAt: timestamp("reported_at", { withTimezone: true }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("conversations_project_investor_unique").on(table.projectId, table.investorId),
  index("conversations_project_idx").on(table.projectId),
  check("conversations_reporter_role_check", sql`${table.reporterRole} is null or ${table.reporterRole} in ('investor', 'filmmaker')`),
]);

export const insertConversationSchema = createInsertSchema(conversationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversationsTable.$inferSelect;

export const conversationMessagesTable = pgTable("conversation_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  senderUid: text("sender_uid").notNull(),
  senderRole: text("sender_role").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("conversation_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  index("conversation_messages_sender_created_idx").on(table.senderUid, table.createdAt),
  check("conversation_messages_sender_role_check", sql`${table.senderRole} in ('investor', 'filmmaker')`),
  check("conversation_messages_body_length_check", sql`char_length(${table.body}) between 1 and 2000`),
]);

export const insertConversationMessageSchema = createInsertSchema(conversationMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertConversationMessage = z.infer<typeof insertConversationMessageSchema>;
export type ConversationMessage = typeof conversationMessagesTable.$inferSelect;

export const conversationModerationAuditTable = pgTable("conversation_moderation_audit", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  adminUid: text("admin_uid").notNull(),
  action: text("action").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("conversation_moderation_audit_conversation_created_idx").on(table.conversationId, table.createdAt),
  check("conversation_moderation_audit_action_check", sql`${table.action} in ('lock', 'unlock', 'review')`),
]);

export const insertConversationModerationAuditSchema = createInsertSchema(conversationModerationAuditTable).omit({
  id: true,
  createdAt: true,
});
export type InsertConversationModerationAudit = z.infer<typeof insertConversationModerationAuditSchema>;
export type ConversationModerationAudit = typeof conversationModerationAuditTable.$inferSelect;