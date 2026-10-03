type Allocation = { project_id: number; amount: number };
type Review = { name: string; amount: number; unallocated: boolean; allocations: Allocation[] };

/** Stable comparison of what the investor actually reviewed, independent of row order. */
export function investorReviewKey(review: Review): string {
  return JSON.stringify([
    review.name.trim(), review.amount, review.unallocated,
    [...review.allocations].sort((a, b) => a.project_id - b.project_id).map(row => [row.project_id, row.amount]),
  ]);
}

export function minimaForSelectedStages<T extends { distribution: number | null; production: number | null; idea: number | null }>(minima: T, stages: string[]) {
  return {
    distribution: stages.includes('distribution') ? minima.distribution : null,
    production: stages.includes('production') ? minima.production : null,
    idea: stages.includes('idea') ? minima.idea : null,
  };
}