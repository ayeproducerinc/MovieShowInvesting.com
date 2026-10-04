import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const referralMembersTable = pgTable("referral_members", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  uid: text("uid").notNull(),
  email: text("email").notNull().unique(),
  code: text("code").notNull().unique(),
  accountCreatedAt: timestamp("account_created_at", { withTimezone: true }).notNull(),
  referredBy: text("referred_by"),
  attributionAt: timestamp("attribution_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("referral_members_referrer_idx").on(table.referredBy)]);
export const insertReferralMemberSchema = createInsertSchema(referralMembersTable).omit({ createdAt: true });
export type InsertReferralMember = z.infer<typeof insertReferralMemberSchema>;
export type ReferralMemberRecord = typeof referralMembersTable.$inferSelect;