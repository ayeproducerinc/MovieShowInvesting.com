import { randomUUID } from "node:crypto";
import {
  ensureVisitor,
  getFilmmakerAccountVisitorOwner,
  getInvestorAccountVisitorOwner,
} from "@workspace/db";
import {
  GetCurrentAuthUserResponse,
  LogoutBrowserSessionResponse,
} from "@workspace/api-zod";
import { Router, type IRouter, type Request, type Response } from "express";

import {
  clearSecureCookie,
  deleteSession,
  getSafeReturnTo,
  getTrustedOrigin,
  OIDC_COOKIE_PREFIX,
  SESSION_COOKIE,
  setSecureCookie,
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

router.get("/auth/user", (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.get("/login", (_req: Request, res: Response) => {
  clearOidcCookies(res);
  res.redirect(302, "/me/projects");
});

router.get("/callback", (_req: Request, res: Response) => {
  clearOidcCookies(res);
  res.status(410).send("This sign-in method is unavailable. Use Sign in at /me/projects.");
});

router.post("/logout", async (req: Request, res: Response) => {
  const origin = getTrustedOrigin(req);
  const returnTo = getSafeReturnTo(req.query.returnTo, origin);
  const sid = req.cookies?.[SESSION_COOKIE];
  let freshVisitorId: string | null = null;
  if (req.isAuthenticated() && req.user) {
    const visitorId = req.cookies?.[VISITOR_COOKIE];
    if (typeof visitorId === "string" && UUID.test(visitorId)) {
      const [filmmakerOwner, investorOwner] = await Promise.all([
        getFilmmakerAccountVisitorOwner(visitorId),
        getInvestorAccountVisitorOwner(visitorId),
      ]);
      const filmmakerOwnsVisitor = filmmakerOwner?.provider === "replit" && filmmakerOwner.uid === req.user.id;
      const investorOwnsVisitor = investorOwner?.replitUid === req.user.id;
      if (filmmakerOwnsVisitor || investorOwnsVisitor) {
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