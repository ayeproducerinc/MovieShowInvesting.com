import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetFirebaseConfigQueryKey, useGetFirebaseConfig } from '@workspace/api-client-react';
import { useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';

export function useMessagingAuth() {
  const queryClient = useQueryClient();
  const user = useFirebaseUser();
  const ready = useFirebaseSessionReady();
  const config = useGetFirebaseConfig({ query: { queryKey: getGetFirebaseConfigQueryKey(), retry: false, staleTime: 300_000 } });
  const provider = user ? 'firebase' : null;
  const identityId = provider === 'firebase' ? user?.uid ?? null : null;
  const identityKey = provider && identityId ? `${provider}:${identityId}` : null;
  const previousIdentityKey = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!ready || previousIdentityKey.current === identityKey) return;
    if (previousIdentityKey.current !== undefined) {
      queryClient.removeQueries({ predicate: query => typeof query.queryKey[0] === 'string' && (/^\/api\/conversations(?:\/\d+)?$/.test(query.queryKey[0]) || /^\/api\/me\/conversations$/.test(query.queryKey[0])) });
    }
    previousIdentityKey.current = identityKey;
  }, [identityKey, ready, queryClient]);

  return {
    user,
    ready,
    provider,
    identityId,
    identityKey,
    configPending: config.isPending,
    configError: config.isError || (!!config.data && (!config.data.apiKey || !config.data.authDomain || !config.data.projectId || !config.data.appId)),
    retryConfig: config.refetch,
  };
}