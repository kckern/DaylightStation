import { useContext, useEffect, useState } from 'react';
import { LocalSessionContext } from './LocalSessionContext.js';
import { PeekContext } from '../peek/PeekProvider.jsx';

function useLocalController() {
  const ctx = useContext(LocalSessionContext);
  if (!ctx) throw new Error('useSessionController(local) must be inside LocalSessionProvider');
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

function useRemoteController(deviceId) {
  const peekCtx = useContext(PeekContext);
  if (!peekCtx) throw new Error('useSessionController({deviceId}) requires PeekProvider');
  const adapter = peekCtx.getAdapter(deviceId);
  if (!adapter) {
    return {
      snapshot: null,
      transport: {}, queue: {}, config: {}, lifecycle: {}, portability: {},
    };
  }
  return {
    snapshot: adapter.getSnapshot(),
    transport: adapter.transport,
    queue: adapter.queue,
    config: adapter.config,
    lifecycle: adapter.lifecycle,
    portability: adapter.portability,
  };
}

export function useSessionController(target) {
  if (target === 'local') return useLocalController();
  if (target && typeof target === 'object' && typeof target.deviceId === 'string') {
    return useRemoteController(target.deviceId);
  }
  throw new Error('useSessionController: target must be "local" or {deviceId}');
}

export default useSessionController;
