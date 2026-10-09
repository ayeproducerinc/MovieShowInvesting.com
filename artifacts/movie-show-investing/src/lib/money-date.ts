/**
 * Money date (DECISIONS.md › Money date). Months are stored as "YYYY-MM". The
 * dates and countdown are private to the filmmaker and admin.
 */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_PATTERN = /^([0-9]{4})-(0[1-9]|1[0-2])$/;

export function formatMonth(value: string | null | undefined): string {
  const match = value ? MONTH_PATTERN.exec(value) : null;
  return match ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : '';
}

/** Whole months from this month to the target month (0 = this month, negative = passed). */
export function monthsLeft(target: string, now: Date): number | null {
  const match = MONTH_PATTERN.exec(target);
  if (!match) return null;
  return (Number(match[1]) - now.getFullYear()) * 12 + (Number(match[2]) - 1 - now.getMonth());
}

export type MoneyDateFields = {
  money_needed_by_month: string | null;
  money_needed_by_skipped: boolean;
};

/** What the private countdown says about "money needed by". */
export function neededByStatus(moneyDate: MoneyDateFields | null, now: Date):
  | { state: 'missing'; skipped: boolean }
  | { state: 'passed'; label: string }
  | { state: 'upcoming'; label: string; months: number } {
  const month = moneyDate?.money_needed_by_month;
  if (!month) return { state: 'missing', skipped: Boolean(moneyDate?.money_needed_by_skipped) };
  const months = monthsLeft(month, now);
  if (months === null || months < 0) return { state: 'passed', label: formatMonth(month) };
  return { state: 'upcoming', label: formatMonth(month), months };
}

export function monthsLeftText(months: number): string {
  if (months === 0) return 'this month';
  return `${months} month${months === 1 ? '' : 's'} left`;
}
