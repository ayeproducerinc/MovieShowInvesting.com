import { sql } from "drizzle-orm";
import { check, integer, pgTable, serial, text, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pledgesTable } from "./pledges";
import { projectsTable } from "./projects";
import { filmmakersTable } from "./filmmakers";

export const interestAlertsTable = pgTable("interest_alerts", {
  id: serial("id").primaryKey(),
  pledgeId: integer("pledge_id").notNull().references(() => pledgesTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  filmmakerId: integer("filmmaker_id").notNull().references(() => filmmakersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
  emailStatus: text("email_status").notNull().default("pending"),
  emailUncertain: boolean("email_uncertain").notNull().default(false),
}, (table) => [
  uniqueIndex("interest_alerts_pledge_unique").on(table.pledgeId),
  check("interest_alerts_email_status_check", sql`${table.emailStatus} in ('pending', 'sending', 'sent', 'failed', 'unconfigured')`),
]);

export const insertInterestAlertSchema = createInsertSchema(interestAlertsTable).omit({ id: true, createdAt: true });
export type InsertInterestAlert = z.infer<typeof insertInterestAlertSchema>;
export type InterestAlert = typeof interestAlertsTable.$inferSelect;