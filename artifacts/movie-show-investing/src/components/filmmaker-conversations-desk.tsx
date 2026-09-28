import { RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { getGetMyConversationsQueryKey, getGetMessagingConfigQueryKey, useGetMessagingConfig, useGetMyConversations } from '@workspace/api-client-react';
import './conversation.css';

export function FilmmakerConversationsDesk({ projectIds, uid }: { projectIds: number[]; uid: string }) {
  const config = useGetMessagingConfig({ query: { queryKey: getGetMessagingConfigQueryKey(), retry: false } });
  const list = useGetMyConversations({ query: { queryKey: [...getGetMyConversationsQueryKey(), uid], enabled: config.data?.available === true, retry: false } });
  if (!config.data?.available) return null;
  const conversations = (list.data?.conversations ?? []).filter(item => projectIds.includes(item.project_id));
  return <section className="q-desk correspondence" aria-label="Project conversations" style={{ minHeight: 0 }}><div className="page-wrap">
    <div className="corr-heading"><div><span className="corr-kicker">Your filmmaker desk / Private threads</span><h1>Open<br/><em>dialogue.</em></h1></div><p>Each thread stays with its project. Administrators can read and moderate correspondence; the Ask relay remains separate.</p></div>
    {list.isPending ? <div role="status" aria-label="Loading project conversations"><div className="corr-skeleton" style={{ width: '60%' }}/><div className="corr-skeleton" style={{ width: '40%' }}/></div>
      : list.isError ? <div className="corr-error" role="alert">Conversations could not be loaded. <button type="button" className="corr-button secondary" onClick={() => void list.refetch()} data-testid="button-retry-filmmaker-conversations">Try again <RotateCcw size={14}/></button></div>
      : conversations.length ? <div className="corr-layout" style={{ display: 'block', minHeight: 0 }}>{conversations.map(item => <Link key={item.id} href={`/messages/${item.id}`} className="corr-item" data-testid={`link-filmmaker-conversation-${item.id}`}><span className="corr-kicker">{item.locked ? 'Paused' : item.reported ? 'Under review' : 'Private thread'}</span><strong>{item.project_title}</strong><small>With {item.other_party_name} · {item.last_message_at ? new Date(item.last_message_at).toLocaleDateString() : 'No messages yet'}</small></Link>)}</div>
      : <div className="corr-state" style={{ padding: 30, background: '#f9f5ee' }}><span className="corr-kicker">No project threads yet</span><p>When an investor begins a conversation about one of your films, it will appear here.</p></div>}
    <p className="corr-disclosure">{config.data.disclosure} Administrators can read and moderate these messages.</p>
  </div></section>;
}