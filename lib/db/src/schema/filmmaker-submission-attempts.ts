import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const filmmakerSubmissionAttemptsTable = pgTable("filmmaker_submission_attempts", {
  id: serial("id").primaryKey(),
  ipHash: text("ip_hash").notNull(),
  visitorHash: text("visitor_hash").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("filmmaker_submission_attempts_ip_time_idx").on(table.ipHash, table.attemptedAt),
  index("filmmaker_submission_attempts_visitor_time_idx").on(table.visitorHash, table.attemptedAt),
  index("filmmaker_submission_attempts_time_idx").on(table.attemptedAt),
]);