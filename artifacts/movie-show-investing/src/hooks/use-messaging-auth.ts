import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetFirebaseConfigQueryKey, useGetFirebaseConfig } from '@workspace/api-client-react';
import { useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { isReplitAuthActive, useAuth } from '@workspace/replit-auth-web';

export function useMessagingAuth() {
  const queryClient = useQueryClient();
  const user = useFirebaseUser();
  const ready = useFirebaseSessionReady();
  const replitAuth = useAuth();
  const config = useGetFirebaseConfig({ query: { queryKey: getGetFirebaseConfigQueryKey(), retry: false, staleTime: 300_000 } });
  // The API prefers Bearer auth, but this web client disables the Firebase
  // token getter while Replit auth is active and relies on its session cookie.
  const firebaseBearerActive = !replitAuth.isLoading && !isReplitAuthActive();
  const provider = replitAuth.user ? 'replit' : user && firebaseBearerActive ? 'firebase' : null;
  const identityId = provider === 'replit' ? replitAuth.user?.id ?? null : provider === 'firebase' ? user?.uid ?? null : null;
  const identityKey = provider && identityId ? `${provider}:${identityId}` : null;
  const previousIdentityKey = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (replitAuth.isLoading || (!replitAuth.user && !ready) || previousIdentityKey.current === identityKey) return;
    if (previousIdentityKey.current !== undefined) {
      queryClient.removeQueries({ predicate: query => typeof query.queryKey[0] === 'string' && (/^\/api\/conversations(?:\/\d+)?$/.test(query.queryKey[0]) || /^\/api\/me\/conversations$/.test(query.queryKey[0])) });
    }
    previousIdentityKey.current = identityKey;
  }, [identityKey, ready, replitAuth.isLoading, replitAuth.user, queryClient]);

  return {
    user,
    ready,
    provider,
    identityId,
    identityKey,
    authLoading: replitAuth.isLoading,
    configPending: config.isPending,
    configError: config.isError || (!!config.data && (!config.data.apiKey || !config.data.authDomain || !config.data.projectId || !config.data.appId)),
    retryConfig: config.refetch,
  };
}