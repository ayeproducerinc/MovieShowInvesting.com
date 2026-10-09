import { getGetFilmmakerProjectBackersQueryKey, useGetFilmmakerProjectBackers } from '@workspace/api-client-react';
import { backerLabel } from '@/lib/backer-display';

const dollars = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';

/** Private to the project's filmmaker (DECISIONS.md › Backer names). */
export function FilmmakerBackers({ projectId, identityId }: { projectId: number; identityId: string }) {
  const backers = useGetFilmmakerProjectBackers(projectId, { query: {
    queryKey: [...getGetFilmmakerProjectBackersQueryKey(projectId), identityId],
    retry: false,
  } });
  return <section className="dossier-section" data-testid="section-filmmaker-backers">
    <span className="dossier-kicker">Your backers · private to you</span>
    {backers.isPending ? <p role="status">Loading your backers…</p>
      : backers.isError ? <p role="alert">We couldn’t load your backers. <button type="button" className="underline" onClick={() => void backers.refetch()}>Try again</button></p>
      : !backers.data.backers.length ? <p data-testid="text-no-backers">No confirmed pledges yet. Share your project link so people can pledge.</p>
      : <ul className="dossier-links" data-testid="list-filmmaker-backers">{backers.data.backers.map((backer, index) =>
        <li key={`${backer.confirmed_at}-${index}`} style={{ overflowWrap: 'anywhere' }}>
          <strong>{backerLabel(backer)}</strong> · {dollars(backer.amount)}{backer.confirmed_at && ` · ${day(backer.confirmed_at)}`}
          {backer.email && <> · <a href={`mailto:${backer.email}`}>{backer.email}</a></>}
        </li>)}</ul>}
    <p className="dossier-status">Names, emails and amounts are shown only to you and Movie Show Investing admins. Pledges are non-binding; no money is collected.</p>
  </section>;
}
