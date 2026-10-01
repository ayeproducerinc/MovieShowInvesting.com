#!/usr/bin/env node

/**
 * Focused runtime integration coverage for secure filmmaker draft materials,
 * account linking, and public pitch-deck eligibility.
 *
 * Run explicitly with: node scripts/test-onboarding-materials.mjs
 * Use --keep-fixtures to retain synthetic test data and write private custom
 * tokens/IDs to /tmp/msi-onboarding-test-fixtures.json; use --cleanup to remove it.
 * For a browser handoff, sign in with customToken and seed the browser's
 * msi_visitor_id cookie from browser_handoff_visitor_id.
 * This script is intentionally not wired into a default test/build workflow.
 */

import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";

const API_BASE = (process.env.MSI_TEST_API_BASE_URL || "http://localhost:80/api").replace(/\/+$/, "");
const FIXTURE_FILE = "/tmp/msi-onboarding-test-fixtures.json";
const CLEANUP_MANIFEST_FILE = "/tmp/msi-onboarding-cleanup-manifest.json";
const MAX_DECK_BYTES = 20 * 1024 * 1024;
const testTag = `msi-it-${randomUUID().replaceAll("-", "").slice(0, 18)}`;
const filmmakerEmail = `${testTag}-filmmaker@example.invalid`;
const secondEmail = `${testTag}-other@example.invalid`;
const investorEmail = `${testTag}-investor@example.invalid`;
const filename = `${testTag}.pdf`;
const synopsis = `Runtime integration synopsis ${testTag}`;
const trailerUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const args = new Set(process.argv.slice(2));
const keepFixtures = args.has("--keep-fixtures");
const cleanupOnly = args.has("--cleanup");
const resumeFailedMediaPublic = args.has("--resume-failed-media-public");
const visitorIds = new Set();
const results = [];
let resumeFixtureMode = false;
const state = {
  pool: null,
  adminApp: null,
  auth: null,
  firebaseProjectId: null,
  firebaseApiKey: null,
  firstUser: null,
  secondUser: null,
  firstToken: null,
  secondToken: null,
  firstCustomToken: null,
  secondCustomToken: null,
  fixtureTag: testTag,
  fixtureEmails: [filmmakerEmail, secondEmail, investorEmail],
  draftId: null,
  browserHandoffDraftId: null,
  browserHandoffVisitorId: null,
  claimContextDraft: null,
  mismatchContextDraft: null,
  unclaimedSubmitDraft: null,
  projectId: null,
  projectSlug: null,
  projectMaterials: null,
  draftSnapshot: null,
  mediaTouched: false,
  unresolvedStoragePaths: [],
};

class CheckFailure extends Error {
  constructor(reason) {
    super(reason);
    this.name = "CheckFailure";
  }
}

function check(condition, reason) {
  if (!condition) throw new CheckFailure(reason);
}

function apiUrl(path) {
  return new URL(path.replace(/^\/+/, ""), `${API_BASE}/`);
}

function makeHeaders({ token, visitorId, draftId, projectId, headers } = {}) {
  const output = new Headers(headers);
  if (token) output.set("Authorization", `Bearer ${token}`);
  if (visitorId) output.set("Cookie", `msi_visitor_id=${visitorId}`);
  if (draftId !== undefined) output.set("X-MSI-Draft-Id", String(draftId));
  if (projectId !== undefined) output.set("X-MSI-Project-Id", String(projectId));
  return output;
}

async function apiRequest(path, options = {}) {
  return fetch(apiUrl(path), {
    ...options,
    headers: makeHeaders(options),
    signal: options.signal ?? AbortSignal.timeout(120_000),
  });
}

async function apiJson(path, options = {}) {
  const response = await apiRequest(path, options);
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Status assertions are more useful than exposing untrusted response text.
  }
  return { response, data };
}

async function jsonRequest(path, method, payload, auth = {}) {
  return apiJson(path, {
    ...auth,
    method,
    headers: { "Content-Type": "application/json", ...(auth.headers ?? {}) },
    body: JSON.stringify(payload),
  });
}

function requireSuccess(response, action) {
  check(response.ok, `${action}: expected success, received HTTP ${response.status}`);
}

async function safeUploadErrorCode(response) {
  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    return "UNCLASSIFIED_API_ERROR";
  }
  const codes = new Map([
    ["X-MSI-Filename must contain a safe filename no longer than 200 characters.", "UPLOAD_FILENAME_REQUIRED_OR_INVALID"],
    ["Image bytes do not match the declared type or exceed the pixel limit.", "IMAGE_FORMAT_OR_PIXEL_LIMIT_REJECTED"],
    ["Image could not be decoded and safely re-encoded.", "IMAGE_DECODE_REJECTED"],
    ["Pitch decks must be uploaded as application/pdf.", "PITCH_DECK_MIME_REJECTED"],
    ["Upload bytes do not match the declared Content-Length.", "UPLOAD_CONTENT_LENGTH_MISMATCH"],
    ["The uploaded file does not contain a valid PDF signature.", "PDF_SIGNATURE_REJECTED"],
    ["Pitch deck filename is invalid.", "PITCH_DECK_FILENAME_REJECTED"],
    ["Bunny Storage is not configured.", "BUNNY_STORAGE_UNAVAILABLE"],
    ["Bunny Storage could not save this image.", "BUNNY_IMAGE_SAVE_REJECTED"],
    ["Bunny Storage could not save this pitch deck.", "BUNNY_PDF_SAVE_REJECTED"],
  ]);
  return codes.get(body?.error) ?? "UNCLASSIFIED_API_ERROR";
}

async function requireUploadSuccess(response, action) {
  if (!response.ok) {
    const code = await safeUploadErrorCode(response);
    throw new CheckFailure(`${action}: HTTP ${response.status} (${code})`);
  }
}

function requireRejected(response, action) {
  check(response.status >= 400 && response.status < 500, `${action}: expected client rejection, received HTTP ${response.status}`);
}

async function test(name, operation) {
  try {
    await operation();
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    const reason = error instanceof CheckFailure ? error.message : "unexpected request or runtime error";
    results.push({ name, passed: false });
    console.log(`FAIL ${name} — ${reason}`);
  }
}

async function initializeDatabase() {
  if (!process.env.DATABASE_URL) throw new CheckFailure("DATABASE_URL is unavailable");
  const dbRequire = createRequire(new URL("../lib/db/package.json", import.meta.url));
  const pg = dbRequire("pg");
  const Pool = pg.Pool ?? pg.default?.Pool;
  if (!Pool) throw new CheckFailure("PostgreSQL driver is unavailable");
  state.pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    ...(cleanupOnly ? { statement_timeout: 15_000, query_timeout: 15_000 } : {}),
  });
  await state.pool.query("select 1");
}

async function initializeFirebaseIdentities() {
  await initializeFirebaseAdmin();
  await initializeFirebaseWebConfig();

  state.firstUser = await state.auth.createUser({
    email: filmmakerEmail,
    emailVerified: true,
    displayName: `Integration filmmaker ${testTag}`,
    disabled: false,
  });
  state.secondUser = await state.auth.createUser({
    email: secondEmail,
    emailVerified: true,
    displayName: `Integration account ${testTag}`,
    disabled: false,
  });
  const firstCredential = await mintCredential(state.firstUser.uid, "first");
  state.firstToken = firstCredential.idToken;
  const secondCredential = await mintCredential(state.secondUser.uid, "second");
  state.secondToken = secondCredential.idToken;
}

async function initializeFirebaseAdmin() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new CheckFailure("Firebase test-auth configuration is unavailable");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new CheckFailure("Firebase test-auth configuration is invalid");
  }
  if (!serviceAccount || typeof serviceAccount !== "object" || !serviceAccount.project_id) {
    throw new CheckFailure("Firebase test-auth configuration is invalid");
  }
  state.firebaseProjectId = serviceAccount.project_id;

  const apiRequire = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
  const { cert, getApps, initializeApp } = apiRequire("firebase-admin/app");
  const { getAuth } = apiRequire("firebase-admin/auth");
  state.adminApp = getApps().find((app) => app.name === testTag)
    ?? initializeApp({ credential: cert(serviceAccount) }, testTag);
  state.auth = getAuth(state.adminApp);
}

