import cookieParser from "cookie-parser";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  ConfirmInvestorIntentBody,
  ConfirmInvestorIntentResponse,
  ClaimInvestorIntentResponse,
  GetCurrentInvestorIntentResponse,
  MatchInvestorBody,
  MatchInvestorResponse,
  SaveInvestorIntentBody,
  SaveInvestorIntentResponse,
} from "@workspace/api-zod";
import { resolveProtectedIdentity } from "../lib/filmmaker-auth";
import { deliverInterestAlertEmail } from "../lib/interest-alert-email";
import { requireAccountAgeConfirmation } from "../lib/age-confirmation";
import { acceptsPledges, allocationLimitError } from "../lib/pledge-policy";
import { backerEvidence } from "../lib/backer-visibility";

const router: IRouter = Router();
router.use(cookieParser());

const VISITOR_COOKIE = "msi_visitor_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const SLATES = ["distribution", "production", "idea"] as const;
type Slate = typeof SLATES[number];
type Minimums = Record<Slate, number | null>;
type ProjectRow = {
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
};
type InvestorRow = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
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
  signature_name: string | null;
  signed_at: Date | null;
  confirmed_at: Date | null;
  firebase_uid: string | null;
  replit_uid: string | null;
  visitor_id: string | null;
};
type EntryRow = { id: number; name: string; amount: number; unallocated: boolean; signature_name: string | null; confirmed_at: Date | null };

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

