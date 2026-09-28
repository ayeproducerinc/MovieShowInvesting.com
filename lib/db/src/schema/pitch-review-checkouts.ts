import { integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projectsTable } from "./projects";

export const pitchReviewCheckoutsTable = pgTable("pitch_review_checkouts", {
  sessionId: text("session_id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id),
  visitorId: text("visitor_id").notNull(),
  state: text("state").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("pitch_review_one_open_checkout_per_project").on(table.projectId).where(sql`${table.state} = 'open'`),
]);