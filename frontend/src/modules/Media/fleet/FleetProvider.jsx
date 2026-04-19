import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { wsService } from '../../../services/WebSocketService.js';
import { useDevices } from './useDevices.js';
import { reduceFleet, initialFleetState } from './fleetReducer.js';
import mediaLog from '../logging/mediaLog.js';

const FleetContext = createContext(null);

function isDeviceStateBroadcast(msg) {
  return !!msg && typeof msg.topic === 'string' && msg.topic.startsWith('device-state:');
}

export function FleetProvider({ children }) {
  const { devices, loading, error, refresh } = useDevices();
  const [fleetState, dispatch] = useReducer(reduceFleet, initialFleetState);

  useEffect(() => {
    const unsub = wsService.subscribe(isDeviceStateBroadcast, (msg) => {
      const deviceId = msg.deviceId;
      if (typeof deviceId !== 'string' || deviceId.length === 0) return;
      if (!msg.snapshot && msg.reason !== 'offline') return;
      dispatch({
        type: 'RECEIVED',
        deviceId,
        snapshot: msg.snapshot ?? null,
        reason: msg.reason ?? 'change',
        ts: msg.ts ?? new Date().toISOString(),
      });
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = wsService.onStatusChange((status) => {
      if (status && status.connected === false) {
        dispatch({ type: 'STALE' });
        mediaLog.wsDisconnected({});
      } else if (status && status.connected === true) {
        mediaLog.wsConnected({});
      }
    });
    return unsub;
  }, []);

  const value = useMemo(
    () => ({ devices, byDevice: fleetState.byDevice, loading, error, refresh }),
    [devices, fleetState.byDevice, loading, error, refresh]
  );

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export function useFleetContext() {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error('useFleetContext must be used inside FleetProvider');
  return ctx;
}

export default FleetProvider;
