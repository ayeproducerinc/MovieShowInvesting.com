import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailLogTable = pgTable("email_log", {
  id: serial("id").primaryKey(),
  to: text("to").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmailLogSchema = createInsertSchema(emailLogTable).omit({ id: true, createdAt: true });
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLog = typeof emailLogTable.$inferSelect;