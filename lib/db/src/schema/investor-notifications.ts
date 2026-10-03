import { boolean, index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** Append-only consent evidence. A null/missing choice is not consent. */
export const investorNotificationEventsTable = pgTable("investor_notification_events", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  uid: text("uid").notNull(),
  allowed: boolean("allowed").notNull(),
  version: text("version").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("investor_notification_identity_idx").on(table.provider, table.uid)]);
export const insertInvestorNotificationEventSchema = createInsertSchema(investorNotificationEventsTable).omit({ id: true, recordedAt: true });
export type InsertInvestorNotificationEvent = z.infer<typeof insertInvestorNotificationEventSchema>;
export type InvestorNotificationEvent = typeof investorNotificationEventsTable.$inferSelect;