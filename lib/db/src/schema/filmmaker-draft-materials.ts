import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { visitorsTable } from "./visitors";

export const filmmakerDraftMaterialsTable = pgTable("filmmaker_draft_materials", {
  visitorId: text("visitor_id").primaryKey().references(() => visitorsTable.visitorId, { onDelete: "cascade" }),
  synopsis: text("synopsis"),
  trailerUrl: text("trailer_url"),
  bunnyVideoId: text("bunny_video_id"),
  posterUrl: text("poster_url"),
  posterStoragePath: text("poster_storage_path"),
  shareImageUrl: text("share_image_url"),
  shareImageStoragePath: text("share_image_storage_path"),
  pitchDeckStoragePath: text("pitch_deck_storage_path"),
  pitchDeckName: text("pitch_deck_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("filmmaker_draft_materials_updated_at_idx").on(table.updatedAt),
]);

export const insertFilmmakerDraftMaterialsSchema = createInsertSchema(filmmakerDraftMaterialsTable).omit({
  updatedAt: true,
});
export type InsertFilmmakerDraftMaterials = z.infer<typeof insertFilmmakerDraftMaterialsSchema>;
export type FilmmakerDraftMaterials = typeof filmmakerDraftMaterialsTable.$inferSelect;