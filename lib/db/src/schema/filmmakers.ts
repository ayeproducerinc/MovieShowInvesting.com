import { pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// The filmmaker flow is a later phase; this minimal table makes the Phase 1
// home count an actual database query rather than an invented constant.
export const filmmakersTable = pgTable("filmmakers", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFilmmakerSchema = createInsertSchema(filmmakersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFilmmaker = z.infer<typeof insertFilmmakerSchema>;
export type Filmmaker = typeof filmmakersTable.$inferSelect;