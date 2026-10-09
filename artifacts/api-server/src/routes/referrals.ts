import { Router, type IRouter, type Request, type Response } from "express";
import {
  CaptureReferralBody, CaptureReferralResponse, ClaimReferralResponse, GetMyReferralsResponse,
  GetAdminReferralsQueryParams, GetAdminReferralsResponse, VerifyReferralRewardParams,
  VerifyReferralRewardResponse, RecordReferralPayoutParams, RecordReferralPayoutBody, RecordReferralPayoutResponse,
} from "@workspace/api-zod";
import { authenticateFilmmaker } from "../lib/filmmaker-auth";
import { authorizeAdminIdentity } from "../lib/admin-auth";
import { getTrustedOrigin } from "../lib/trusted-origin";
import {
  captureReferral, enrollReferralMember, memberReferrals, referralLedger, referralIdentityId,
  refreshReferralReward, recordReferralPayout, ReferralError,
} from "../lib/referrals";

const router: IRouter = Router();
const COOKIE = "msi_referral";
const attempts = new Map<string, { count: number; until: number }>();
router.use("/referrals", (_req,res,next) => { res.set("Cache-Control","private, no-store"); next(); });
router.use("/admin/referrals", (_req,res,next) => { res.set("Cache-Control","private, no-store"); next(); });

function sameOrigin(req: Request, res: Response): boolean {
  // Bearer clients aren't ambient-cookie authenticated; still reject foreign origins.
  const origin = req.get("origin");
  if (!origin) {
    if (req.get("authorization")) return true;
    res.status(403).json({ error: "A same-origin request is required." });
    return false;
  }
  try {
    if (origin === getTrustedOrigin(req)) return true;
  } catch { /* Fail closed. */ }
  res.status(403).json({ error: "A same-origin request is required." });
  return false;
}

function bounded(req: Request, res: Response): boolean {
  const now = Date.now();
  const key = `${req.ip}:${req.path}`;
  const old = attempts.get(key);
  const entry = old && old.until > now ? old : { count: 0, until: now + 300_000 };
  entry.count++;
  attempts.set(key,entry);
  if (attempts.size > 2000) {
    for (const [ip,value] of attempts) if (value.until <= now) attempts.delete(ip);
    if (attempts.size > 2000) attempts.delete(attempts.keys().next().value!);
  }
  if (entry.count <= 30) return true;
  res.set("Retry-After","300");
  res.status(429).json({ error: "Too many referral attempts. Please try again in five minutes." });
  return false;
}

function fail(req: Request, res: Response, error: unknown): void {
  if (error instanceof ReferralError) { res.status(error.status).json({error:error.message}); return; }
  req.log.error("Referral operation unavailable");
  res.status(503).json({ error: "Referral tracking is temporarily unavailable. Please retry." });
}

router.post("/referrals/capture", async (req,res): Promise<void> => {
  if (!sameOrigin(req,res) || !bounded(req,res)) return;
  const body = CaptureReferralBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error:"Enter a valid referral code."}); return; }
  const existingIdentity = await authenticateFilmmaker(req,res,false);
  if (res.headersSent) return;
  if (existingIdentity) {
    res.status(409).json({error:"Referral codes apply before a new account signs up. Existing members can share their own referral link."});
    return;
  }
  try {
    const result = await captureReferral(body.data.code,req.cookies?.[COOKIE],Boolean(body.data.manual));
    res.cookie(COOKIE,result.token,{httpOnly:true,secure:req.secure,sameSite:"lax",path:"/",
      expires:new Date(result.expiresAt)});
    res.json(CaptureReferralResponse.parse({saved:true,expires_at:result.expiresAt}));
  } catch (error) { fail(req,res,error); }
});

async function member(req: Request, res: Response): Promise<void> {
  const identity = await authenticateFilmmaker(req,res,true);
  if (!identity) return;
  try {
    const id = await enrollReferralMember(identity,req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE,{httpOnly:true,secure:req.secure,sameSite:"lax",path:"/"});
    const result = await memberReferrals(id);
    res.json((req.method === "POST" ? ClaimReferralResponse : GetMyReferralsResponse).parse(result));
  } catch (error) { fail(req,res,error); }
}

router.post("/referrals/claim", async (req,res): Promise<void> => {
  if (!sameOrigin(req,res)) return;
  await member(req,res);
});
router.get("/referrals/me", member);

router.get("/admin/referrals", async (req,res): Promise<void> => {
  if (!await authorizeAdminIdentity(req,res)) return;
  const params = GetAdminReferralsQueryParams.safeParse(req.query);
  if (!params.success || (params.data.page ?? 1)>100000) {
    res.status(400).json({error:"Invalid referral page."}); return;
  }
  try { res.json(GetAdminReferralsResponse.parse(await referralLedger(params.data.page ?? 1))); }
  catch(error) { fail(req,res,error); }
});

router.post("/admin/referrals/:rewardId/verify", async (req,res): Promise<void> => {
  if (!sameOrigin(req,res)) return;
  if (!await authorizeAdminIdentity(req,res) || !bounded(req,res)) return;
  const params = VerifyReferralRewardParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({error:"Invalid referral reward."}); return; }
  try { res.json(VerifyReferralRewardResponse.parse(await refreshReferralReward(params.data.rewardId))); }
  catch(error) { fail(req,res,error); }
});

router.post("/admin/referrals/:rewardId/payout", async (req,res): Promise<void> => {
  if (!sameOrigin(req,res)) return;
  const identity = await authorizeAdminIdentity(req,res);
  if (!identity || !bounded(req,res)) return;
  const params = RecordReferralPayoutParams.safeParse(req.params);
  const body = RecordReferralPayoutBody.safeParse(req.body);
  if (!params.success || !body.success || body.data.reference.trim().length<3) {
    res.status(400).json({error:"A valid reward, payout date, and payment reference are required."}); return;
  }
  try {
    res.json(RecordReferralPayoutResponse.parse(await recordReferralPayout(
      params.data.rewardId,body.data,referralIdentityId(identity))));
  } catch(error) { fail(req,res,error); }
});

export default router;