import { integer, pgTable, serial, text, timestamp, boolean, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { investorsTable } from "./investors";

export const interestEntriesTable = pgTable("interest_entries", {
  id: serial("id").primaryKey(),
  investorId: integer("investor_id").notNull().references(() => investorsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  amount: integer("amount").notNull(),
  unallocated: boolean("unallocated").notNull(),
  signatureName: text("signature_name"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  submittedAnswers: jsonb("submitted_answers").$type<Record<string, unknown>>(),
  confirmationEvidence: jsonb("confirmation_evidence").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("interest_entries_investor_idx").on(table.investorId)]);

export const insertInterestEntrySchema = createInsertSchema(interestEntriesTable).omit({ id: true, createdAt: true });
export type InterestEntry = typeof interestEntriesTable.$inferSelect;