async function initializeFirebaseWebConfig() {
  let result;
  try {
    result = await apiJson("config");
  } catch {
    throw new CheckFailure("Firebase public web configuration request failed");
  }
  if (!result.response.ok) {
    throw new CheckFailure(`Firebase public web configuration unavailable (HTTP ${result.response.status})`);
  }
  const config = result.data;
  if (typeof config?.apiKey !== "string" || !config.apiKey
    || typeof config.authDomain !== "string" || !config.authDomain
    || typeof config.appId !== "string" || !config.appId
    || typeof config.projectId !== "string" || !config.projectId) {
    throw new CheckFailure("Firebase public web configuration is incomplete");
  }
  const projectMatches = config.projectId === state.firebaseProjectId;
  if (!projectMatches) {
    throw new CheckFailure("Firebase public web config project does not match the service-account project");
  }
  state.firebaseApiKey = config.apiKey;
}

async function mintCredential(uid, accountSlot) {
  const customToken = await state.auth.createCustomToken(uid);
  if (accountSlot === "first") state.firstCustomToken = customToken;
  if (accountSlot === "second") state.secondCustomToken = customToken;
  return { customToken, idToken: await exchangeCustomToken(customToken) };
}

function firebaseExchangeFailureCode(data, status) {
  const message = data?.error?.message;
  if (typeof message === "string" && /^[A-Z0-9_]{1,64}$/.test(message)) return message;
  if (typeof message === "string" && /api key/i.test(message)) return "API_KEY_INVALID";
  return `HTTP_${status}`;
}

async function exchangeCustomToken(customToken) {
  if (!state.firebaseApiKey) throw new CheckFailure("Firebase public web configuration is unavailable");
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(state.firebaseApiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Never surface Firebase response bodies, which may contain credentials.
  }
  if (!response.ok || typeof data?.idToken !== "string") {
    const code = firebaseExchangeFailureCode(data, response.status);
    throw new CheckFailure(`Firebase custom-token exchange failed (${code})`);
  }
  return data.idToken;
}

async function createVisitor() {
  const { response, data } = await jsonRequest("visit", "POST", { ref: state.fixtureTag });
  requireSuccess(response, "record visitor");
  check(typeof data?.visitor_id === "string", "visitor record did not return an identifier");
  visitorIds.add(data.visitor_id);
  if (resumeFixtureMode) await persistRetainedFixtureState();
  return data.visitor_id;
}

async function createGuestFilmmakerDraft(label, tag = state.fixtureTag) {
  const visitorId = await createVisitor();
  const priceGroup = await apiRequest("price-group", { visitorId });
  requireSuccess(priceGroup, `assign ${label} price group`);

  const progress = await jsonRequest("progress", "POST", {
    flow: "filmmaker",
    last_screen: 1,
    answers: {
      title: `${label} ${tag}`,
      logline: `A ${label.toLowerCase()} draft ${tag}`,
      integration_tag: tag,
    },
    completed: false,
  }, { visitorId });
  requireSuccess(progress.response, `save ${label} guest draft`);

  const saved = await apiJson("progress/filmmaker", { visitorId });
  requireSuccess(saved.response, `read ${label} guest draft`);
  check(saved.data?.flow === "filmmaker" && typeof saved.data?.draft_id === "number",
    `${label} guest draft did not return a draft identifier`);
  return { visitorId, draftId: saved.data.draft_id };
}

async function prepareFilmmakerDraft() {
  const draft = await createGuestFilmmakerDraft("Primary draft");
  const visitorId = draft.visitorId;
  state.draftId = draft.draftId;
  return visitorId;
}

async function prepareBrowserHandoffDraft() {
  const draft = await createGuestFilmmakerDraft("Browser handoff");
  state.browserHandoffVisitorId = draft.visitorId;
  state.browserHandoffDraftId = draft.draftId;
}

async function prepareClaimRegressionDrafts() {
  state.claimContextDraft = await createGuestFilmmakerDraft("Claim context");
  state.mismatchContextDraft = await createGuestFilmmakerDraft("Mismatched claim context");
  state.unclaimedSubmitDraft = await createGuestFilmmakerDraft("Unclaimed submission");
}

function submissionBody(
  email = filmmakerEmail,
  title = `Integration project ${state.fixtureTag}`,
  tag = state.fixtureTag,
) {
  return {
    no_project_yet: false,
    stage: "idea",
    title,
    format: "movie",
    genre: "Drama",
    logline: `A test-only logline for ${tag}.`,
    budget: 50000,
    budget_from_example: true,
    deal_answer: "maybe",
    offer_per100: 125,
    wants_lower: true,
    payback_terms: "works",
    funding_sources: ["Haven’t yet"],
    name: `Integration filmmaker ${tag}`,
    email,
    city: "Test City",
    country: "US",
    favorite_genres: ["Drama"],
    chat_opt_in: false,
  };
}

async function validPng() {
  const apiRequire = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
  const sharp = apiRequire("sharp");
  return sharp({
    create: {
      width: 600,
      height: 900,
      channels: 3,
      background: { r: 34, g: 48, b: 68 },
    },
  }).png().toBuffer();
}

function validPdf() {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`,
    "utf8",
  );
}

function assertSnapshotShape(snapshot, label) {
  check(snapshot && typeof snapshot === "object", `${label} snapshot was not an object`);
  for (const field of [
    "synopsis",
    "trailer_url",
    "poster_url",
    "share_image_url",
    "pitch_deck_url",
    "pitch_deck_name",
  ]) {
    check(Object.hasOwn(snapshot, field), `${label} snapshot is missing ${field}`);
  }
}

async function uploadDraftMaterial(path, bytes, contentType, extraHeaders = {}) {
  const response = await apiRequest(path, {
    method: "POST",
    visitorId: state.filmmakerVisitorId,
    draftId: state.draftId,
    headers: { "Content-Type": contentType, ...extraHeaders },
    body: bytes,
  });
  if (response.ok) state.mediaTouched = true;
  return response;
}

async function getDraftSnapshot(auth = {}) {
  return apiJson("filmmakers/draft-materials", {
    visitorId: state.filmmakerVisitorId,
    draftId: state.draftId,
    ...auth,
  });
}

async function getProjectSnapshot(auth = {}) {
  return apiJson("filmmakers/project-materials", {
    visitorId: state.filmmakerVisitorId,
    projectId: state.projectId,
    ...auth,
  });
}

async function projectRecord() {
  const result = await state.pool.query(
    `select p.id, p.slug, p.approved, p.showcase_requested, p.hidden, p.review_paid_at
       from projects p
       join filmmakers f on f.id = p.filmmaker_id
      where p.id = $1 and f.firebase_uid = $2`,
    [state.projectId, state.firstUser.uid],
  );
  return result.rows[0] ?? null;
}

async function setProjectVisibility({ approved, listed, hidden }) {
  const result = await state.pool.query(
    `update projects p
        set approved = $2,
            showcase_requested = $3,
            hidden = $4,
            review_decision = case when $2 then 'approved' else null end
       from filmmakers f
      where p.id = $1
        and p.filmmaker_id = f.id
        and f.firebase_uid = $5
      returning p.id`,
    [state.projectId, approved, listed, hidden, state.firstUser.uid],
  );
  check(result.rowCount === 1, "could not update the test-owned project visibility fixture");
}

async function publicProject() {
  return apiJson(`projects/${encodeURIComponent(state.projectSlug)}`);
}

async function exploreTestProject() {
  const search = new URLSearchParams({ search: `Integration project ${state.fixtureTag}` });
  return apiJson(`explore?${search.toString()}`);
}

function projectDeckLink(data) {
  return typeof data?.pitch_deck_url === "string" && data.pitch_deck_url.length > 0
    ? data.pitch_deck_url
    : null;
}

async function assertProjectNotPubliclyOffered({ hidden = false } = {}) {
  const detail = await publicProject();
  if (hidden) {
    requireRejected(detail.response, "hidden project detail");
  } else {
    requireSuccess(detail.response, "unlisted project detail");
    check(!projectDeckLink(detail.data), "ineligible project detail still offers its pitch deck");
  }
  const listing = await exploreTestProject();
  requireSuccess(listing.response, "read public Explore");
  const projects = Array.isArray(listing.data?.projects) ? listing.data.projects : [];
  check(!projects.some((project) => project.id === state.projectId),
    "ineligible project remains in the public Explore listing");
  check(!projects.some((project) => projectDeckLink(project)),
    "ineligible Explore results expose a pitch-deck URL");
}

function resolvePublicFileUrl(value) {
  if (/^https?:\/\//i.test(value)) return new URL(value);
  if (value.startsWith("/api/")) return new URL(value, apiUrl("/"));
  return apiUrl(value);
}

async function checkPublicPdf(link) {
  const response = await fetch(resolvePublicFileUrl(link), { signal: AbortSignal.timeout(45_000) });
  check(response.ok, `public pitch deck returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  check(contentType === "application/pdf", "public pitch deck did not return a PDF");
  const bytes = Buffer.from(await response.arrayBuffer());
  check(bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-",
    "public pitch deck response did not contain a PDF signature");
}

