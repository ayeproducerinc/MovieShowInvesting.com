import type { AuthUser } from "@workspace/api-zod";
import type { NextFunction, Request, Response } from "express";

import {
  clearSecureCookie,
  deleteSession,
  getSession,
  getTrustedOrigin,
  SESSION_COOKIE,
} from "../lib/replit-auth";

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User | undefined;
    }

    interface AuthedRequest {
      user: User;
    }
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function replitAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = req.cookies?.[SESSION_COOKIE];
  const oidcCallback = req.method.toUpperCase() === "GET" && req.path === "/api/callback";
  if (sid && !oidcCallback) {
    try {
      const trustedOrigin = getTrustedOrigin(req);
      const requestOrigin = req.get("origin");
      if (
        (requestOrigin && requestOrigin !== trustedOrigin) ||
        (!SAFE_METHODS.has(req.method.toUpperCase()) && !requestOrigin)
      ) {
        res.status(403).json({ error: "Same-origin request required." });
        return;
      }
    } catch {
      res.status(403).json({ error: "Request origin is not trusted." });
      return;
    }
  }

  if (typeof sid !== "string" || !/^[a-f0-9]{64}$/.test(sid)) {
    next();
    return;
  }

  try {
    const session = await getSession(sid);
    if (!session?.user?.id || !session.user.email) {
      await deleteSession(sid);
      clearSecureCookie(res, SESSION_COOKIE);
      next();
      return;
    }
    req.user = session.user;
    next();
  } catch (error) {
    next(error);
  }
}
