import { useState } from 'react';
import { useGetAdminInvestor, useGetAdminInvestors, getExportAdminInvestorsUrl } from '@workspace/api-client-react';
import { ArrowDownToLine, Search, ShieldAlert, Users, X } from 'lucide-react';
import { Field, ReadableFields, ReadableValue, fmtDate } from '@/components/admin-readable';
import { customFetch } from '../../../../lib/api-client-react/src/custom-fetch';

const LIMIT = 25;
const STATUSES = [['', 'All statuses'], ['signup', 'Signed up'], ['draft', 'Unfinished worksheet'], ['saved', 'Saved, unsigned'], ['confirmed', 'Confirmed']] as const;
type Status = '' | 'signup' | 'draft' | 'saved' | 'confirmed';
type Rec = Record<string, unknown>;
const money = (n: unknown) => typeof n === 'number' ? `$${n.toLocaleString()}` : null;
const perm = (v: boolean | null | undefined) => v === true ? 'Allowed' : v === false ? 'Withdrawn / declined' : 'Unknown (not recorded)';
const arr = (v: unknown) => Array.isArray(v) ? v : [];

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useGetAdminInvestor(id, { query: { queryKey: ['/api/admin/investors', 'detail', id], retry: false } });
  const d = q.data;
  const p = (d?.profile ?? {}) as Rec;
  const v = (d?.verification ?? {}) as Rec;
  const identityKeys = ['name', 'email', 'phone', 'city', 'state', 'country', 'zip'];
  return <div role="dialog" aria-modal="true" aria-label="Investor record" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#18202b]/80 p-3 md:p-8" data-testid="dialog-investor-detail">
    <div className="my-auto w-full max-w-5xl bg-[#f7f4ed] p-5 shadow-2xl md:p-9">
      <div className="flex items-start justify-between gap-5">
        <div><p className="admin-overline admin-mono">Private investor record</p><h2 className="admin-page-title">{typeof p.name === 'string' && p.name ? p.name : 'Investor record'}</h2>
          <p>Self-reported intake and non-binding interest. This is not identity verification, accreditation verification or approval to invest.</p></div>
        <button type="button" className="admin-button secondary" aria-label="Close investor record" onClick={onClose} data-testid="button-close-investor"><X size={17} /></button>
      </div>
      {q.isPending && <div className="admin-skeleton" style={{ height: 120, marginTop: 24 }} />}
      {q.isError && <div className="admin-state" role="alert"><ShieldAlert size={20} /><h2>Record unavailable</h2><p>The protected record could not be retrieved.</p><button type="button" className="admin-button secondary" onClick={() => void q.refetch()}>Try again</button></div>}
      {d && <>
        <section className="mt-7"><h3 className="admin-overline admin-mono">Self-reported contact and location (current profile)</h3>
          <dl className="grid gap-x-6 md:grid-cols-2">
            {identityKeys.map(k => <Field key={k} label={k === 'zip' ? 'Postal code' : k.replace(/^./, c => c.toUpperCase())}>{k === 'zip' ? (typeof (p.zip ?? p.postal_code) === 'string' ? (p.zip ?? p.postal_code) as string : null) : typeof p[k] === 'string' ? p[k] as string : null}</Field>)}
          </dl></section>
        <section className="mt-7"><h3 className="admin-overline admin-mono">Verification — what is and is not established</h3>
          <ReadableFields data={v} />
          <p className="mt-2 text-sm">Accreditation, identity and location are self-reported. A Google or account sign-in does not verify a typed contact email or legal identity.</p></section>
        <section className="mt-7"><h3 className="admin-overline admin-mono">Full questionnaire and preferences (current profile)</h3>
          <ReadableFields data={p} skip={[...identityKeys, 'postal_code']} /></section>
        <section className="mt-7"><h3 className="admin-overline admin-mono">Age confirmation</h3>
          {d.age_confirmation ? <ReadableFields data={d.age_confirmation as Rec} /> : <p className="admin-missing">Missing: no saved age confirmation evidence. It is not assumed.</p>}</section>
        <section className="mt-7"><h3 className="admin-overline admin-mono">Interest entries ({d.entries.length})</h3>
          <p className="text-sm">Saved and signed entries are distinguished below. Later profile edits do not change signed entries. Amounts are non-binding.</p>
          {d.entries.length === 0 && <p className="admin-missing mt-2">No interest entries.</p>}
          {d.entries.map((e, i) => {
            const en = e as Rec;
            return <article key={String(en.entry_id ?? i)} className="mt-4 border border-[#c8c0b5] p-4" data-testid={`entry-investor-${i}`}>
               <p className="admin-badge">{en.confirmed_at ? 'Signed · confirmed non-binding interest' : 'Saved · unsigned; not a confirmed waitlist member'}</p>
              <dl className="grid gap-x-6 md:grid-cols-2">
                <Field label="Confirmed at">{fmtDate(en.confirmed_at)}</Field>
                <Field label="Typed signature">{typeof en.signature_name === 'string' ? en.signature_name : null}</Field>
                <Field label="Non-binding amount">{money(en.amount)}</Field>
                <Field label="Unallocated (general interest)">{en.unallocated ? 'Yes, not assigned to any project' : 'No'}</Field>
              </dl>
              <h4 className="admin-mono mt-3 text-xs uppercase tracking-wider">Project allocations</h4>
              {arr(en.allocations).length ? <ul className="admin-list">{arr(en.allocations).map((a, j) => { const al = a as Rec; return <li key={j}>{String(al.title ?? `Project ${al.project_id}`)} · {money(al.amount) ?? NP}{al.eligible === false ? ' · currently hidden or ineligible (private history only)' : ''}</li>; })}</ul> : <p className="admin-missing">None</p>}
              <h4 className="admin-mono mt-3 text-xs uppercase tracking-wider">Answers as submitted</h4>
              {en.submitted_answers ? <ReadableValue value={en.submitted_answers} /> : <p className="admin-missing">Missing historical evidence: answers at signing were not captured.</p>}
              <h4 className="admin-mono mt-3 text-xs uppercase tracking-wider">Confirmation evidence</h4>
               {en.confirmation_evidence ? <ReadableValue value={en.confirmation_evidence} /> : <p className="admin-missing">{en.confirmed_at ? 'Missing historical evidence: acknowledgment and version were not captured.' : 'Not confirmed: no signature or confirmation evidence yet.'}</p>}
            </article>;
          })}</section>
        <section className="mt-7"><h3 className="admin-overline admin-mono">Unfinished worksheet</h3>
          {d.draft ? <ReadableFields data={d.draft as Rec} /> : <p className="admin-missing">No unfinished worksheet. Drafts never count toward pledges or waitlists.</p>}</section>
        <section className="mt-7"><h3 className="admin-overline admin-mono">Offering-notification permission history</h3>
           {d.notification_history.length ? <><p className="text-sm">Most recent first. Only the latest choice controls outreach permission.</p><ul className="admin-list">{d.notification_history.map((h, i) => { const r = h as Rec; return <li key={i}><strong>{i === 0 ? 'Latest choice' : 'Earlier choice'}: {perm(r.allowed as boolean | null)}</strong> · {typeof r.recorded_at === 'string' ? <time dateTime={r.recorded_at}>{r.recorded_at}</time> : 'Date missing'} · version {String(r.version ?? 'unknown')}</li>; })}</ul></> : <p className="admin-missing">Unknown: permission was never recorded. Excluded from outreach-ready export.</p>}
          <p className="mt-2 text-sm">Kept separate from the 15-minute chat opt-in. No automatic messages are sent.</p></section>
      </>}
    </div>
  </div>;
}
const NP = 'Not provided';