async function runPublicDeckEligibilityAndRevocation() {
  await assertProjectNotPubliclyOffered();

  await setProjectVisibility({ approved: true, listed: true, hidden: false });
  const detail = await publicProject();
  requireSuccess(detail.response, "read approved public project detail");
  const detailLink = projectDeckLink(detail.data);
  check(detailLink, "approved project detail did not expose its pitch deck");

  const explore = await exploreTestProject();
  requireSuccess(explore.response, "read eligible Explore listing");
  const projects = Array.isArray(explore.data?.projects) ? explore.data.projects : [];
  const listing = projects.find((item) => item.id === state.projectId);
  check(listing, "approved project with a deck was absent from Explore");
  const listingLink = projectDeckLink(listing);
  check(listingLink, "eligible Explore item did not expose its pitch deck");
  await checkPublicPdf(detailLink);

  await setProjectVisibility({ approved: true, listed: false, hidden: false });
  await assertProjectNotPubliclyOffered();

  await setProjectVisibility({ approved: false, listed: true, hidden: false });
  await assertProjectNotPubliclyOffered();

  await setProjectVisibility({ approved: true, listed: true, hidden: true });
  await assertProjectNotPubliclyOffered({ hidden: true });

  await setProjectVisibility({ approved: true, listed: true, hidden: false });
  const beforeRemoval = await publicProject();
  requireSuccess(beforeRemoval.response, "read public project before deck removal");
  check(projectDeckLink(beforeRemoval.data), "restored eligible project did not expose its deck");

  const removeDeck = await apiRequest("filmmakers/project-materials/pitch-deck", {
    method: "DELETE",
    visitorId: state.filmmakerVisitorId,
    projectId: state.projectId,
    token: state.firstToken,
  });
  requireSuccess(removeDeck, "remove attached pitch deck");
  const afterRemoval = await getProjectSnapshot({ token: state.firstToken });
  requireSuccess(afterRemoval.response, "read project after deck removal");
  assertSnapshotShape(afterRemoval.data, "project");
  check(!afterRemoval.data.pitch_deck_url && !afterRemoval.data.pitch_deck_name,
    "removed deck remains attached to the project");
  const publicAfterRemoval = await publicProject();
  requireSuccess(publicAfterRemoval.response, "read public project after deck removal");
  check(!projectDeckLink(publicAfterRemoval.data), "removed deck is still offered publicly");

  const wrongProject = await apiRequest("filmmakers/project-materials", {
    visitorId: state.filmmakerVisitorId,
    projectId: state.projectId + 1,
    token: state.firstToken,
  });
  requireRejected(wrongProject, "wrong project context");
  await setProjectVisibility({ approved: false, listed: false, hidden: true });
}

