import { useContext, useEffect, useState } from 'react';
import { LocalSessionContext } from './LocalSessionContext.js';

export function useSessionController(target) {
  if (target !== 'local') {
    // RemoteSessionAdapter is P5. Fail fast for now.
    throw new Error('useSessionController: remote targets not implemented in P1');
  }
  const ctx = useContext(LocalSessionContext);
  if (!ctx) throw new Error('useSessionController must be inside LocalSessionProvider');
  const { adapter } = ctx;
  const [snapshot, setSnapshot] = useState(adapter.getSnapshot());

  useEffect(() => {
    setSnapshot(adapter.getSnapshot());
    return adapter.subscribe(setSnapshot);
  }, [adapter]);

  return {
    snapshot,
    transport: adapter.transport,
    queue: adapter.queue,
    config: adapter.config,
    lifecycle: adapter.lifecycle,
    portability: adapter.portability,
  };
}

export default useSessionController;
