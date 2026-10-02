import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { visitorsTable } from "./visitors";

/** Sticky first activity; guest keys resolve through secure account links at read time. */
export const filmmakerActivityTable = pgTable("filmmaker_activity", {
  identityKey: text("identity_key").primaryKey(),
  visitorId: text("visitor_id").references(() => visitorsTable.visitorId, { onDelete: "cascade" }),
  firstActivityAt: timestamp("first_activity_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("filmmaker_activity_identity_check", sql`
    (${table.visitorId} is not null and ${table.identityKey} = 'visitor:' || ${table.visitorId})
    or (${table.visitorId} is null and ${table.identityKey} ~ '^(firebase|replit):.+$')
  `),
]);

export const insertFilmmakerActivitySchema = createInsertSchema(filmmakerActivityTable).omit({ firstActivityAt: true });
export type InsertFilmmakerActivity = z.infer<typeof insertFilmmakerActivitySchema>;
export type FilmmakerActivity = typeof filmmakerActivityTable.$inferSelect;