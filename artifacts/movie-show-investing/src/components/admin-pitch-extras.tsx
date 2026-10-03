import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSaveAdminReviewNotes } from '@workspace/api-client-react';
import { FileText } from 'lucide-react';
import { Field, ReadableFields, ReadableValue, fmtDate } from '@/components/admin-readable';
import { customFetch } from '../../../../lib/api-client-react/src/custom-fetch';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Rec : null;

export function ReviewNotesForm({ projectId, notes }: { projectId: number; notes: Rec | null }) {
  const qc = useQueryClient();
  const save = useSaveAdminReviewNotes();
  const [text, setText] = useState(typeof notes?.notes === 'string' ? notes.notes : '');
  const [obl, setObl] = useState(notes?.obligations_checked === true);
  const [auth, setAuth] = useState(notes?.authority_checked === true);
  const [q, setQ] = useState(notes?.questions_resolved === true);
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null);
  const [stamp, setStamp] = useState<string | null>(typeof notes?.updated_at === 'string' ? notes.updated_at : null);

  function submit() {
    setMsg(null);
    save.mutate({ projectId, data: { notes: text, obligations_checked: obl, authority_checked: auth, questions_resolved: q, updated_at: stamp } }, {
      onSuccess: (res) => {
        const r = rec(res);
        if (typeof r?.updated_at === 'string') setStamp(r.updated_at);
        setMsg({ t: 'Review notes saved.', bad: false });
        void qc.invalidateQueries({ queryKey: ['admin-project-pitch-details', projectId] });
      },
      onError: () => setMsg({ t: 'Could not save. The notes may have changed elsewhere; reload this review and try again.', bad: true }),
    });
  }

  return <section className="mt-8" data-testid={`section-review-notes-${projectId}`}>
    <h3 className="admin-overline admin-mono">Manual review checklist</h3>
    <p className="text-sm">What the filmmaker submitted is shown above as a claim. These boxes record only what the reviewer personally checked. They do not certify legal compliance.</p>
    <div className="mt-3 grid gap-2">
      {([['Outstanding financing or reward obligations checked', obl, setObl, 'obligations'], ['Authority to pitch and share the materials checked', auth, setAuth, 'authority'], ['Open questions resolved', q, setQ, 'questions']] as const).map(([label, v, set, id]) =>
        <label key={id} className="flex items-center gap-3"><input type="checkbox" checked={v} onChange={e => set(e.target.checked)} data-testid={`checkbox-review-${id}-${projectId}`} />{label}</label>)}
    </div>
    <label className="admin-mono mt-4 block text-xs uppercase tracking-wider" htmlFor={`review-notes-${projectId}`}>Notes</label>
    <textarea id={`review-notes-${projectId}`} className="mt-2 w-full border border-[#c8c0b5] bg-transparent p-3" rows={5} maxLength={8000} value={text} onChange={e => setText(e.target.value)} data-testid={`textarea-review-notes-${projectId}`} />
    <div className="mt-3 flex flex-wrap items-center gap-4">
      <button type="button" className="admin-button" disabled={save.isPending} onClick={submit} data-testid={`button-save-review-notes-${projectId}`}>{save.isPending ? 'Saving…' : 'Save review notes'}</button>
      {stamp && <span className="text-sm">Last saved {fmtDate(stamp)}</span>}
      {msg && <span role={msg.bad ? 'alert' : 'status'} className={msg.bad ? 'admin-feedback' : ''}>{msg.t}</span>}
    </div>
  </section>;
}

function OriginalDeck({ projectId, url }: { projectId: number; url: string }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function open() {
    setErr('');
    const tab = window.open('about:blank', '_blank');
    if (!tab) { setErr('Your browser blocked the tab. Allow pop-ups and retry.'); return; }
    setBusy(true);
    try {
      const blob = await customFetch<Blob>(`/api/filmmakers/project-materials/pitch-deck?project_id=${projectId}&original=1`, { responseType: 'blob' });
      if (!blob.size) throw new Error('empty');
      const o = URL.createObjectURL(blob);
      tab.location.href = o;
      window.setTimeout(() => URL.revokeObjectURL(o), 5 * 60_000);
    } catch { tab.close(); setErr('The original stored deck could not be loaded. It may not have been retained.'); }
    finally { setBusy(false); }
  }
  void url;
  return <div>
    <button type="button" className="admin-button secondary" disabled={busy} onClick={() => void open()} data-testid={`button-view-original-deck-${projectId}`}><FileText size={14} />{busy ? 'Loading…' : 'View original stored deck'}</button>
    {err && <p role="alert" className="admin-feedback">{err}</p>}
  </div>;
}

export function PitchProvenance({ projectId, data }: { projectId: number; data: Rec }) {
  const original = rec(data.original_submission);
  const provenance = typeof data.submission_provenance === 'string' ? data.submission_provenance : null;
  const changed = data.changes_since_submission === true;
  const history = Array.isArray(data.review_history) ? data.review_history : [];
  const materials = rec(original?.materials);
  const deckUrl = typeof materials?.deck_url === 'string' ? materials.deck_url : null;
  return <>
    <section className="mt-8" data-testid={`section-original-submission-${projectId}`}>
      <h3 className="admin-overline admin-mono">Original submission</h3>
      <p className="admin-badge">{changed ? 'Edited since submission — the sections above show the current edited view' : 'No edits detected since submission'}</p>
      {provenance && <p className="mt-2 text-sm"><strong>Provenance:</strong> {provenance}</p>}
      {original ? <details className="admin-evidence-fold mt-4" data-testid={`details-original-submission-${projectId}`}>
        <summary>Original submitted answers, proposal and evidence</summary>
        <dl className="grid gap-x-6 md:grid-cols-2">
          <Field label="Submitted at">{fmtDate(original.submitted_at)}</Field>
        </dl>
        <h4 className="admin-mono mt-4 text-xs uppercase tracking-wider">Original answers</h4>
        <ReadableValue value={original.answers} />
        <h4 className="admin-mono mt-4 text-xs uppercase tracking-wider">Original pitch record</h4>
        <ReadableValue value={original.project} />
        <h4 className="admin-mono mt-4 text-xs uppercase tracking-wider">Filmmaker at submission</h4>
        <ReadableValue value={original.filmmaker} />
        <h4 className="admin-mono mt-4 text-xs uppercase tracking-wider">Age confirmation at submission</h4>
        {original.age_confirmation ? <ReadableValue value={original.age_confirmation} /> : <p className="admin-missing">Missing: no age confirmation evidence was captured with this submission.</p>}
        <h4 className="admin-mono mt-4 text-xs uppercase tracking-wider">Original attachment references</h4>
        {materials ? <ReadableFields data={materials} skip={['deck_url']} /> : <p className="admin-missing">Missing: no attachment references were preserved.</p>}
        <div className="mt-3">{deckUrl ? <OriginalDeck projectId={projectId} url={deckUrl} /> : <p className="admin-missing">No original stored deck is retained for this submission.</p>}</div>
      </details> : <p className="admin-missing mt-3" data-testid={`text-original-missing-${projectId}`}>Missing historical evidence: no reliable original submission was saved for this pitch. Original answers are not reconstructed from the filmmaker's latest profile.</p>}
    </section>
    <section className="mt-8">
      <h3 className="admin-overline admin-mono">Review history</h3>
      {history.length ? <ReadableValue value={history} /> : <p className="admin-missing">No review decisions recorded.</p>}
    </section>
  </>;
}
