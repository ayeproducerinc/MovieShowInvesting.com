import { pool } from "@workspace/db";
import type { MoneyDateValue } from "./money-date";

/** Private money date for one project (DECISIONS.md › Money date); null when none was recorded. */
export async function readMoneyDate(projectId: number): Promise<MoneyDateValue | null> {
  const { rows } = await pool.query<MoneyDateValue>(
    `select development_amount, filming_start_month, filming_start_skipped, money_needed_by_month, money_needed_by_skipped
     from project_money_dates where project_id = $1`,
    [projectId],
  );
  return rows[0] ?? null;
}

/**
 * Save the timeline answers. The development amount is written only at intake
 * (includeAmount); Edit pitch changes the two dates and leaves the amount alone.
 */
export async function saveMoneyDate(projectId: number, value: MoneyDateValue, includeAmount: boolean): Promise<void> {
  await pool.query(
    `insert into project_money_dates
       (project_id, development_amount, filming_start_month, filming_start_skipped, money_needed_by_month, money_needed_by_skipped)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (project_id) do update set
       development_amount = case when $7 then excluded.development_amount else project_money_dates.development_amount end,
       filming_start_month = excluded.filming_start_month,
       filming_start_skipped = excluded.filming_start_skipped,
       money_needed_by_month = excluded.money_needed_by_month,
       money_needed_by_skipped = excluded.money_needed_by_skipped,
       updated_at = now()`,
    [projectId, includeAmount ? value.development_amount : null, value.filming_start_month, value.filming_start_skipped,
      value.money_needed_by_month, value.money_needed_by_skipped, includeAmount],
  );
}
