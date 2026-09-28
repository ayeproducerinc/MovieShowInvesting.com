import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { visitorsTable } from "./visitors";

export const filmmakerAccountVisitorsTable = pgTable("filmmaker_account_visitors", {
  visitorId: text("visitor_id").primaryKey().references(() => visitorsTable.visitorId, { onDelete: "cascade" }),
  firebaseUid: text("firebase_uid"),
  replitUid: text("replit_uid"),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("filmmaker_account_visitors_uid_idx").on(table.firebaseUid),
  index("filmmaker_account_visitors_replit_uid_idx").on(table.replitUid),
]);

export const insertFilmmakerAccountVisitorSchema = createInsertSchema(filmmakerAccountVisitorsTable).omit({
  linkedAt: true,
});
export type InsertFilmmakerAccountVisitor = z.infer<typeof insertFilmmakerAccountVisitorSchema>;
export type FilmmakerAccountVisitor = typeof filmmakerAccountVisitorsTable.$inferSelect;