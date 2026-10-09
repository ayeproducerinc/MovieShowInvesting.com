import { getGetFilmmakerProjectBackersQueryKey, useGetFilmmakerProjectBackers } from '@workspace/api-client-react';
import { backerLabel, backersErrorText, pledgeSummary, progressLines } from '@/lib/backer-display';

const dollars = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';

/** One shared query for the project's private backer data (list and totals). */
export function useProjectBackers(projectId: number, identityId: string) {
  return useGetFilmmakerProjectBackers(projectId, { query: {
    queryKey: [...getGetFilmmakerProjectBackersQueryKey(projectId), identityId],
    retry: false,
  } });
}

/** Compact total for the project's status box; private to the filmmaker until listed. */
export function PledgedSoFar({ projectId, identityId, listed }: { projectId: number; identityId: string; listed: boolean }) {
  const backers = useProjectBackers(projectId, identityId);
  if (!backers.isSuccess) return null;
  return <div className="dossier-line" data-testid="status-pledged-so-far">
    <span className="dossier-kicker">Pledged so far</span>
    <p style={{ fontSize: 22, color: '#f4f0e7', margin: '8px 0 4px' }} data-testid="text-pledged-so-far">{pledgeSummary(backers.data, dollars)}</p>
    <p>{listed ? 'Your listed project shows this total publicly.' : 'Only you can see this total until your project is approved and listed.'} Pledges are non-binding; no money is collected.</p>
  </div>;
}

/** Private to the project's filmmaker (DECISIONS.md › Backer names). */
export function FilmmakerBackers({ projectId, identityId }: { projectId: number; identityId: string }) {
  const backers = useProjectBackers(projectId, identityId);
  return <section className="dossier-section" data-testid="section-filmmaker-backers">
    <span className="dossier-kicker">Your backers · private to you</span>
    {backers.isPending ? <p role="status">Loading your backers…</p>
      : backers.isError ? (() => {
        const failure = backersErrorText(backers.error?.status);
        return <p role="alert" data-testid="error-filmmaker-backers">{failure.text}{failure.canRetry && <> <button type="button" className="underline" onClick={() => void backers.refetch()}>Try again</button></>}</p>;
      })()
      : !backers.data.backers.length ? <p data-testid="text-no-backers">No confirmed pledges yet. Share your project link so people can pledge.</p>
      : <>
        <p data-testid="text-backers-total"><strong>{pledgeSummary(backers.data, dollars)}</strong></p>
        <ul className="dossier-links" data-testid="list-backer-progress" style={{ marginBottom: 18 }}>
          {progressLines(backers.data, dollars, day).map(line => <li key={line}>{line}</li>)}
        </ul>
        <ul className="dossier-links" data-testid="list-filmmaker-backers">{backers.data.backers.map((backer, index) =>
          <li key={`${backer.confirmed_at}-${index}`} style={{ overflowWrap: 'anywhere' }}>
            <strong>{backerLabel(backer)}</strong> · {dollars(backer.amount)}{backer.confirmed_at && ` · ${day(backer.confirmed_at)}`}
            {backer.email && <> · <a href={`mailto:${backer.email}`}>{backer.email}</a></>}
          </li>)}</ul>
      </>}
    <p className="dossier-status">Names, emails and amounts are shown only to you and Movie Show Investing admins. Pledges are non-binding; no money is collected.</p>
  </section>;
}
