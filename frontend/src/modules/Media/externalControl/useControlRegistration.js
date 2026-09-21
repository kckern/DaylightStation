import { useEffect, useRef, useState } from 'react';
import { wsService } from '../../../services/WebSocketService.js';

function randomNonce() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* fall through */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Owns one live-route claim for the provider lifetime. The WebSocket service
// itself is tab-global, so the hook must subscribe before it sends identify and
// must never infer controllability merely from socket connection or send().
export function useControlRegistration(controlClientId, {
  service = wsService,
  createNonce = randomNonce,
  // The event bus records the first missed 30-second sweep before counting its
  // three stale misses, so a dead-but-OPEN owner can survive almost 120s.
  // Keep this finite window beyond that lifetime so an overlapping reconnect
  // can reclaim its route without ever treating a rejected claim as ready.
  retryMs = 1000,
  maxRetries = 130,
} = {}) {
  const [ready, setReady] = useState(false);
  const attemptRef = useRef(null);
  const connectedRef = useRef(false);
  const createNonceRef = useRef(createNonce);
  const retryRef = useRef({ count: 0, timer: null });
  createNonceRef.current = createNonce;

  useEffect(() => {
    if (!controlClientId) return undefined;
    const unsubscribeMessage = service.subscribe(
      (message) => message?.type === 'identify_ack',
      (message) => {
        const attempt = attemptRef.current;
        if (message?.clientId !== controlClientId || !attempt || message.nonce !== attempt) return;
        if (message.ok !== true) {
          clearTimeout(retryRef.current.timer);
          if (retryRef.current.count++ < maxRetries) {
            retryRef.current.timer = setTimeout(() => {
              const nonce = createNonceRef.current();
              attemptRef.current = nonce;
              service.sendEphemeral({ type: 'identify', clientId: controlClientId, nonce });
            }, retryMs);
          }
          return;
        }
        setReady(true);
      }
    );
    const unsubscribeStatus = service.onStatusChange(({ connected }) => {
      if (!connected) {
        connectedRef.current = false;
        attemptRef.current = null;
        clearTimeout(retryRef.current.timer); retryRef.current = { count: 0, timer: null };
        setReady(false);
        return;
      }
      if (connectedRef.current) return;
      connectedRef.current = true;
      const nonce = createNonceRef.current();
      retryRef.current = { count: 0, timer: null };
      attemptRef.current = nonce;
      setReady(false);
      service.sendEphemeral({ type: 'identify', clientId: controlClientId, nonce });
    });
    return () => {
      attemptRef.current = null;
      clearTimeout(retryRef.current.timer);
      service.sendEphemeral?.({ type: 'identify_release', clientId: controlClientId });
      connectedRef.current = false;
      setReady(false);
      unsubscribeStatus?.();
      unsubscribeMessage?.();
    };
  }, [controlClientId, service, retryMs, maxRetries]);

  return { controlClientId, ready };
}

export default useControlRegistration;
