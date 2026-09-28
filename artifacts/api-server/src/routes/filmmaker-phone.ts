import { Router, type IRouter } from "express";
import { syncFilmmakerPhoneVerification } from "@workspace/db";
import { VerifyFilmmakerPhoneResponse } from "@workspace/api-zod";
import { authenticateFilmmaker } from "../lib/filmmaker-auth";

const router: IRouter = Router();

router.post("/filmmakers/phone-verification", async (req, res): Promise<void> => {
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  if (!identity.phoneNumber) {
    res.status(403).json({ error: "A phone number linked to this Firebase account is required." });
    return;
  }

  await syncFilmmakerPhoneVerification(identity.uid, identity.phoneNumber);
  res.json(VerifyFilmmakerPhoneResponse.parse({ phone_verified: Boolean(identity.phoneNumber) }));
});

export default router;