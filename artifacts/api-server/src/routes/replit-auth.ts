import { randomUUID } from "node:crypto";
import {
  ensureVisitor,
  getFilmmakerAccountVisitorOwner,
} from "@workspace/db";
import {
  GetCurrentAuthUserResponse,
  LogoutBrowserSessionResponse,
} from "@workspace/api-zod";
import { Router, type IRouter, type Request, type Response } from "express";
import * as oidc from "openid-client";

import {
  clearSecureCookie,
  createSession,
  deleteSession,
  getOidcConfig,
  getSafeReturnTo,
  getTrustedOrigin,
  OIDC_COOKIE_PREFIX,
  OIDC_TTL,
  SESSION_COOKIE,
  SESSION_TTL,
  setSecureCookie,
  upsertVerifiedOidcUser,
} from "../lib/replit-auth";

const router: IRouter = Router();
const OIDC_COOKIE_NAMES = ["state", "nonce", "verifier", "returnTo"] as const;
const VISITOR_COOKIE = "msi_visitor_id";
const VISITOR_COOKIE_TTL = 365 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clearOidcCookies(res: Response): void {
  for (const name of OIDC_COOKIE_NAMES) {
    clearSecureCookie(res, `${OIDC_COOKIE_PREFIX}${name}`);
  }
}

function setFreshVisitorCookie(req: Request, res: Response, visitorId: string): void {
  res.cookie(VISITOR_COOKIE, visitorId, {
    maxAge: VISITOR_COOKIE_TTL,
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    path: "/",
  });
}

function getCallbackUrl(req: Request, origin: string): URL {
  const callbackUrl = new URL(req.originalUrl, origin);
  if (callbackUrl.origin !== origin || callbackUrl.pathname !== "/api/callback") {
    throw new Error("OIDC callback URL does not match the trusted origin.");
  }
  return callbackUrl;
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.get("/login", async (req: Request, res: Response) => {
  const origin = getTrustedOrigin(req);
  const config = await getOidcConfig();
  const callbackUrl = `${origin}/api/callback`;
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const authorizationUrl = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });

  setSecureCookie(res, `${OIDC_COOKIE_PREFIX}state`, state, OIDC_TTL);
  setSecureCookie(res, `${OIDC_COOKIE_PREFIX}nonce`, nonce, OIDC_TTL);
  setSecureCookie(res, `${OIDC_COOKIE_PREFIX}verifier`, codeVerifier, OIDC_TTL);
  setSecureCookie(
    res,
    `${OIDC_COOKIE_PREFIX}returnTo`,
    getSafeReturnTo(req.query.returnTo, origin),
    OIDC_TTL,
  );
  res.redirect(authorizationUrl.href);
});

router.get("/callback", async (req: Request, res: Response) => {
  let origin: string;
  try {
    origin = getTrustedOrigin(req);
  } catch {
    res.status(400).send("Authentication callback host is not trusted.");
    return;
  }

  const state = req.cookies?.[`${OIDC_COOKIE_PREFIX}state`];
  const nonce = req.cookies?.[`${OIDC_COOKIE_PREFIX}nonce`];
  const codeVerifier = req.cookies?.[`${OIDC_COOKIE_PREFIX}verifier`];
  const returnTo = getSafeReturnTo(req.cookies?.[`${OIDC_COOKIE_PREFIX}returnTo`], origin);
  clearOidcCookies(res);
  if (
    typeof state !== "string" ||
    typeof nonce !== "string" ||
    typeof codeVerifier !== "string"
  ) {
    res.status(400).send("Authentication request expired. Please sign in again.");
    return;
  }

  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    const config = await getOidcConfig();
    tokens = await oidc.authorizationCodeGrant(config, getCallbackUrl(req, origin), {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
      expectedNonce: nonce,
      idTokenExpected: true,
    });
  } catch {
    res.status(401).send("Sign-in verification failed. Please start again.");
    return;
  }

  const claims = tokens.claims();
  if (!claims) {
    res.status(401).send("The identity provider did not return a verified identity.");
    return;
  }

  let user;
  try {
    user = await upsertVerifiedOidcUser(claims);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("verified email") || error.message.includes("invalid email"))
    ) {
      res.status(403).send("Sign-in requires a valid, verified email address.");
      return;
    }
    throw error;
  }

  const sid = await createSession(user);
  setSecureCookie(res, SESSION_COOKIE, sid, SESSION_TTL);
  res.redirect(returnTo);
});

router.post("/logout", async (req: Request, res: Response) => {
  const origin = getTrustedOrigin(req);
  const returnTo = getSafeReturnTo(req.query.returnTo, origin);
  const sid = req.cookies?.[SESSION_COOKIE];
  let freshVisitorId: string | null = null;
  if (req.isAuthenticated() && req.user) {
    const visitorId = req.cookies?.[VISITOR_COOKIE];
    if (typeof visitorId === "string" && UUID.test(visitorId)) {
      const owner = await getFilmmakerAccountVisitorOwner(visitorId);
      if (owner?.provider === "replit" && owner.uid === req.user.id) {
        freshVisitorId = randomUUID();
        await ensureVisitor(freshVisitorId);
      }
    }
  }

  if (typeof sid === "string" && /^[a-f0-9]{64}$/.test(sid)) {
    await deleteSession(sid);
  }
  clearSecureCookie(res, SESSION_COOKIE);
  if (freshVisitorId) {
    setFreshVisitorCookie(req, res, freshVisitorId);
  }
  res.json(LogoutBrowserSessionResponse.parse({ success: true, returnTo }));
});

export default router;