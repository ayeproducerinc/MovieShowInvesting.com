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
import { useAuth } from '@workspace/replit-auth-web';

function date(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No messages yet';
}

function Thread({ id, uid, onChange }: { id: number; uid: string; onChange: () => void }) {
  const queryClient = useQueryClient();
  const detail = useGetConversation(id, { query: { queryKey: [...getGetConversationQueryKey(id), uid], retry: false, refetchInterval: 15000, refetchIntervalInBackground: false } });
  const send = useSendConversationMessage();
  const report = useReportConversation();
  const [body, setBody] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [reportFeedback, setReportFeedback] = useState('');
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => { setBody(''); setReason(''); setError(''); setReportFeedback(''); setUncertain(false); }, [id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() || send.isPending || uncertain) return;
    setError('');
    try {
      await send.mutateAsync({ id, data: { body: body.trim() } });
      setBody('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(id) }),
        queryClient.invalidateQueries({ queryKey: getGetMyConversationsQueryKey() }),
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
      await queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(id) });
    } catch { setReportFeedback('The report could not be confirmed. Please check again before resubmitting.'); }
  }

  if (detail.isPending) return <div className="corr-thread"><div className="corr-state" role="status" aria-label="Loading correspondence"><div className="corr-skeleton" style={{ width: '42%', height: 45 }}/><div className="corr-skeleton" style={{ width: '75%' }}/><div className="corr-skeleton" style={{ width: '60%' }}/></div></div>;
  if (detail.isError || !detail.data) return <div className="corr-thread"><div className="corr-state" role="alert"><span className="corr-kicker">Correspondence unavailable</span><h2>This thread is out of reach.</h2><p>{detail.error?.status === 403 || detail.error?.status === 404 ? 'This conversation is not available to this account.' : 'We could not retrieve this conversation. Nothing has been changed.'}</p><button type="button" className="corr-button secondary" onClick={() => void detail.refetch()} data-testid="button-retry-thread">Try again <RotateCcw size={15}/></button></div></div>;
  const { conversation, messages } = detail.data;
  return <article className="corr-thread" data-testid={`thread-conversation-${id}`}>
    <div className="corr-thread-head"><div><span className="corr-kicker">Project correspondence / {String(id).padStart(3, '0')}</span><h2 data-testid="text-thread-project">{conversation.project_title}</h2><span className="corr-muted">In conversation with {conversation.other_party_name}</span></div><Link href={`/project/${conversation.project_slug}`} data-testid="link-thread-project">View dossier <ArrowUpRight size={13} style={{ display: 'inline' }}/></Link></div>
    <div className="corr-messages" aria-label="Messages" aria-live="polite">
      {messages.length ? messages.map(message => <div className="corr-message" key={message.id} data-testid={`message-${message.id}`}><span className="corr-kicker">{message.sender_role === 'filmmaker' ? 'Filmmaker' : 'Investor'}</span><p>{message.body}</p><time dateTime={message.created_at}>{date(message.created_at)}</time></div>) : <div className="corr-state"><span className="corr-kicker">An open line</span><h2>No words exchanged yet.</h2><p>Start with a considered note about this film. This is a text-only conversation, not an investment commitment.</p></div>}
    </div>
    {conversation.locked ? <div className="corr-compose"><p role="status">This thread has been paused by an administrator. Previous messages remain visible.</p></div> : <form className="corr-compose" onSubmit={event => void submit(event)}>
      <label htmlFor={`message-body-${id}`}>Write a message</label>
      <textarea id={`message-body-${id}`} value={body} onChange={event => setBody(event.target.value)} placeholder="A note about the project…" required data-testid="textarea-message-body"/>
      {error && <p role="alert" className="corr-error">{error}</p>}
      <div className="corr-actions"><span className="corr-muted">Text only. No attachments or contact details are exchanged here.</span><button className="corr-button" type="submit" disabled={!body.trim() || send.isPending || uncertain} data-testid="button-send-message">{send.isPending ? 'Sending…' : 'Send message'} <Send size={15}/></button></div>
      {uncertain && <button type="button" className="corr-button secondary" style={{ marginTop: 13 }} onClick={async () => { await detail.refetch(); setUncertain(false); }} data-testid="button-check-message">Check thread before retrying <RotateCcw size={14}/></button>}
    </form>}
    <details className="corr-report"><summary data-testid="summary-report-thread">Report this conversation</summary><form onSubmit={event => void submitReport(event)}><div className="corr-field"><label htmlFor={`report-${id}`}>Tell us what needs review</label><textarea id={`report-${id}`} required value={reason} onChange={event => setReason(event.target.value)} data-testid="textarea-report-reason"/></div><button type="submit" className="corr-button secondary" disabled={!reason.trim() || report.isPending} data-testid="button-submit-report">{report.isPending ? 'Submitting…' : 'Submit report'}</button>{reportFeedback && <p role={reportFeedback.startsWith('Report received') ? 'status' : 'alert'} className={reportFeedback.startsWith('Report received') ? 'corr-muted' : 'corr-error'}>{reportFeedback}</p>}</form></details>
  </article>;
}

