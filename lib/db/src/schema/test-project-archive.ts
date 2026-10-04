import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Private evidence only: never exposed through public project or investor APIs. */
export const testProjectArchiveTable = pgTable("test_project_archive", {
  projectId: integer("project_id").primaryKey(),
  environment: text("environment").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  mediaCleanup: jsonb("media_cleanup").$type<Record<string, string>>().notNull().default({}),
});