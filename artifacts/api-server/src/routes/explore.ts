import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { GetExploreQueryParams, GetExploreResponse } from "@workspace/api-zod";
import { resolveProtectedIdentity } from "../lib/filmmaker-auth";
import { CONFIRMED_BACKERS_SQL, publicBackers, type BackerRow } from "../lib/backer-visibility";

const router: IRouter = Router();

type ExploreRow = {
  budget: number | null;
  proposal: import("@workspace/db").Proposal | null;
  id: number;
  slug: string | null;
  title: string | null;
  logline: string | null;
  format: string | null;
  genre: string | null;
  stage: string | null;
  poster_url: string | null;
  pitch_deck_name: string | null;
  has_pitch_deck: boolean;
  offer_per_100: number | null;
  confirmed_pledge_total: number;
  is_owner: boolean;
  public_filmmaker_name: string | null;
  created_at: Date;
};

const VISITOR_COOKIE = "msi_visitor_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeImageUrl(value: string | null): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

router.get("/explore", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await resolveProtectedIdentity(req, res, false);
  if (res.headersSent) return;
  const query = GetExploreQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid explore filters." });
    return;
  }

  const cookieCandidate = req.cookies?.[VISITOR_COOKIE];
  const visitorId = typeof cookieCandidate === "string" && UUID.test(cookieCandidate) ? cookieCandidate : null;
  const { rows: projects } = await pool.query<ExploreRow>(`
    select p.id, p.slug, p.title, p.logline, p.format, p.genre, p.stage,
      p.poster_url, p.pitch_deck_name, (p.pitch_deck_storage_path is not null) as has_pitch_deck, p.public_filmmaker_name, p.budget, p.proposal,
      p.offer_per100 as offer_per_100, p.created_at,
      coalesce((
        ($1::text = 'firebase' and f.firebase_uid = $2)
        or ($1::text = 'replit' and f.replit_uid = $2)
        or ($3::text is not null and f.visitor_id = $3)
      ), false) as is_owner,
      coalesce((
        select sum(pl.amount)::float8 from pledges pl
        where pl.project_id = p.id and pl.confirmed = true
      ), 0)::float8 as confirmed_pledge_total
    from projects p left join filmmakers f on f.id = p.filmmaker_id
    where p.approved = true and p.showcase_requested = true and p.hidden = false
      and p.stage in ('idea', 'production', 'distribution')
  `, [identity?.provider ?? null, identity?.uid ?? null, visitorId]);

  const needle = query.data.search?.trim().toLocaleLowerCase() ?? "";
  const filtered = projects.filter((project) => {
    if (!project.slug || !project.title) return false;
    if (query.data.stage && project.stage !== query.data.stage) return false;
    if (query.data.genre && project.genre !== query.data.genre) return false;
    return !needle || [
      project.title,
      project.logline,
      project.format,
      project.genre,
      project.stage,
    ].some((field) => field?.toLocaleLowerCase().includes(needle));
  });

  const sort = query.data.sort?.toLowerCase();
  filtered.sort((a, b) => {
    if (sort === "offer" || sort === "offer_per_100") {
      return (b.offer_per_100 ?? 0) - (a.offer_per_100 ?? 0) || b.created_at.getTime() - a.created_at.getTime();
    }
    if (sort === "popular" || sort === "confirmed_pledges") {
      return b.confirmed_pledge_total - a.confirmed_pledge_total || b.created_at.getTime() - a.created_at.getTime();
    }
    if (sort === "title" || sort === "alphabetical") {
      return a.title!.localeCompare(b.title!);
    }
    return b.created_at.getTime() - a.created_at.getTime();
  });

  // Explore lists approved projects only, so opted-in names may show on every card.
  // Development amount only (never the private dates). Tolerates a not-yet-migrated table.
  const developmentAmounts = new Map<number, number | null>(filtered.length ? (await pool.query<{ project_id: number; development_amount: number | null }>(
    "select project_id, development_amount from project_money_dates where project_id = any($1::int[])",
    [filtered.map((project) => project.id)],
  ).catch(() => ({ rows: [] as { project_id: number; development_amount: number | null }[] }))).rows.map((row) => [row.project_id, row.development_amount]) : []);
  const backerRows = filtered.length
    ? (await pool.query<BackerRow>(CONFIRMED_BACKERS_SQL, [filtered.map((project) => project.id)])).rows : [];
  const response = {
    projects: filtered.map((project) => ({
      id: project.id,
      slug: project.slug!,
      title: project.title!,
      logline: project.logline,
      format: project.format,
      genre: project.genre,
      stage: project.stage,
      poster_url: safeImageUrl(project.poster_url),
      pitch_deck_url: project.has_pitch_deck ? `/api/projects/${encodeURIComponent(project.slug!)}/pitch-deck` : null,
      pitch_deck_name: project.has_pitch_deck ? project.pitch_deck_name : null,
      offer_per_100: project.offer_per_100,
      budget: project.budget,
      development_amount: developmentAmounts.get(project.id) ?? null,
      proposal: project.proposal,
      confirmed_pledge_total: Number(project.confirmed_pledge_total),
      is_owner: project.is_owner,
      // Only the credit the filmmaker chose to publish; never private contact names.
      public_filmmaker_name: project.public_filmmaker_name?.trim() || null,
      public_backers: publicBackers(backerRows.filter((row) => row.project_id === project.id)),
    })),
  };
  res.json(GetExploreResponse.parse(response));
});

export default router;