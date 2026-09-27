import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { investorsTable } from "./investors";

export const investorMinimumsTable = pgTable("investor_minimums", {
  id: serial("id").primaryKey(),
  investorId: integer("investor_id").notNull().references(() => investorsTable.id, { onDelete: "cascade" }),
  slate: text("slate").notNull(),
  minPer100: integer("min_per100"),
  otherText: text("other_text"),
  notInterested: boolean("not_interested"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("investor_minimums_investor_slate_unique").on(table.investorId, table.slate),
  check("investor_minimums_slate_check", sql`${table.slate} in ('distribution', 'production', 'idea')`),
  check("investor_minimums_ladder_check", sql`${table.minPer100} is null or ${table.minPer100} in (125, 150, 175, 200) or ${table.minPer100} >= 250`),
]);

export const insertInvestorMinimumSchema = createInsertSchema(investorMinimumsTable).omit({ id: true, createdAt: true });
export type InsertInvestorMinimum = z.infer<typeof insertInvestorMinimumSchema>;
export type InvestorMinimum = typeof investorMinimumsTable.$inferSelect;