import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Manage one mounted read scope for an existing transport. Memoize the read
 * callback by the scope it reads and pass its signal to the transport.
 * Check isCurrent() before publishing. Reload replaces the current read.
 * Poll starts only when the scope is idle. An optional timeout retires a
 * stalled request and releases the polling slot.
 */
export function useRefreshableRead(read, { timeoutMs } = {}) {
  const committed = useRef(null);
  useLayoutEffect(() => {
    const scope = { read, timeoutMs, pending: null };
    committed.current = scope;
    return () => {
      committed.current = null;
      scope.pending?.cancel();
    };
  }, [read, timeoutMs]);

  const reload = useCallback(async () => {
    const scope = committed.current;
    if (!scope || scope.read !== read || scope.timeoutMs !== timeoutMs) return;
    const previous = scope.pending;
    const controller = new AbortController();
    let deadline;
    const pending = {
      cancel() {
        clearTimeout(deadline);
        controller.abort();
      },
    };
    scope.pending = pending;
    previous?.cancel();
    const isCurrent = () => committed.current === scope && scope.pending === pending;
    if (timeoutMs > 0) {
      deadline = setTimeout(() => {
        if (!isCurrent()) return;
        scope.pending = null;
        pending.cancel();
      }, timeoutMs);
    }
    try {
      await read(isCurrent, controller.signal);
    } finally {
      clearTimeout(deadline);
      if (isCurrent()) scope.pending = null;
    }
  }, [read, timeoutMs]);

  const poll = useCallback(() => {
    if (!committed.current?.pending) return reload();
  }, [reload]);

  return { reload, poll };
}
