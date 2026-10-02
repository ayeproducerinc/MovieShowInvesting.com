import type { QueryClient } from '@tanstack/react-query';
import {
  getFlowProgress, getGetSiteStatsQueryKey, joinFilmmakerCommunity,
} from '@workspace/api-client-react';

/** Successful homepage sign-in only; never run on a generic auth-state change. */
export function clearPrivateAuthQueries(queryClient: QueryClient) {
  const statsKey = getGetSiteStatsQueryKey();
  const privateQuery = (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== statsKey[0];
  // clear() also removes the mounted public query. Its existing observer then
  // stays attached to an orphan while setQueryData writes a different query.
  void queryClient.cancelQueries({ predicate: privateQuery });
  queryClient.removeQueries({ predicate: privateQuery });
  queryClient.getMutationCache().clear();
}

export async function registerHomepageCommunity(token: string) {
  const request = { headers: { Authorization: `Bearer ${token}` } };
  let draftId: number | undefined;
  try {
    const progress = await getFlowProgress('filmmaker', request);
    draftId = progress.draft_id;
  } catch (error) {
    if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 404) throw error;
  }
  return joinFilmmakerCommunity({ source: 'homepage', ...(draftId ? { draft_id: draftId } : {}) }, request);
}

export async function refreshCommunityCount(queryClient: QueryClient, filmmakers: number) {
  const queryKey = getGetSiteStatsQueryKey();
  // A pre-registration stats request must not overwrite the new authoritative total.
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData(queryKey, { filmmakers });
  await queryClient.invalidateQueries({ queryKey });
}

export function communityRegistrationError(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error && error.data
    && typeof error.data === 'object' && 'error' in error.data && typeof error.data.error === 'string') {
    return error.data.error;
  }
  return 'The community count could not be updated. Try again.';
}