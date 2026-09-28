import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  investorName: text("investor_name"),
  investorEmail: text("investor_email"),
  question: text("question"),
  answer: text("answer"),
  answerTokenHash: text("answer_token_hash"),
  answerTokenExpiresAt: timestamp("answer_token_expires_at", { withTimezone: true }),
  answerDeliveryState: text("answer_delivery_state"),
  answerDeliveryId: text("answer_delivery_id"),
  reportTokenHash: text("report_token_hash"),
  reportTokenExpiresAt: timestamp("report_token_expires_at", { withTimezone: true }),
  answerReportTokenHash: text("answer_report_token_hash"),
  answerReportTokenExpiresAt: timestamp("answer_report_token_expires_at", { withTimezone: true }),
  askedAt: timestamp("asked_at", { withTimezone: true }).notNull().defaultNow(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  reported: boolean("reported").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;