import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { getGetMessagingConfigQueryKey, getGetMyConversationsQueryKey, useCreateConversation, useGetMessagingConfig } from '@workspace/api-client-react';
import { useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import './conversation.css';
import { useAuth } from '@workspace/replit-auth-web';

export function ProjectConversationEntry({ slug }: { slug: string }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const user = useFirebaseUser();
  const replitAuth = useAuth();
  const authenticated = Boolean(replitAuth.user || user);
  const ready = useFirebaseSessionReady();
  const config = useGetMessagingConfig({ query: { queryKey: getGetMessagingConfigQueryKey(), retry: false, staleTime: 30000 } });
  const create = useCreateConversation();
  const [error, setError] = useState('');
  async function begin() {
    setError('');
    try {
      const conversation = await create.mutateAsync({ slug });
      await queryClient.invalidateQueries({ queryKey: getGetMyConversationsQueryKey() });
      navigate(`/messages/${conversation.id}`);
    } catch { setError('We could not open the conversation. No message was sent. Please try again.'); }
  }
  return <section className="corr-project-entry" aria-label="Project correspondence"><span className="dossier-kicker">Private correspondence / This film</span><h2>Stay in conversation.</h2>
    {config.isPending ? <p role="status">Checking whether project messaging is open…</p> : !config.data?.available ? <><p data-testid="status-messaging-unavailable">Project messaging is not available yet. The privacy setup must be approved before private threads can open. You can still use the separate Ask the filmmaker form above.</p>{config.isError && <button type="button" className="dossier-button dossier-button-outline" onClick={() => void config.refetch()} data-testid="button-check-project-messaging">Check again <RotateCcw size={15}/></button>}</>
     : <><p>{config.data.disclosure} Administrators can read and moderate messages. This is a text-only exchange about the film, not an investment commitment.</p>{replitAuth.isLoading || !ready && !replitAuth.user ? <p role="status">Checking sign-in…</p> : authenticated ? <button type="button" className="dossier-button" disabled={create.isPending} onClick={() => void begin()} data-testid="button-open-project-conversation">{create.isPending ? 'Opening…' : 'Start or continue conversation'} <ArrowUpRight size={16}/></button> : <Link href={`/messages?project=${encodeURIComponent(slug)}`} className="dossier-button" data-testid="link-sign-in-project-conversation">Sign in to start a conversation <ArrowUpRight size={16}/></Link>}</>}
    {error && <p className="dossier-error" role="alert">{error}</p>}
  </section>;
}