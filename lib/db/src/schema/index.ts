export * from "./age-confirmations";
// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

export * from "./visitors";
export * from "./filmmakers";
export * from "./filmmaker-activity";
export * from "./projects";
export * from "./test-project-archive";
export * from "./test-followup-archive";
export * from "./referral-members";
export * from "./referral-receipts";
export * from "./referral-rewards";
export * from "./pitch-review-checkouts";
export * from "./investors";
export * from "./pledges";
export * from "./interest-entries";
export * from "./interest-alerts";
export * from "./investor-minimums";
export * from "./messages";
export * from "./flow-progress";
export * from "./investor-account-progress";
export * from "./email-log";
export * from "./filmmaker-account-visitors";
export * from "./question-ip-attempts";
export * from "./filmmaker-submission-attempts";
export * from "./filmmaker-draft-materials";
export * from "./conversations";
export * from "./auth";
export * from "./investor-notifications";