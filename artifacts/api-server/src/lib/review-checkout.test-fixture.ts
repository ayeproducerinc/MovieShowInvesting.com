// Isolated test doubles, bundled only by scripts/test-review-checkouts.mjs.
// No real database, Stripe calls, credentials or customer records are used.
type Row = Record<string, any>;
const table = (name: string, columns: string[]) => Object.fromEntries([
  ["tableName", name], ...columns.map(c => [c, c]),
]);
export const pitchReviewCheckoutsTable = table("checkouts", ["sessionId", "projectId", "visitorId", "state", "paidAt", "createdAt"]);
export const projectsTable = table("projects", ["id", "reviewPaidAt", "showcaseRequested"]);
let state: { rows: Row[]; projects: Row[]; responses: Record<string, any>; requests: { path: string; body?: string; headers?: Record<string, string> }[]; rewards: number; failSessionPersistence: number };
export function resetFixture(responses: Record<string, any>, rows: Row[] = []) {
  state = { rows, projects: [{ id: 99, slug: "fixture", hidden: false, approved: false, showcaseRequested: false, reviewPaidAt: null }], responses, requests: [], rewards: 0, failSessionPersistence: 0 };
  return state;
}
export function fixtureState() { return state; }
export const eq = (column: string, value: unknown) => (row: Row) => row[column] === value;
export const and = (...predicates: ((row: Row) => boolean)[]) => (row: Row) => predicates.every(p => p(row));
export const sql = (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values });
export const logger = { warn() {}, info() {}, error() {} };
const rowsFor = (t: any) => t === projectsTable ? state.projects : state.rows;
export const db = {
  select(selection?: Row) {
    let rows: Row[] = [], predicate = (_row: Row) => true, limit = Infinity;
    const builder = {
      from(t: any) { rows = rowsFor(t); return builder; },
      where(p: (row: Row) => boolean) { predicate = p; return builder; },
      limit(n: number) { limit = n; return builder; },
      for(_lock: string) { return builder; },
      then(resolve: any, reject: any) {
        const result = rows.filter(predicate).slice(0, limit).map(row =>
          selection ? Object.fromEntries(Object.entries(selection).map(([key, column]) => [key, row[column]])) : { ...row });
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  },
  insert(t: any) { return { values: async (row: Row) => {
    if (t === pitchReviewCheckoutsTable && state.rows.some(r => r.projectId === row.projectId && r.state === "open")) {
      throw new Error("unique open checkout per project");
    }
    rowsFor(t).push({ state: "open", createdAt: new Date(), ...row });
  } }; },
  update(t: any) { return { set: (changes: Row) => ({ where: async (p: (row: Row) => boolean) => {
    if (changes.sessionId && state.failSessionPersistence > 0) {
      state.failSessionPersistence--; throw new Error("fixture persistence failed");
    }
    for (const row of rowsFor(t).filter(p)) Object.assign(row, changes);
  } }) }; },
  async transaction(fn: (tx: any) => Promise<void>) {
    const backup = structuredClone({ rows: state.rows, projects: state.projects, rewards: state.rewards });
    try { await fn(db); } catch (error) { Object.assign(state, backup); throw error; }
  },
  async execute(_query: unknown) { state.rewards++; },
};
export class ReplitConnectors {
  async proxy(_provider: string, path: string, options?: { body?: string; headers?: Record<string, string> }) {
    state.requests.push({ path, body: options?.body, headers: options?.headers });
    let value = state.responses[path] ?? state.responses[path.split("?")[0]];
    if (typeof value === "function") value = await value(options);
    if (value instanceof Error) throw value;
    if (value?.__status) return new Response(JSON.stringify(value.__body), { status: value.__status });
    return new Response(JSON.stringify(value ?? { error: "Fixture response missing" }), { status: value ? 200 : 404 });
  }
}
