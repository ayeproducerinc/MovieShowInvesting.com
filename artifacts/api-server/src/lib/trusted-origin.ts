import type { Request } from "express";

// Same-origin check for cookie-bearing requests (e.g. referrals). The allowed
// hosts are the site's deployment domains, or AUTH_PUBLIC_ORIGIN when set.
function trustedHosts(): Set<string> {
  return new Set(
    [process.env.REPLIT_DOMAINS, process.env.REPLIT_DEV_DOMAIN]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function getTrustedOrigin(req: Request): string {
  const incomingHost = (req.get("x-forwarded-host") ?? req.get("host") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (!incomingHost || incomingHost.includes("@")) {
    throw new Error("Request host is not trusted for authentication.");
  }

  let parsedHost: URL;
  try {
    parsedHost = new URL(`https://${incomingHost}`);
  } catch {
    throw new Error("Request host is not trusted for authentication.");
  }
  if (parsedHost.username || parsedHost.password || parsedHost.pathname !== "/") {
    throw new Error("Request host is not trusted for authentication.");
  }

  const configuredOrigin = process.env.AUTH_PUBLIC_ORIGIN;
  if (configuredOrigin) {
    let publicUrl: URL;
    try {
      publicUrl = new URL(configuredOrigin);
    } catch {
      throw new Error("AUTH_PUBLIC_ORIGIN must be a valid origin.");
    }
    if (
      publicUrl.protocol !== "https:" ||
      publicUrl.username ||
      publicUrl.password ||
      publicUrl.pathname !== "/" ||
      publicUrl.search ||
      publicUrl.hash ||
      publicUrl.host.toLowerCase() !== incomingHost
    ) {
      throw new Error("Request host does not match AUTH_PUBLIC_ORIGIN.");
    }
    return publicUrl.origin;
  }

  const domains = trustedHosts();
  const allowed =
    domains.has(parsedHost.hostname.toLowerCase()) &&
    (!parsedHost.port || parsedHost.port === "443");
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsedHost.hostname) &&
    (!parsedHost.port || /^\d{1,5}$/.test(parsedHost.port));
  if (!allowed && !localDevelopment) {
    throw new Error("Request host is not trusted for authentication.");
  }

  return `${localDevelopment && req.get("x-forwarded-proto") === "http" ? "http" : "https"}://${parsedHost.host}`;
}
