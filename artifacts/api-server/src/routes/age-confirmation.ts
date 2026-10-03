import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { ConfirmAgeBody, GetAgeConfirmationResponse, ConfirmAgeResponse } from "@workspace/api-zod";
import { resolveProtectedIdentity } from "../lib/filmmaker-auth";
import { getAccountAgeConfirmation } from "../lib/age-confirmation";

const router: IRouter = Router();

router.get("/participation/age-confirmation", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const identity = await resolveProtectedIdentity(req, res, false);
  if (!identity && res.headersSent) return;
  res.json(GetAgeConfirmationResponse.parse(identity
    ? await getAccountAgeConfirmation(identity)
    : { age_confirmed: false, confirmed_at: null }));
});

router.post("/participation/age-confirmation", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const identity = await resolveProtectedIdentity(req, res, true);
  if (!identity) return;
  if (!ConfirmAgeBody.safeParse(req.body).success) {
    res.status(400).json({ error: "An explicit 18+ acknowledgment is required." });
    return;
  }
  await pool.query(
    "insert into age_confirmations(provider, uid) values ($1, $2) on conflict (provider, uid) do nothing",
    [identity.provider, identity.uid],
  );
  res.json(ConfirmAgeResponse.parse(await getAccountAgeConfirmation(identity)));
});

export default router;