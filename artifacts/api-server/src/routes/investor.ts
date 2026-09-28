import cookieParser from "cookie-parser";
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  GetCurrentInvestorIntentResponse,
  MatchInvestorBody,
  MatchInvestorResponse,
  SaveInvestorIntentBody,
  SaveInvestorIntentResponse,
} from "@workspace/api-zod";
import { FirebaseConfigurationError, verifyFirebaseIdToken } from "../lib/firebase-admin";

const router: IRouter = Router();
router.use(cookieParser());

const VISITOR_COOKIE = "msi_visitor_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLATES = ["distribution", "production", "idea"] as const;
type Slate = typeof SLATES[number];
type Minimums = Record<Slate, number | null>;
type InvestorIdentity = { uid: string; email: string };
type ProjectRow = {
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
};
type InvestorRow = {
  id: number;
  name: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  amount_choice: string | null;
  investment_amount: number | null;
  unallocated: boolean | null;
  accredited: string | null;
  experience: string[] | null;
  motivations: string[] | null;
  favorite_genres: string[] | null;
  stages: string[] | null;
  minima: Minimums | null;
  call_opt_in: boolean | null;
  firebase_uid: string | null;
  visitor_id: string | null;
};

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

async function authenticateInvestor(
  req: Request,
  res: Response,
  required: boolean,
): Promise<InvestorIdentity | null> {
  const authorization = req.get("authorization");
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) {
    if (authorization) res.status(401).json({ error: "A valid Firebase bearer token is required." });
    else if (required) res.status(401).json({ error: "A Firebase ID token is required." });
    return null;
  }
  try {
    const decoded = await verifyFirebaseIdToken(token);
    if (decoded.email_verified !== true || typeof decoded.email !== "string" || !decoded.uid) {
      res.status(403).json({ error: "A verified Firebase email is required." });
      return null;
    }
    return { uid: decoded.uid, email: decoded.email.trim().toLowerCase() };
  } catch (error) {
    if (error instanceof FirebaseConfigurationError) {
      res.status(503).json({ error: error.message });
      return null;
    }
    req.log.warn({ error: error instanceof Error ? error.message : "Authentication failed." }, "Firebase investor token verification failed");
    res.status(401).json({ error: "The Firebase ID token is invalid or expired." });
    return null;
  }
}

async function getDiscoverableProjects(): Promise<ProjectRow[]> {
  const { rows } = await pool.query<ProjectRow>(`
    select p.id, p.slug, p.title, p.logline, p.format, p.genre, p.stage,
      p.poster_url, p.offer_per100 as offer_per_100,
      coalesce((
        select sum(pl.amount)::float8 from pledges pl
        where pl.project_id = p.id and pl.confirmed = true
      ), 0)::float8 as confirmed_pledge_total
    from projects p
    where p.approved = true and p.showcase_requested = true and p.hidden = false
      and p.stage in ('idea', 'production', 'distribution')
  `);
  return rows;
}

function projectCard(project: ProjectRow) {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    logline: project.logline,
    format: project.format,
    genre: project.genre,
    stage: project.stage,
    poster_url: safeImageUrl(project.poster_url),
    offer_per_100: project.offer_per_100,
    confirmed_pledge_total: Number(project.confirmed_pledge_total),
  };
}

router.post("/investor/matches", async (req, res): Promise<void> => {
  const parsed = MatchInvestorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid investor matching input." });
    return;
  }
  const { favorite_genres: genres, stages, minima } = parsed.data;
  const candidates = await getDiscoverableProjects();
  const matches = candidates.filter((project) => {
    if (!project.stage || !["distribution", "production", "idea"].includes(project.stage)) return false;
    if (!project.genre || !genres.includes(project.genre) || !stages.includes(project.stage)) return false;
    const minimum = minima[project.stage as Slate];
    return minimum !== null && project.offer_per_100 !== null && project.offer_per_100 >= minimum;
  }).filter((project) => project.slug !== null && project.title !== null).map(projectCard);

  res.json(MatchInvestorResponse.parse({ projects: matches }));
});

