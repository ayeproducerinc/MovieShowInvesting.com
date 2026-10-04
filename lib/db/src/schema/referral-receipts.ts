import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { referralMembersTable } from "./referral-members";

export const referralReceiptsTable = pgTable("referral_receipts", {
  tokenHash: text("token_hash").primaryKey(),
  referrerId: text("referrer_id").notNull().references(() => referralMembersTable.id),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedBy: text("consumed_by"),
}, table => [index("referral_receipts_expiry_idx").on(table.expiresAt)]);
export const insertReferralReceiptSchema = createInsertSchema(referralReceiptsTable);
export type InsertReferralReceipt = z.infer<typeof insertReferralReceiptSchema>;