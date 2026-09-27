import { useEffect, useRef, useState } from 'react';
import {
  getGetSiteStatsQueryKey,
  useGetSiteStats,
  useRecordVisit,
} from '@workspace/api-client-react';
import type { VisitInput } from '@workspace/api-client-react';

type VisitStatus = 'idle' | 'loading' | 'ready' | 'error';
let visitStatus: VisitStatus = 'idle';
const visitListeners = new Set<(status: VisitStatus) => void>();
let visitPromise: Promise<void> | null = null;

function updateVisitStatus(status: VisitStatus) {
  visitStatus = status;
  visitListeners.forEach(listener => listener(status));
}

function visitInput(): VisitInput {
  const params = new URLSearchParams(window.location.search);
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'ref'] as const;
  const data: VisitInput = {};
  for (const key of keys) {
    const value = params.get(key)?.trim().slice(0, 200);
    if (value) data[key] = value;
  }
  return data;
}

function beginVisit(record: (data: { data: VisitInput }) => Promise<unknown>) {
  if (visitStatus === 'ready' || visitPromise) return;
  updateVisitStatus('loading');
  visitPromise = record({ data: visitInput() }).then(() => {
    updateVisitStatus('ready');
  }).catch(() => {
    updateVisitStatus('error');
  }).finally(() => {
    visitPromise = null;
  });
}

export function usePublicSite() {
  const stats = useGetSiteStats({
    query: { queryKey: getGetSiteStatsQueryKey(), retry: 1, staleTime: 60_000 },
  });
  return { stats };
}

export function useVisitAttribution() {
  const { mutateAsync } = useRecordVisit({ mutation: { retry: false } });
  const mutateRef = useRef(mutateAsync);
  mutateRef.current = mutateAsync;
  const [status, setStatus] = useState<VisitStatus>(visitStatus);

  useEffect(() => {
    visitListeners.add(setStatus);
    setStatus(visitStatus);
    beginVisit(data => mutateRef.current(data));
    return () => { visitListeners.delete(setStatus); };
  }, []);

  return {
    status,
    retry: () => beginVisit(data => mutateRef.current(data)),
  };
}