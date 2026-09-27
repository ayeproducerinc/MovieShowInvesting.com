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

const router: IRouter = Router();
router.use(cookieParser());

const VISITOR_COOKIE = "msi_visitor_id";
const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/stats", async (_req, res): Promise<void> => {
  const filmmakers = await getFilmmakerCount();
  res.json(GetSiteStatsResponse.parse({ filmmakers }));
});

router.get("/config", (_req, res): void => {
  const apiKey = process.env.FIREBASE_API_KEY;
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const appId = process.env.FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId || !appId) {
    res.status(503).json({ error: "Firebase web configuration has not been supplied." });
    return;
  }
  res.json(GetFirebaseConfigResponse.parse({ apiKey, authDomain, projectId, appId }));
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