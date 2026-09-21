// frontend/src/modules/Media/fleet/FleetProvider.jsx
// Wires the fleet store to the world: device roster from the Device API
// (refreshed when the tab regains focus), live state from device-state:*
// broadcasts, staleness from WS connection status.
import React, { createContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { subscribeTopic, subscribeTopicKind, onStatus, topics } from '../net/ws.js';
import { useDevices } from './useDevices.js';
import { createFleetStore } from './fleetStore.js';
import mediaLog from '../logging/mediaLog.js';
import { useClientIdentity } from '../identity/useClientIdentity.js';
import { useSessionController } from '../controller/useSessionController.js';

export const FleetContext = createContext(null);

const browserDeviceId = (clientId) => `browser:${clientId}`;

function playbackSnapshot(message) {
  return {
    sessionId: message.sessionId,
    state: message.state,
    currentItem: message.currentItem ?? null,
    position: message.position ?? 0,
    config: message.config ?? null,
    displayName: message.displayName,
  };
}

export function FleetProvider({ children }) {
  const { devices, loading, error, refresh } = useDevices();
  const { clientId, displayName } = useClientIdentity();
  const { snapshot: localSnapshot } = useSessionController('local');
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createFleetStore();
  const store = storeRef.current;
  const browserEntries = useSyncExternalStore(store.subscribeAll, store.getAll, store.getAll);

  useEffect(() => {
    if (!localSnapshot) return;
    store.receive({ deviceId: browserDeviceId(clientId), snapshot: localSnapshot, reason: 'change' });
  }, [store, clientId, localSnapshot]);

  useEffect(() => subscribeTopic(topics.playbackState, (message) => {
    if (!message?.clientId || !message?.displayName || !message?.state) return;
    store.receive({
      deviceId: browserDeviceId(message.clientId),
      snapshot: playbackSnapshot(message),
      reason: 'change',
      ts: message.ts,
    });
  }), [store]);

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

  const fleetDevices = useMemo(() => {
    const browsers = [...browserEntries.entries()]
      .filter(([id]) => id.startsWith('browser:'))
      .map(([id, entry]) => ({
        id,
        name: entry.snapshot?.displayName ?? (id === browserDeviceId(clientId) ? displayName : id.slice('browser:'.length)),
        type: 'browser',
        isLocal: id === browserDeviceId(clientId),
      }));
    return [...devices, ...browsers.filter(browser => !devices.some(device => device.id === browser.id))];
  }, [devices, browserEntries, clientId, displayName]);

  const value = useMemo(
    () => ({ devices: fleetDevices, store, loading, error, refresh }),
    [fleetDevices, store, loading, error, refresh]
  );

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export default FleetProvider;
