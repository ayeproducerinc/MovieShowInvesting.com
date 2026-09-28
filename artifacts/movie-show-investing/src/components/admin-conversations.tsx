import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import {
  getGetAdminConversationQueryKey, getGetAdminConversationsQueryKey,
  useGetAdminConversation, useGetAdminConversations, useModerateAdminConversation,
  type ConversationModerationInputAction,
} from '@workspace/api-client-react';
import './conversation.css';

function Detail({ id, uid }: { id: number; uid: string }) {
  const queryClient = useQueryClient();
  const detail = useGetAdminConversation(id, { query: { queryKey: [...getGetAdminConversationQueryKey(id), uid], retry: false, refetchInterval: 15000 } });
  const moderate = useModerateAdminConversation();
  const [note, setNote] = useState('');
  const [feedback, setFeedback] = useState('');
  const [working, setWorking] = useState(false);
  async function submit(action: ConversationModerationInputAction) {
    if (!note.trim() || working) return;
    setFeedback(''); setWorking(true);
    try {
      await moderate.mutateAsync({ id, data: { action, note: note.trim() } });
      setNote('');
      setFeedback(action === 'resolve'
        ? `Report resolved. The conversation remains ${detail.data?.locked ? 'paused' : 'unlocked'}; report history is retained.`
        : action === 'review' ? 'Review note recorded; report status is unchanged.'
          : action === 'lock' ? 'Conversation paused.'
            : detail.data?.reported
              ? 'Conversation unlocked; the report remains active, so participant posting stays blocked.'
              : 'Conversation unlocked.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetAdminConversationQueryKey(id) }),
        queryClient.invalidateQueries({ queryKey: getGetAdminConversationsQueryKey() }),
      ]);
    } catch { setFeedback('The moderation action could not be confirmed. Refresh the audit before trying again.'); }
    finally { setWorking(false); }
  }
  if (detail.isPending) return <div className="corr-admin-detail" role="status" aria-label="Loading conversation detail"><div className="corr-skeleton" style={{ width: '65%' }}/><div className="corr-skeleton"/></div>;
  if (detail.isError || !detail.data) return <div className="corr-admin-detail" role="alert"><p>Could not load this conversation’s details. No action is available until it loads.</p><button type="button" className="corr-button secondary" onClick={() => void detail.refetch()} data-testid="button-retry-admin-thread">Try again <RotateCcw size={14}/></button></div>;
  const thread = detail.data;
  return <article className="corr-admin-detail" data-testid={`admin-thread-${id}`}>
    <span className="corr-kicker">Conversation / {String(thread.id).padStart(3, '0')}</span><h3>{thread.project_title}</h3>
    <p>Other party: {thread.other_party_name}</p>
     <p><strong>Status:</strong> {thread.locked ? 'Paused' : 'Unlocked'} · {thread.reported ? 'Reported — posting remains blocked until the report is resolved' : 'No active report'}</p>
     {thread.reported && <p className="corr-muted">Review notes and unlocking do not resolve a report. Resolve it explicitly to restore posting, unless the conversation remains paused.</p>}
    <p className="corr-muted">Created {new Date(thread.created_at).toLocaleString()} · Last message {thread.last_message_at ? new Date(thread.last_message_at).toLocaleString() : 'none'}</p>
     {(thread.reported || thread.report_reason) && <section aria-label="Report details" style={{ marginTop: 28, padding: '18px 22px', borderLeft: '3px solid #813d4d', background: '#f0dfda' }}>
       <span className="corr-kicker">{thread.reported ? 'Active report reason' : 'Most recent report reason / resolved'}</span>
      <p data-testid="text-admin-report-reason" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: 0 }}>{thread.report_reason || 'No reason was provided.'}</p>
    </section>}
    <section aria-label="Conversation messages" style={{ marginTop: 32 }}>
      <h3 style={{ fontSize: 29 }}>Messages / {thread.messages.length}</h3>
      {thread.messages.length ? <div style={{ display: 'grid', gap: 12 }}>{thread.messages.map(message => <article key={message.id} data-testid={`admin-conversation-message-${message.id}`} style={{ padding: '17px 20px', border: '1px solid #c7beb2', background: message.sender_role === 'filmmaker' ? '#eee6db' : '#f3eee5' }}>
        <span className="corr-kicker">{message.sender_role === 'filmmaker' ? 'Filmmaker' : 'Investor'} / <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time></span>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.65, marginBottom: 0 }}>{message.body}</p>
      </article>)}</div> : <p className="corr-muted">No messages have been exchanged in this conversation.</p>}
    </section>
    <h3 style={{ fontSize: 29, marginTop: 30 }}>Moderation record</h3>
    {thread.audit.length ? <ul style={{ padding: 0 }}>{thread.audit.map((entry, index) => <li key={`${entry.at}-${index}`}><span className="corr-kicker">{entry.action} / {new Date(entry.at).toLocaleString()}</span><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.note || 'No note recorded.'}</p></li>)}</ul> : <p className="corr-muted">No moderation actions recorded.</p>}
    <form onSubmit={event => { event.preventDefault(); void submit(thread.locked ? 'unlock' : 'lock'); }}><div className="corr-field"><label htmlFor={`moderation-note-${id}`}>Moderation note (required, recorded in audit)</label><textarea id={`moderation-note-${id}`} value={note} onChange={event => setNote(event.target.value)} required data-testid="textarea-moderation-note" placeholder="Reason for the action…"/></div>
       <div className="corr-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        <button type="submit" className="corr-button" disabled={!note.trim() || working} data-testid="button-moderate-lock">{thread.locked ? 'Unlock conversation' : 'Pause conversation'}</button>
        <button type="button" className="corr-button secondary" disabled={!note.trim() || working} onClick={() => void submit('review')} data-testid="button-moderate-review">Record review note</button>
         {thread.reported && <button type="button" className="corr-button secondary" disabled={!note.trim() || working} onClick={() => void submit('resolve')} data-testid="button-moderate-resolve">Resolve report</button>}
      </div>
    </form>
    {feedback && <p className={feedback.startsWith('The moderation') ? 'corr-error' : 'corr-muted'} role={feedback.startsWith('The moderation') ? 'alert' : 'status'}>{feedback}</p>}
  </article>;
}

