import { useCallback, useLayoutEffect, useRef } from 'react';

/** The marker must share the target's commit, inside its render condition.
 * It confirms a committed shell, never domain readiness/completion/credit.
 */
export function LocalMountCommit({ requestId, confirm, children }) {
  useLayoutEffect(() => { if (requestId) confirm(requestId); }, [requestId, confirm]);
  return children;
}

export function useLocalMountConfirmation() {
  const pending = useRef(null);
  const sequence = useRef(0);
  const alive = useRef(true);
  const finish = useCallback((id, mounted) => {
    const request = pending.current;
    if (!request || request.id !== id) return;
    pending.current = null;
    clearTimeout(request.timer);
    request.resolve(mounted);
  }, []);
  const cancel = useCallback(() => { if (pending.current) finish(pending.current.id, false); }, [finish]);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // React StrictMode replays setup immediately; a real unmount stays dead.
      queueMicrotask(() => { if (!alive.current) cancel(); });
    };
  }, [cancel]);
  const begin = useCallback(() => {
    cancel();
    const id = ++sequence.current;
    if (!alive.current) return { id, promise: Promise.resolve(false), isCurrent: () => false, refuse() {} };
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const timer = setTimeout(() => finish(id, false), 120_000);
    pending.current = { id, resolve, timer };
    return { id, promise, isCurrent: () => alive.current && pending.current?.id === id,
      refuse: () => finish(id, false) };
  }, [cancel, finish]);
  const confirm = useCallback(id => { if (alive.current) finish(id, true); }, [finish]);
  return { begin, confirm, cancel };
}
