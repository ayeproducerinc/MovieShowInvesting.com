import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import cookieParser from "cookie-parser";
import { getFilmmakerCount, recordVisitorAttribution } from "@workspace/db";
import {
  GetFirebaseConfigResponse,
  GetSiteStatsResponse,
  RecordVisitBody,
  RecordVisitResponse,
} from "@workspace/api-zod";
import { getFirebaseWebConfig } from "../lib/firebase-web-config";

const router: IRouter = Router();
router.use(cookieParser());

const VISITOR_COOKIE = "msi_visitor_id";
const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/stats", async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const filmmakers = await getFilmmakerCount();
  res.json(GetSiteStatsResponse.parse({ filmmakers }));
});

router.get("/config", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  try {
    const config = await getFirebaseWebConfig();
    res.json(GetFirebaseConfigResponse.parse(config));
  } catch (error) {
    req.log.error({ error: error instanceof Error ? error.message : "Unknown Firebase configuration error" }, "Firebase web configuration unavailable");
    res.status(503).json({ error: "Firebase web configuration could not be loaded from the project's web app." });
  }
});

router.post("/visit", async (req, res): Promise<void> => {
  const parsed = RecordVisitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid visitor attribution." });
    return;
  }

  const candidate = req.cookies?.[VISITOR_COOKIE];
  const visitorId = typeof candidate === "string" && UUID.test(candidate) ? candidate : randomUUID();
  const { utm_source, utm_medium, utm_campaign, ref } = parsed.data;
  await recordVisitorAttribution({
    visitorId,
    utmSource: utm_source || null,
    utmMedium: utm_medium || null,
    utmCampaign: utm_campaign || null,
    refCodeUsed: ref || null,
  });

  res.cookie(VISITOR_COOKIE, visitorId, {
    maxAge: ONE_YEAR,
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    path: "/",
  });
  res.json(RecordVisitResponse.parse({ visitor_id: visitorId }));
});

export default router;