import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const visitorsTable = pgTable("visitors", {
  visitorId: text("visitor_id").primaryKey(),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  refCodeUsed: text("ref_code_used"),
  priceGroup: text("price_group"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check("visitors_price_group_check", sql`${table.priceGroup} is null or ${table.priceGroup} in ('A', 'B')`),
]);

export const insertVisitorSchema = createInsertSchema(visitorsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertVisitor = z.infer<typeof insertVisitorSchema>;
export type Visitor = typeof visitorsTable.$inferSelect;