router.post("/investor/intents", async (req, res): Promise<void> => {
  const parsed = SaveInvestorIntentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid investor intent input." });
    return;
  }
  const identity = await authenticateInvestor(req, res, false);
  if (req.get("authorization") && !identity) return;
  const data = parsed.data;
  const email = data.email.trim().toLowerCase();
  if (identity && identity.email !== email) {
    res.status(403).json({ error: "The submitted email must match the verified Firebase account." });
    return;
  }

  const cookieCandidate = req.cookies?.[VISITOR_COOKIE];
  let visitorId = typeof cookieCandidate === "string" && UUID.test(cookieCandidate) ? cookieCandidate : null;
  if (!visitorId && !identity) {
    res.status(400).json({ error: "A recorded visitor cookie or verified Firebase account is required." });
    return;
  }
  if (visitorId) {
    const { rows } = await pool.query<{ visitor_id: string }>(
      "select visitor_id from visitors where visitor_id = $1",
      [visitorId],
    );
    if (!rows.length) {
      if (!identity) {
        res.status(400).json({ error: "The visitor cookie is not associated with a recorded visitor." });
        return;
      }
      visitorId = null;
    }
  }

  const allocations = data.allocations;
  const allocationSum = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  if (data.amount < 100) {
    res.status(400).json({ error: "The total intent must be at least $100." });
    return;
  }
  if (allocations.some((allocation) => allocation.amount < 25)) {
    res.status(400).json({ error: "Each project allocation must be at least $25." });
    return;
  }
  if (allocations.length > (data.amount < 150 ? 4 : 5)) {
    res.status(400).json({ error: "A total below $150 can include at most 4 projects; $150 or more can include at most 5." });
    return;
  }
  if (new Set(allocations.map((allocation) => allocation.project_id)).size !== allocations.length) {
    res.status(400).json({ error: "A project may appear only once in the allocations." });
    return;
  }
  if (allocationSum > data.amount || (!data.unallocated && allocationSum !== data.amount)
    || (data.unallocated && allocationSum === data.amount)) {
    res.status(400).json({ error: "Project allocations and the unallocated balance must exactly equal the total intent." });
    return;
  }

  const minimums: Minimums = {
    distribution: data.minima.distribution,
    production: data.minima.production,
    idea: data.minima.idea,
  };
  const client = await pool.connect();
  let investorId: number | null = null;
  let conflict: string | null = null;
  try {
    await client.query("begin");
    const lockKeys = [
      `investor:email:${email}`,
      ...(visitorId ? [`investor:visitor:${visitorId}`] : []),
      ...(identity ? [`investor:firebase:${identity.uid}`] : []),
    ].sort();
    for (const lockKey of lockKeys) {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
    }
    if (allocations.length) {
      const ids = allocations.map((allocation) => allocation.project_id);
      const visible = await client.query<{ id: number }>(
        `select id from projects where id = any($1::int[])
          and approved = true and showcase_requested = true and hidden = false
          and stage in ('idea', 'production', 'distribution')
          for share`,
        [ids],
      );
      if (visible.rows.length !== ids.length) {
        await client.query("rollback");
        res.status(400).json({ error: "Every allocated project must be approved, visible, and available for showcase." });
        return;
      }
    }

    const matchingInvestors = await client.query<InvestorRow>(
      "select * from investors where lower(trim(email)) = $1 for update",
      [email],
    );
    const emailOwner = matchingInvestors.rows[0];
    let uidOwner: InvestorRow | undefined;
    if (identity) {
      const uidMatches = await client.query<InvestorRow>(
        "select * from investors where firebase_uid = $1 order by id limit 2 for update",
        [identity.uid],
      );
      if (uidMatches.rows.length > 1) {
        conflict = "This Firebase account has conflicting investor records and cannot be safely updated.";
      } else {
        uidOwner = uidMatches.rows[0];
        if (uidOwner && uidOwner.email?.trim().toLowerCase() !== email) {
          conflict = "This Firebase account already has an investor intent with a different email.";
        }
      }
    }
    let visitorOwner: InvestorRow | undefined;
    if (visitorId) {
      const visitorMatches = await client.query<InvestorRow>(
        "select * from investors where visitor_id = $1 order by id limit 2 for update",
        [visitorId],
      );
      if (visitorMatches.rows.length > 1) {
        conflict = "This visitor has conflicting investor records and cannot be safely updated.";
      } else {
        visitorOwner = visitorMatches.rows[0];
      }
    }
    const existing = emailOwner ?? uidOwner;
    if (matchingInvestors.rows.length > 1) {
      conflict = "This email has conflicting investor records and cannot be safely updated.";
    } else if (emailOwner?.firebase_uid) {
      if (!identity || emailOwner.firebase_uid !== identity.uid) {
        conflict = "This email is already associated with a different investor identity.";
      }
    } else if (emailOwner && !identity && (!visitorId || emailOwner.visitor_id !== visitorId)) {
      conflict = "This email is already associated with a different investor identity.";
    }
    if (uidOwner && existing && uidOwner.id !== existing.id) {
      conflict = "This Firebase account and email belong to different investor records.";
    }
    if (visitorOwner && existing && visitorOwner.id !== existing.id) {
      conflict = "This visitor is already associated with a different investor intent.";
    }
    if (visitorOwner?.firebase_uid && (!identity || visitorOwner.firebase_uid !== identity.uid)) {
      conflict = "This visitor is linked to a different Firebase account.";
    }
    if (visitorOwner && !identity && visitorOwner.email?.trim().toLowerCase() !== email) {
      conflict = "This visitor already has an investor intent with a different email.";
    }

    if (conflict) {
      await client.query("rollback");
    } else {
      const values = [
        data.name.trim(),
        email,
        data.city ?? null,
        data.state ?? null,
        data.zip ?? null,
        String(data.amount),
        data.amount,
        data.unallocated,
        data.accredited ? "yes" : "no",
        data.experience,
        data.experience.includes("other") ? "other" : null,
        data.motivations,
        data.motivations.includes("other") ? "other" : null,
        data.favorite_genres,
        data.stages,
        JSON.stringify(minimums),
        data.call_opt_in,
        existing?.firebase_uid ?? identity?.uid ?? null,
        existing?.visitor_id ?? visitorId,
      ];
      if (existing) {
        investorId = existing.id;
        await client.query(`
          update investors set
            name = $1, email = $2, city = $3, state = $4, zip = $5,
            amount_choice = $6, investment_amount = $7, unallocated = $8,
            accredited = $9, experience = $10, experience_other = $11,
            motivations = $12, motivations_other = $13, favorite_genres = $14,
            stages = $15, minima = $16::jsonb, call_opt_in = $17,
            firebase_uid = $18, visitor_id = $19
          where id = $20
        `, [...values, investorId]);
      } else {
        const inserted = await client.query<{ id: number }>(`
          insert into investors (
            name, email, city, state, zip, amount_choice, investment_amount,
            unallocated, accredited, experience, experience_other, motivations,
            motivations_other, favorite_genres, stages, minima, call_opt_in,
            firebase_uid, visitor_id
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            $15, $16::jsonb, $17, $18, $19
          ) returning id
        `, values);
        investorId = inserted.rows[0].id;
      }

      await client.query("delete from pledges where investor_id = $1 and confirmed = false", [investorId]);
      for (const allocation of allocations) {
        await client.query(
          "insert into pledges (investor_id, project_id, amount, confirmed) values ($1, $2, $3, false)",
          [investorId, allocation.project_id, allocation.amount],
        );
      }

      for (const slate of SLATES) {
        const minimum = minimums[slate];
        const legacyAcceptsValue = minimum === null || [125, 150, 175, 200].includes(minimum) || minimum >= 250;
        const prior = await client.query<{ id: number }>(
          "select id from investor_minimums where investor_id = $1 and slate = $2",
          [investorId, slate],
        );
        if (!legacyAcceptsValue) {
          if (prior.rows[0]) await client.query("delete from investor_minimums where id = $1", [prior.rows[0].id]);
          continue;
        }
        if (prior.rows[0]) {
          await client.query(
            "update investor_minimums set min_per100 = $1, not_interested = $2 where id = $3",
            [minimum, minimum === null, prior.rows[0].id],
          );
        } else {
          await client.query(
            "insert into investor_minimums (investor_id, slate, min_per100, not_interested) values ($1, $2, $3, $4)",
            [investorId, slate, minimum, minimum === null],
          );
        }
      }
      await client.query("commit");
    }
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  if (conflict) {
    res.status(409).json({ error: conflict });
    return;
  }
  res.status(201).json(SaveInvestorIntentResponse.parse({
    investor_id: investorId,
    status: "saved",
  }));
});

