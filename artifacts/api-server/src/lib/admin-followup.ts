/**
 * Admin follow-up and research (DECISIONS.md › Admin follow-up and research).
 * The quiet-project list is a list only: nothing here sends a message.
 */
export const QUIET_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type QuietCandidate = {
  id: number;
  title: string | null;
  createdAt: Date;
  hidden: boolean;
  filmmakerName: string | null;
  filmmakerEmail: string | null;
  lastApprovedUpdateAt: Date | null;
  backerCount: number;
};

/**
 * Projects with no approved update in the last 30 days. A project younger than
 * 30 days is not quiet yet. Hidden projects are left out. Quietest first.
 */
export function quietProjects(projects: QuietCandidate[], now: Date) {
  const cutoff = now.getTime() - QUIET_DAYS * DAY_MS;
  return projects
    .filter((project) => !project.hidden)
    .filter((project) => (project.lastApprovedUpdateAt ?? project.createdAt).getTime() < cutoff)
    .sort((a, b) => (a.lastApprovedUpdateAt ?? a.createdAt).getTime() - (b.lastApprovedUpdateAt ?? b.createdAt).getTime());
}

export const RESEARCH_QUESTION_KEY = "set-aside-interest-v1";
export const RESEARCH_QUESTION = "If you could set this money aside today and earn interest until the offering opens, would you?";
export const RESEARCH_NOTE = "This is a research question. No account is being offered.";
export const RESEARCH_ANSWERS = [
  { key: "yes", label: "Yes" },
  { key: "no", label: "No" },
  { key: "not_sure", label: "Not sure" },
] as const;
export type ResearchAnswer = (typeof RESEARCH_ANSWERS)[number]["key"];

/** Admin counts: every answer listed (zero when none), then the total. */
export function researchRows(counts: { answer: string; count: number }[]): [string, number][] {
  const byAnswer = new Map(counts.map((row) => [row.answer, row.count]));
  const rows: [string, number][] = RESEARCH_ANSWERS.map((answer) => [answer.label, byAnswer.get(answer.key) ?? 0]);
  rows.push(["Total answers", rows.reduce((sum, [, count]) => sum + count, 0)]);
  return rows;
}
