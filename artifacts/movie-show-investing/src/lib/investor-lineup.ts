export type LineupProject = { id: number; stage: string | null };

export const cap = (amount: number) => amount < 150 ? 4 : 5;

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