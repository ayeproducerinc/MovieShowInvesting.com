const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_SITE_KEY_ENV = "CLOUDFLARE_TURNSTILE_SITE_KEY";
const TURNSTILE_SECRET_KEY_ENV = "CLOUDFLARE_TURNSTILE_SECRET_KEY";

export type TurnstileConfig = {
  siteKey: string | null;
  secretKey: string | null;
};

function readEnv(primary: string, legacy: string): string | null {
  const value = (process.env[primary] ?? process.env[legacy])?.trim();
  return value || null;
}

export function getTurnstileConfig(): TurnstileConfig {
  return {
    siteKey: readEnv(TURNSTILE_SITE_KEY_ENV, "TURNSTILE_SITE_KEY"),
    secretKey: readEnv(TURNSTILE_SECRET_KEY_ENV, "TURNSTILE_SECRET_KEY"),
  };
}

export function normalizeTurnstileHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function allowedTurnstileHostnames(): string[] {
  const hosts = new Set<string>();
  const publicUrl = process.env.PUBLIC_APP_URL?.trim();
  if (publicUrl) {
    try {
      const url = new URL(publicUrl);
      if (url.protocol === "https:") hosts.add(normalizeTurnstileHostname(url.hostname));
    } catch {
      // A malformed canonical URL must not authorize an arbitrary hostname.
    }
  }
  if (process.env.NODE_ENV === "development") {
    const developmentDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
    if (developmentDomain && /^[a-z0-9.-]+$/i.test(developmentDomain)) {
      hosts.add(normalizeTurnstileHostname(developmentDomain));
    }
  }
  return [...hosts];
}

export async function verifyTurnstileToken(
  token: string,
  options: { ip?: string; action: string },
): Promise<boolean> {
  const { secretKey } = getTurnstileConfig();
  const allowedHosts = allowedTurnstileHostnames();
  if (!secretKey || !allowedHosts.length) return false;

  try {
    const body = new URLSearchParams({
      secret: secretKey,
      response: token,
      ...(options.ip ? { remoteip: options.ip } : {}),
    });
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;

    const result: unknown = await response.json();
    if (result === null || typeof result !== "object") return false;
    const verification = result as { success?: unknown; action?: unknown; hostname?: unknown };
    return verification.success === true
      && verification.action === options.action
      && typeof verification.hostname === "string"
      && allowedHosts.includes(normalizeTurnstileHostname(verification.hostname));
  } catch {
    return false;
  }
}
