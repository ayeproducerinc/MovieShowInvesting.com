/**
 * Money date (DECISIONS.md › Money date). Two optional month-and-year answers
 * with "Skip for now" stored separately from a blank, and an optional
 * development amount. The dates are private to the filmmaker and admin.
 */
export const MONTH_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const MAX_AMOUNT = 2_147_483_647;

export type MoneyDateInput = {
  development_amount?: number | null;
  filming_start_month?: string | null;
  filming_start_skipped?: boolean | null;
  money_needed_by_month?: string | null;
  money_needed_by_skipped?: boolean | null;
};
export type MoneyDateValue = {
  development_amount: number | null;
  filming_start_month: string | null;
  filming_start_skipped: boolean;
  money_needed_by_month: string | null;
  money_needed_by_skipped: boolean;
};

function month(value: string | null | undefined, skipped: boolean | null | undefined, label: string):
  { ok: true; month: string | null; skipped: boolean } | { ok: false; error: string } {
  if (skipped === true) return { ok: true, month: null, skipped: true };
  const text = (value ?? "").trim();
  if (!text) return { ok: true, month: null, skipped: false };
  if (!MONTH_PATTERN.test(text)) return { ok: false, error: `Choose a month and year for “${label}”.` };
  return { ok: true, month: text, skipped: false };
}

/** Distribution projects are already filmed, so they have no filming start question. */
export function asksFilmingStart(stage: string | null | undefined): boolean {
  return stage === "idea" || stage === "production";
}

export function validateMoneyDate(input: MoneyDateInput, stage?: string | null): { ok: true; value: MoneyDateValue } | { ok: false; error: string } {
  const amount = input.development_amount;
  if (amount !== undefined && amount !== null && (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_AMOUNT)) {
    return { ok: false, error: "Enter the development amount as whole dollars." };
  }
  const filming = asksFilmingStart(stage)
    ? month(input.filming_start_month, input.filming_start_skipped, "When do you plan to start filming?")
    : { ok: true as const, month: null, skipped: false };
  if (!filming.ok) return filming;
  const needed = month(input.money_needed_by_month, input.money_needed_by_skipped, "When do you need the money by?");
  if (!needed.ok) return needed;
  return {
    ok: true,
    value: {
      development_amount: amount ?? null,
      filming_start_month: filming.month, filming_start_skipped: filming.skipped,
      money_needed_by_month: needed.month, money_needed_by_skipped: needed.skipped,
    },
  };
}

/** True when the request carries any money-date field (so an Edit pitch save can leave it alone). */
export function hasMoneyDateFields(input: Record<string, unknown>): boolean {
  return ["filming_start_month", "filming_start_skipped", "money_needed_by_month", "money_needed_by_skipped", "development_amount"]
    .some((key) => input[key] !== undefined);
}
