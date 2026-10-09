/**
 * New-pledge limits (DECISIONS.md › Investor pledge limits): at least $100 per
 * project and up to 5 projects. Signed pledges keep their original amounts, and
 * the database check (amount >= 25) is intentionally left in place; these limits
 * apply to new choices in the application only.
 */
export const PROJECT_MINIMUM = 100;
export const MAX_PROJECTS = 5;

/** Most projects a total can cover at $100 each, capped at 5. */
export function maxProjectsFor(total: number): number {
  return Math.max(1, Math.min(MAX_PROJECTS, Math.floor(total / PROJECT_MINIMUM)));
}

const PLEDGE_STAGES = ["idea", "production", "distribution"];

/**
 * Open pledging (DECISIONS.md › Product and scope): a submitted project accepts
 * pledges while it is not hidden, whether or not it is approved. A projects row
 * exists only after final submission; drafts live in flow_progress.
 */
export function acceptsPledges(project: { hidden?: boolean | null; stage: string | null }): boolean {
  return !project.hidden && PLEDGE_STAGES.includes(project.stage ?? "");
}

export function allocationLimitError(total: number, amounts: number[]): string | null {
  if (amounts.some((amount) => amount < PROJECT_MINIMUM)) {
    return `Each project needs at least $${PROJECT_MINIMUM}.`;
  }
  if (amounts.length > MAX_PROJECTS) return `A pledge can include up to ${MAX_PROJECTS} projects.`;
  if (amounts.length > maxProjectsFor(total)) {
    return `A $${total} pledge can cover up to ${maxProjectsFor(total)} project${maxProjectsFor(total) === 1 ? "" : "s"} at $${PROJECT_MINIMUM} each.`;
  }
  return null;
}
