import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { visitorsTable } from "./visitors";

export const filmmakerAccountVisitorsTable = pgTable("filmmaker_account_visitors", {
  visitorId: text("visitor_id").primaryKey().references(() => visitorsTable.visitorId, { onDelete: "cascade" }),
  firebaseUid: text("firebase_uid").notNull(),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("filmmaker_account_visitors_uid_idx").on(table.firebaseUid),
]);

export const insertFilmmakerAccountVisitorSchema = createInsertSchema(filmmakerAccountVisitorsTable).omit({
  linkedAt: true,
});
export type InsertFilmmakerAccountVisitor = z.infer<typeof insertFilmmakerAccountVisitorSchema>;
export type FilmmakerAccountVisitor = typeof filmmakerAccountVisitorsTable.$inferSelect;