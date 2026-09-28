import { boolean, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { visitorsTable } from "./visitors";

export const investorsTable = pgTable("investors", {
  id: serial("id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  phone: text("phone"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  amountChoice: text("amount_choice"),
  investmentAmount: integer("investment_amount"),
  unallocated: boolean("unallocated"),
  accredited: text("accredited"),
  experience: text("experience").array(),
  experienceOther: text("experience_other"),
  motivations: text("motivations").array(),
  motivationsOther: text("motivations_other"),
  favoriteGenres: text("favorite_genres").array(),
  stages: text("stages").array(),
  minima: jsonb("minima").$type<{
    distribution: number | null;
    production: number | null;
    idea: number | null;
  }>(),
  feelSafeText: text("feel_safe_text"),
  callOptIn: boolean("call_opt_in"),
  path: text("path"),
  preference: text("preference"),
  preferenceWhy: text("preference_why"),
  signatureName: text("signature_name"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  firebaseUid: text("firebase_uid"),
  visitorId: text("visitor_id").references(() => visitorsTable.visitorId, { onDelete: "set null" }),
  ownRefCode: text("own_ref_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("investors_firebase_uid_unique").on(table.firebaseUid),
  uniqueIndex("investors_visitor_id_unique").on(table.visitorId),
]);

export const insertInvestorSchema = createInsertSchema(investorsTable).omit({ id: true, createdAt: true });
export type InsertInvestor = z.infer<typeof insertInvestorSchema>;
export type Investor = typeof investorsTable.$inferSelect;