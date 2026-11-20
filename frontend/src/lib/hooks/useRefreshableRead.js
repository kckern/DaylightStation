import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Manage one mounted read scope for an existing transport. Memoize the read
 * callback by the scope it reads and pass its signal to the transport.
 * Check isCurrent() before publishing. Reload replaces the current read.
 * Cancel retires the current read and leaves the scope available for another.
 * Poll starts only when the scope is idle. An optional timeout retires a
 * stalled request, releases the polling slot, and calls the optional onTimeout.
 * Arguments supplied to reload or poll reach only that read and its timeout.
 * Memoize onTimeout with the same lifetime as the read.
 */
export function useRefreshableRead(read, { timeoutMs, onTimeout } = {}) {
  const committed = useRef(null);
  useLayoutEffect(() => {
    const scope = { read, timeoutMs, onTimeout, pending: null };
    committed.current = scope;
    return () => {
      committed.current = null;
      scope.pending?.cancel();
    };
  }, [read, timeoutMs, onTimeout]);

  const reload = useCallback(async (...args) => {
    const scope = committed.current;
    if (!scope || scope.read !== read || scope.timeoutMs !== timeoutMs || scope.onTimeout !== onTimeout) return;
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
        scope.onTimeout?.(...args);
      }, timeoutMs);
    }
    try {
      await read(isCurrent, controller.signal, ...args);
    } finally {
      clearTimeout(deadline);
      if (isCurrent()) scope.pending = null;
    }
  }, [read, timeoutMs, onTimeout]);

  const poll = useCallback((...args) => {
    if (!committed.current?.pending) return reload(...args);
  }, [reload]);

  const cancel = useCallback(() => {
    const scope = committed.current;
    if (!scope) return;
    const pending = scope.pending;
    scope.pending = null;
    pending?.cancel();
  }, []);

  return { reload, poll, cancel };
}