export function AdminInvestors({ userId }: { userId: string }) {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState<Status>('');
  const [projectId, setProjectId] = useState('');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const pid = /^[1-9]\d*$/.test(projectId) ? Number(projectId) : undefined;
  const params = { ...(applied ? { search: applied } : {}), ...(status ? { status } : {}), ...(pid ? { project_id: pid } : {}), offset, limit: LIMIT };
  const q = useGetAdminInvestors(params, { query: { queryKey: ['/api/admin/investors', params, userId], retry: false, staleTime: 15_000 } });
  const total = q.data?.total ?? 0;

  async function download() {
    setExporting(true); setExportError('');
    try {
      const { offset: _o, limit: _l, ...filters } = params; void _o; void _l;
      const blob = await customFetch<Blob>(getExportAdminInvestorsUrl(filters), { responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'movie-show-investing-investors.csv';
      document.body.append(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setExportError('The export could not be created. Try again.'); }
    finally { setExporting(false); }
  }

  return <div data-testid="section-investors">
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); setOffset(0); setApplied(search.trim()); }}>
      <label className="grid gap-1 text-xs admin-mono uppercase">Search<input className="border border-[#c8c0b5] bg-transparent p-2 normal-case" maxLength={200} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or email" data-testid="input-investor-search" /></label>
      <label className="grid gap-1 text-xs admin-mono uppercase">Status<select className="border border-[#c8c0b5] bg-transparent p-2 normal-case" value={status} onChange={e => { setOffset(0); setStatus(e.target.value as Status); }} data-testid="select-investor-status">{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="grid gap-1 text-xs admin-mono uppercase">Project / segment<select className="border border-[#c8c0b5] bg-transparent p-2 normal-case" value={projectId} onChange={e => { setOffset(0); setProjectId(e.target.value); }} data-testid="select-investor-project"><option value="">All projects</option>{(q.data?.projects ?? []).map(p => <option key={p.id} value={p.id}>{p.title ?? `Project ${p.id}`}{p.eligible ? '' : ' (not currently eligible)'}</option>)}</select></label>
      <button type="submit" className="admin-button secondary" data-testid="button-investor-search"><Search size={14} />Search</button>
      <button type="button" className="admin-button" disabled={exporting} onClick={() => void download()} data-testid="button-export-investors"><ArrowDownToLine size={14} />{exporting ? 'Preparing…' : 'Download filtered CSV'}</button>
    </form>
    <p className="mt-3 text-sm">The outreach-ready export includes only confirmed interest with explicit, current offering-notification permission and a verified account email. Unknown or withdrawn permission is excluded. Project allocations and unallocated general interest are separate segments. Amounts are non-binding; nothing is sent automatically.</p>
    {exportError && <p role="alert" className="admin-feedback">{exportError}</p>}
    {q.isPending && <div className="admin-skeleton" style={{ height: 160, marginTop: 20 }} />}
    {q.isError && <div className="admin-state mt-5" role="alert"><ShieldAlert size={20} /><h2>Investors could not be loaded</h2><p>Access may have been denied or the connection failed.</p><button type="button" className="admin-button secondary" onClick={() => void q.refetch()}>Try again</button></div>}
    {q.data && (q.data.items.length === 0 ? <div className="admin-state mt-5"><Users size={20} /><h2>No matching people</h2><p>Nothing recorded matches these filters.</p></div> : <>
      <div className="admin-table-wrap mt-5" tabIndex={0} aria-label="Investor table, scroll horizontally for all columns"><table className="admin-table admin-investor-table" data-testid="table-investors">
        <thead><tr>{['Name', 'Email', 'Status', 'First seen', 'Last activity', 'Confirmed non-binding', 'Notification permission', 'Projects', 'Record'].map(c => <th scope="col" key={c}>{c}</th>)}</tr></thead>
        <tbody>{q.data.items.map((r, i) => <tr key={r.id} data-testid={`row-investor-${i}`}>
          <td>{r.name ?? NP}</td><td>{r.email ?? NP}</td><td>{STATUSES.find(s => s[0] === r.status)?.[1] ?? r.status}</td>
          <td>{fmtDate(r.first_seen_at) ?? 'Not evidenced'}</td><td>{fmtDate(r.last_activity_at) ?? 'Not evidenced'}</td>
          <td>{r.status === 'confirmed' ? money(r.confirmed_amount) : '—'}</td><td>{perm(r.notification_allowed)}</td>
          <td>{r.project_ids.length ? r.project_ids.join(', ') : '—'}</td>
          <td><button type="button" className="admin-button secondary" onClick={() => setOpenId(r.id)} data-testid={`button-open-investor-${i}`}>View</button></td>
        </tr>)}</tbody></table></div>
      <div className="mt-4 flex items-center gap-4">
        <button type="button" className="admin-button secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} data-testid="button-investors-prev">Previous</button>
        <span className="admin-mono text-xs" data-testid="text-investors-range">{offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()} people</span>
        <button type="button" className="admin-button secondary" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)} data-testid="button-investors-next">Next</button>
      </div></>)}
    {openId && <Detail id={openId} onClose={() => setOpenId(null)} />}
  </div>;
}
