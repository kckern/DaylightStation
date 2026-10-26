import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import { createHealthOperations } from './healthOperations.js';

const Context = createContext(null);
const EMPTY = { operations: new Map(), revision: 0 };
const subscribeEmpty = () => () => {};
const getEmpty = () => EMPTY;

export function HealthOperationsProvider({ userId, children, send = DaylightAPI }) {
  // The keyed owner also disposes requests when the confirmed user changes.
  return <Session key={userId} userId={userId} send={send}>{children}</Session>;
}
function Session({ userId, children, send }) {
  const store = useMemo(() => createHealthOperations({ userId }), [userId]);
  const running = useRef(new Map());
  const lease = useRef(null);
  useEffect(() => {
    const token = { active: true }; lease.current = token;
    return () => {
      token.active = false;
      // StrictMode can replay an effect; disposal belongs to the departed session.
      queueMicrotask(() => { if (lease.current === token) store.dispose(); });
    };
  }, [store]);
  const value = useMemo(() => {
    const execute = (id, onResult) => {
      if (running.current.has(id)) return running.current.get(id);
      const op = store.getSnapshot().operations.get(id);
      if (!op || store.disposed) return Promise.resolve();
      const owner = lease.current;
      store.transition(id, { phase: 'pending', error: null });
      const request = send(op.request.path, structuredClone(op.request.body), op.request.method);
      const promise = Promise.resolve(request).then(async response => {
        if (!owner?.active || store.disposed) return;
        await onResult?.(response, op);
        if (owner.active) store.transition(id, { phase: 'succeeded', response });
        return response;
      }).catch(error => {
        if (owner?.active && !store.disposed) store.transition(id, { phase: error.status === 409 ? 'conflict' : 'error', error: error.message });
        throw error;
      }).finally(() => running.current.delete(id));
      running.current.set(id, promise);
      return promise;
    };
    return { store, execute, retry: execute, isActive: () => Boolean(lease.current?.active) && !store.disposed };
  }, [store, send]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useHealthOperations() {
  const context = useContext(Context);
  const snapshot = useSyncExternalStore(context?.store.subscribe || subscribeEmpty, context?.store.getSnapshot || getEmpty);
  return context ? { ...context, snapshot } : null;
}
