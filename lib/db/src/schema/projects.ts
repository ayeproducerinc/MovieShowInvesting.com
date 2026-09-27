import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { filmmakersTable } from "./filmmakers";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  filmmakerId: integer("filmmaker_id").references(() => filmmakersTable.id, { onDelete: "set null" }),
  slug: text("slug").unique(),
  title: text("title"),
  format: text("format"),
  genre: text("genre"),
  genreOther: text("genre_other"),
  stage: text("stage"),
  stageOther: text("stage_other"),
  logline: text("logline"),
  trailerUrl: text("trailer_url"),
  pilotUrl: text("pilot_url"),
  bunnyVideoId: text("bunny_video_id"),
  posterUrl: text("poster_url"),
  shareImageUrl: text("share_image_url"),
  budget: integer("budget"),
  budgetFromExample: boolean("budget_from_example"),
  priceGroup: text("price_group"),
  dealAnswer: text("deal_answer"),
  offerPer100: integer("offer_per100"),
  offerOtherText: text("offer_other_text"),
  wantsLower: boolean("wants_lower"),
  paybackTerms: text("payback_terms"),
  paybackTermsOther: text("payback_terms_other"),
  synopsis: text("synopsis"),
  teamLinks: jsonb("team_links").$type<string[]>(),
  moneyUse: text("money_use"),
  distributionPlan: text("distribution_plan"),
  showcaseRequested: boolean("showcase_requested"),
  approved: boolean("approved").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("projects_stage_check", sql`${table.stage} is null or ${table.stage} in ('distribution', 'production', 'idea', 'other')`),
  check("projects_offer_floor_check", sql`${table.offerPer100} is null or ${table.offerPer100} >= 125`),
  check("projects_price_group_check", sql`${table.priceGroup} is null or ${table.priceGroup} in ('A', 'B')`),
  check("projects_deal_answer_check", sql`${table.dealAnswer} is null or ${table.dealAnswer} in ('yes', 'maybe', 'no')`),
  check("projects_payback_terms_check", sql`${table.paybackTerms} is null or ${table.paybackTerms} in ('works', 'need_some', 'other')`),
]);

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;