import { Router, type IRouter } from "express";
import { SearchLocationsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const PROVIDER_URL = "https://geodb-free-service.wirefreethought.com/v1/geo/cities";
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 100;
const MIN_PROVIDER_INTERVAL_MS = 250;
const LOCATION_LIMIT = 10;

type LocationSuggestion = {
  city: string;
  region: string;
  country: string;
  country_code: string;
};

const cache = new Map<string, { locations: LocationSuggestion[]; expiresAt: number }>();
let providerQueue: Promise<void> = Promise.resolve();
let lastProviderRequestAt = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProviderLocations(value: unknown): LocationSuggestion[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.data) || value.data.length > LOCATION_LIMIT) return undefined;

  const locations: LocationSuggestion[] = [];
  for (const entry of value.data) {
    if (!isRecord(entry)
      || typeof entry.city !== "string"
      || !entry.city.trim()
      || (typeof entry.region !== "string" && entry.region !== null && entry.region !== undefined)
      || typeof entry.country !== "string"
      || !entry.country.trim()
      || typeof entry.countryCode !== "string"
      || !/^[A-Z]{2}$/.test(entry.countryCode)) {
      return undefined;
    }
    locations.push({
      city: entry.city.trim(),
      region: typeof entry.region === "string" ? entry.region.trim() : "",
      country: entry.country.trim(),
      country_code: entry.countryCode,
    });
  }
  return locations;
}

async function waitForProviderTurn(): Promise<void> {
  const previous = providerQueue;
  let release!: () => void;
  providerQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const waitMs = Math.max(0, MIN_PROVIDER_INTERVAL_MS - (Date.now() - lastProviderRequestAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastProviderRequestAt = Date.now();
  } finally {
    release();
  }
}

function saveToCache(key: string, locations: LocationSuggestion[]): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { locations, expiresAt: Date.now() + CACHE_TTL_MS });
}

router.get("/locations", async (req, res): Promise<void> => {
  const rawQuery = req.query.query;
  const query = typeof rawQuery === "string" ? rawQuery.trim().replace(/\s+/g, " ") : "";
  if (query.length < 2 || query.length > 80) {
    res.status(400).json({ error: "Location search queries must be between 2 and 80 characters." });
    return;
  }

  const cacheKey = query.toLocaleLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.json(SearchLocationsResponse.parse({ locations: cached.locations }));
    return;
  }
  if (cached) cache.delete(cacheKey);

  try {
    await waitForProviderTurn();
    const url = new URL(PROVIDER_URL);
    url.search = new URLSearchParams({
      namePrefix: query,
      types: "CITY",
      limit: String(LOCATION_LIMIT),
      sort: "-population",
    }).toString();
    const upstream = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!upstream.ok) {
      req.log.warn({ status: upstream.status }, "Location provider returned a non-success status");
      res.status(upstream.status === 429 || upstream.status >= 500 ? 503 : 502).json({
        error: "Location suggestions are temporarily unavailable. Please try again.",
      });
      return;
    }

    let payload: unknown;
    try {
      payload = await upstream.json();
    } catch {
      req.log.warn("Location provider returned invalid JSON");
      res.status(502).json({ error: "Location provider returned an invalid response." });
      return;
    }
    const locations = parseProviderLocations(payload);
    if (!locations) {
      req.log.warn("Location provider returned invalid location data");
      res.status(502).json({ error: "Location provider returned an invalid response." });
      return;
    }

    const result = SearchLocationsResponse.parse({ locations });
    saveToCache(cacheKey, result.locations);
    res.json(result);
  } catch (error) {
    req.log.warn({ err: error }, "Location provider request failed");
    res.status(503).json({ error: "Location suggestions are temporarily unavailable. Please try again." });
  }
});

export default router;