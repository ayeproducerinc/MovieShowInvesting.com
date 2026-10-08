import type { Request, Response } from "express";

/** Per-instance, per-IP fixed-window limiter. Returns false after sending 429. */
export function perIpLimit(options: { limit: number; windowMs: number; message: string }) {
  const attempts = new Map<string, { count: number; until: number }>();
  return (req: Request, res: Response): boolean => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    const old = attempts.get(key);
    const entry = old && old.until > now ? old : { count: 0, until: now + options.windowMs };
    entry.count++;
    attempts.set(key, entry);
    if (attempts.size > 2000) {
      for (const [ip, value] of attempts) if (value.until <= now) attempts.delete(ip);
      if (attempts.size > 2000) attempts.delete(attempts.keys().next().value!);
    }
    if (entry.count <= options.limit) return true;
    res.set("Retry-After", String(Math.ceil(options.windowMs / 1000)));
    res.status(429).json({ error: options.message });
    return false;
  };
}
