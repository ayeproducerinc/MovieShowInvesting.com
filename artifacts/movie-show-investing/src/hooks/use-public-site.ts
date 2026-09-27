import { useEffect, useRef } from 'react';
import {
  getGetSiteStatsQueryKey,
  useGetSiteStats,
  useRecordVisit,
} from '@workspace/api-client-react';
import type { VisitInput } from '@workspace/api-client-react';

let visitAttempted = false;

export function usePublicSite() {
  const stats = useGetSiteStats({
    query: { queryKey: getGetSiteStatsQueryKey(), retry: 1, staleTime: 60_000 },
  });
  return { stats };
}

export function useVisitAttribution() {
  const { mutate } = useRecordVisit({ mutation: { retry: false } });
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  useEffect(() => {
    if (visitAttempted) return;
    visitAttempted = true;
    const params = new URLSearchParams(window.location.search);
    const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'ref'] as const;
    const data: VisitInput = {};
    for (const key of keys) {
      const value = params.get(key)?.trim().slice(0, 200);
      if (value) data[key] = value;
    }
    mutateRef.current({ data });
  }, []);
}