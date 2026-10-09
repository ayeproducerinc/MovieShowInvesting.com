import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { investorsTable } from "./investors";

/** Research question answers. Created by lib/db/migrations/research-answers.sql; keep in sync. */
export const investorResearchAnswersTable = pgTable("investor_research_answers", {
  investorId: integer("investor_id").notNull().references(() => investorsTable.id, { onDelete: "cascade" }),
  questionKey: text("question_key").notNull(),
  answer: text("answer").notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.investorId, table.questionKey] }),
  check("investor_research_answers_answer_check", sql`${table.answer} in ('yes', 'no', 'not_sure')`),
]);
export type InvestorResearchAnswer = typeof investorResearchAnswersTable.$inferSelect;
