import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  GetFilmmakerInterestAlertsResponse,
  ReadFilmmakerInterestAlertParams,
  ReadFilmmakerInterestAlertResponse,
} from "@workspace/api-zod";
import { resolveProtectedIdentity } from "../lib/filmmaker-auth";

const router: IRouter = Router();

type AlertRow = {
  id: number;
  project_id: number;
  project_title: string | null;
  project_slug: string | null;
  created_at: Date;
  read_at: Date | null;
};

function view(row: AlertRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    project_title: row.project_title,
    project_slug: row.project_slug,
    created_at: row.created_at.toISOString(),
    read_at: row.read_at?.toISOString() ?? null,
  };
}

router.get("/filmmakers/interest-alerts", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await resolveProtectedIdentity(req, res, true);
  if (!identity) return;
  const uidColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
  const { rows } = await pool.query<AlertRow>(
    `select a.id, a.project_id, p.title as project_title, p.slug as project_slug,
       a.created_at, a.read_at
     from interest_alerts a
     join projects p on p.id = a.project_id and p.filmmaker_id = a.filmmaker_id
     join filmmakers f on f.id = a.filmmaker_id
     where f.${uidColumn} = $1
     order by a.created_at desc, a.id desc`,
    [identity.uid],
  );
  res.json(GetFilmmakerInterestAlertsResponse.parse({ alerts: rows.map(view) }));
});

router.post("/filmmakers/interest-alerts/:alertId/read", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await resolveProtectedIdentity(req, res, true);
  if (!identity) return;
  const params = ReadFilmmakerInterestAlertParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid alert ID." });
    return;
  }
  const uidColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
  const { rows } = await pool.query<AlertRow>(
    `update interest_alerts a
     set read_at = coalesce(a.read_at, now())
     from projects p, filmmakers f
     where a.id = $1 and p.id = a.project_id and p.filmmaker_id = a.filmmaker_id
       and f.id = a.filmmaker_id and f.${uidColumn} = $2
     returning a.id, a.project_id, p.title as project_title, p.slug as project_slug,
       a.created_at, a.read_at`,
    [params.data.alertId, identity.uid],
  );
  if (!rows.length) {
    res.status(404).json({ error: "Alert not found for this account." });
    return;
  }
  res.json(ReadFilmmakerInterestAlertResponse.parse(view(rows[0])));
});

export default router;