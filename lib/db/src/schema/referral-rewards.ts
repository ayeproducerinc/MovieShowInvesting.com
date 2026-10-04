import { sql } from "drizzle-orm";
import { pgTable, text, integer, serial, timestamp, boolean, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { referralMembersTable } from "./referral-members";

// Project/session identifiers are retained historical references, not cascading FKs.
export const referralRewardsTable = pgTable("referral_rewards", {
  id: serial("id").primaryKey(),
  referredId: text("referred_id").notNull().unique().references(() => referralMembersTable.id),
  referrerId: text("referrer_id").notNull().references(() => referralMembersTable.id),
  projectId: integer("project_id").notNull(),
  projectTitle: text("project_title"),
  sessionId: text("session_id").notNull().unique(),
  amountCents: integer("amount_cents").notNull().default(1000),
  paymentStatus: text("payment_status").notNull().default("valid"),
  paymentCheckedAt: timestamp("payment_checked_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  payoutReference: text("payout_reference").unique(),
  paidBy: text("paid_by"),
  reviewFlag: boolean("review_flag").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("referral_reward_amount_check", sql`${table.amountCents} = 1000`),
  check("referral_reward_payment_status_check", sql`${table.paymentStatus} in ('valid','refunded','disputed','unverified')`),
  check("referral_reward_payout_check", sql`(${table.paidAt} is null and ${table.payoutReference} is null and ${table.paidBy} is null) or (${table.paidAt} is not null and ${table.payoutReference} is not null and ${table.paidBy} is not null)`),
]);
export const insertReferralRewardSchema = createInsertSchema(referralRewardsTable).omit({ id: true, createdAt: true });
export type InsertReferralReward = z.infer<typeof insertReferralRewardSchema>;