async function runFunctionalTests() {
  await test("anonymous-investor-entry-is-server-rejected", async () => {
    const visitorId = await createVisitor();
    const progress = await jsonRequest("progress", "POST", {
      flow: "investor",
      last_screen: 1,
      answers: { integration_tag: testTag },
      completed: false,
    }, { visitorId });
    requireRejected(progress.response, "anonymous investor draft save");

    const intent = await jsonRequest("investor/intents", "POST", {
      name: `Integration investor ${testTag}`,
      email: investorEmail,
      amount: 100,
      allocations: [],
      unallocated: true,
      accredited: false,
      experience: [],
      motivations: [],
      favorite_genres: ["Drama"],
      stages: ["idea"],
      minima: { distribution: null, production: null, idea: 125 },
      call_opt_in: false,
      city: "Test City",
      country: "US",
    }, { visitorId });
    requireRejected(intent.response, "anonymous investor profile save");
  });

  await test("prepare-guest-claim-context-regression-fixtures", prepareClaimRegressionDrafts);

  await test("new-guest-claim-requires-draft-header", async () => {
    const draft = state.claimContextDraft;
    const claim = await jsonRequest("filmmakers/projects/claim", "POST", {
      draft_id: draft.draftId,
    }, {
      visitorId: draft.visitorId,
      token: state.secondToken,
    });
    const link = await state.pool.query(
      "select 1 from filmmaker_account_visitors where visitor_id = $1 and firebase_uid = $2",
      [draft.visitorId, state.secondUser.uid],
    );
    if (link.rowCount) {
      await state.pool.query(
        "delete from filmmaker_account_visitors where visitor_id = $1 and firebase_uid = $2",
        [draft.visitorId, state.secondUser.uid],
      );
    }
    requireRejected(claim.response, "new guest-draft claim without X-MSI-Draft-Id");
    check(link.rowCount === 0, "claim without the expected draft header linked the guest visitor");
  });

  await test("new-guest-claim-rejects-header-for-another-visitor", async () => {
    const draft = state.mismatchContextDraft;
    const otherVisitorDraft = state.claimContextDraft;
    const claim = await jsonRequest("filmmakers/projects/claim", "POST", {
      draft_id: draft.draftId,
    }, {
      visitorId: draft.visitorId,
      draftId: otherVisitorDraft.draftId,
      token: state.firstToken,
    });
    const link = await state.pool.query(
      "select 1 from filmmaker_account_visitors where visitor_id = $1 and firebase_uid = $2",
      [draft.visitorId, state.firstUser.uid],
    );
    if (link.rowCount) {
      await state.pool.query(
        "delete from filmmaker_account_visitors where visitor_id = $1 and firebase_uid = $2",
        [draft.visitorId, state.firstUser.uid],
      );
    }
    requireRejected(claim.response, "claim with another visitor's draft header");
    check(link.rowCount === 0, "mismatched draft header linked the visitor cookie's draft");
  });

  await test("matching-new-draft-claim-establishes-account-draft", async () => {
    const draft = state.claimContextDraft;
    const claim = await jsonRequest("filmmakers/projects/claim", "POST", {
      draft_id: draft.draftId,
    }, {
      visitorId: draft.visitorId,
      draftId: draft.draftId,
      token: state.secondToken,
    });
    requireSuccess(claim.response, "claim guest filmmaker draft with matching context");
    check(claim.data?.claimed === true && claim.data?.submission_claimed === false,
      "matching active-draft claim did not create an account-owned draft");
    const ownedDraft = await state.pool.query(
      `select 1 from filmmaker_account_visitors a
        join flow_progress p on p.visitor_id = a.visitor_id
       where a.visitor_id = $1 and a.firebase_uid = $2
         and p.flow = 'filmmaker' and p.completed = false`,
      [draft.visitorId, state.secondUser.uid],
    );
    check(ownedDraft.rowCount === 1, "account conflict fixture is not an active account-owned draft");
  });

  await test("authenticated-unclaimed-submit-rejected-without-auto-linking", async () => {
    const draft = state.unclaimedSubmitDraft;
    const submit = await jsonRequest("filmmakers", "POST", submissionBody(secondEmail), {
      visitorId: draft.visitorId,
      draftId: draft.draftId,
      token: state.secondToken,
    });
    const link = await state.pool.query(
      "select 1 from filmmaker_account_visitors where visitor_id = $1 and firebase_uid = $2",
      [draft.visitorId, state.secondUser.uid],
    );
    const filmmaker = await state.pool.query(
      "select 1 from filmmakers where visitor_id = $1 and firebase_uid = $2",
      [draft.visitorId, state.secondUser.uid],
    );
    check(submit.response.status >= 400 && submit.response.status < 500
      && link.rowCount === 0 && filmmaker.rowCount === 0,
    `unclaimed authenticated submission must be rejected without auto-linking (received HTTP ${submit.response.status})`);
  });

  await test("claim-of-unclaimed-draft-reports-existing-account-draft-conflict", async () => {
    const draft = state.unclaimedSubmitDraft;
    const claim = await jsonRequest("filmmakers/projects/claim", "POST", {
      draft_id: draft.draftId,
    }, {
      visitorId: draft.visitorId,
      draftId: draft.draftId,
      token: state.secondToken,
    });
    check(claim.response.status === 409,
      `claim with a separate active account draft should return HTTP 409, received HTTP ${claim.response.status}`);
    const link = await state.pool.query(
      "select 1 from filmmaker_account_visitors where visitor_id = $1 and firebase_uid = $2",
      [draft.visitorId, state.secondUser.uid],
    );
    check(link.rowCount === 0, "account-draft-conflict claim linked the guest visitor");
  });

  await test("guest-filmmaker-draft-and-final-auth-gate", async () => {
    state.filmmakerVisitorId = await prepareFilmmakerDraft();

    const anonymousSubmit = await jsonRequest("filmmakers", "POST", submissionBody(), {
      visitorId: state.filmmakerVisitorId,
      draftId: state.draftId,
    });
    if (anonymousSubmit.response.ok && typeof anonymousSubmit.data?.project_id === "number") {
      state.projectId = anonymousSubmit.data.project_id;
    }
    requireRejected(anonymousSubmit.response, "anonymous final filmmaker submission");
  });

  await test("draft-synopsis-image-and-pdf-persistence-and-validation", async () => {
    const patch = await jsonRequest("filmmakers/draft-materials", "PATCH", {
      synopsis,
      trailer_url: trailerUrl,
    }, {
      visitorId: state.filmmakerVisitorId,
      draftId: state.draftId,
    });
    requireSuccess(patch.response, "save guest draft materials");

    const poster = await uploadDraftMaterial(
      "filmmakers/draft-materials/images?kind=poster",
      await validPng(),
      "image/png",
      { "X-MSI-Filename": `${state.fixtureTag}-poster-first.png` },
    );
    await requireUploadSuccess(poster, "upload draft poster");
    const firstPosterSnapshot = await getDraftSnapshot();
    requireSuccess(firstPosterSnapshot.response, "read draft after poster upload");
    assertSnapshotShape(firstPosterSnapshot.data, "draft");
    const firstPosterUrl = firstPosterSnapshot.data.poster_url;
    check(typeof firstPosterUrl === "string" && firstPosterUrl.length > 0, "poster was not persisted");

    const share = await uploadDraftMaterial(
      "filmmakers/draft-materials/images?kind=share",
      await validPng(),
      "image/png",
      { "X-MSI-Filename": `${state.fixtureTag}-share.png` },
    );
    await requireUploadSuccess(share, "upload draft share image");
    const replacedPoster = await uploadDraftMaterial(
      "filmmakers/draft-materials/images?kind=poster",
      await validPng(),
      "image/png",
      { "X-MSI-Filename": `${state.fixtureTag}-poster-replacement.png` },
    );
    await requireUploadSuccess(replacedPoster, "replace draft poster");

    const deck = await uploadDraftMaterial(
      "filmmakers/draft-materials/pitch-deck",
      validPdf(),
      "application/pdf",
      { "X-MSI-Filename": filename },
    );
    await requireUploadSuccess(deck, "upload draft pitch deck");

    const persisted = await getDraftSnapshot();
    requireSuccess(persisted.response, "read saved draft materials");
    assertSnapshotShape(persisted.data, "draft");
    check(persisted.data.synopsis === synopsis, "synopsis did not survive a fresh read");
    check(persisted.data.trailer_url === trailerUrl, "trailer URL did not survive a fresh read");
    check(typeof persisted.data.poster_url === "string" && persisted.data.poster_url.length > 0,
      "replacement poster was not persisted");
    check(persisted.data.poster_url !== firstPosterUrl, "poster replacement did not replace the prior attachment");
    check(typeof persisted.data.share_image_url === "string" && persisted.data.share_image_url.length > 0,
      "share image was not persisted");
    check(typeof persisted.data.pitch_deck_url === "string" && persisted.data.pitch_deck_url.length > 0,
      "pitch deck was not persisted");
    check(persisted.data.pitch_deck_name === filename, "pitch-deck filename was not persisted");
    state.draftSnapshot = persisted.data;

    const badMime = await uploadDraftMaterial(
      "filmmakers/draft-materials/pitch-deck",
      validPdf(),
      "text/plain",
      { "X-MSI-Filename": `${testTag}.txt` },
    );
    requireRejected(badMime, "pitch-deck MIME validation");

    const tooLarge = await uploadDraftMaterial(
      "filmmakers/draft-materials/pitch-deck",
      Buffer.alloc(MAX_DECK_BYTES + 1, 0x41),
      "application/pdf",
      { "X-MSI-Filename": `${testTag}-oversize.pdf` },
    );
    requireRejected(tooLarge, "pitch-deck 20 MB limit");
  });

  await test("verified-account-claim-and-single-project-attachment", async () => {
    const claim = await jsonRequest("filmmakers/projects/claim", "POST", {
      draft_id: state.draftId,
    }, {
      visitorId: state.filmmakerVisitorId,
      draftId: state.draftId,
      token: state.firstToken,
    });
    requireSuccess(claim.response, "claim filmmaker draft");

    const wrongDraft = await apiRequest("filmmakers/draft-materials", {
      visitorId: state.filmmakerVisitorId,
      draftId: state.draftId + 1,
      token: state.firstToken,
    });
    requireRejected(wrongDraft, "wrong draft context");

    const submit = await jsonRequest("filmmakers", "POST", submissionBody(), {
      visitorId: state.filmmakerVisitorId,
      draftId: state.draftId,
      token: state.firstToken,
    });
    requireSuccess(submit.response, "authenticated filmmaker final submission");
    check(typeof submit.data?.project_id === "number", "submission did not return a project identifier");
    state.projectId = submit.data.project_id;
    const owned = await projectRecord();
    check(owned?.slug, "submitted project slug could not be resolved");
    state.projectSlug = owned.slug;

    const attached = await getProjectSnapshot({ token: state.firstToken });
    requireSuccess(attached.response, "read account-owned project materials");
    assertSnapshotShape(attached.data, "project");
    check(attached.data.synopsis === synopsis, "draft synopsis did not attach to the submitted project");
    check(attached.data.trailer_url === trailerUrl, "draft trailer URL did not attach to the submitted project");
    check(typeof attached.data.poster_url === "string" && attached.data.poster_url.length > 0,
      "draft poster did not attach to the submitted project");
    check(typeof attached.data.share_image_url === "string" && attached.data.share_image_url.length > 0,
      "draft share image did not attach to the submitted project");
    check(typeof attached.data.pitch_deck_url === "string" && attached.data.pitch_deck_url.length > 0,
      "draft deck did not attach to the submitted project");
    check(attached.data.pitch_deck_name === filename, "attached deck lost its filename");
    state.projectMaterials = attached.data;

    const repeatedRead = await getProjectSnapshot({ token: state.firstToken });
    requireSuccess(repeatedRead.response, "repeat account-owned project material read");
    check(repeatedRead.data?.pitch_deck_url === attached.data.pitch_deck_url
      && repeatedRead.data?.synopsis === synopsis, "project material attachment changed on repeated read");

    const count = await state.pool.query(
      `select count(*)::int as count
         from projects p
         join filmmakers f on f.id = p.filmmaker_id
        where p.id = $1 and f.firebase_uid = $2 and p.title = $3`,
      [state.projectId, state.firstUser.uid, `Integration project ${testTag}`],
    );
    check(count.rows[0]?.count === 1, "draft was not attached exactly once to the account-owned project");

  });

  await test("legacy-completed-submission-claim-allows-missing-draft-header", async () => {
    const detachedFilmmaker = await state.pool.query(
      `update filmmakers set firebase_uid = null
        where visitor_id = $1 and firebase_uid = $2
        returning id`,
      [state.filmmakerVisitorId, state.firstUser.uid],
    );
    check(detachedFilmmaker.rowCount === 1, "could not prepare the test-owned legacy completed submission");
    await state.pool.query(
      "delete from filmmaker_account_visitors where visitor_id = $1 and firebase_uid = $2",
      [state.filmmakerVisitorId, state.firstUser.uid],
    );

    const claim = await jsonRequest("filmmakers/projects/claim", "POST", {
      draft_id: state.draftId,
    }, {
      visitorId: state.filmmakerVisitorId,
      token: state.firstToken,
    });
    requireSuccess(claim.response, "claim legacy completed submission without X-MSI-Draft-Id");
    check(claim.data?.claimed === true
      && claim.data?.submission_claimed === true
      && claim.data?.project_id === state.projectId,
    "legacy completed claim did not restore ownership of the submitted project");
  });

  await test("different-account-cannot-read-private-materials", async () => {
    const draft = await apiRequest("filmmakers/draft-materials", {
      visitorId: state.filmmakerVisitorId,
      draftId: state.draftId,
      token: state.secondToken,
    });
    requireRejected(draft, "other-account draft materials read");

    const project = await apiRequest("filmmakers/project-materials", {
      visitorId: state.filmmakerVisitorId,
      projectId: state.projectId,
      token: state.secondToken,
    });
    requireRejected(project, "other-account project materials read");

    const ownerWithoutCookie = await apiRequest("filmmakers/project-materials", {
      projectId: state.projectId,
      token: state.firstToken,
    });
    requireSuccess(ownerWithoutCookie, "read account-owned project materials without a visitor cookie");

    const ownProjects = await apiJson("filmmakers/projects", { token: state.secondToken });
    requireSuccess(ownProjects.response, "read second account project list");
    const listed = Array.isArray(ownProjects.data?.projects) ? ownProjects.data.projects : [];
    check(!listed.some((item) => item.id === state.projectId),
      "project appeared in a different account's private project list");
  });

  await test("public-deck-eligibility-and-revocation", runPublicDeckEligibilityAndRevocation);

  await test("no-review-checkout-or-payment-created", async () => {
    const checkouts = await state.pool.query(
      "select count(*)::int as count from pitch_review_checkouts where project_id = $1",
      [state.projectId],
    );
    const project = await projectRecord();
    check(checkouts.rows[0]?.count === 0, "integration flow created a review checkout");
    check(project && project.review_paid_at === null, "integration flow marked review as paid");
  });
}

