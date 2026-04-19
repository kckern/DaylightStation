import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { wsService } from '../../../services/WebSocketService.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { RemoteSessionAdapter } from './RemoteSessionAdapter.js';
import mediaLog from '../logging/mediaLog.js';

export const PeekContext = createContext(null);

function isAckMsg(msg) {
  return !!msg && typeof msg.topic === 'string' && msg.topic.startsWith('device-ack:');
}

export function PeekProvider({ children }) {
  const { devices, byDevice } = useFleetContext();
  const [activePeeks, setActivePeeks] = useState(new Map());
  const adaptersRef = useRef(new Map());
  const byDeviceRef = useRef(byDevice);
  useEffect(() => { byDeviceRef.current = byDevice; }, [byDevice]);

  useEffect(() => {
    const unsub = wsService.subscribe(isAckMsg, (msg) => {
      const { deviceId, commandId, ok, error } = msg;
      if (!deviceId || !commandId) return;
      const adapter = adaptersRef.current.get(deviceId);
      if (adapter) adapter._resolveAck({ commandId, ok, error });
    });
    return unsub;
  }, []);

  const enterPeek = useCallback((deviceId) => {
    const cfg = devices.find((d) => d.id === deviceId);
    if (!cfg) return null;
    let adapter = adaptersRef.current.get(deviceId);
    if (!adapter) {
      adapter = new RemoteSessionAdapter({
        deviceId,
        httpClient: DaylightAPI,
        getSnapshot: () => byDeviceRef.current.get(deviceId)?.snapshot ?? null,
      });
      adaptersRef.current.set(deviceId, adapter);
    }
    setActivePeeks((prev) => {
      const next = new Map(prev);
      next.set(deviceId, { controller: adapter, enteredAt: new Date().toISOString() });
      return next;
    });
    mediaLog.peekEntered({ deviceId });
    return adapter;
  }, [devices]);

  const exitPeek = useCallback((deviceId) => {
    setActivePeeks((prev) => {
      if (!prev.has(deviceId)) return prev;
      const next = new Map(prev);
      next.delete(deviceId);
      return next;
    });
    mediaLog.peekExited({ deviceId });
  }, []);

  const getAdapter = useCallback((deviceId) => {
    return adaptersRef.current.get(deviceId) ?? null;
  }, []);

  const value = useMemo(
    () => ({ activePeeks, enterPeek, exitPeek, getAdapter }),
    [activePeeks, enterPeek, exitPeek, getAdapter]
  );

  return <PeekContext.Provider value={value}>{children}</PeekContext.Provider>;
}

export function usePeekContext() {
  const ctx = useContext(PeekContext);
  if (!ctx) throw new Error('usePeekContext must be used inside PeekProvider');
  return ctx;
}

export default PeekProvider;
