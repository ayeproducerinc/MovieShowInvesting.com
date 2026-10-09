export type LineupProject = { id: number; stage: string | null };

/** New pledges: at least $100 per project, up to 5 projects (DECISIONS.md › Investor pledge limits). */
export const PROJECT_MINIMUM = 100;
export const MAX_PROJECTS = 5;

/** Most projects a total can cover at $100 each, capped at 5. */
export const cap = (amount: number) => Math.max(1, Math.min(MAX_PROJECTS, Math.floor(amount / PROJECT_MINIMUM)));

/**
 * A project-page link (one=1) reuses a saved worksheet only when it holds no
 * other projects; otherwise the investor chooses how to continue.
 */
export function canUseSingleProjectDraft(
  lineup: { project_id: number }[],
  targetId: number,
  unallocated: boolean,
): boolean {
  return !unallocated && lineup.every(row => row.project_id === targetId);
}

/** One-project pledge: the whole amount goes to the selected project. */
export function singleProjectLineup(projectId: number, amount: number) {
  return [{ project_id: projectId, amount }];
}

export function split(amount: number, selected: LineupProject[]) {
  if (!selected.length) return [];
  const each = Math.floor(amount / selected.length);
  return selected.map((project, index) => ({
    project_id: project.id,
    amount: each + (index === 0 ? amount - each * selected.length : 0),
  }));
}

/** Include one match from each eligible slate before filling remaining slots. */
export function selectAutoBuildProjects<T extends LineupProject>(matches: T[], amount: number): T[] {
  const selected: T[] = [];
  const ids = new Set<number>();
  const add = (project: T | undefined) => {
    if (project && !ids.has(project.id) && selected.length < cap(amount)) {
      selected.push(project);
      ids.add(project.id);
    }
  };
  for (const stage of ['distribution', 'production', 'idea']) {
    add(matches.find(project => project.stage === stage));
  }
  for (const project of matches) add(project);
  return selected;
}