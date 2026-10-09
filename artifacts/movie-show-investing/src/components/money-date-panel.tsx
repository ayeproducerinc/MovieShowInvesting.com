import type { FilmmakerMoneyDate } from '@workspace/api-client-react';
import { useProjectBackers } from '@/components/filmmaker-backers';
import { monthsLeftText, neededByStatus } from '@/lib/money-date';

const dollars = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/** Lets the project page reveal the tab that holds Edit pitch details. */
export const OPEN_PITCH_DETAILS_EVENT = 'msi:open-pitch-details';

/** Opens Edit pitch details at the timeline so the filmmaker can add or change a date. */
function openTimelineEditor() {
  window.dispatchEvent(new Event(OPEN_PITCH_DETAILS_EVENT));
  const details = document.querySelector<HTMLDetailsElement>('[data-testid="details-edit-pitch"]');
  if (details) details.open = true;
  window.setTimeout(() => document.getElementById('edit-your-timeline')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

/** Private countdown (DECISIONS.md › Money date): never shown publicly or emailed to backers. */
export function MoneyDatePanel({ projectId, identityId, moneyDate, budget }: {
  projectId: number; identityId: string; moneyDate: FilmmakerMoneyDate | null | undefined; budget: number | null | undefined;
}) {
  const backers = useProjectBackers(projectId, identityId);
  const status = neededByStatus(moneyDate ?? null, new Date());
  const link = (label: string) => <button type="button" className="underline" data-testid="button-edit-money-date" onClick={openTimelineEditor}>{label}</button>;
  return <section className="dossier-section" data-testid="section-money-date" style={{ overflowWrap: 'anywhere' }}>
    <span className="dossier-kicker">Your money date · private to you</span>
    <ul className="dossier-links">
      <li data-testid="text-money-needed-by">{status.state === 'upcoming'
        ? <><strong>Money needed by {status.label}</strong> · {monthsLeftText(status.months)}</>
        : status.state === 'passed'
          ? <><strong>Money needed by {status.label}</strong> · this date has passed. {link('Update it')}</>
          : <>{status.skipped ? 'You skipped “When do you need the money by?”. ' : 'No date for when you need the money. '}{link('Add it')}</>}
      </li>
      <li data-testid="text-money-pledged">Pledged so far: {backers.isSuccess ? <strong>{dollars(backers.data.confirmed_pledge_total)}</strong> : '…'} <span className="dossier-status">(confirmed, non-binding)</span></li>
      {moneyDate?.development_amount != null && <li data-testid="text-money-development">Development amount: <strong>{dollars(moneyDate.development_amount)}</strong></li>}
      {budget ? <li data-testid="text-money-budget">Budget: <strong>{dollars(budget)}</strong></li> : null}
    </ul>
  </section>;
}
