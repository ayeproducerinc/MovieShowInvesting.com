import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { visitorsTable } from "./visitors";

export const filmmakersTable = pgTable("filmmakers", {
  id: serial("id").primaryKey(),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  favoriteGenres: text("favorite_genres").array(),
  chatOptIn: boolean("chat_opt_in"),
  noProjectYet: boolean("no_project_yet"),
  visitorId: text("visitor_id").references(() => visitorsTable.visitorId, { onDelete: "set null" }),
  ownRefCode: text("own_ref_code"),
  firebaseUid: text("firebase_uid"),
  emailVerified: boolean("email_verified"),
  phoneVerified: boolean("phone_verified"),
  fundingSources: text("funding_sources").array(),
  fundingOther: text("funding_other"),
  reachedGoal: boolean("reached_goal"),
  fundingExperience: text("funding_experience"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFilmmakerSchema = createInsertSchema(filmmakersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFilmmaker = z.infer<typeof insertFilmmakerSchema>;
export type Filmmaker = typeof filmmakersTable.$inferSelect;