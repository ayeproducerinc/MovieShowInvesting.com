import { drizzle } from "drizzle-orm/node-postgres";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import { flowProgressTable, visitorsTable, type FlowProgressRecord } from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";

export async function ensureVisitor(visitorId: string): Promise<void> {
  await db.insert(visitorsTable).values({ visitorId }).onConflictDoNothing();
}

export async function recordVisitorAttribution(input: {
  visitorId: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  refCodeUsed: string | null;
}): Promise<void> {
  await db.insert(visitorsTable).values(input).onConflictDoUpdate({
    target: visitorsTable.visitorId,
    set: {
      utmSource: sql`coalesce(${visitorsTable.utmSource}, excluded.utm_source)`,
      utmMedium: sql`coalesce(${visitorsTable.utmMedium}, excluded.utm_medium)`,
      utmCampaign: sql`coalesce(${visitorsTable.utmCampaign}, excluded.utm_campaign)`,
      refCodeUsed: sql`coalesce(${visitorsTable.refCodeUsed}, excluded.ref_code_used)`,
    },
  });
}

export async function getFilmmakerCount(): Promise<number> {
  const [result] = await db.select({ total: count() }).from(schema.filmmakersTable);
  return result.total;
}

export async function readVisitorPriceGroup(visitorId: string): Promise<"A" | "B" | null> {
  const [visitor] = await db.select({ priceGroup: visitorsTable.priceGroup })
    .from(visitorsTable)
    .where(eq(visitorsTable.visitorId, visitorId));
  return visitor?.priceGroup === "A" || visitor?.priceGroup === "B" ? visitor.priceGroup : null;
}

export async function assignVisitorPriceGroup(visitorId: string, group: "A" | "B"): Promise<"A" | "B" | null> {
  const [assigned] = await db.update(visitorsTable)
    .set({ priceGroup: group })
    .where(and(eq(visitorsTable.visitorId, visitorId), isNull(visitorsTable.priceGroup)))
    .returning({ priceGroup: visitorsTable.priceGroup });
  return assigned?.priceGroup === "A" || assigned?.priceGroup === "B" ? assigned.priceGroup : null;
}

export async function findVisitorFlowProgress(visitorId: string, flow: "filmmaker" | "investor"): Promise<FlowProgressRecord | undefined> {
  const [record] = await db.select().from(flowProgressTable).where(and(
    eq(flowProgressTable.visitorId, visitorId),
    eq(flowProgressTable.flow, flow),
  ));
  return record;
}

export async function visitorExists(visitorId: string): Promise<boolean> {
  const [visitor] = await db.select({ visitorId: visitorsTable.visitorId })
    .from(visitorsTable)
    .where(eq(visitorsTable.visitorId, visitorId));
  return Boolean(visitor);
}

export async function saveVisitorFlowProgress(input: {
  visitorId: string;
  flow: "filmmaker" | "investor";
  lastScreen: number;
  answers: Record<string, unknown>;
  completed: boolean;
}): Promise<FlowProgressRecord> {
  const [record] = await db.insert(flowProgressTable).values(input).onConflictDoUpdate({
    target: [flowProgressTable.visitorId, flowProgressTable.flow],
    set: {
      lastScreen: input.lastScreen,
      answers: input.answers,
      completed: input.completed,
      updatedAt: new Date(),
    },
  }).returning();
  return record;
}

export async function updateProjectReview(
  projectId: number,
  changes: { approved?: boolean; hidden?: boolean },
): Promise<{ id: number; approved: boolean; hidden: boolean } | undefined> {
  const [project] = await db.update(schema.projectsTable)
    .set(changes)
    .where(eq(schema.projectsTable.id, projectId))
    .returning({
      id: schema.projectsTable.id,
      approved: schema.projectsTable.approved,
      hidden: schema.projectsTable.hidden,
    });
  return project;
}

export async function updateMessageVisibility(
  messageId: number,
  hidden: boolean,
): Promise<{ id: number; hidden: boolean } | undefined> {
  const [message] = await db.update(schema.messagesTable)
    .set({ hidden })
    .where(eq(schema.messagesTable.id, messageId))
    .returning({
      id: schema.messagesTable.id,
      hidden: schema.messagesTable.hidden,
    });
  return message;
}
