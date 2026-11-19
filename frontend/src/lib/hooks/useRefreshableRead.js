import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Manage one mounted read scope for an existing transport. Memoize the read
 * callback by the scope it reads and pass its signal to the transport.
 * Check isCurrent() before publishing. Reload replaces the current read.
 * Poll starts only when the scope is idle.
 */
export function useRefreshableRead(read) {
  const committed = useRef(null);
  useLayoutEffect(() => {
    const scope = { read, pending: null };
    committed.current = scope;
    return () => {
      committed.current = null;
      scope.pending?.abort();
    };
  }, [read]);

  const reload = useCallback(async () => {
    const scope = committed.current;
    if (!scope || scope.read !== read) return;
    const previous = scope.pending;
    const controller = new AbortController();
    scope.pending = controller;
    previous?.abort();
    const isCurrent = () => committed.current === scope && scope.pending === controller;
    try {
      await read(isCurrent, controller.signal);
    } finally {
      if (isCurrent()) scope.pending = null;
    }
  }, [read]);

  const poll = useCallback(() => {
    if (!committed.current?.pending) return reload();
  }, [reload]);

  return { reload, poll };
}
