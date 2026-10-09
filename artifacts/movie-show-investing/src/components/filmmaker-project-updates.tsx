import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFilmmakerProjectUpdatesQueryKey, useCreateFilmmakerProjectUpdate, useGetFilmmakerProjectUpdates,
} from '@workspace/api-client-react';
import { filmmakerEmailLine, updateStatusLabel } from '@/lib/project-update-display';

const NOTE_MAX = 500;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const selectStyle = { width: '100%', padding: '14px 16px', border: '1px solid #a9a194', borderRadius: 0, background: '#fbf8f1', font: '500 14px/1.5 var(--app-font-sans)' } as const;
const GROUP_LABEL: Record<string, string> = { idea: 'Idea stage', production: 'Production stage', distribution: 'Distribution stage', any: 'Any stage' };

/** "Post an update" for the project's own filmmaker (DECISIONS.md › Project updates). */
export function FilmmakerProjectUpdates({ projectId, identityId }: { projectId: number; identityId: string }) {
  const queryClient = useQueryClient();
  const queryKey = [...getGetFilmmakerProjectUpdatesQueryKey(projectId), identityId];
  const updates = useGetFilmmakerProjectUpdates(projectId, { query: { queryKey, retry: false } });
  const create = useCreateFilmmakerProjectUpdate();
  const [milestone, setMilestone] = useState('');
  const [role, setRole] = useState('');
  const [personName, setPersonName] = useState('');
  const [nameConsent, setNameConsent] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  if (updates.isPending) return <section className="dossier-section" data-testid="section-project-updates"><span className="dossier-kicker">Project updates</span><p role="status">Loading your updates…</p></section>;
  if (updates.isError) return <section className="dossier-section" data-testid="section-project-updates"><span className="dossier-kicker">Project updates</span><p role="alert">Your updates couldn’t load right now. <button type="button" className="underline" onClick={() => void updates.refetch()}>Try again</button></p></section>;

  const data = updates.data;
  const groups = ['idea', 'production', 'distribution', 'any'].filter(group => data.milestone_options.some(option => option.group === group));
  const submit = async () => {
    setMessage(null);
    if (!milestone) { setMessage({ text: 'Choose a milestone.', failed: true }); return; }
    try {
      await create.mutateAsync({ projectId, data: {
        milestone_key: milestone,
        role: milestone === 'team_member_joined' ? role || null : null,
        person_name: milestone === 'team_member_joined' && nameConsent ? personName : null,
        name_consent: milestone === 'team_member_joined' && nameConsent,
        custom_label: milestone === 'other' ? customLabel : null,
        note: note || null,
      } });
      setMilestone(''); setRole(''); setPersonName(''); setNameConsent(false); setCustomLabel(''); setNote('');
      setMessage({ text: 'Posted. Waiting for review — it appears on your project page once approved.', failed: false });
      await queryClient.invalidateQueries({ queryKey: getGetFilmmakerProjectUpdatesQueryKey(projectId) });
    } catch (cause) {
      const data = cause && typeof cause === 'object' && 'data' in cause ? (cause as { data?: unknown }).data : null;
      const detail = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : null;
      setMessage({ text: detail ?? 'Your update couldn’t be posted. Please try again.', failed: true });
    }
  };

  return <section className="dossier-section" data-testid="section-project-updates" style={{ overflowWrap: 'anywhere' }}>
    <span className="dossier-kicker">Project updates</span>
    <h2>Post an update.</h2>
    <p>Share a milestone with the people who pledged. Every update is reviewed before it appears on your project page.</p>
    <div className="dossier-field">
      <label htmlFor="update-milestone">Milestone</label>
      <select id="update-milestone" data-testid="select-update-milestone" style={selectStyle} value={milestone} onChange={event => setMilestone(event.target.value)}>
        <option value="">Choose a milestone…</option>
        {groups.map(group => <optgroup key={group} label={GROUP_LABEL[group]}>
          {data.milestone_options.filter(option => option.group === group).map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
        </optgroup>)}
      </select>
    </div>
    {milestone === 'team_member_joined' && <>
      <div className="dossier-field">
        <label htmlFor="update-role">Their role</label>
        <select id="update-role" data-testid="select-update-role" style={selectStyle} value={role} onChange={event => setRole(event.target.value)}>
          <option value="">Choose a role…</option>
          {data.team_roles.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </div>
      <div className="dossier-field">
        <label htmlFor="update-person">Their name <small>· optional</small></label>
        <input id="update-person" data-testid="input-update-person" maxLength={80} value={personName} onChange={event => setPersonName(event.target.value)} />
      </div>
      <label className="fm-check" style={{ marginBottom: 21 }}><input type="checkbox" data-testid="checkbox-update-name-consent" checked={nameConsent} onChange={event => setNameConsent(event.target.checked)} /><span>This person agreed to be named publicly. Without this, their name isn’t saved.</span></label>
    </>}
    {milestone === 'other' && <div className="dossier-field">
      <label htmlFor="update-label">Short label</label>
      <input id="update-label" data-testid="input-update-label" maxLength={60} value={customLabel} onChange={event => setCustomLabel(event.target.value)} placeholder="For example: Table read done" />
    </div>}
    <div className="dossier-field">
      <label htmlFor="update-note">Note <small>· optional, {note.length}/{NOTE_MAX}</small></label>
      <textarea id="update-note" data-testid="input-update-note" maxLength={NOTE_MAX} rows={4} value={note} onChange={event => setNote(event.target.value)} />
    </div>
    <p className="dossier-status" data-testid="text-update-backers">{filmmakerEmailLine(data.backers_to_email)}</p>
    {message && <p role={message.failed ? 'alert' : 'status'} className={message.failed ? 'dossier-error' : 'dossier-notice'} data-testid="status-update-post">{message.text}</p>}
    <button type="button" className="dossier-button" data-testid="button-post-update" disabled={create.isPending} onClick={() => void submit()}>{create.isPending ? 'Posting…' : 'Post update'}</button>
    {data.updates.length > 0 && <ul className="dossier-links" data-testid="list-project-updates" style={{ marginTop: 24 }}>
      {data.updates.map(update => <li key={update.id}>
        <strong>{update.label}</strong>{update.role && ` · ${update.role}`}{update.person_name && ` · ${update.person_name}`} · {day(update.created_at)} · <span data-testid={`status-update-${update.id}`}>{updateStatusLabel(update.status)}</span>
        {update.note && <><br /><span>{update.note}</span></>}
      </li>)}
    </ul>}
  </section>;
}
