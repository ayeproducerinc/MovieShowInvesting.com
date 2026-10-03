import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const investorAccountProgressTable = pgTable("investor_account_progress", {
  id: serial("id").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
  verifiedEmail: text("verified_email"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  provider: text("provider").notNull(),
  uid: text("uid").notNull(),
  lastScreen: integer("last_screen").notNull(),
  answers: jsonb("answers").notNull(),
  completed: boolean("completed").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("investor_account_progress_identity_unique").on(table.provider, table.uid),
]);

export const insertInvestorAccountProgressSchema = createInsertSchema(investorAccountProgressTable);
export type InsertInvestorAccountProgress = z.infer<typeof insertInvestorAccountProgressSchema>;
export type InvestorAccountProgress = typeof investorAccountProgressTable.$inferSelect;