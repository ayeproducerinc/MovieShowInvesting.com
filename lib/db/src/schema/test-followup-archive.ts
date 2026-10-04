import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** Private, one-time receipts: never clear a later request from the same account. */
export const testFollowupArchiveTable = pgTable("test_followup_archive", {
  kind: text("kind").notNull(),
  recordId: integer("record_id").notNull(),
  environment: text("environment").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  clearedAt: timestamp("cleared_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.kind, table.recordId] })]);