function isGeneratedStoragePath(storagePath) {
  return typeof storagePath === "string"
    && /^Movie Show Investing folder\/(?:filmmaker-drafts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|filmmakers\/[1-9][0-9]*)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp|pdf)$/i.test(storagePath);
}

function safeBunnyStorageUrl(storagePath) {
  if (!isGeneratedStoragePath(storagePath)) return null;
  const key = process.env.BUNNY_STORAGE_API_KEY?.trim();
  const zone = process.env.BUNNY_STORAGE_ZONE?.trim();
  const rawHost = process.env.BUNNY_STORAGE_HOST?.trim();
  if (!key || !zone || !rawHost) return null;
  let host;
  try {
    const parsed = new URL(rawHost.includes("://") ? rawHost : `https://${rawHost}`);
    const supported = new Set([
      "storage.bunnycdn.com", "ny.storage.bunnycdn.com", "la.storage.bunnycdn.com",
      "sg.storage.bunnycdn.com", "syd.storage.bunnycdn.com", "uk.storage.bunnycdn.com",
      "se.storage.bunnycdn.com", "br.storage.bunnycdn.com", "jh.storage.bunnycdn.com",
    ]);
    if (parsed.protocol !== "https:" || !supported.has(parsed.hostname.toLowerCase())
      || parsed.pathname !== "/" || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  const safePath = storagePath.split("/").map((part) => encodeURIComponent(part)).join("/");
  return {
    url: `https://${host}/${encodeURIComponent(zone)}/${safePath}`,
    key,
  };
}

async function ownedBunnyStoragePaths() {
  if (!state.pool || visitorIds.size === 0) return [];
  const ids = await ownedVisitorIds();
  if (ids.length === 0) return [];
  const paths = new Set();
  try {
    const draftRows = await state.pool.query(
      `select poster_storage_path, share_image_storage_path, pitch_deck_storage_path
         from filmmaker_draft_materials where visitor_id = any($1::text[])`,
      [ids],
    );
    for (const row of draftRows.rows) {
      for (const value of Object.values(row)) if (value) paths.add(value);
    }
    const projectRows = await state.pool.query(
      `select p.poster_storage_path, p.share_image_storage_path, p.pitch_deck_storage_path
         from projects p
         join filmmakers f on f.id = p.filmmaker_id
        where f.firebase_uid = any($1::text[]) or f.email = any($2::text[])`,
      [[state.firstUser?.uid, state.secondUser?.uid].filter(Boolean), state.fixtureEmails],
    );
    for (const row of projectRows.rows) {
      for (const value of Object.values(row)) if (value) paths.add(value);
    }
  } catch {
    // If the relevant material schema is not deployed, no upload can have been
    // persisted through the expected API; SQL cleanup below still runs.
    if (state.mediaTouched || state.draftSnapshot || state.projectMaterials) {
      throw new CheckFailure("could not inspect test-owned Bunny files for cleanup");
    }
    return [];
  }
  return [...paths];
}

async function deleteOwnedBunnyFiles(paths) {
  let deleted = 0;
  const unresolved = [];
  for (const path of paths) {
    const target = safeBunnyStorageUrl(path);
    if (!target) {
      unresolved.push(path);
      continue;
    }
    try {
      const headers = { AccessKey: target.key };
      const response = await fetch(target.url, {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok && response.status !== 404) {
        unresolved.push(path);
        continue;
      }
      let verification = await fetch(target.url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (verification.status === 404) {
        deleted += 1;
        continue;
      }
      if (verification.ok) {
        await verification.body?.cancel().catch(() => undefined);
        const retry = await fetch(target.url, {
          method: "DELETE",
          headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (!retry.ok && retry.status !== 404) {
          unresolved.push(path);
          continue;
        }
        verification = await fetch(target.url, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (verification.status === 404) {
          deleted += 1;
          continue;
        }
      }
      await verification.body?.cancel().catch(() => undefined);
      unresolved.push(path);
    } catch {
      unresolved.push(path);
    }
  }
  return { deleted, unresolved };
}

async function deleteOwnedMaterialRecordsViaApi() {
  if (!state.filmmakerVisitorId || !state.draftId) return;
  for (const kind of ["poster", "share", "trailer", "pitch-deck"]) {
    await apiRequest(`filmmakers/draft-materials/${kind}`, {
      method: "DELETE",
      visitorId: state.filmmakerVisitorId,
      draftId: state.draftId,
      token: state.firstToken,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
  if (!state.projectId) return;
  for (const kind of ["poster", "share", "trailer", "pitch-deck"]) {
    await apiRequest(`filmmakers/project-materials/${kind}`, {
      method: "DELETE",
      visitorId: state.filmmakerVisitorId,
      projectId: state.projectId,
      token: state.firstToken,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
}

async function cleanupDatabase() {
  if (!state.pool) return null;
  const counts = {
    projects: 0,
    filmmakers: 0,
    flowProgress: 0,
    draftMaterials: 0,
    accountLinks: 0,
    investors: 0,
    visitors: 0,
  };
  const uids = [state.firstUser?.uid, state.secondUser?.uid].filter(Boolean);
  const emails = state.fixtureEmails;
  const visitors = await ownedVisitorIds();
  await state.pool.query("begin");
  try {
    const filmmakers = await state.pool.query(
      `select id, visitor_id from filmmakers
        where firebase_uid = any($1::text[]) or email = any($2::text[])`,
      [uids, emails],
    );
    const filmmakerIds = filmmakers.rows.map((row) => row.id);
    for (const row of filmmakers.rows) if (row.visitor_id) visitors.push(row.visitor_id);
    const projects = filmmakerIds.length
      ? await state.pool.query("select id from projects where filmmaker_id = any($1::int[])", [filmmakerIds])
      : { rows: [] };
    const projectIds = projects.rows.map((row) => row.id);

    if (projectIds.length) {
      await state.pool.query("delete from pitch_review_checkouts where project_id = any($1::int[])", [projectIds]);
      counts.projects = (await state.pool.query(
        "delete from projects where id = any($1::int[])",
        [projectIds],
      )).rowCount;
    }
    if (filmmakerIds.length) {
      counts.filmmakers = (await state.pool.query(
        "delete from filmmakers where id = any($1::int[])",
        [filmmakerIds],
      )).rowCount;
    }

    const uniqueVisitors = [...new Set(visitors)];
    if (uniqueVisitors.length) {
      counts.flowProgress = (await state.pool.query(
        "delete from flow_progress where visitor_id = any($1::text[])",
        [uniqueVisitors],
      )).rowCount;
      counts.draftMaterials = (await state.pool.query(
        "delete from filmmaker_draft_materials where visitor_id = any($1::text[])",
        [uniqueVisitors],
      )).rowCount;
      counts.accountLinks = (await state.pool.query(
        "delete from filmmaker_account_visitors where visitor_id = any($1::text[])",
        [uniqueVisitors],
      )).rowCount;
    }
    const investorRows = await state.pool.query(
      `select id from investors
        where visitor_id = any($1::text[]) or email = any($2::text[]) or firebase_uid = any($3::text[])`,
      [uniqueVisitors, emails, uids],
    );
    const investorIds = investorRows.rows.map((row) => row.id);
    if (investorIds.length) {
      await state.pool.query("delete from investor_minimums where investor_id = any($1::int[])", [investorIds]);
      counts.investors = (await state.pool.query(
        "delete from investors where id = any($1::int[])",
        [investorIds],
      )).rowCount;
    }
    if (uniqueVisitors.length) {
      counts.visitors = (await state.pool.query(
        "delete from visitors where visitor_id = any($1::text[])",
        [uniqueVisitors],
      )).rowCount;
    }
    await state.pool.query("commit");
    return counts;
  } catch (error) {
    await state.pool.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function ownedVisitorIds() {
  if (!state.pool || visitorIds.size === 0) return [];
  const result = await state.pool.query(
    "select visitor_id from visitors where visitor_id = any($1::text[]) and ref_code_used = $2",
    [[...visitorIds], state.fixtureTag],
  );
  return result.rows.map((row) => row.visitor_id);
}

async function cleanup() {
  const failures = [];
  let bunnyPaths = [];
  let bunnyFilesDeleted = 0;
  let firebaseUsersDeleted = 0;
  let databaseCounts = null;
  state.unresolvedStoragePaths = [];
  const mediaExpected = state.mediaTouched || state.draftSnapshot || state.projectMaterials;
  if (mediaExpected) {
    try {
      bunnyPaths = await ownedBunnyStoragePaths();
    } catch {
      failures.push("media-path-inspection");
    }
  }
  if (mediaExpected) {
    if (!cleanupOnly) await deleteOwnedMaterialRecordsViaApi();
    try {
      const remoteCleanup = await deleteOwnedBunnyFiles(bunnyPaths);
      bunnyFilesDeleted = remoteCleanup.deleted;
      state.unresolvedStoragePaths = remoteCleanup.unresolved;
      if (remoteCleanup.unresolved.length) failures.push("bunny-file-deletion");
    } catch {
      failures.push("bunny-file-deletion");
    }
  }
  try {
    databaseCounts = await cleanupDatabase();
  } catch {
    failures.push("database-fixture-cleanup");
  }
  if (state.auth) {
    for (const user of [state.firstUser, state.secondUser]) {
      if (user?.uid) {
        try {
          await state.auth.deleteUser(user.uid);
          firebaseUsersDeleted += 1;
        } catch (error) {
          if (error?.code !== "auth/user-not-found") {
            const safeCode = typeof error?.code === "string" && /^[a-zA-Z0-9/_-]{1,64}$/.test(error.code)
              ? error.code
              : "unknown";
            failures.push(`firebase-test-user-deletion:${safeCode}`);
          }
        }
      }
    }
  }
  if (state.adminApp) {
    try {
      await state.adminApp.delete();
    } catch {
      failures.push("firebase-admin-app-shutdown");
    }
  }
  if (state.pool) {
    try {
      await state.pool.end();
    } catch {
      failures.push("database-pool-shutdown");
    }
  }
  return {
    success: failures.length === 0,
    failures,
    bunnyFilesDeleted,
    unresolvedStoragePaths: state.unresolvedStoragePaths,
    firebaseUsersDeleted,
    databaseCounts,
  };
}

async function writeFixtureFile() {
  check(state.firstUser?.uid && state.secondUser?.uid && state.auth, "synthetic browser-test identities are unavailable");
  check(state.browserHandoffVisitorId && Number.isSafeInteger(state.browserHandoffDraftId),
    "browser-handoff guest draft was not prepared");
  const payload = {
    version: 1,
    tag: state.fixtureTag,
    customToken: await state.auth.createCustomToken(state.firstUser.uid),
    otherCustomToken: await state.auth.createCustomToken(state.secondUser.uid),
    users: {
      filmmaker: { uid: state.firstUser.uid },
      other: { uid: state.secondUser.uid },
    },
    visitor_ids: [...visitorIds],
    filmmaker_visitor_id: state.filmmakerVisitorId,
    draft_id: state.draftId,
    browser_handoff_visitor_id: state.browserHandoffVisitorId,
    browser_handoff_draft_id: state.browserHandoffDraftId,
    project_id: state.projectId,
    media_created: Boolean(state.mediaTouched),
  };
  await writeFile(FIXTURE_FILE, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await chmod(FIXTURE_FILE, 0o600);
}

async function loadFixtureFile() {
  let fixture;
  try {
    const fileInfo = await stat(FIXTURE_FILE);
    if ((fileInfo.mode & 0o077) !== 0) throw new CheckFailure("fixture file permissions are not private");
    fixture = JSON.parse(await readFile(FIXTURE_FILE, "utf8"));
  } catch (error) {
    if (error instanceof CheckFailure) throw error;
    throw new CheckFailure("fixture file is missing or invalid");
  }
  const validUid = (value) => typeof value === "string" && value.length > 0;
  if (fixture?.version !== 1
    || typeof fixture.tag !== "string" || !/^msi-it-[0-9a-f]{18}$/.test(fixture.tag)
    || typeof fixture.customToken !== "string" || fixture.customToken.length === 0
    || typeof fixture.otherCustomToken !== "string" || fixture.otherCustomToken.length === 0
    || !validUid(fixture.users?.filmmaker?.uid)
    || !validUid(fixture.users?.other?.uid)
    || !Array.isArray(fixture.visitor_ids)
    || fixture.visitor_ids.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
    || typeof fixture.filmmaker_visitor_id !== "string"
    || !fixture.visitor_ids.includes(fixture.filmmaker_visitor_id)
    || typeof fixture.browser_handoff_visitor_id !== "string"
    || !fixture.visitor_ids.includes(fixture.browser_handoff_visitor_id)
    || (fixture.media_created !== undefined && typeof fixture.media_created !== "boolean")
    || !Number.isSafeInteger(fixture.browser_handoff_draft_id)) {
    throw new CheckFailure("fixture file does not contain valid test-owned IDs");
  }
  return fixture;
}

async function persistRetainedFixtureState() {
  const fixture = await loadFixtureFile();
  fixture.visitor_ids = [...new Set([...fixture.visitor_ids, ...visitorIds])];
  if (state.filmmakerVisitorId) fixture.filmmaker_visitor_id = state.filmmakerVisitorId;
  if (Number.isSafeInteger(state.draftId)) fixture.draft_id = state.draftId;
  if (Number.isSafeInteger(state.projectId)) fixture.project_id = state.projectId;
  fixture.media_created = fixture.media_created === true || state.mediaTouched;

  const temporaryPath = `${FIXTURE_FILE}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(fixture, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, FIXTURE_FILE);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function updateCleanupManifest(storagePaths) {
  const paths = [...new Set(storagePaths.filter(isGeneratedStoragePath))];
  const invalidCount = storagePaths.length - paths.length;
  if (paths.length === 0) {
    await unlink(CLEANUP_MANIFEST_FILE).catch(() => undefined);
    return { pathCount: 0, invalidCount };
  }
  const temporaryPath = `${CLEANUP_MANIFEST_FILE}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify({ version: 1, unresolved_storage_paths: paths }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, CLEANUP_MANIFEST_FILE);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return { pathCount: paths.length, invalidCount };
}

async function restoreRecordedFixtureState({ authenticate = true } = {}) {
  const fixture = await loadFixtureFile();
  state.fixtureTag = fixture.tag;
  state.firstUser = { uid: fixture.users.filmmaker.uid };
  state.secondUser = { uid: fixture.users.other.uid };
  state.fixtureEmails = [
    `${fixture.tag}-filmmaker@example.invalid`,
    `${fixture.tag}-other@example.invalid`,
    `${fixture.tag}-investor@example.invalid`,
  ];
  for (const visitorId of fixture.visitor_ids) visitorIds.add(visitorId);
  state.filmmakerVisitorId = fixture.filmmaker_visitor_id;
  state.draftId = Number.isSafeInteger(fixture.draft_id) ? fixture.draft_id : null;
  state.browserHandoffVisitorId = fixture.browser_handoff_visitor_id;
  state.browserHandoffDraftId = fixture.browser_handoff_draft_id;
  state.projectId = Number.isSafeInteger(fixture.project_id) ? fixture.project_id : null;
  state.mediaTouched = fixture.media_created === true
    || (fixture.media_created === undefined && Number.isSafeInteger(fixture.project_id));

  await initializeDatabase();
  await initializeFirebaseAdmin();
  const lookupFixtureUser = async (user, email, displayPrefix) => {
    let account;
    try {
      account = await state.auth.getUser(user.uid);
    } catch (error) {
      if (!authenticate && error?.code === "auth/user-not-found") return { uid: user.uid };
      throw error;
    }
    if (account.email !== email || account.emailVerified !== true
      || !account.displayName?.startsWith(displayPrefix)) return null;
    return account;
  };
  const firstAccount = await lookupFixtureUser(state.firstUser, state.fixtureEmails[0], "Integration filmmaker ");
  const secondAccount = await lookupFixtureUser(state.secondUser, state.fixtureEmails[1], "Integration account ");
  if (!firstAccount || !secondAccount) {
    throw new CheckFailure("recorded account IDs do not match fresh synthetic test identities");
  }
  state.firstUser = firstAccount;
  state.secondUser = secondAccount;
  if (authenticate) {
    await initializeFirebaseWebConfig();
    const firstCredential = await mintCredential(state.firstUser.uid, "first");
    state.firstToken = firstCredential.idToken;
    const secondCredential = await mintCredential(state.secondUser.uid, "second");
    state.secondToken = secondCredential.idToken;
  }
  if (state.projectId !== null) {
    const project = await projectRecord();
    if (project?.slug) state.projectSlug = project.slug;
  }
  return fixture;
}

async function resumeFailedMediaPublicChecks() {
  await restoreRecordedFixtureState({ authenticate: true });

  const priorProject = await projectRecord();
  check(priorProject?.slug, "retained account project slug could not be resolved from owned database data");
  state.projectSlug = priorProject.slug;
  console.log("DIAG retained_project_slug=FOUND_FROM_OWNED_DATABASE_ROW");

  const draft = await createGuestFilmmakerDraft("Media resume");
  state.filmmakerVisitorId = draft.visitorId;
  state.draftId = draft.draftId;
  await persistRetainedFixtureState();

  const resumeSynopsis = `Focused media transfer ${state.fixtureTag}`;
  const resumeTrailer = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const resumeFilename = `${state.fixtureTag}-media-resume.pdf`;
  const projectTitle = `Integration project ${state.fixtureTag} media-resume`;
  const patch = await jsonRequest("filmmakers/draft-materials", "PATCH", {
    synopsis: resumeSynopsis,
    trailer_url: resumeTrailer,
  }, {
    visitorId: state.filmmakerVisitorId,
    draftId: state.draftId,
  });
  requireSuccess(patch.response, "save focused guest draft materials");

  const png = await validPng();
  const missingFilename = await uploadDraftMaterial(
    "filmmakers/draft-materials/images?kind=poster",
    png,
    "image/png",
  );
  const missingFilenameCode = await safeUploadErrorCode(missingFilename);
  check(missingFilename.status === 400 && missingFilenameCode === "UPLOAD_FILENAME_REQUIRED_OR_INVALID",
    `missing-filename diagnostic returned HTTP ${missingFilename.status} (${missingFilenameCode})`);
  console.log("DIAG poster_upload_400=UPLOAD_FILENAME_REQUIRED_OR_INVALID");

  const poster = await uploadDraftMaterial(
    "filmmakers/draft-materials/images?kind=poster",
    png,
    "image/png",
    { "X-MSI-Filename": `${state.fixtureTag}-media-poster.png` },
  );
  await requireUploadSuccess(poster, "upload focused draft poster");
  const firstSnapshot = await getDraftSnapshot();
  requireSuccess(firstSnapshot.response, "read focused draft after poster upload");
  check(typeof firstSnapshot.data?.poster_url === "string" && firstSnapshot.data.poster_url.length > 0,
    "focused poster was not persisted");
  const firstPosterUrl = firstSnapshot.data.poster_url;

  const share = await uploadDraftMaterial(
    "filmmakers/draft-materials/images?kind=share",
    png,
    "image/png",
    { "X-MSI-Filename": `${state.fixtureTag}-media-share.png` },
  );
  await requireUploadSuccess(share, "upload focused draft share image");
  const replacement = await uploadDraftMaterial(
    "filmmakers/draft-materials/images?kind=poster",
    png,
    "image/png",
    { "X-MSI-Filename": `${state.fixtureTag}-media-poster-replacement.png` },
  );
  await requireUploadSuccess(replacement, "replace focused draft poster");

  const deck = await uploadDraftMaterial(
    "filmmakers/draft-materials/pitch-deck",
    validPdf(),
    "application/pdf",
    { "X-MSI-Filename": resumeFilename },
  );
  await requireUploadSuccess(deck, "upload focused draft pitch deck");

  const persisted = await getDraftSnapshot();
  requireSuccess(persisted.response, "read focused persisted draft materials");
  check(persisted.data.synopsis === resumeSynopsis && persisted.data.trailer_url === resumeTrailer,
    "focused draft text materials were not persisted");
  check(typeof persisted.data.poster_url === "string" && persisted.data.poster_url !== firstPosterUrl,
    "focused poster replacement was not persisted");
  check(typeof persisted.data.share_image_url === "string" && persisted.data.share_image_url.length > 0,
    "focused share image was not persisted");
  check(typeof persisted.data.pitch_deck_url === "string" && persisted.data.pitch_deck_url.length > 0
    && persisted.data.pitch_deck_name === resumeFilename,
  "focused pitch deck was not persisted with its filename");
  state.draftSnapshot = persisted.data;

  const draftPdf = await apiRequest(
    `filmmakers/draft-materials/pitch-deck?draft_id=${state.draftId}`,
    { visitorId: state.filmmakerVisitorId, draftId: state.draftId },
  );
  check(draftPdf.ok, `draft pitch-deck read returned HTTP ${draftPdf.status}`);
  check(draftPdf.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/pdf",
    "draft pitch-deck read returned an unexpected content type");
  const draftPdfBytes = Buffer.from(await draftPdf.arrayBuffer());
  check(draftPdfBytes.length >= 5 && draftPdfBytes.toString("ascii", 0, 5) === "%PDF-",
    "draft pitch-deck read did not contain a PDF signature");

  const claim = await jsonRequest("filmmakers/projects/claim", "POST", {
    draft_id: state.draftId,
  }, {
    visitorId: state.filmmakerVisitorId,
    draftId: state.draftId,
    token: state.firstToken,
  });
  requireSuccess(claim.response, "claim focused media draft");

  const submit = await jsonRequest(
    "filmmakers",
    "POST",
    submissionBody(state.fixtureEmails[0], projectTitle, state.fixtureTag),
    {
      visitorId: state.filmmakerVisitorId,
      draftId: state.draftId,
      token: state.firstToken,
    },
  );
  requireSuccess(submit.response, "submit focused media-transfer project");
  check(typeof submit.data?.project_id === "number", "focused submission did not return a project identifier");
  state.projectId = submit.data.project_id;
  const owned = await projectRecord();
  check(owned?.slug, "focused project slug could not be resolved from its owned database row");
  state.projectSlug = owned.slug;
  await persistRetainedFixtureState();

  const attached = await getProjectSnapshot({ token: state.firstToken });
  requireSuccess(attached.response, "read focused project materials after draft transfer");
  check(attached.data.synopsis === resumeSynopsis && attached.data.trailer_url === resumeTrailer,
    "focused draft text materials did not transfer to the project");
  check(typeof attached.data.poster_url === "string" && attached.data.poster_url === persisted.data.poster_url,
    "focused draft poster did not transfer to the project");
  check(typeof attached.data.share_image_url === "string" && attached.data.share_image_url === persisted.data.share_image_url,
    "focused draft share image did not transfer to the project");
  check(typeof attached.data.pitch_deck_url === "string" && attached.data.pitch_deck_url.length > 0
    && attached.data.pitch_deck_name === resumeFilename,
  "focused draft pitch deck did not transfer to the project");
  state.projectMaterials = attached.data;
  state.mediaTouched = true;
  await persistRetainedFixtureState();

  await runPublicDeckEligibilityAndRevocation();
  await persistRetainedFixtureState();
}

async function cleanupRecordedFixtures() {
  await restoreRecordedFixtureState({ authenticate: false });
  const cleanupResult = await cleanup();
  let manifestResult = { pathCount: 0, invalidCount: 0 };
  let manifestFailed = false;
  try {
    manifestResult = await updateCleanupManifest(cleanupResult.unresolvedStoragePaths);
  } catch {
    manifestFailed = true;
  }
  let fixtureRemoved = false;
  try {
    await unlink(FIXTURE_FILE);
    fixtureRemoved = true;
  } catch (error) {
    if (error?.code === "ENOENT") fixtureRemoved = true;
  }

  const counts = cleanupResult.databaseCounts ?? {};
  console.log(
    `cleanup_counts visitors=${counts.visitors ?? 0} flow_rows=${counts.flowProgress ?? 0} `
    + `projects=${counts.projects ?? 0} filmmakers=${counts.filmmakers ?? 0} `
    + `bunny_paths_absent=${cleanupResult.bunnyFilesDeleted} `
    + `unresolved_paths=${cleanupResult.unresolvedStoragePaths.length} `
    + `firebase_users_deleted=${cleanupResult.firebaseUsersDeleted} `
    + `fixture_removed=${fixtureRemoved} manifest_paths=${manifestResult.pathCount}`,
  );
  const failures = [...cleanupResult.failures];
  if (manifestFailed) failures.push("cleanup-manifest-write");
  if (manifestResult.invalidCount) failures.push("cleanup-manifest-path-validation");
  if (!fixtureRemoved) failures.push("credential-fixture-removal");
  if (failures.length) {
    throw new CheckFailure(`test-owned fixture cleanup incomplete (${failures.join(",")})`);
  }
}

async function main() {
  const supportedArgs = new Set(["--keep-fixtures", "--cleanup", "--resume-failed-media-public"]);
  if ([...args].some((arg) => !supportedArgs.has(arg))
    || (keepFixtures && cleanupOnly)
    || (resumeFailedMediaPublic && (keepFixtures || cleanupOnly))) {
    console.log("FAIL integration-runner — choose one supported mode: --keep-fixtures, --cleanup, or --resume-failed-media-public");
    process.exitCode = 1;
    return;
  }

  if (cleanupOnly) {
    await test("cleanup-recorded-browser-test-fixtures", cleanupRecordedFixtures);
    if (results.some((result) => !result.passed)) process.exitCode = 1;
    return;
  }

  if (resumeFailedMediaPublic) {
    resumeFixtureMode = true;
    await test("focused-resume-media-transfer-and-public-eligibility", resumeFailedMediaPublicChecks);
    resumeFixtureMode = false;
    let shutdownPassed = true;
    if (state.adminApp) await state.adminApp.delete().catch(() => { shutdownPassed = false; });
    if (state.pool) await state.pool.end().catch(() => { shutdownPassed = false; });
    if (!shutdownPassed) {
      console.log("FAIL focused-resume-client-shutdown — a local Firebase or database client did not shut down cleanly");
      results.push({ name: "focused-resume-client-shutdown", passed: false });
    }
    if (results.some((result) => !result.passed)) process.exitCode = 1;
    return;
  }

  await test("integration-prerequisites-and-fresh-synthetic-identities", async () => {
    check(API_BASE.startsWith("http://localhost:80/api") || process.env.MSI_TEST_API_BASE_URL,
      "API proxy URL must use the local /api proxy unless explicitly overridden");
    await initializeDatabase();
    await initializeFirebaseIdentities();
  });

  if (state.firstToken && state.secondToken && state.pool) {
    await runFunctionalTests();
    if (keepFixtures) {
      await test("prepare-browser-account-handoff-fixture", prepareBrowserHandoffDraft);
    }
  } else {
    for (const name of [
      "anonymous-investor-entry-is-server-rejected",
      "prepare-guest-claim-context-regression-fixtures",
      "new-guest-claim-requires-draft-header",
      "new-guest-claim-rejects-header-for-another-visitor",
      "matching-new-draft-claim-establishes-account-draft",
      "authenticated-unclaimed-submit-rejected-without-auto-linking",
      "claim-of-unclaimed-draft-reports-existing-account-draft-conflict",
      "guest-filmmaker-draft-and-final-auth-gate",
      "draft-synopsis-image-and-pdf-persistence-and-validation",
      "verified-account-claim-and-single-project-attachment",
      "legacy-completed-submission-claim-allows-missing-draft-header",
      "different-account-cannot-read-private-materials",
      "public-deck-eligibility-and-revocation",
      "no-review-checkout-or-payment-created",
    ]) {
      results.push({ name, passed: false });
      console.log(`FAIL ${name} — integration prerequisites failed`);
    }
  }

  let cleanupPassed = true;
  if (keepFixtures) {
    const browserFixtureReady = Boolean(state.firstToken && state.secondToken
      && state.firstUser && state.secondUser && state.auth
      && state.browserHandoffVisitorId && Number.isSafeInteger(state.browserHandoffDraftId));
    let fixtureSaved = false;
    let fixtureFailure = browserFixtureReady
      ? "protected fixture file could not be created"
      : "setup did not produce browser-ready identities";
    if (browserFixtureReady) {
      try {
        await writeFixtureFile();
        fixtureSaved = true;
        console.log(FIXTURE_FILE);
      } catch {
        // Do not expose filesystem details or any token values.
      }
    }
    if (!fixtureSaved) {
      console.log(`FAIL protected-browser-test-fixtures — ${fixtureFailure}`);
      const cleanupResult = await cleanup();
      cleanupPassed = cleanupResult.success;
      console.log(`${cleanupPassed ? "PASS" : "FAIL"} test-owned-fixture-cleanup${cleanupPassed ? "" : ` — failed phases: ${cleanupResult.failures.join(",")}`}`);
      results.push({ name: "test-owned-fixture-cleanup", passed: cleanupPassed });
    } else {
      if (state.adminApp) await state.adminApp.delete().catch(() => { cleanupPassed = false; });
      if (state.pool) await state.pool.end().catch(() => { cleanupPassed = false; });
      if (!cleanupPassed) console.log("FAIL test-runner-resource-shutdown — a local Firebase or database client did not shut down cleanly");
    }
    results.push({ name: "protected-browser-test-fixtures", passed: fixtureSaved && cleanupPassed });
  } else {
    const cleanupResult = await cleanup();
    cleanupPassed = cleanupResult.success;
    console.log(`${cleanupPassed ? "PASS" : "FAIL"} test-owned-fixture-cleanup${cleanupPassed ? "" : ` — failed phases: ${cleanupResult.failures.join(",")}`}`);
    results.push({ name: "test-owned-fixture-cleanup", passed: cleanupPassed });
  }
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

await main().catch(async () => {
  console.log("FAIL integration-runner — unexpected setup or teardown error");
  const cleanupResult = await cleanup().catch(() => ({ success: false, failures: ["cleanup-aborted"] }));
  console.log(`${cleanupResult.success ? "PASS" : "FAIL"} test-owned-fixture-cleanup${cleanupResult.success ? "" : ` — failed phases: ${cleanupResult.failures.join(",")}`}`);
  process.exitCode = 1;
});