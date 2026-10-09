import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, RotateCcw, Send } from 'lucide-react';
import { Link, useLocation, useParams } from 'wouter';
import {
  getGetConversationQueryKey, getGetMyConversationsQueryKey, getGetMessagingConfigQueryKey,
  useCreateConversation, useGetConversation, useGetMessagingConfig, useGetMyConversations,
  useReportConversation, useSendConversationMessage,
  type Conversation,
} from '@workspace/api-client-react';
import { useMessagingAuth } from '@/hooks/use-messaging-auth';
import '@/components/conversation.css';

const APPROVED_MESSAGING_NOTICE = 'Project messages are visible to the signed-in investor and the filmmaker for that project. Authorized Movie Show Investing administrators can also read messages and reports, review safety concerns, and lock conversations. Messages are stored on the platform. Email notifications, if enabled, contain no message text. Do not share confidential scripts or sensitive personal or financial information.';

function date(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No messages yet';
}

function roleLabel(role: string) {
  return role === 'filmmaker' ? 'Filmmaker' : 'Investor';
}

function senderName(conversation: Conversation, role: string) {
  return role === 'filmmaker' ? conversation.filmmaker_name || 'Filmmaker' : conversation.investor_name || 'Investor';
}

function Thread({ id, provider, uid, scopeKey, onChange }: { id: number; provider: string; uid: string; scopeKey: string; onChange: () => void }) {
  const queryClient = useQueryClient();
  const detailKey = [...getGetConversationQueryKey(id), provider, uid];
  const listKey = [...getGetMyConversationsQueryKey(), provider, uid];
  const detail = useGetConversation(id, { query: { queryKey: detailKey, retry: false, refetchInterval: 15000, refetchIntervalInBackground: false } });
  const send = useSendConversationMessage();
  const report = useReportConversation();
  const [body, setBody] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [reportFeedback, setReportFeedback] = useState('');
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => { setBody(''); setReason(''); setError(''); setReportFeedback(''); setUncertain(false); }, [id, scopeKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() || send.isPending || uncertain) return;
    setError('');
    try {
      await send.mutateAsync({ id, data: { body: body.trim() } });
      setBody('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: detailKey, exact: true }),
        queryClient.invalidateQueries({ queryKey: listKey, exact: true }),
      ]);
      onChange();
    } catch {
      setUncertain(true);
      setError('Delivery could not be confirmed. Your draft is preserved. Refresh the thread to check whether it arrived before sending again.');
    }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) return;
    setReportFeedback('');
    try {
      await report.mutateAsync({ id, data: { reason: reason.trim() } });
      setReason('');
      setReportFeedback('Report received. An administrator can review this conversation.');
      await queryClient.invalidateQueries({ queryKey: detailKey, exact: true });
    } catch { setReportFeedback('The report could not be confirmed. Please check again before resubmitting.'); }
  }

  if (detail.isPending) return <div className="corr-thread"><div className="corr-state" role="status" aria-label="Loading correspondence"><div className="corr-skeleton" style={{ width: '42%', height: 45 }}/><div className="corr-skeleton" style={{ width: '75%' }}/><div className="corr-skeleton" style={{ width: '60%' }}/></div></div>;
  if (detail.isError || !detail.data) return <div className="corr-thread"><div className="corr-state" role="alert"><span className="corr-kicker">Correspondence unavailable</span><h2>This thread is out of reach.</h2><p>{detail.error?.status === 403 || detail.error?.status === 404 ? 'This conversation is not available to this account.' : 'We could not retrieve this conversation. Nothing has been changed.'}</p><button type="button" className="corr-button secondary" onClick={() => void detail.refetch()} data-testid="button-retry-thread">Try again <RotateCcw size={15}/></button></div></div>;
  const { conversation, messages } = detail.data;
  return <article className="corr-thread" data-testid={`thread-conversation-${id}`}>
    <div className="corr-thread-head"><div><h2 data-testid="text-thread-project">{conversation.project_title}</h2><span className="corr-muted" data-testid="text-thread-with">With {conversation.other_party_name}{conversation.viewer_role ? ` (${roleLabel(conversation.viewer_role === 'investor' ? 'filmmaker' : 'investor').toLowerCase()})` : ''}</span></div><Link href={`/project/${conversation.project_slug}`} data-testid="link-thread-project">View project <ArrowUpRight size={13} style={{ display: 'inline' }}/></Link></div>
    <div className="corr-messages" aria-label="Messages" aria-live="polite">
      {messages.length ? messages.map((message, index) => {
        const own = message.sender_role === conversation.viewer_role;
        const continued = index > 0 && messages[index - 1].sender_role === message.sender_role;
        return <div className={`corr-message${own ? ' is-own' : ''}${continued ? ' is-continued' : ''}`} key={message.id} data-testid={`message-${message.id}`}>
          {!continued && <span className="corr-sender" data-testid={`text-message-sender-${message.id}`}>{own ? `You · ${senderName(conversation, message.sender_role)}` : `${senderName(conversation, message.sender_role)} · ${roleLabel(message.sender_role)}`}</span>}
          <p>{message.body}</p>
          <time dateTime={message.created_at}>{date(message.created_at)}</time>
        </div>;
      }) : <div className="corr-state"><h2>No messages yet.</h2><p>Write the first message about this project below.</p></div>}
    </div>
    {conversation.locked ? <div className="corr-compose"><p role="status">This thread has been paused by an administrator. Previous messages remain visible.</p></div> : conversation.reported ? <div className="corr-compose"><p role="status">This conversation is under review. Replies are unavailable while an administrator reviews the report. Previous messages remain visible.</p></div> : <form className="corr-compose" onSubmit={event => void submit(event)}>
      <label htmlFor={`message-body-${id}`}>Write a message</label>
      <textarea id={`message-body-${id}`} value={body} onChange={event => setBody(event.target.value)} placeholder="A note about the project…" required data-testid="textarea-message-body"/>
      {error && <p role="alert" className="corr-error">{error}</p>}
      <div className="corr-actions"><span className="corr-muted">Text only.</span><button className="corr-button" type="submit" disabled={!body.trim() || send.isPending || uncertain} data-testid="button-send-message">{send.isPending ? 'Sending…' : 'Send message'} <Send size={15}/></button></div>
      {uncertain && <button type="button" className="corr-button secondary" style={{ marginTop: 13 }} onClick={async () => { await detail.refetch(); setUncertain(false); }} data-testid="button-check-message">Check thread before retrying <RotateCcw size={14}/></button>}
    </form>}
    <details className="corr-report"><summary data-testid="summary-report-thread">Report this conversation</summary><form onSubmit={event => void submitReport(event)}><div className="corr-field"><label htmlFor={`report-${id}`}>Tell us what needs review</label><textarea id={`report-${id}`} required value={reason} onChange={event => setReason(event.target.value)} data-testid="textarea-report-reason"/></div><button type="submit" className="corr-button secondary" disabled={!reason.trim() || report.isPending} data-testid="button-submit-report">{report.isPending ? 'Submitting…' : 'Submit report'}</button>{reportFeedback && <p role={reportFeedback.startsWith('Report received') ? 'status' : 'alert'} className={reportFeedback.startsWith('Report received') ? 'corr-muted' : 'corr-error'}>{reportFeedback}</p>}</form></details>
  </article>;
}

