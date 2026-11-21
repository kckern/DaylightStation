import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { useRefreshableRead } from '@/lib/hooks/useRefreshableRead.js';
import { fetchSession } from './api/sessionClient.js';

/** Own one gameplay session projection across initial reads, socket updates and host reconciliation. */
export function useGamingSession(sessionId, reconciledSession = null) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const revision = useRef(-1);
  const cancelPendingRef = useRef(() => {});

  const acceptSession = useCallback((next) => {
    if (!next || next.header?.session_id !== sessionId) return false;
    const nextRevision = next.header?.revision ?? 0;
    if (nextRevision < revision.current) return false;
    cancelPendingRef.current();
    revision.current = nextRevision;
    setSession(current => ({
      ...current,
      ...next,
      definition: next.definition ?? current?.definition,
    }));
    setError(null);
    return true;
  }, [sessionId]);

  const read = useCallback(async (isCurrent, signal) => {
    try {
      const value = await fetchSession(sessionId, { signal });
      if (isCurrent()) acceptSession(value);
      return value;
    } catch (cause) {
      if (isCurrent() && cause?.name !== 'AbortError') setError(cause);
      throw cause;
    }
  }, [acceptSession, sessionId]);
  const { reload, cancel } = useRefreshableRead(read);
  cancelPendingRef.current = cancel;
  const refresh = useCallback(() => reload().catch(() => {}), [reload]);

  useEffect(() => {
    revision.current = -1;
    setSession(null);
    setError(null);
    refresh();
    return cancel;
  }, [cancel, refresh]);

  useEffect(() => {
    if (reconciledSession?.header?.session_id !== sessionId) return;
    cancel();
    acceptSession(reconciledSession);
  }, [acceptSession, cancel, reconciledSession, sessionId]);

  useWebSocketSubscription('gaming', (message) => {
    if (message?.kind === 'session-updated' && message.sessionId === sessionId) refresh();
  }, [refresh, sessionId]);

  return { session, error, refresh, acceptSession };
}
