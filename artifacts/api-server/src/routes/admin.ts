import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  emailLogTable,
  filmmakersTable,
  flowProgressTable,
  investorMinimumsTable,
  investorsTable,
  messagesTable,
  pledgesTable,
  projectsTable,
  updateMessageVisibility,
  updateProjectReview,
  visitorsTable,
} from "@workspace/db";
import {
  GetAdminMeResponse,
  GetAdminTableParams,
  GetAdminTableResponse,
  ReviewAdminMessageBody,
  ReviewAdminMessageParams,
  ReviewAdminMessageResponse,
  ReviewAdminProjectBody,
  ReviewAdminProjectParams,
  ReviewAdminProjectResponse,
} from "@workspace/api-zod";
import { FirebaseConfigurationError, verifyFirebaseIdToken } from "../lib/firebase-admin";

const router: IRouter = Router();
type Section = "summary" | "pledges" | "location" | "funnels" | "market" | "price-test" | "queues" | "messages" | "channels" | "email-log";
type AdminTable = { section: Section; title: string; columns: string[]; rows: string[][]; total: number };
type Identity = { email: string };

const SECTION_TITLES: Record<Section, string> = {
  summary: "Summary",
  pledges: "Pledges by project",
  location: "By location",
  funnels: "Funnels",
  market: "Market",
  "price-test": "Price test",
  queues: "Queues",
  messages: "Messages",
  channels: "Channels",
  "email-log": "Email log",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Authentication failed.";
}

async function authorize(req: Request, res: Response): Promise<Identity | null> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    res.status(503).json({ error: "Admin access is not configured. Set ADMIN_EMAIL on the server." });
    return null;
  }

  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    res.status(401).json({ error: "A Firebase ID token is required." });
    return null;
  }

  try {
    const decoded = await verifyFirebaseIdToken(match[1]);
    if (decoded.email_verified !== true || typeof decoded.email !== "string") {
      res.status(401).json({ error: "A verified Firebase email is required." });
      return null;
    }
    const email = decoded.email.trim().toLowerCase();
    if (email !== adminEmail) {
      res.status(403).json({ error: "This account is not an administrator." });
      return null;
    }
    return { email };
  } catch (error) {
    if (error instanceof FirebaseConfigurationError) {
      res.status(503).json({ error: error.message });
      return null;
    }
    req.log.warn({ error: errorMessage(error) }, "Firebase admin token verification failed");
    res.status(401).json({ error: "The Firebase ID token is invalid or expired." });
    return null;
  }
}

