import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const questionIpAttemptsTable = pgTable("question_ip_attempts", {
  id: serial("id").primaryKey(),
  ipHash: text("ip_hash").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("question_ip_attempts_hash_time_idx").on(table.ipHash, table.attemptedAt),
  index("question_ip_attempts_time_idx").on(table.attemptedAt),
]);