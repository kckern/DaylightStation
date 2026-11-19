import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Manage one mounted read scope for an existing transport. Memoize the read
 * callback by the scope it reads, and check isCurrent() before publishing.
 * Reload replaces the current read. Poll starts only when the scope is idle.
 */
export function useRefreshableRead(read) {
  const committed = useRef(null);
  useLayoutEffect(() => {
    committed.current = { read, pending: null };
    return () => { committed.current = null; };
  }, [read]);

  const reload = useCallback(async () => {
    const scope = committed.current;
    if (!scope || scope.read !== read) return;
    const ticket = {};
    scope.pending = ticket;
    const isCurrent = () => committed.current === scope && scope.pending === ticket;
    try {
      await read(isCurrent);
    } finally {
      if (isCurrent()) scope.pending = null;
    }
  }, [read]);

  const poll = useCallback(() => {
    if (!committed.current?.pending) return reload();
  }, [reload]);

  return { reload, poll };
}
