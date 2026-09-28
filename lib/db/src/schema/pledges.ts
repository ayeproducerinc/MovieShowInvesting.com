import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { investorsTable } from "./investors";
import { interestEntriesTable } from "./interest-entries";
import { projectsTable } from "./projects";

export const pledgesTable = pgTable("pledges", {
  id: serial("id").primaryKey(),
  investorId: integer("investor_id").notNull().references(() => investorsTable.id, { onDelete: "cascade" }),
  entryId: integer("entry_id").references(() => interestEntriesTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  amount: integer("amount").notNull(),
  confirmed: boolean("confirmed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("pledges_amount_minimum_check", sql`${table.amount} >= 25`),
]);

export const insertPledgeSchema = createInsertSchema(pledgesTable).omit({ id: true, createdAt: true });
export type InsertPledge = z.infer<typeof insertPledgeSchema>;
export type Pledge = typeof pledgesTable.$inferSelect;