function NewThread({ projectSlug, conversations }: { projectSlug: string; conversations: Conversation[] }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const create = useCreateConversation();
  const [error, setError] = useState('');
  const existing = conversations.find(item => item.project_slug === projectSlug);
  async function begin() {
    setError('');
    try {
      const conversation = await create.mutateAsync({ slug: projectSlug });
      await queryClient.invalidateQueries({ queryKey: getGetMyConversationsQueryKey() });
      navigate(`/messages/${conversation.id}`);
    } catch { setError('We could not open this project conversation. No message was sent. Please try again.'); }
  }
  return <div className="corr-state"><span className="corr-kicker">A private line / {projectSlug}</span><h1>Begin a<br/><em>conversation.</em></h1><p>Correspondence stays with this film. An administrator can read and moderate messages; do not share sensitive personal or financial information here.</p><div className="corr-actions" style={{ justifyContent: 'flex-start' }}>{existing ? <Link href={`/messages/${existing.id}`} className="corr-button" data-testid="link-existing-conversation">Open existing thread <ArrowRight size={16}/></Link> : <button className="corr-button" type="button" onClick={() => void begin()} disabled={create.isPending} data-testid="button-create-conversation">{create.isPending ? 'Opening…' : 'Open a conversation'} <ArrowRight size={16}/></button>}</div>{error && <p className="corr-error" role="alert">{error}</p>}</div>;
}

