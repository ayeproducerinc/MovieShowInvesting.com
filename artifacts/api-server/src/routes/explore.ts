import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { GetExploreQueryParams, GetExploreResponse } from "@workspace/api-zod";
import { resolveProtectedIdentity } from "../lib/filmmaker-auth";

const router: IRouter = Router();

type ExploreRow = {
  id: number;
  slug: string | null;
  title: string | null;
  logline: string | null;
  format: string | null;
  genre: string | null;
  stage: string | null;
  poster_url: string | null;
  offer_per_100: number | null;
  confirmed_pledge_total: number;
  is_owner: boolean;
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
      p.poster_url, p.offer_per100 as offer_per_100, p.created_at,
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
      offer_per_100: project.offer_per_100,
      confirmed_pledge_total: Number(project.confirmed_pledge_total),
      is_owner: project.is_owner,
    })),
  };
  res.json(GetExploreResponse.parse(response));
});

export default router;