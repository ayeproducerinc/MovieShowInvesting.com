import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const replitAuthUsersTable = pgTable(
  "replit_auth_users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    profileImageUrl: text("profile_image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("replit_auth_users_issuer_subject_idx").on(table.issuer, table.subject),
  ],
);

export const sessionsTable = pgTable(
  "sessions",
  {
    sid: text("sid").primaryKey(),
    sess: jsonb("sess").$type<{ user: AuthSessionUser }>().notNull(),
    expire: timestamp("expire", { withTimezone: true }).notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export interface AuthSessionUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

export type ReplitAuthUser = typeof replitAuthUsersTable.$inferSelect;