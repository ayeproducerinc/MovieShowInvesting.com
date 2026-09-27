import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { visitorsTable } from "./visitors";

export const flowProgressTable = pgTable("flow_progress", {
  id: serial("id").primaryKey(),
  visitorId: text("visitor_id").notNull().references(() => visitorsTable.visitorId, { onDelete: "cascade" }),
  flow: text("flow").notNull(),
  lastScreen: integer("last_screen").notNull(),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
  completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("flow_progress_visitor_flow_unique").on(table.visitorId, table.flow),
  check("flow_progress_flow_check", sql`${table.flow} in ('filmmaker', 'investor')`),
  check("flow_progress_screen_check", sql`(${table.flow} = 'filmmaker' and ${table.lastScreen} between 1 and 6) or (${table.flow} = 'investor' and ${table.lastScreen} between 1 and 5)`),
]);

export const insertFlowProgressSchema = createInsertSchema(flowProgressTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFlowProgress = z.infer<typeof insertFlowProgressSchema>;
export type FlowProgressRecord = typeof flowProgressTable.$inferSelect;