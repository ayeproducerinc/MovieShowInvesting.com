import { Router, type IRouter, type Request } from "express";
import { getPublicProjectBySlug } from "@workspace/db";
import {
  GetProjectShareMetadataParams,
  GetProjectShareMetadataResponse,
  GetPublicProjectParams,
  GetPublicProjectResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const thumbnailCache = new Map<string, { expiresAt: number; url: string | null }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 100;
const DEFAULT_SHARE_IMAGE = "/film-frame.jpg";

function safeWebUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function videoIdentity(value: string): { provider: "youtube" | "vimeo"; id: string } | null {
  const safeUrl = safeWebUrl(value);
  if (!safeUrl) return null;
  const url = new URL(safeUrl);
  const hostname = url.hostname.toLowerCase();
  if (hostname === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? { provider: "youtube", id } : null;
  }
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(hostname)) {
    const id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})/)?.[1];
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? { provider: "youtube", id } : null;
  }
  if (hostname === "vimeo.com" || hostname === "www.vimeo.com" || hostname === "player.vimeo.com") {
    const id = url.pathname.match(/\/(?:video\/)?([0-9]{1,12})\/?$/)?.[1];
    return id ? { provider: "vimeo", id } : null;
  }
  return null;
}

function cacheThumbnail(key: string, url: string | null): void {
  if (thumbnailCache.size >= CACHE_LIMIT) {
    const oldest = thumbnailCache.keys().next().value;
    if (oldest !== undefined) thumbnailCache.delete(oldest);
  }
  thumbnailCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, url });
}

async function trailerThumbnail(value: string | null): Promise<string | null> {
  if (!value) return null;
  const identity = videoIdentity(value);
  if (!identity) return null;
  const key = `${identity.provider}:${identity.id}`;
  const cached = thumbnailCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  if (identity.provider === "youtube") {
    const result = `https://i.ytimg.com/vi/${identity.id}/hqdefault.jpg`;
    cacheThumbnail(key, result);
    return result;
  }
  try {
    const sourceUrl = `https://vimeo.com/${identity.id}`;
    const response = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(sourceUrl)}`, {
      signal: AbortSignal.timeout(2500),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      cacheThumbnail(key, null);
      return null;
    }
    const payload: unknown = await response.json();
    if (payload === null || typeof payload !== "object" || !("thumbnail_url" in payload)
      || typeof payload.thumbnail_url !== "string") {
      cacheThumbnail(key, null);
      return null;
    }
    const thumbnail = safeWebUrl(payload.thumbnail_url);
    const url = thumbnail && new URL(thumbnail).hostname.toLowerCase() === "i.vimeocdn.com"
      ? thumbnail
      : null;
    cacheThumbnail(key, url);
    return url;
  } catch {
    cacheThumbnail(key, null);
    return null;
  }
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function getPublicOrigin(req: Request): string | null {
  const configured = process.env.PUBLIC_APP_URL;
  if (configured) {
    const parsed = safeWebUrl(configured);
    if (parsed) return new URL(parsed).origin;
  }
  const host = req.get("host");
  if (!host || !/^[a-z0-9.[\]:-]+$/i.test(host)) return null;
  try {
    const parsed = new URL(`${req.protocol}://${host}`);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

router.get("/projects/:slug", async (req, res): Promise<void> => {
  const params = GetPublicProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project slug." });
    return;
  }
  const project = await getPublicProjectBySlug(params.data.slug);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const response = {
    id: project.id,
    slug: project.slug,
    title: project.title,
    format: project.format,
    genre: project.genre,
    stage: project.stage,
    logline: project.logline,
    synopsis: project.synopsis,
    team_links: Array.isArray(project.teamLinks)
      ? project.teamLinks.filter((link): link is string => typeof link === "string").map(safeWebUrl).filter((link): link is string => link !== null)
      : [],
    money_use: project.moneyUse,
    distribution_plan: project.distributionPlan,
    trailer_url: safeWebUrl(project.trailerUrl),
    trailer_thumbnail_url: await trailerThumbnail(project.trailerUrl),
    poster_url: safeWebUrl(project.posterUrl),
    confirmed_pledge_total: project.confirmedPledgeTotal,
    approved: project.approved,
    showcase_requested: project.showcaseRequested,
    phone_verified: project.phoneVerified,
  };
  res.json(GetPublicProjectResponse.parse(response));
});

router.get("/projects/:slug/share", async (req, res): Promise<void> => {
  const params = GetProjectShareMetadataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).type("text/plain").send("Invalid project slug.");
    return;
  }
  const project = await getPublicProjectBySlug(params.data.slug);
  if (!project) {
    res.status(404).type("text/plain").send("Project not found.");
    return;
  }
  const origin = getPublicOrigin(req);
  if (!origin) {
    res.status(503).type("text/plain").send("Project sharing is temporarily unavailable.");
    return;
  }
  const browserUrl = `${origin}/project/${encodeURIComponent(project.slug)}`;
  const image = safeWebUrl(project.shareImageUrl) ?? safeWebUrl(project.posterUrl)
    ?? `${origin}${DEFAULT_SHARE_IMAGE}`;
  const description = (project.synopsis ?? project.logline ?? "Discover this independent film project.")
    .replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300);
  const title = `${project.title} | Movie Show Investing`;
  const needsNoIndex = !project.approved || !project.showcaseRequested;
  const robotsMeta = needsNoIndex ? '<meta name="robots" content="noindex,nofollow">' : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${robotsMeta}<link rel="canonical" href="${htmlEscape(browserUrl)}"><meta name="description" content="${htmlEscape(description)}"><meta property="og:type" content="website"><meta property="og:title" content="${htmlEscape(title)}"><meta property="og:description" content="${htmlEscape(description)}"><meta property="og:image" content="${htmlEscape(image)}"><meta property="og:url" content="${htmlEscape(browserUrl)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${htmlEscape(title)}"><meta name="twitter:description" content="${htmlEscape(description)}"><meta name="twitter:image" content="${htmlEscape(image)}"><meta http-equiv="refresh" content="0;url=${htmlEscape(browserUrl)}"><title>${htmlEscape(title)}</title></head><body><p>Opening project page: <a href="${htmlEscape(browserUrl)}">${htmlEscape(project.title)}</a></p></body></html>`;
  if (needsNoIndex) res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.type("html").send(GetProjectShareMetadataResponse.parse(html));
});

export default router;