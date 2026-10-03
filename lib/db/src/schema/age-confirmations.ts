import { primaryKey, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** A self-declaration only, never a date of birth or KYC result. */
export const ageConfirmationsTable = pgTable("age_confirmations", {
  provider: text("provider").notNull(),
  uid: text("uid").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.provider, table.uid] })]);
export const insertAgeConfirmationSchema = createInsertSchema(ageConfirmationsTable).omit({ confirmedAt: true });
export type InsertAgeConfirmation = z.infer<typeof insertAgeConfirmationSchema>;
export type AgeConfirmation = typeof ageConfirmationsTable.$inferSelect;