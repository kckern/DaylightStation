// frontend/src/modules/Media/fleet/FleetProvider.jsx
// Wires the fleet store to the world: device roster from the Device API
// (refreshed when the tab regains focus), live state from device-state:*
// broadcasts, staleness from WS connection status.
import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { subscribeTopicKind, onStatus } from '../net/ws.js';
import { useDevices } from './useDevices.js';
import { createFleetStore } from './fleetStore.js';
import mediaLog from '../logging/mediaLog.js';

export const FleetContext = createContext(null);

export function FleetProvider({ children }) {
  const { devices, loading, error, refresh } = useDevices();
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createFleetStore();
  const store = storeRef.current;

  useEffect(() => {
    return subscribeTopicKind('device-state', (msg) => {
      if (!msg.snapshot && msg.reason !== 'offline') return;
      store.receive({
        deviceId: msg.deviceId,
        snapshot: msg.snapshot ?? null,
        reason: msg.reason ?? 'change',
        ts: msg.ts,
      });
    });
  }, [store]);

  useEffect(() => {
    return onStatus((status) => {
      if (status && status.connected === false) {
        store.markAllStale();
        mediaLog.wsDisconnected({});
      } else if (status && status.connected === true) {
        mediaLog.wsConnected({});
      }
    });
  }, [store]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refresh]);

  const value = useMemo(
    () => ({ devices, store, loading, error, refresh }),
    [devices, store, loading, error, refresh]
  );

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export function useFleetContext() {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error('useFleetContext must be used inside FleetProvider');
  return ctx;
}

export default FleetProvider;