async function getDiscoverableProjects(
  identity: Awaited<ReturnType<typeof resolveProtectedIdentity>>,
  visitorId: string | null,
): Promise<ProjectRow[]> {
  const { rows } = await pool.query<ProjectRow>(`
    select p.id, p.slug, p.title, p.logline, p.format, p.genre, p.stage,
      p.poster_url, p.pitch_deck_name, (p.pitch_deck_storage_path is not null) as has_pitch_deck, p.public_filmmaker_name,
      p.offer_per100 as offer_per_100, p.budget, p.proposal,
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
    pitch_deck_url: project.has_pitch_deck ? `/api/projects/${encodeURIComponent(project.slug!)}/pitch-deck` : null,
    pitch_deck_name: project.has_pitch_deck ? project.pitch_deck_name : null,
    offer_per_100: project.offer_per_100,
    budget: project.budget,
    proposal: project.proposal,
    confirmed_pledge_total: Number(project.confirmed_pledge_total),
    is_owner: project.is_owner,
    public_filmmaker_name: project.public_filmmaker_name?.trim() || null,
  };
}

router.post("/investor/matches", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await resolveProtectedIdentity(req, res, false);
  if (res.headersSent) return;
  const parsed = MatchInvestorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid investor matching input." });
    return;
  }
  const { favorite_genres: genres, stages, minima } = parsed.data;
  const cookieCandidate = req.cookies?.[VISITOR_COOKIE];
  const visitorId = typeof cookieCandidate === "string" && UUID.test(cookieCandidate) ? cookieCandidate : null;
  const candidates = await getDiscoverableProjects(identity, visitorId);
  const matches = candidates.filter((project) => {
    if (project.is_owner) return false;
    if (!project.stage || !["distribution", "production", "idea"].includes(project.stage)) return false;
    if (!project.genre || !genres.includes(project.genre) || !stages.includes(project.stage)) return false;
    const minimum = minima[project.stage as Slate];
    return minimum !== null && project.offer_per_100 !== null && project.offer_per_100 >= minimum;
  }).filter((project) => project.slug !== null && project.title !== null).map(projectCard);

  res.json(MatchInvestorResponse.parse({ projects: matches }));
});

router.post("/investor/intents", async (req, res): Promise<void> => {
  const rawBody: unknown = req.body;
  if (rawBody && typeof rawBody === "object") {
    const body = rawBody as { amount?: unknown; allocations?: unknown };
    if (typeof body.amount === "number" && Number.isInteger(body.amount) && body.amount > MAX_POSTGRES_INTEGER) {
      res.status(400).json({ error: "The total intent cannot exceed $2,147,483,647, the maximum amount supported by storage." });
      return;
    }
    if (Array.isArray(body.allocations) && body.allocations.some((allocation: unknown) =>
      allocation && typeof allocation === "object"
      && typeof (allocation as { amount?: unknown }).amount === "number"
      && Number.isInteger((allocation as { amount: number }).amount)
      && (allocation as { amount: number }).amount > MAX_POSTGRES_INTEGER
    )) {
      res.status(400).json({ error: "A project allocation cannot exceed $2,147,483,647, the maximum amount supported by storage." });
      return;
    }
  }
  const parsed = SaveInvestorIntentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid investor intent input." });
    return;
  }
  const identity = await resolveProtectedIdentity(req, res, true);
  if (!identity) return;
  const data = parsed.data;
  if (data.ground_rules_accepted !== true) {
    res.status(400).json({ error: "Acknowledge the ground rules in your worksheet before saving interest." });
    return;
  }
  if (!await requireAccountAgeConfirmation(identity, res)) return;
  const email = data.email.trim().toLowerCase();
  const actualOwner = identity ? `${identity.provider}:${identity.uid}` : "visitor";
  if (data.expected_investor_owner !== actualOwner) {
    res.status(409).json({ error: "The investor account changed while this worksheet was open. Reload before saving." });
    return;
  }
  if (identity && identity.email !== email) {
    res.status(403).json({ error: "The submitted email must match the verified account." });
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
  if (!Number.isSafeInteger(data.amount) || data.amount < 100 || data.amount > MAX_POSTGRES_INTEGER) {
    res.status(400).json({ error: "The total intent must be a whole-dollar amount from $100 to $2,147,483,647." });
    return;
  }
  if (allocations.some((allocation) =>
    !Number.isSafeInteger(allocation.amount) || allocation.amount > MAX_POSTGRES_INTEGER
  )) {
    res.status(400).json({ error: "Each project allocation must be a whole-dollar amount no greater than $2,147,483,647." });
    return;
  }
  const limitError = allocationLimitError(data.amount, allocations.map((allocation) => allocation.amount));
  if (limitError) {
    res.status(400).json({ error: limitError });
    return;
  }
  if (new Set(allocations.map((allocation) => allocation.project_id)).size !== allocations.length) {
    res.status(400).json({ error: "A project may appear only once in the allocations." });
    return;
  }
  if (!Number.isSafeInteger(allocationSum) || allocationSum > MAX_POSTGRES_INTEGER) {
    res.status(400).json({ error: "The sum of project allocations cannot exceed $2,147,483,647, the maximum amount supported by storage." });
    return;
  }
  if (data.unallocated && allocations.length !== 0) {
    res.status(400).json({ error: "Just pledge intents must have zero project allocations." });
    return;
  }
  if (!data.unallocated && allocationSum !== data.amount) {
    res.status(400).json({ error: "Allocated project amounts must exactly equal the total intent." });
    return;
  }

  const minimums: Minimums = {
    distribution: data.minima.distribution,
    production: data.minima.production,
    idea: data.minima.idea,
  };
  const client = await pool.connect();
  let investorId: number | null = null;
  let savedEntryId: number | null = null;
  let conflict: string | null = null;
  let conflictCode: string | null = null;
  try {
    await client.query("begin");
    const lockKeys = [
      `investor:email:${email}`,
      ...(visitorId ? [`investor:visitor:${visitorId}`] : []),
      ...(identity ? [`investor:${identity.provider}:${identity.uid}`] : []),
    ].sort();
    for (const lockKey of lockKeys) {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
    }
    if (allocations.length) {
      const ids = allocations.map((allocation) => allocation.project_id);
      // Open pledging: submitted and not hidden, approved or not.
      const candidates = await client.query<{ id: number; hidden: boolean; stage: string | null }>(
        "select id, hidden, stage from projects where id = any($1::int[]) for share",
        [ids],
      );
      if (candidates.rows.length !== ids.length || !candidates.rows.every(acceptsPledges)) {
        await client.query("rollback");
        res.status(400).json({ error: "Every project must be submitted and not hidden to receive pledges." });
        return;
      }
      const ownProjects = await client.query<{ id: number }>(`
        select p.id
        from projects p
        join filmmakers f on f.id = p.filmmaker_id
        where p.id = any($1::int[])
          and (
            ($2::text = 'firebase' and f.firebase_uid = $3)
            or ($2::text = 'replit' and f.replit_uid = $3)
            or ($4::text is not null and f.visitor_id = $4)
          )
        for share of f
      `, [ids, identity?.provider ?? null, identity?.uid ?? null, visitorId]);
      if (ownProjects.rows.length) {
        await client.query("rollback");
        res.status(400).json({ error: "You cannot allocate interest to your own project." });
        return;
      }
    }

    const matchingInvestors = await client.query<InvestorRow>(
      "select * from investors where lower(trim(email)) = $1 for update",
      [email],
    );
    let uidOwner: InvestorRow | undefined;
    if (identity) {
      const uidColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
      const uidMatches = await client.query<InvestorRow>(
        `select * from investors where ${uidColumn} = $1 order by id limit 2 for update`,
        [identity.uid],
      );
      if (uidMatches.rows.length > 1) {
        conflict = "This account has conflicting investor records and cannot be safely updated.";
      } else {
        uidOwner = uidMatches.rows[0];
        if (uidOwner && uidOwner.email?.trim().toLowerCase() !== email) {
          conflict = "This account already has an investor intent with a different email.";
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
    const sameAccount = (row: InvestorRow) => Boolean(identity && (
      identity.provider === "firebase" ? row.firebase_uid === identity.uid
        : row.replit_uid === identity.uid
    ));
    const guestRows = matchingInvestors.rows.filter(row => !row.firebase_uid && !row.replit_uid);
    const guestFromThisVisit = guestRows.find(row => visitorId && row.visitor_id === visitorId);
    const otherAccount = matchingInvestors.rows.find(row =>
      (row.firebase_uid || row.replit_uid) && !sameAccount(row));
    const startingFresh = data.start_fresh === true;
    let existing: InvestorRow | undefined;
    if (identity) {
      // A verified email never transfers the guest's answers. start_fresh
      // explicitly creates a separate account-owned record with no visitor ID.
      existing = uidOwner;
      if (otherAccount) {
        conflict = "This email is already associated with a different investor identity.";
      } else if (!uidOwner && !startingFresh && guestRows.length) {
        conflict = "This email has an unclaimed guest investor intent. Claim it from its original browser, or choose to start fresh with this account.";
        conflictCode = "guest_interest_conflict";
      } else if (startingFresh && !uidOwner && !guestRows.length) {
        conflict = "There is no unclaimed guest interest to start separately from.";
      } else if (!uidOwner && !startingFresh && visitorOwner && (!existing || visitorOwner.id !== existing.id)) {
        conflict = "This visitor is already associated with a different investor intent.";
      }
    } else {
      existing = guestFromThisVisit;
      if (startingFresh) {
        conflict = "Starting fresh requires a signed-in account.";
      } else if (visitorOwner && visitorOwner.email?.trim().toLowerCase() !== email) {
        conflict = "This visitor already has an investor intent with a different email.";
      } else if (!existing && matchingInvestors.rows.length) {
        conflict = "This email is already associated with a different investor identity.";
      } else if (visitorOwner && (visitorOwner.firebase_uid || visitorOwner.replit_uid)) {
        conflict = "This visitor is linked to a different account.";
      }
    }
    const adding = data.new_entry === true;
    if (adding && (!identity || !existing?.confirmed_at)) {
      conflict = "A separate entry requires an account with previously confirmed interest.";
    } else if (existing?.confirmed_at && !adding && !conflict) {
      conflict = "This investor interest has already been confirmed and cannot be replaced.";
    }

    if (conflict) {
      await client.query("rollback");
    } else {
      const values = [
        data.name.trim(),
        email,
        data.city.trim(),
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
        existing?.firebase_uid ?? (identity?.provider === "firebase" ? identity.uid : null),
        existing?.replit_uid ?? (identity?.provider === "replit" ? identity.uid : null),
        uidOwner ? uidOwner.visitor_id : existing?.visitor_id ?? (identity ? null : visitorId),
        data.phone?.trim() || null,
        data.country,
      ];
      if (adding && existing) {
        investorId = existing.id;
        const pending = await client.query<{ id: number }>(
          "select id from interest_entries where investor_id = $1 and confirmed_at is null for update", [investorId],
        );
        let entryId = pending.rows[0]?.id;
        if (entryId) {
          await client.query(
            "update interest_entries set name = $1, amount = $2, unallocated = $3 where id = $4",
            [data.name.trim(), data.amount, data.unallocated, entryId],
          );
          await client.query("delete from pledges where entry_id = $1 and confirmed = false", [entryId]);
        } else {
          const created = await client.query<{ id: number }>(
            "insert into interest_entries (investor_id, name, amount, unallocated) values ($1, $2, $3, $4) returning id",
            [investorId, data.name.trim(), data.amount, data.unallocated],
          );
          entryId = created.rows[0].id;
        }
        savedEntryId = entryId;
        for (const allocation of allocations) {
          await client.query(
            "insert into pledges (investor_id, entry_id, project_id, amount, confirmed) values ($1, $2, $3, $4, false)",
            [investorId, entryId, allocation.project_id, allocation.amount],
          );
        }
      } else if (existing) {
        investorId = existing.id;
        await client.query(`
          update investors set
            name = $1, email = $2, city = $3, state = $4, zip = $5,
            amount_choice = $6, investment_amount = $7, unallocated = $8,
            accredited = $9, experience = $10, experience_other = $11,
            motivations = $12, motivations_other = $13, favorite_genres = $14,
            stages = $15, minima = $16::jsonb, call_opt_in = $17,
            firebase_uid = $18, replit_uid = $19, visitor_id = $20,
            phone = $21, country = $22
          where id = $23
        `, [...values, investorId]);
      } else {
        const inserted = await client.query<{ id: number }>(`
          insert into investors (
            name, email, city, state, zip, amount_choice, investment_amount,
            unallocated, accredited, experience, experience_other, motivations,
            motivations_other, favorite_genres, stages, minima, call_opt_in,
            firebase_uid, replit_uid, visitor_id, phone, country
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            $15, $16::jsonb, $17, $18, $19, $20, $21, $22
          ) returning id
        `, values);
        investorId = inserted.rows[0].id;
      }

      // Which approved update's email led to this pledge, counted per update later.
      // Kept only for an approved update whose project is in this pledge.
      let sourceUpdateId: number | null = null;
      if (data.source_update_id && allocations.length) {
        const { rows: [table] } = await client.query<{ ok: boolean }>("select to_regclass('public.project_updates') is not null as ok");
        if (table?.ok) {
          const { rows: [source] } = await client.query<{ project_id: number }>(
            "select project_id from project_updates where id = $1 and status = 'approved'", [data.source_update_id],
          );
          if (source && allocations.some((allocation) => allocation.project_id === source.project_id)) sourceUpdateId = data.source_update_id;
        }
      }
      const { expected_investor_owner: _owner, source_update_id: _source, ...submittedQuestionnaire } = data;
      const snapshot = JSON.stringify({
        ...submittedQuestionnaire,
        ...(sourceUpdateId ? { source_update_id: sourceUpdateId } : {}),
        saved_at: new Date().toISOString(),
        verified_account_email: identity.email,
        ground_rules_version: "investor-ground-rules-v1",
      });
      if (adding) {
        await client.query("update interest_entries set submitted_answers = $1::jsonb where id = $2 and confirmed_at is null", [snapshot, savedEntryId]);
      } else {
        await client.query("update investors set submitted_answers = $1::jsonb where id = $2 and confirmed_at is null", [snapshot, investorId]);
      }
      if (!adding) {
        await client.query("delete from pledges where investor_id = $1 and entry_id is null and confirmed = false", [investorId]);
        for (const allocation of allocations) {
          await client.query(
            "insert into pledges (investor_id, project_id, amount, confirmed) values ($1, $2, $3, false)",
            [investorId, allocation.project_id, allocation.amount],
          );
        }
      }

      if (!adding) for (const slate of SLATES) {
        const minimum = minimums[slate];
        const prior = await client.query<{ id: number }>(
          "select id from investor_minimums where investor_id = $1 and slate = $2",
          [investorId, slate],
        );
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
    res.status(409).json({ error: conflict, ...(conflictCode ? { code: conflictCode } : {}) });
    return;
  }
  res.status(201).json(SaveInvestorIntentResponse.parse({
    investor_id: investorId,
    entry_id: savedEntryId,
    status: "saved",
  }));
});

router.get("/investor/intents/current", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await resolveProtectedIdentity(req, res, false);
  if (req.get("authorization") && !identity) return;
  const cookieCandidate = req.cookies?.[VISITOR_COOKIE];
  const visitorId = typeof cookieCandidate === "string" && UUID.test(cookieCandidate) ? cookieCandidate : null;

  let investor: InvestorRow | undefined;
  if (identity) {
    const uidColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
    const { rows } = await pool.query<InvestorRow>(
      `select * from investors where ${uidColumn} = $1 order by id`,
      [identity.uid],
    );
    if (rows.length > 1) {
      res.status(409).json({ error: "This account has multiple investor interest records and cannot be read safely." });
      return;
    }
    investor = rows[0];
    if (investor && investor.email?.trim().toLowerCase() !== identity.email) {
      res.status(403).json({ error: "This investor intent is not associated with the verified account email." });
      return;
    }
  } else if (visitorId) {
    // Linked investor records are never accessible through a guest cookie,
    // including the visitor cookie originally used before account linking.
    const { rows } = await pool.query<InvestorRow>(
      "select * from investors where visitor_id = $1 and firebase_uid is null and replit_uid is null order by id",
      [visitorId],
    );
    if (rows.length > 1) {
      res.status(409).json({ error: "This browser has multiple guest investor interest records and cannot be read safely." });
      return;
    }
    investor = rows[0];
  }
  if (!investor) {
    res.json(GetCurrentInvestorIntentResponse.parse({ intent: null, history: [] }));
    return;
  }

  const { rows: entries } = await pool.query<EntryRow>(
    "select id, name, amount, unallocated, signature_name, confirmed_at from interest_entries where investor_id = $1 order by id desc",
    [investor.id],
  );
  const active = entries.find(entry => !entry.confirmed_at) ?? entries.find(entry => entry.confirmed_at);
  const { rows: savedAllocations } = await pool.query<{
    entry_id: number | null;
    confirmed: boolean;
    project_id: number | null;
    amount: number;
    project_title: string | null;
    project_slug: string | null;
    project_visible: boolean;
    public_filmmaker_name: string | null;
  }>(
    `select pl.entry_id, pl.confirmed, pl.project_id, pl.amount, p.title as project_title, p.slug as project_slug,
       coalesce(p.approved = true and p.showcase_requested = true and p.hidden = false
         and p.stage in ('idea', 'production', 'distribution'), false) as project_visible,
       p.public_filmmaker_name
     from pledges pl left join projects p on p.id = pl.project_id
      where pl.investor_id = $1 order by pl.id`,
    [investor.id],
  );
  const viewAllocations = (entryId: number | null, confirmed: boolean) => savedAllocations
    .filter(row => row.entry_id === entryId && row.confirmed === confirmed && row.project_id !== null)
    .map(row => ({
      project_id: row.project_id!, amount: row.amount, project_title: row.project_title,
      project_slug: row.project_slug, project_visible: row.project_visible,
      public_filmmaker_name: row.project_visible ? row.public_filmmaker_name?.trim() || null : null,
    }));
  const history = [
    ...(investor.confirmed_at ? [{
      entry_id: null, name: investor.name ?? "", amount: investor.investment_amount ?? Number.parseInt(investor.amount_choice ?? "0", 10),
      confirmed_at: investor.confirmed_at.toISOString(), unallocated: investor.unallocated ?? false,
      allocations: viewAllocations(null, true),
    }] : []),
    ...entries.filter(entry => entry.confirmed_at).reverse().map(entry => ({
      entry_id: entry.id, name: entry.name, amount: entry.amount, confirmed_at: entry.confirmed_at!.toISOString(),
      unallocated: entry.unallocated, allocations: viewAllocations(entry.id, true),
    })),
  ];
  const intent = {
    investor_id: investor.id,
    entry_id: active?.id ?? null,
    name: active?.name ?? investor.name ?? "",
    email: investor.email ?? "",
    amount: active?.amount ?? investor.investment_amount ?? Number.parseInt(investor.amount_choice ?? "0", 10),
    allocations: viewAllocations(active?.id ?? null, active ? !!active.confirmed_at : !!investor.confirmed_at),
    unallocated: active?.unallocated ?? investor.unallocated ?? false,
    status: active ? active.confirmed_at ? "confirmed" : "saved" : investor.confirmed_at ? "confirmed" : "saved",
    confirmed_at: active ? active.confirmed_at?.toISOString() ?? null : investor.confirmed_at?.toISOString() ?? null,
    accredited: investor.accredited === "yes",
    experience: investor.experience ?? [],
    motivations: investor.motivations ?? [],
    favorite_genres: investor.favorite_genres ?? [],
    stages: investor.stages ?? [],
    minima: investor.minima ?? { distribution: null, production: null, idea: null },
    call_opt_in: investor.call_opt_in ?? false,
    phone: investor.phone,
    city: investor.city,
    state: investor.state,
    country: investor.country,
    zip: investor.zip,
  };
  res.json(GetCurrentInvestorIntentResponse.parse({ intent, history }));
});

router.post("/investor/intents/claim", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await resolveProtectedIdentity(req, res, true);
  if (!identity) return;
  const cookieCandidate = req.cookies?.[VISITOR_COOKIE];
  const visitorId = typeof cookieCandidate === "string" && UUID.test(cookieCandidate) ? cookieCandidate : null;
  if (!visitorId) {
    res.status(404).json({ error: "No saved guest interest is available in this browser." });
    return;
  }

  const uidColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const lockKey of [
      `investor:email:${identity.email}`,
      `investor:visitor:${visitorId}`,
      `investor:${identity.provider}:${identity.uid}`,
    ].sort()) {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
    }
    const { rows: visitors } = await client.query<InvestorRow>(
      "select * from investors where visitor_id = $1 for update", [visitorId],
    );
    if (visitors.length > 1) {
      await client.query("rollback");
      res.status(409).json({ error: "This browser has multiple investor interest records and cannot be claimed safely." });
      return;
    }
    const guest = visitors[0];
    if (!guest) {
      await client.query("rollback");
      res.status(404).json({ error: "No saved guest interest is available in this browser." });
      return;
    }
    if (guest.email?.trim().toLowerCase() !== identity.email
      || (guest.firebase_uid && (identity.provider !== "firebase" || guest.firebase_uid !== identity.uid))
      || (guest.replit_uid && (identity.provider !== "replit" || guest.replit_uid !== identity.uid))) {
      await client.query("rollback");
      res.status(403).json({ error: "This browser's saved interest does not belong to the verified account." });
      return;
    }
    const { rows: separateAccounts } = await client.query<{ id: number }>(
      "select id from investors where lower(trim(email)) = $1 and id <> $2 and (firebase_uid is not null or replit_uid is not null) for update",
      [identity.email, guest.id],
    );
    if (separateAccounts.length) {
      await client.query("rollback");
      res.status(409).json({ error: "This email already has separate signed-in interest. The older guest record cannot be linked automatically." });
      return;
    }
    const { rows: accountRows } = await client.query<InvestorRow>(
      `select * from investors where ${uidColumn} = $1 for update`, [identity.uid],
    );
    if (accountRows.length > 1) {
      await client.query("rollback");
      res.status(409).json({ error: "This account has multiple investor interest records and cannot be linked safely." });
      return;
    }
    if (accountRows[0] && accountRows[0].id !== guest.id) {
      await client.query("rollback");
      res.status(409).json({ error: "This account already has a different investor interest record." });
      return;
    }
    if (!accountRows[0]) {
      await client.query(`update investors set ${uidColumn} = $1 where id = $2`, [identity.uid, guest.id]);
    }
    await client.query("commit");
    res.json(ClaimInvestorIntentResponse.parse({ investor_id: guest.id, status: "linked" }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
});

router.post("/investor/intents/confirm", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await resolveProtectedIdentity(req, res, true);
  if (!identity) return;
  if (!await requireAccountAgeConfirmation(identity, res)) return;
  const parsed = ConfirmInvestorIntentBody.safeParse(req.body);
  if (!parsed.success || parsed.data.accepted !== true) {
    res.status(400).json({ error: "A valid signature and explicit acknowledgment are required." });
    return;
  }
  const submitted = parsed.data;
  const signature = submitted.signature_name.trim().replace(/\s+/g, " ");
  const uidColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
  const client = await pool.connect();
  let newAlerts: { id: number; owner_key: string }[] = [];
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `investor:${identity.provider}:${identity.uid}`,
    ]);
    const { rows } = await client.query<InvestorRow>(
      `select * from investors where ${uidColumn} = $1 for update`, [identity.uid],
    );
    if (rows.length > 1) {
      await client.query("rollback");
      res.status(409).json({ error: "This account has multiple investor interest records and cannot be confirmed safely." });
      return;
    }
    const investor = rows[0];
    if (!investor) {
      await client.query("rollback");
      res.status(404).json({ error: "No saved investor interest is linked to this account. Link your guest interest in its original browser first." });
      return;
    }
    if (submitted.investor_id !== undefined && submitted.investor_id !== investor.id) {
      await client.query("rollback");
      res.status(409).json({ error: "The signed-in account no longer matches the investor record you reviewed. Nothing was signed." });
      return;
    }
    if (investor.email?.trim().toLowerCase() !== identity.email) {
      await client.query("rollback");
      res.status(403).json({ error: "This investor interest is not associated with the verified account email." });
      return;
    }
    const { rows: entries } = await client.query<EntryRow>(
      "select id, name, amount, unallocated, signature_name, confirmed_at from interest_entries where investor_id = $1 order by id desc for update",
      [investor.id],
    );
    const active = entries.find(entry => !entry.confirmed_at) ?? entries.find(entry => entry.confirmed_at);
    if ((submitted.entry_id ?? null) !== (active?.id ?? null)) {
      await client.query("rollback");
      res.status(409).json({ error: "A different interest entry is now current. Review the latest lineup before signing." });
      return;
    }
    if (signature.toLocaleLowerCase() !== (active?.name ?? investor.name ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase()) {
      await client.query("rollback");
      res.status(400).json({ error: "Type the full name saved with this interest to sign it." });
      return;
    }
    const amount = active?.amount ?? investor.investment_amount ?? Number.parseInt(investor.amount_choice ?? "0", 10);
    const { rows: pledges } = await client.query<{ id: number; project_id: number | null; amount: number; confirmed: boolean }>(
      "select id, project_id, amount, confirmed from pledges where investor_id = $1 and entry_id is not distinct from $2 order by id for update",
      [investor.id, active?.id ?? null],
    );
    const expected = submitted.allocations.map(a => `${a.project_id}:${a.amount}`).sort();
    const actual = pledges.map(p => `${p.project_id}:${p.amount}`).sort();
    if (amount !== submitted.amount || expected.length !== actual.length || expected.some((item, index) => item !== actual[index])) {
      await client.query("rollback");
      res.status(409).json({ error: "Your saved amount or project choices changed. Review the lineup and try again." });
      return;
    }
    if (active?.confirmed_at || !active && investor.confirmed_at) {
      if ((active?.signature_name ?? investor.signature_name)?.trim().toLocaleLowerCase() !== signature.toLocaleLowerCase()
        || pledges.some(p => !p.confirmed)) {
        await client.query("rollback");
        res.status(409).json({ error: "This interest was already confirmed with a different signature or state." });
        return;
      }
      await client.query("commit");
      res.json(ConfirmInvestorIntentResponse.parse({
        investor_id: investor.id, status: "confirmed", confirmed_at: (active?.confirmed_at ?? investor.confirmed_at)!.toISOString(),
      }));
      return;
    }
    const confirmationVisitorCandidate = req.cookies?.[VISITOR_COOKIE];
    const confirmationVisitorId = typeof confirmationVisitorCandidate === "string" && UUID.test(confirmationVisitorCandidate)
      ? confirmationVisitorCandidate
      : null;
    const projectIds = pledges.map((pledge) => pledge.project_id).filter((id): id is number => id !== null);
    if (projectIds.length) {
      const ownProjects = await client.query<{ id: number }>(`
        select p.id
        from projects p
        join filmmakers f on f.id = p.filmmaker_id
        where p.id = any($1::int[])
          and (
            ($2::text = 'firebase' and f.firebase_uid = $3)
            or ($2::text = 'replit' and f.replit_uid = $3)
            or ($4::text is not null and f.visitor_id = $4)
          )
        for share of f
      `, [projectIds, identity.provider, identity.uid, confirmationVisitorId]);
      if (ownProjects.rows.length) {
        await client.query("rollback");
        res.status(409).json({ error: "Interest in your own project cannot be confirmed." });
        return;
      }
    }
    if (!Number.isSafeInteger(amount) || amount < 100
      || ((active?.unallocated ?? investor.unallocated) ? pledges.length !== 0 : pledges.length === 0 || pledges.some(p => p.project_id === null)
        || pledges.reduce((sum, p) => sum + p.amount, 0) !== amount)
      || pledges.some(p => p.confirmed)) {
      await client.query("rollback");
      res.status(409).json({ error: "This saved interest is incomplete or has already changed. It cannot be confirmed." });
      return;
    }
    // Unsigned choices saved under the old $25 minimum must be revised before signing.
    const savedLimitError = allocationLimitError(amount, pledges.map((pledge) => pledge.amount));
    if (savedLimitError) {
      await client.query("rollback");
      res.status(409).json({ error: `${savedLimitError} Update your saved choices before signing.` });
      return;
    }
    // The investor confirms the exact saved choices, not a new public listing.
    // An already-saved project may later be hidden; public totals still exclude
    // hidden projects, while deleted projects are refused above (null project_id).
    const evidenceResult = await client.query(
      `select submitted_answers from ${active ? "interest_entries" : "investors"} where id = $1`,
      [active?.id ?? investor.id],
    );
    const ageResult = await client.query("select confirmed_at from age_confirmations where provider = $1 and uid = $2", [identity.provider, identity.uid]);
    const termResult = await client.query(
      "select id, title, stage, budget, proposal, offer_per100 from projects where id = any($1::int[]) order by id", [projectIds],
    );
    const confirmationEvidence = JSON.stringify({
      accepted: true, notice_version: "nonbinding-interest-v1",
      notice: "Non-binding indication of interest only. No investment or payment occurs now. Returns, invitations and eligibility are not guaranteed.",
      signed_at: new Date().toISOString(), signature_name: signature, amount,
      allocations: pledges.map(p => ({ project_id: p.project_id, amount: p.amount })),
      questionnaire: evidenceResult.rows[0]?.submitted_answers ?? null,
      age_confirmation: ageResult.rows[0] ? { confirmed_at: ageResult.rows[0].confirmed_at, self_declaration: true } : null,
      project_terms_at_confirmation: termResult.rows,
      verified_account_email: identity.email,
      // Backer-visibility notice shown at signing, and the public-display choice (off by default).
      ...backerEvidence(submitted.public_display === true),
    });
    await client.query(
      `update ${active ? "interest_entries" : "investors"} set confirmation_evidence = $1::jsonb where id = $2 and confirmed_at is null`,
      [confirmationEvidence, active?.id ?? investor.id],
    );
    await client.query(
      "update pledges set confirmed = true where investor_id = $1 and entry_id is not distinct from $2 and confirmed = false",
      [investor.id, active?.id ?? null],
    );
    const { rows: updated } = await client.query<{ confirmed_at: Date }>(
      active
        ? "update interest_entries set signature_name = $1, confirmed_at = now() where id = $2 returning confirmed_at"
        : "update investors set signature_name = $1, signed_at = now(), confirmed_at = now() where id = $2 returning confirmed_at",
      [signature, active?.id ?? investor.id],
    );
    const alerts = await client.query<{ id: number; owner_key: string }>(
      `with added as (
       insert into interest_alerts (pledge_id, project_id, filmmaker_id)
       select pl.id, p.id, f.id
       from pledges pl
       join projects p on p.id = pl.project_id
       join filmmakers f on f.id = p.filmmaker_id
        where pl.investor_id = $1 and pl.entry_id is not distinct from $2 and pl.confirmed = true
         and (f.firebase_uid is not null or f.replit_uid is not null)
       on conflict (pledge_id) do nothing returning id, filmmaker_id
       )
       select added.id, case when f.firebase_uid is not null then 'firebase:' || f.firebase_uid
         else 'replit:' || f.replit_uid end as owner_key
       from added join filmmakers f on f.id = added.filmmaker_id`,
      [investor.id, active?.id ?? null],
    );
    newAlerts = alerts.rows;
    await client.query("commit");
    // The committed confirmation and in-app alert do not depend on Mailjet.
    const ownerKeys = new Set(newAlerts.map(alert => alert.owner_key));
    for (const ownerKey of ownerKeys) {
      const alertIds = newAlerts.filter(alert => alert.owner_key === ownerKey).map(alert => alert.id);
      try {
        await deliverInterestAlertEmail(alertIds);
      } catch {
        req.log.warn({ alertId: alertIds[0] }, "Interest alert email preparation failed; confirmation remains valid");
      }
    }
    res.json(ConfirmInvestorIntentResponse.parse({
      investor_id: investor.id, status: "confirmed", confirmed_at: updated[0].confirmed_at.toISOString(),
    }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
});

export default router;