export default function Conversation() {
  const queryClient = useQueryClient();
  const params = useParams<{ id?: string }>();
  const id = params.id && /^[1-9]\d*$/.test(params.id) ? Number(params.id) : null;
  const projectSlug = new URLSearchParams(window.location.search).get('project');
  const auth = useMessagingAuth();
  const replitAuth = useAuth();
  const config = useGetMessagingConfig({ query: { queryKey: getGetMessagingConfigQueryKey(), retry: false, staleTime: 30000 } });
  const identityId = replitAuth.user?.id ?? auth.user?.uid;
  const list = useGetMyConversations({ query: { queryKey: [...getGetMyConversationsQueryKey(), identityId], enabled: !replitAuth.isLoading && config.data?.available === true && !!identityId && (Boolean(replitAuth.user) || auth.ready), retry: false, refetchInterval: id ? 20000 : false } });
  useEffect(() => { document.title = 'Correspondence | Movie Show Investing'; const meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]') ?? document.createElement('meta'); const old = meta.content; meta.name = 'robots'; meta.content = 'noindex, nofollow'; if (!meta.parentNode) document.head.append(meta); return () => { if (old) meta.content = old; else meta.remove(); }; }, []);
  const unavailable = config.isError || !config.data?.available;
  if (replitAuth.isLoading) return <main className="correspondence"><div className="corr-state" role="status" aria-label="Checking sign-in"><div className="corr-skeleton" style={{ width: '30%' }}/><div className="corr-skeleton" style={{ width: '75%', height: 90 }}/><div className="corr-skeleton" style={{ width: '54%' }}/></div></main>;
  return <main className="correspondence">
    <header className="corr-top"><Link href="/" className="corr-kicker" data-testid="link-correspondence-home">Movie Show Investing / Correspondence</Link><span className="corr-kicker">Private project conversations</span></header>
    {config.isPending || auth.configPending ? <div className="corr-state" role="status" aria-label="Loading messaging"><div className="corr-skeleton" style={{ width: '30%' }}/><div className="corr-skeleton" style={{ width: '75%', height: 90 }}/><div className="corr-skeleton" style={{ width: '54%' }}/></div>
      : unavailable ? <div className="corr-state"><span className="corr-kicker">Correspondence / Not yet open</span><h1>A quieter<br/><em>channel, soon.</em></h1><p>{config.data?.available === false
      ? 'Project messaging is turned off right now. Existing threads cannot be read or started until the messaging privacy setup is approved.'
      : 'Messaging availability could not be confirmed, so private conversations are not being shown. Try again when the service is available.'} {identityId ? 'You can still sign out in the site header.' : 'Use Sign in in the site header to manage your filmmaker projects and other account features.'}</p><button type="button" className="corr-button secondary" onClick={() => void config.refetch()} data-testid="button-retry-messaging">Check availability <RotateCcw size={15}/></button></div>
      : !identityId && (auth.configError || !auth.ready) ? <div className="corr-state"><span className="corr-kicker">Access unavailable</span><h1>Not connected<br/><em>yet.</em></h1><p>Google sign-in could not be prepared. Your messages have not changed. Use Sign in in the site header when it becomes available.</p><button type="button" className="corr-button secondary" onClick={() => void auth.retryConfig()} data-testid="button-retry-message-auth">Check again <RotateCcw size={15}/></button></div>
      : !identityId ? <div className="corr-state"><span className="corr-kicker">Private access / Account sign-in</span><h1>Words worth<br/><em>keeping.</em></h1><p>Use Sign in in the site header to read and write project correspondence. Administrators can read and moderate these messages.</p></div>
      : <><div className="corr-heading"><div><span className="corr-kicker">The correspondence desk / {String(list.data?.conversations.length ?? 0).padStart(2, '0')} threads</span><h1>Between<br/><em>the lines.</em></h1></div><div><p>Private, project-scoped notes between an investor and a filmmaker. This is a place for conversation, not a commitment to invest.</p></div></div>
      {list.isPending ? <div className="corr-layout"><div className="corr-state" role="status" aria-label="Loading conversations"><div className="corr-skeleton"/><div className="corr-skeleton"/><div className="corr-skeleton"/></div></div>
      : list.isError ? <div className="corr-state" role="alert"><h2>We couldn’t open your desk.</h2><p>We couldn’t verify access to your private conversations, so none are being shown. Try again when the connection returns.</p><button type="button" className="corr-button secondary" onClick={() => void list.refetch()} data-testid="button-retry-conversations">Try again <RotateCcw size={15}/></button></div>
       : <div className="corr-layout"><aside className="corr-list" aria-label="Your conversations"><div className="corr-list-head"><span className="corr-kicker">Your threads</span><span className="corr-kicker">{list.data?.conversations.length ?? 0}</span></div><div className="corr-list-scroll">{(list.data?.conversations ?? []).map(item => <Link key={item.id} href={`/messages/${item.id}`} className={`corr-item ${id === item.id ? 'is-active' : ''}`} aria-current={id === item.id ? 'page' : undefined} data-testid={`link-conversation-${item.id}`}><span className="corr-kicker">{item.locked ? 'Paused' : item.reported ? 'Under review' : 'Project / Private'}</span><strong>{item.project_title}</strong><small>{item.other_party_name} · {date(item.last_message_at)}</small></Link>)}{!list.data?.conversations.length && <div className="corr-state" style={{ padding: 25 }}><span className="corr-kicker">No conversations yet</span><p>Open a film dossier to begin a project conversation when available.</p></div>}</div></aside>{id && Number.isSafeInteger(id) ? <Thread id={id} uid={identityId!} onChange={() => void list.refetch()}/> : projectSlug ? <NewThread projectSlug={projectSlug} conversations={list.data?.conversations ?? []}/> : <div className="corr-state"><span className="corr-kicker">Select a thread</span><h1>Room to<br/><em>respond.</em></h1><p>Choose a conversation from the index to read its messages, or visit a film dossier to begin a new one.</p><Link href="/" className="corr-button secondary" data-testid="link-browse-projects">Return to the site <ArrowUpRight size={16}/></Link></div>}</div>}
    </>}
    {config.data?.available && <footer className="corr-disclosure" data-testid="text-messaging-disclosure">{config.data.disclosure} Administrators can read and moderate conversations. Messages are text-only and are not an offer or an investment commitment.</footer>}
  </main>;
}