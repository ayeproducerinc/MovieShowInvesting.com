/**
 * Measures the owner needs from project updates (DECISIONS.md › Project updates):
 * how many backers increased, and how many new pledges came in, after each update.
 * Input is one row per confirmed pledge to the project.
 */
export type PledgeRow = {
  investor_id: number;
  amount: number;
  confirmed_at: Date | null;
  /** Set when the pledge started from that update's "Increase my pledge" email button. */
  source_update_id: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
export const IMPACT_WINDOW_DAYS = 14;

function firstConfirmed(rows: PledgeRow[]): Map<number, number> {
  const first = new Map<number, number>();
  for (const row of rows) {
    if (!row.confirmed_at) continue;
    const at = row.confirmed_at.getTime();
    const current = first.get(row.investor_id);
    if (current === undefined || at < current) first.set(row.investor_id, at);
  }
  return first;
}

/**
 * Filmmaker summary. An increase is any confirmed pledge after a backer's first
 * one to this project. New since the last update counts backers whose first
 * pledge came after it, with everything they have pledged.
 */
export function projectProgress(rows: PledgeRow[], lastUpdateAt: Date | null) {
  const first = firstConfirmed(rows);
  const increasers = new Set<number>();
  let increaseAmount = 0;
  const newcomers = new Set<number>();
  let newAmount = 0;
  for (const row of rows) {
    if (!row.confirmed_at) continue;
    const at = row.confirmed_at.getTime();
    const firstAt = first.get(row.investor_id)!;
    if (at > firstAt) {
      increasers.add(row.investor_id);
      increaseAmount += row.amount;
    }
    if (lastUpdateAt && firstAt > lastUpdateAt.getTime()) {
      newcomers.add(row.investor_id);
      newAmount += row.amount;
    }
  }
  return {
    increase_count: increasers.size,
    increase_amount: increaseAmount,
    new_since_last_update_count: newcomers.size,
    new_since_last_update_amount: newAmount,
  };
}

/**
 * Admin, per update: increases that came from its email button, and backers
 * who pledged to the project for the first time in the 14 days after approval.
 */
export function updateImpact(rows: PledgeRow[], update: { id: number; approvedAt: Date | null }) {
  let increaseCount = 0;
  let increaseAmount = 0;
  const fromUpdate = new Set<number>();
  for (const row of rows) {
    if (row.source_update_id === update.id && row.confirmed_at) {
      fromUpdate.add(row.investor_id);
      increaseAmount += row.amount;
    }
  }
  increaseCount = fromUpdate.size;
  let newCount = 0;
  let newAmount = 0;
  if (update.approvedAt) {
    const start = update.approvedAt.getTime();
    const end = start + IMPACT_WINDOW_DAYS * DAY_MS;
    const first = firstConfirmed(rows);
    const newcomers = new Set([...first].filter(([, at]) => at >= start && at < end).map(([investor]) => investor));
    newCount = newcomers.size;
    for (const row of rows) {
      if (row.confirmed_at && newcomers.has(row.investor_id) && row.confirmed_at.getTime() < end) newAmount += row.amount;
    }
  }
  return {
    increase_count: increaseCount,
    increase_amount: increaseAmount,
    new_pledge_count_14d: newCount,
    new_pledge_amount_14d: newAmount,
  };
}
