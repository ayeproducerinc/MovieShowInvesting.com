import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

/**
 * Money date (DECISIONS.md › Money date). Created by lib/db/migrations/money-date.sql;
 * keep in sync. Dates are private to the filmmaker and admin.
 */
export const projectMoneyDatesTable = pgTable("project_money_dates", {
  projectId: integer("project_id").primaryKey().references(() => projectsTable.id, { onDelete: "cascade" }),
  developmentAmount: integer("development_amount"),
  filmingStartMonth: text("filming_start_month"),
  filmingStartSkipped: boolean("filming_start_skipped").notNull().default(false),
  moneyNeededByMonth: text("money_needed_by_month"),
  moneyNeededBySkipped: boolean("money_needed_by_skipped").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("project_money_dates_development_check", sql`${table.developmentAmount} is null or ${table.developmentAmount} >= 0`),
  check("project_money_dates_filming_month_check", sql`${table.filmingStartMonth} is null or ${table.filmingStartMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("project_money_dates_needed_month_check", sql`${table.moneyNeededByMonth} is null or ${table.moneyNeededByMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("project_money_dates_filming_skip_check", sql`not (${table.filmingStartSkipped} and ${table.filmingStartMonth} is not null)`),
  check("project_money_dates_needed_skip_check", sql`not (${table.moneyNeededBySkipped} and ${table.moneyNeededByMonth} is not null)`),
]);
export type ProjectMoneyDate = typeof projectMoneyDatesTable.$inferSelect;
