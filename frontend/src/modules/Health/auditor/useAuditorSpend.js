import { useEffect, useRef } from 'react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { cleanupPath } from '../cleanup/CleanupQuestions.jsx';

export const spendPath = `${cleanupPath}/spend?days=30`;

/**
 * The auditor spend summary, refetched when the cleanup status poll shows a
 * new latest run or that run finishing. `status` is the useCleanup resource.
 */
export function useAuditorSpend(status) {
  const spend = useApiResource(spendPath, { swr: true });
  const latest = status.data?.runs?.[0];
  const key = latest ? `${latest.id}:${latest.completedAt || ''}` : null;
  const loaded = !!status.data;
  // undefined until the first status arrives; spend was fetched on mount alongside it.
  const seen = useRef(undefined);
  const { reload } = spend;
  useEffect(() => {
    if (!loaded) return;
    if (seen.current === undefined) { seen.current = key; return; }
    if (key === seen.current) return;
    seen.current = key;
    reload();
  }, [loaded, key, reload]);
  return spend;
}
