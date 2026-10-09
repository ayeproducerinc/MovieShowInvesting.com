import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  AnswerInvestorResearchQuestionBody, AnswerInvestorResearchQuestionResponse, GetInvestorResearchQuestionResponse,
} from "@workspace/api-zod";
import { resolveProtectedIdentity } from "../lib/filmmaker-auth";
import { RESEARCH_NOTE, RESEARCH_QUESTION, RESEARCH_QUESTION_KEY, type ResearchAnswer } from "../lib/admin-followup";

// One optional research question after an investor signs (DECISIONS.md › Admin follow-up and research).
const router: IRouter = Router();

async function signedInvestorId(provider: "firebase" | "replit", uid: string): Promise<number | null> {
  const column = provider === "firebase" ? "firebase_uid" : "replit_uid";
  // Asked only after signing: the account needs a confirmed pledge record.
  const { rows } = await pool.query<{ id: number }>(
    `select i.id from investors i where i.${column} = $1 and (i.confirmed_at is not null
       or exists (select 1 from interest_entries e where e.investor_id = i.id and e.confirmed_at is not null)) limit 1`,
    [uid],
  );
  return rows[0]?.id ?? null;
}

async function view(investorId: number | null) {
  let answer: ResearchAnswer | null = null;
  if (investorId) {
    const { rows } = await pool.query<{ answer: ResearchAnswer }>(
      "select answer from investor_research_answers where investor_id = $1 and question_key = $2",
      [investorId, RESEARCH_QUESTION_KEY],
    ).catch(() => ({ rows: [] as { answer: ResearchAnswer }[] }));
    answer = rows[0]?.answer ?? null;
  }
  return { question: RESEARCH_QUESTION, note: RESEARCH_NOTE, answer, can_answer: investorId !== null };
}

router.get("/investor/research-question", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await resolveProtectedIdentity(req, res, true);
  if (!identity) return;
  res.json(GetInvestorResearchQuestionResponse.parse(await view(await signedInvestorId(identity.provider, identity.uid))));
});

router.put("/investor/research-question", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await resolveProtectedIdentity(req, res, true);
  if (!identity) return;
  const body = AnswerInvestorResearchQuestionBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Choose Yes, No or Not sure." }); return; }
  const investorId = await signedInvestorId(identity.provider, identity.uid);
  if (!investorId) { res.status(404).json({ error: "This question appears after you sign a pledge." }); return; }
  await pool.query(
    `insert into investor_research_answers (investor_id, question_key, answer) values ($1, $2, $3)
     on conflict (investor_id, question_key) do update set answer = excluded.answer, answered_at = now()`,
    [investorId, RESEARCH_QUESTION_KEY, body.data.answer],
  );
  res.json(AnswerInvestorResearchQuestionResponse.parse(await view(investorId)));
});

export default router;