router.get("/investor/intents/current", async (req, res): Promise<void> => {
  const identity = await authenticateInvestor(req, res, false);
  if (req.get("authorization") && !identity) return;
  const cookieCandidate = req.cookies?.[VISITOR_COOKIE];
  const visitorId = typeof cookieCandidate === "string" && UUID.test(cookieCandidate) ? cookieCandidate : null;

  let investor: InvestorRow | undefined;
  if (identity) {
    const { rows } = await pool.query<InvestorRow>(
      "select * from investors where firebase_uid = $1 order by id limit 1",
      [identity.uid],
    );
    investor = rows[0];
    if (investor && investor.email?.trim().toLowerCase() !== identity.email) {
      res.status(403).json({ error: "This investor intent is not associated with the verified Firebase email." });
      return;
    }
  } else if (visitorId) {
    // Linked investor records are never accessible through a guest cookie,
    // including the visitor cookie originally used before account linking.
    const { rows } = await pool.query<InvestorRow>(
      "select * from investors where visitor_id = $1 and firebase_uid is null order by id limit 1",
      [visitorId],
    );
    investor = rows[0];
  }
  if (!investor) {
    res.json(GetCurrentInvestorIntentResponse.parse({ intent: null }));
    return;
  }

  const { rows: pendingAllocations } = await pool.query<{ project_id: number | null; amount: number }>(
    "select project_id, amount from pledges where investor_id = $1 and confirmed = false order by id",
    [investor.id],
  );
  const intent = {
    investor_id: investor.id,
    name: investor.name ?? "",
    email: investor.email ?? "",
    amount: investor.investment_amount ?? Number.parseInt(investor.amount_choice ?? "0", 10),
    allocations: pendingAllocations
      .filter((allocation): allocation is { project_id: number; amount: number } => allocation.project_id !== null)
      .map((allocation) => ({ project_id: allocation.project_id, amount: allocation.amount })),
    unallocated: investor.unallocated ?? false,
    accredited: investor.accredited === "yes",
    experience: investor.experience ?? [],
    motivations: investor.motivations ?? [],
    favorite_genres: investor.favorite_genres ?? [],
    stages: investor.stages ?? [],
    minima: investor.minima ?? { distribution: null, production: null, idea: null },
    call_opt_in: investor.call_opt_in ?? false,
    city: investor.city,
    state: investor.state,
    zip: investor.zip,
  };
  res.json(GetCurrentInvestorIntentResponse.parse({ intent }));
});

export default router;