export function AdminConversations({ uid }: { uid: string }) {
  const list = useGetAdminConversations({ query: { queryKey: [...getGetAdminConversationsQueryKey(), uid], retry: false, refetchInterval: 20000 } });
  const [selected, setSelected] = useState<number | null>(null);
  return <section className="corr-admin" aria-label="Conversation moderation"><span className="corr-kicker">Private correspondence / Moderation</span>
    {list.isPending ? <div role="status" aria-label="Loading administrator conversations"><div className="corr-skeleton" style={{ width: '35%' }}/><div className="corr-skeleton" style={{ width: '70%' }}/></div>
    : list.isError ? <div className="corr-error" role="alert">Conversation records could not be loaded. <button type="button" className="corr-button secondary" onClick={() => void list.refetch()} data-testid="button-retry-admin-conversations">Try again <RotateCcw size={14}/></button></div>
    : !list.data?.conversations.length ? <div className="corr-admin-detail"><h3>No threads to moderate.</h3><p>Project conversations will appear here when the messaging service is available and a participant opens one.</p></div>
    : <div className="corr-admin-grid"><div className="corr-admin-list" aria-label="All conversations">{list.data.conversations.map(item => <button type="button" key={item.id} aria-current={selected === item.id} onClick={() => setSelected(item.id)} data-testid={`button-admin-conversation-${item.id}`}><strong>{item.project_title}</strong><br/><span className="corr-muted">#{item.id} · {item.other_party_name} · {item.reported ? 'Reported' : item.locked ? 'Paused' : 'Open'}</span></button>)}</div>{selected ? <Detail key={`${selected}-${uid}`} id={selected} uid={uid}/> : <div className="corr-admin-detail"><h3>Select a conversation.</h3><p>Read its status and moderation record, then take an explicit, audited action if needed. Reported threads are marked in the index.</p></div>}</div>}
  </section>;
}