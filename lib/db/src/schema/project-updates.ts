import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { filmmakersTable } from "./filmmakers";
import { investorsTable } from "./investors";

/**
 * Filmmaker-posted milestones (DECISIONS.md › Project updates). Created by the
 * reviewed SQL migration lib/db/migrations/project-updates.sql; keep in sync.
 */
export const projectUpdatesTable = pgTable("project_updates", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  filmmakerId: integer("filmmaker_id").notNull().references(() => filmmakersTable.id, { onDelete: "cascade" }),
  milestoneKey: text("milestone_key").notNull(),
  role: text("role"),
  personName: text("person_name"),
  nameConsent: boolean("name_consent").notNull().default(false),
  customLabel: text("custom_label"),
  note: text("note"),
  status: text("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  emailsQueuedAt: timestamp("emails_queued_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("project_updates_project_status_idx").on(table.projectId, table.status, table.createdAt),
  index("project_updates_status_idx").on(table.status),
  check("project_updates_milestone_check", sql`${table.milestoneKey} in ('script_draft_finished', 'script_locked', 'budget_schedule_done', 'lead_cast_attached', 'proof_of_concept_out', 'locations_secured', 'shoot_dates_set', 'filming_started', 'filming_wrapped', 'final_cut_locked', 'festival_selection', 'award_or_press', 'distributor_signed', 'release_date_set', 'released', 'team_member_joined', 'other_funding_secured', 'other')`),
  check("project_updates_role_check", sql`${table.role} is null or ${table.role} in ('producer', 'director', 'writer', 'executive_producer', 'cinematographer', 'casting_director', 'other')`),
  check("project_updates_status_check", sql`${table.status} in ('pending', 'approved', 'rejected')`),
  check("project_updates_name_consent_check", sql`${table.personName} is null or ${table.nameConsent}`),
  check("project_updates_name_length_check", sql`${table.personName} is null or char_length(${table.personName}) <= 80`),
  check("project_updates_label_check", sql`(${table.milestoneKey} = 'other' and ${table.customLabel} is not null and char_length(${table.customLabel}) between 1 and 60) or (${table.milestoneKey} <> 'other' and ${table.customLabel} is null)`),
  check("project_updates_note_length_check", sql`${table.note} is null or char_length(${table.note}) <= 500`),
]);

/** One row per update and backer; a backer never gets the same update twice. */
export const projectUpdateEmailsTable = pgTable("project_update_emails", {
  id: serial("id").primaryKey(),
  updateId: integer("update_id").notNull().references(() => projectUpdatesTable.id, { onDelete: "cascade" }),
  investorId: integer("investor_id").notNull().references(() => investorsTable.id, { onDelete: "cascade" }),
  emailStatus: text("email_status").notNull().default("pending"),
  emailUncertain: boolean("email_uncertain").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("project_update_emails_update_investor_unique").on(table.updateId, table.investorId),
  check("project_update_emails_status_check", sql`${table.emailStatus} in ('pending', 'sending', 'sent', 'failed', 'unconfigured')`),
]);

export const insertProjectUpdateSchema = createInsertSchema(projectUpdatesTable).omit({ id: true, createdAt: true });
export type InsertProjectUpdate = z.infer<typeof insertProjectUpdateSchema>;
export type ProjectUpdate = typeof projectUpdatesTable.$inferSelect;
export type ProjectUpdateEmail = typeof projectUpdateEmailsTable.$inferSelect;

/** Update-email preference events: on by default; latest wins; "off" stops emails. */
export const projectUpdateEmailEventsTable = pgTable("project_update_email_events", {
  id: serial("id").primaryKey(),
  investorId: integer("investor_id").notNull().references(() => investorsTable.id, { onDelete: "cascade" }),
  allowed: boolean("allowed").notNull(),
  source: text("source").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("project_update_email_events_investor_idx").on(table.investorId, table.recordedAt),
  check("project_update_email_events_source_check", sql`${table.source} in ('email_link', 'lineup')`),
]);
export type ProjectUpdateEmailEvent = typeof projectUpdateEmailEventsTable.$inferSelect;