function text(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function buildTable(section: Section, columns: string[], rows: unknown[][]): AdminTable {
  return {
    section,
    title: SECTION_TITLES[section],
    columns,
    rows: rows.map((row) => row.map(text)),
    total: rows.length,
  };
}

async function getAdminTable(section: Section): Promise<AdminTable> {
  const [
    filmmakers,
    projects,
    investors,
    pledges,
    minimums,
    messages,
    progress,
    visitors,
    emailLogs,
  ] = await Promise.all([
    db.select().from(filmmakersTable),
    db.select().from(projectsTable),
    db.select().from(investorsTable),
    db.select().from(pledgesTable),
    db.select().from(investorMinimumsTable),
    db.select().from(messagesTable),
    db.select().from(flowProgressTable),
    db.select().from(visitorsTable),
    db.select().from(emailLogTable),
  ]);

  const investorById = new Map(investors.map((investor) => [investor.id, investor]));
  const visitorById = new Map(visitors.map((visitor) => [visitor.visitorId, visitor]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const confirmedPledges = pledges.filter((pledge) => pledge.confirmed);

  if (section === "summary") {
    const confirmedProjectPledges = confirmedPledges.filter((pledge) => pledge.projectId != null);
    const unallocatedPledges = confirmedPledges.filter((pledge) => pledge.projectId == null);
    const confirmedTotal = confirmedPledges.reduce((sum, pledge) => sum + pledge.amount, 0);
    const accreditedInvestors = investors.filter((investor) => investor.accredited === "yes");
    const accreditedIds = new Set(accreditedInvestors.map((investor) => investor.id));
    const accreditedDollars = confirmedPledges
      .filter((pledge) => pledge.investorId != null && accreditedIds.has(pledge.investorId))
      .reduce((sum, pledge) => sum + pledge.amount, 0);
    const rows = [
      ["Filmmakers", filmmakers.length],
      ["Projects", projects.length],
      ["Showcased projects", projects.filter((project) => project.approved && !project.hidden).length],
      ["Investors", investors.length],
      ["Confirmed pledges", confirmedPledges.length],
      ["Confirmed pledged to projects", confirmedProjectPledges.reduce((sum, pledge) => sum + pledge.amount, 0)],
      ["Confirmed unallocated pledges", unallocatedPledges.reduce((sum, pledge) => sum + pledge.amount, 0)],
      ["Total confirmed pledged", confirmedTotal],
      ["Average confirmed pledge", confirmedPledges.length ? Math.round(confirmedTotal / confirmedPledges.length) : "—"],
      ["Accredited investors", accreditedInvestors.length],
      ["Confirmed accredited pledge dollars", accreditedDollars],
    ];
    return buildTable(section, ["Metric", "Value"], rows);
  }

  if (section === "pledges") {
    const rows = projects.map((project) => {
      const projectPledges = confirmedPledges.filter((pledge) => pledge.projectId === project.id);
      const people = new Set(projectPledges.map((pledge) => pledge.investorId).filter((id): id is number => id != null));
      const accreditedPeople = new Set([...people].filter((id) => investorById.get(id)?.accredited === "yes"));
      const cities = new Map<string, number>();
      for (const investorId of people) {
        const city = investorById.get(investorId)?.city;
        if (city) cities.set(city, (cities.get(city) ?? 0) + 1);
      }
      const topCity = [...cities.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
      return [
        project.title ?? "",
        project.stage ?? "",
        project.offerPer100 ?? "",
        people.size,
        projectPledges.reduce((sum, pledge) => sum + pledge.amount, 0),
        accreditedPeople.size,
        topCity,
      ];
    });
    return buildTable(section, ["Project", "Slate", "Offer per $100", "Confirmed pledgers", "Confirmed pledged", "Accredited pledgers", "Top city"], rows);
  }

  if (section === "location") {
    type Location = { state: string; city: string; investors: Set<number>; filmmakers: Set<number>; pledged: number };
    const locations = new Map<string, Location>();
    const ensureLocation = (state: string | null, city: string | null): Location => {
      const key = `${state ?? ""}\u0000${city ?? ""}`;
      let location = locations.get(key);
      if (!location) {
        location = { state: state ?? "", city: city ?? "", investors: new Set(), filmmakers: new Set(), pledged: 0 };
        locations.set(key, location);
      }
      return location;
    };
    investors.forEach((investor) => ensureLocation(investor.state, investor.city).investors.add(investor.id));
    filmmakers.forEach((filmmaker) => ensureLocation(filmmaker.state, filmmaker.city).filmmakers.add(filmmaker.id));
    for (const pledge of confirmedPledges) {
      const investor = pledge.investorId == null ? undefined : investorById.get(pledge.investorId);
      if (investor) ensureLocation(investor.state, investor.city).pledged += pledge.amount;
    }
    const rows = [...locations.values()]
      .sort((a, b) => a.state.localeCompare(b.state) || a.city.localeCompare(b.city))
      .map((location) => [location.state, location.city, location.investors.size, location.pledged, location.filmmakers.size]);
    return buildTable(section, ["State", "City", "Investors", "Confirmed pledged", "Filmmakers"], rows);
  }

  if (section === "funnels") {
    const rows: unknown[][] = [];
    for (const flow of ["filmmaker", "investor"] as const) {
      const records = progress.filter((record) => record.flow === flow);
      const screenCount = flow === "filmmaker" ? 6 : 5;
      for (let screen = 1; screen <= screenCount; screen += 1) {
        const reached = records.filter((record) => record.lastScreen >= screen).length;
        const previousReached = screen === 1 ? reached : records.filter((record) => record.lastScreen >= screen - 1).length;
        const dropoff = previousReached === 0 ? "—" : `${Math.round(((previousReached - reached) / previousReached) * 100)}%`;
        rows.push([flow, screen, reached, dropoff]);
      }
    }
    return buildTable(section, ["Flow", "Screen", "Reached", "Drop-off from previous screen"], rows);
  }

  if (section === "market") {
    const ladder = [125, 150, 175, 200];
    const rows: unknown[][] = [];
    for (const slate of ["distribution", "production", "idea", "other"]) {
      const slateProjects = projects.filter((project) => project.stage === slate);
      const slateMinimums = minimums.filter((minimum) => minimum.slate === slate);
      const offerCounts = ladder.map((offer) => slateProjects.filter((project) => project.offerPer100 === offer).length);
      const offer250Plus = slateProjects.filter((project) => (project.offerPer100 ?? 0) >= 250).length;
      const otherOffers = slateProjects.filter((project) => project.offerPer100 != null && !ladder.includes(project.offerPer100) && project.offerPer100 < 250).length;
      const minimumCounts = ladder.map((minimum) => slateMinimums.filter((answer) => !answer.notInterested && answer.minPer100 === minimum).length);
      const minimum250Plus = slateMinimums.filter((answer) => !answer.notInterested && answer.minPer100 != null && answer.minPer100 >= 250).length;
      const otherMinimums = slateMinimums.filter((answer) => !answer.notInterested && answer.minPer100 == null && Boolean(answer.otherText)).length;
      const notInterested = slateMinimums.filter((answer) => answer.notInterested).length;
      rows.push([slate, ...offerCounts, offer250Plus, otherOffers, slateProjects.filter((project) => project.wantsLower).length,
        ...minimumCounts, minimum250Plus, otherMinimums, notInterested]);
    }
    return buildTable(section, [
      "Slate", "Offers 125", "Offers 150", "Offers 175", "Offers 200", "Offers 250+",
      "Other offers", "Wants below floor", "Minimums 125", "Minimums 150", "Minimums 175",
      "Minimums 200", "Minimums 250+", "Other minimums", "Not interested",
    ], rows);
  }

  if (section === "price-test") {
    const rows: unknown[][] = [];
    for (const group of ["A", "B"]) {
      const groupVisitors = new Set(visitors.filter((visitor) => visitor.priceGroup === group).map((visitor) => visitor.visitorId));
      const groupProgress = progress.filter((record) => record.flow === "filmmaker" && groupVisitors.has(record.visitorId));
      const distributionProjects = projects.filter((project) => project.stage === "distribution" && project.priceGroup === group);
      const answers = ["yes", "maybe", "no"].map((answer) => distributionProjects.filter((project) => project.dealAnswer === answer).length);
      const offers = new Map<string, number>();
      for (const project of distributionProjects) {
        if (project.offerPer100 != null) offers.set(String(project.offerPer100), (offers.get(String(project.offerPer100)) ?? 0) + 1);
      }
      rows.push([
        group,
        groupProgress.length,
        groupProgress.filter((record) => record.completed).length,
        ...answers,
        [...offers.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([offer, count]) => `${offer}: ${count}`).join(", "),
      ]);
    }
    return buildTable(section, ["Group", "Started", "Completed", "Deal yes", "Deal maybe", "Deal no", "Distribution offers chosen"], rows);
  }

  if (section === "queues") {
    const rows: unknown[][] = [];
    for (const project of projects.filter((item) => item.showcaseRequested)) {
      const status = project.hidden ? "Hidden" : project.approved ? "Approved" : "Pending";
      rows.push(["Approval", "", project.title ?? "", project.slug ?? "", project.createdAt, status, project.id]);
    }
    const callRecords: { priority: number; row: unknown[] }[] = [];
    investors.filter((investor) => investor.callOptIn).forEach((investor) => {
      const accredited = investor.accredited === "yes";
      callRecords.push({
        priority: accredited ? 0 : 1,
        row: ["Call", accredited ? "Accredited first" : "Retail", investor.name ?? "", investor.email ?? "", investor.createdAt, investor.accredited ?? "", ""],
      });
    });
    filmmakers.filter((filmmaker) => filmmaker.chatOptIn).forEach((filmmaker) => {
      callRecords.push({
        priority: 2,
        row: ["Filmmaker chat", "", filmmaker.name ?? "", filmmaker.email ?? "", filmmaker.createdAt, "Opted in", ""],
      });
    });
    callRecords.sort((a, b) => a.priority - b.priority);
    rows.push(...callRecords.map((item) => item.row));
    for (const message of messages.filter((item) => item.answer == null && !item.hidden)) {
      const project = message.projectId == null ? undefined : projectById.get(message.projectId);
      rows.push(["Unanswered question", "", message.investorName ?? "", project?.title ?? "", message.askedAt, "Waiting", ""]);
    }
    return buildTable(section, ["Queue", "Priority", "Person", "Details", "Created", "Status", "Project ID"], rows);
  }

  if (section === "messages") {
    const rows = messages.map((message) => {
      const project = message.projectId == null ? undefined : projectById.get(message.projectId);
      const responseMinutes = message.answeredAt
        ? Math.max(0, Math.round((message.answeredAt.getTime() - message.askedAt.getTime()) / 60_000))
        : "";
      return [
        project?.title ?? "",
        message.investorName ?? "",
        message.investorEmail ?? "",
        message.question ?? "",
        message.answer ?? "",
        message.askedAt,
        message.answeredAt ?? "",
        responseMinutes,
        message.reported,
        message.hidden,
        message.id,
      ];
    });
    return buildTable(section, ["Project", "Investor", "Investor email", "Question", "Answer", "Asked at", "Answered at", "Response minutes", "Reported", "Hidden", "Message ID"], rows);
  }

  if (section === "channels") {
    type Attribution = { kind: string; value: string; visitorIds: Set<string>; filmmakers: number; investors: number };
    const groups = new Map<string, Attribution>();
    const addAttribution = (kind: string, value: string | null, visitorId: string): void => {
      const label = value ?? "";
      const key = `${kind}\u0000${label}`;
      let item = groups.get(key);
      if (!item) {
        item = { kind, value: label, visitorIds: new Set(), filmmakers: 0, investors: 0 };
        groups.set(key, item);
      }
      item.visitorIds.add(visitorId);
    };
    visitors.forEach((visitor) => {
      if (visitor.utmSource) addAttribution("UTM source", visitor.utmSource, visitor.visitorId);
      if (visitor.refCodeUsed) addAttribution("Referral code", visitor.refCodeUsed, visitor.visitorId);
    });
    filmmakers.forEach((filmmaker) => {
      if (!filmmaker.visitorId) return;
      const visitor = visitorById.get(filmmaker.visitorId);
      if (!visitor) return;
      if (visitor.utmSource) {
        const item = groups.get(`UTM source\u0000${visitor.utmSource}`);
        if (item) item.filmmakers += 1;
      }
      if (visitor.refCodeUsed) {
        const item = groups.get(`Referral code\u0000${visitor.refCodeUsed}`);
        if (item) item.filmmakers += 1;
      }
    });
    investors.forEach((investor) => {
      if (!investor.visitorId) return;
      const visitor = visitorById.get(investor.visitorId);
      if (!visitor) return;
      if (visitor.utmSource) {
        const item = groups.get(`UTM source\u0000${visitor.utmSource}`);
        if (item) item.investors += 1;
      }
      if (visitor.refCodeUsed) {
        const item = groups.get(`Referral code\u0000${visitor.refCodeUsed}`);
        if (item) item.investors += 1;
      }
    });
    const rows = [...groups.values()]
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value))
      .map((item) => [item.kind, item.value, item.visitorIds.size, item.filmmakers, item.investors]);
    return buildTable(section, ["Attribution", "Value", "Visitors", "Filmmakers", "Investors"], rows);
  }

  const rows = emailLogs.map((entry) => [entry.to, entry.type, entry.status, entry.createdAt]);
  return buildTable(section, ["To", "Type", "Status", "Created at"], rows);
}

router.get("/admin/me", async (req, res): Promise<void> => {
  const identity = await authorize(req, res);
  if (!identity) return;
  res.json(GetAdminMeResponse.parse({ email: identity.email, role: "admin" }));
});

router.get("/admin/tables/:section", async (req, res): Promise<void> => {
  const identity = await authorize(req, res);
  if (!identity) return;
  const parsedParams = GetAdminTableParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid admin table section." });
    return;
  }
  const table = await getAdminTable(parsedParams.data.section);
  res.json(GetAdminTableResponse.parse(table));
});

router.patch("/admin/projects/:projectId", async (req, res): Promise<void> => {
  const identity = await authorize(req, res);
  if (!identity) return;

  const parsedParams = ReviewAdminProjectParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid project ID." });
    return;
  }
  const parsedBody = ReviewAdminProjectBody.safeParse(req.body);
  if (!parsedBody.success || (parsedBody.data.approved === undefined && parsedBody.data.hidden === undefined)) {
    res.status(400).json({ error: "At least one of approved or hidden must be provided." });
    return;
  }

  const project = await updateProjectReview(parsedParams.data.projectId, parsedBody.data);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  res.json(ReviewAdminProjectResponse.parse(project));
});

router.patch("/admin/messages/:messageId", async (req, res): Promise<void> => {
  const identity = await authorize(req, res);
  if (!identity) return;

  const parsedParams = ReviewAdminMessageParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid message ID." });
    return;
  }
  const parsedBody = ReviewAdminMessageBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "A boolean hidden value is required." });
    return;
  }

  const message = await updateMessageVisibility(parsedParams.data.messageId, parsedBody.data.hidden);
  if (!message) {
    res.status(404).json({ error: "Message not found." });
    return;
  }
  res.json(ReviewAdminMessageResponse.parse(message));
});

export default router;