function NewThread({ projectSlug, conversations, provider, uid }: { projectSlug: string; conversations: Conversation[]; provider: string; uid: string }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const create = useCreateConversation();
  const [error, setError] = useState('');
  const existing = conversations.find(item => item.project_slug === projectSlug);
  async function begin() {
    setError('');
    try {
      const conversation = await create.mutateAsync({ slug: projectSlug });
      await queryClient.invalidateQueries({ queryKey: [...getGetMyConversationsQueryKey(), provider, uid], exact: true });
      navigate(`/messages/${conversation.id}`);
    } catch { setError('We could not open this project conversation. No message was sent. Please try again.'); }
  }
  return <div className="corr-state"><h1>Message the filmmaker</h1><div className="corr-actions" style={{ justifyContent: 'flex-start' }}>{existing ? <Link href={`/messages/${existing.id}`} className="corr-button" data-testid="link-existing-conversation">Open existing thread <ArrowRight size={16}/></Link> : <button className="corr-button" type="button" onClick={() => void begin()} disabled={create.isPending} data-testid="button-create-conversation">{create.isPending ? 'Opening…' : 'Open a conversation'} <ArrowRight size={16}/></button>}</div>{error && <p className="corr-error" role="alert">{error}</p>}</div>;
}

export default function Conversation() {
  const queryClient = useQueryClient();
  const params = useParams<{ id?: string }>();
  const id = params.id && /^[1-9]\d*$/.test(params.id) ? Number(params.id) : null;
  const projectSlug = new URLSearchParams(window.location.search).get('project');
  const auth = useMessagingAuth();
  const config = useGetMessagingConfig({ query: { queryKey: getGetMessagingConfigQueryKey(), retry: false, staleTime: 30000 } });
  const identityId = auth.identityId;
  const messagingAvailable = config.data?.available === true && config.data.disclosure === APPROVED_MESSAGING_NOTICE;
  const provider = auth.provider;
  const scopeKey = auth.identityKey;
  const list = useGetMyConversations({ query: { queryKey: [...getGetMyConversationsQueryKey(), provider, identityId], enabled: messagingAvailable && !!identityId && !!provider && auth.ready, retry: false, refetchInterval: id ? 20000 : false } });
  useEffect(() => { document.title = 'Messages | Movie Show Investing'; const meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]') ?? document.createElement('meta'); const old = meta.content; meta.name = 'robots'; meta.content = 'noindex, nofollow'; if (!meta.parentNode) document.head.append(meta); return () => { if (old) meta.content = old; else meta.remove(); }; }, []);
  const unavailable = config.isError || !messagingAvailable;
  return <main className="correspondence">
    
    {config.isPending || auth.configPending ? <div className="corr-state" role="status" aria-label="Loading messaging"><div className="corr-skeleton" style={{ width: '30%' }}/><div className="corr-skeleton" style={{ width: '75%', height: 90 }}/><div className="corr-skeleton" style={{ width: '54%' }}/></div>
      : unavailable ? <div className="corr-state"><h1>Messages</h1><p>{config.data?.available === false
      ? 'Project messaging is turned off right now. Existing threads cannot be read or started until the messaging privacy setup is approved.'
      : 'Messaging availability could not be confirmed, so private conversations are not being shown. Try again when the service is available.'} {identityId ? 'You can still sign out in the site header.' : 'Use Sign in in the site header to manage your filmmaker projects and other account features.'}</p><button type="button" className="corr-button secondary" onClick={() => void config.refetch()} data-testid="button-retry-messaging">Check availability <RotateCcw size={15}/></button></div>
      : !identityId && (auth.configError || !auth.ready) ? <div className="corr-state"><h1>Messages</h1><p>Google sign-in could not be prepared. Your messages have not changed. Use Sign in in the site header when it becomes available.</p><button type="button" className="corr-button secondary" onClick={() => void auth.retryConfig()} data-testid="button-retry-message-auth">Check again <RotateCcw size={15}/></button></div>
      : !identityId ? <div className="corr-state"><h1>Messages</h1><p>Use Sign in in the site header to read and send project messages.</p></div>
      : <><div className="corr-heading"><h1>Messages</h1></div>
      {list.isPending ? <div className="corr-layout"><div className="corr-state" role="status" aria-label="Loading conversations"><div className="corr-skeleton"/><div className="corr-skeleton"/><div className="corr-skeleton"/></div></div>
      : list.isError ? <div className="corr-state" role="alert"><h2>We couldn’t open your desk.</h2><p>We couldn’t verify access to your private conversations, so none are being shown. Try again when the connection returns.</p><button type="button" className="corr-button secondary" onClick={() => void list.refetch()} data-testid="button-retry-conversations">Try again <RotateCcw size={15}/></button></div>
        : <div className="corr-layout"><aside className="corr-list" aria-label="Your conversations"><div className="corr-list-head"><span className="corr-kicker">Conversations</span><span className="corr-kicker">{list.data?.conversations.length ?? 0}</span></div><div className="corr-list-scroll">{(list.data?.conversations ?? []).map(item => <Link key={item.id} href={`/messages/${item.id}`} className={`corr-item ${id === item.id ? 'is-active' : ''}`} aria-current={id === item.id ? 'page' : undefined} data-testid={`link-conversation-${item.id}`}>{(item.locked || item.reported) && <span className="corr-kicker">{item.locked ? 'Paused' : 'Under review'}</span>}<strong>{item.other_party_name}</strong><small>{item.project_title} · {date(item.last_message_at)}</small></Link>)}{!list.data?.conversations.length && <div className="corr-state" style={{ padding: 25 }}><p>No conversations yet. Open a project page to message its filmmaker.</p></div>}</div></aside>{id && Number.isSafeInteger(id) ? provider && scopeKey && <Thread key={`${id}:${scopeKey}`} id={id} provider={provider} uid={identityId!} scopeKey={scopeKey} onChange={() => void list.refetch()}/> : projectSlug ? provider && identityId ? <NewThread projectSlug={projectSlug} conversations={list.data?.conversations ?? []} provider={provider} uid={identityId}/> : null : <div className="corr-state"><p>Select a conversation to read it.</p><Link href="/explore" className="corr-button secondary" data-testid="link-browse-projects">Explore projects <ArrowUpRight size={16}/></Link></div>}</div>}
    </>}
     {messagingAvailable && <details className="corr-disclosure"><summary>Who can read these messages?</summary><p data-testid="text-messaging-disclosure">{config.data?.disclosure}</p></details>}
  </main>;
}