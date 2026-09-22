// frontend/src/modules/Media/fleet/FleetProvider.jsx
// Wires the fleet store to the world: device roster from the Device API
// (refreshed when the tab regains focus), live state from device-state:*
// broadcasts, staleness from WS connection status.
import React, { createContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeTopic, subscribeTopicKind, onStatus, topics } from '../net/ws.js';
import { useDevices } from './useDevices.js';
import { createFleetStore } from './fleetStore.js';
import mediaLog from '../logging/mediaLog.js';
import { useClientIdentity } from '../identity/useClientIdentity.js';
import { TIMING } from '../constants.js';
import { browserDisplayState, sortFleetDevices } from './browserLiveness.js';

export const FleetContext = createContext(null);

const browserDeviceId = (clientId) => `browser:${clientId}`;

function playbackSnapshot(message) {
  return {
    sessionId: message.sessionId,
    state: message.state,
    currentItem: message.currentItem ?? null,
    queue: message.queue ?? [],
    position: message.position ?? 0,
    config: message.config ?? null,
    displayName: message.displayName,
    meta: {
      ownerId: message.ownerId,
      revision: message.revision,
      origin: message.origin ?? null,
      updatedAt: message.lastHeardAt ?? message.ts,
    },
  };
}

export function FleetProvider({ children }) {
  const { devices, loading, error, refresh } = useDevices();
  const [connected, setConnected] = useState(true);
  const { clientId, displayName } = useClientIdentity();
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createFleetStore();
  const store = storeRef.current;
  const browserEntries = useSyncExternalStore(store.subscribeAll, store.getAll, store.getAll);

  useEffect(() => subscribeTopic(topics.playbackState, (message) => {
    if (!message?.identity?.clientId || !message?.deviceId || !message?.state) return;
    store.receive({
      deviceId: message.deviceId,
      snapshot: playbackSnapshot(message),
      reason: 'change',
      ts: message.ts,
      identity: message.identity,
      connected: message.connected,
      lastHeardAt: message.lastHeardAt,
      staleAfterMs: TIMING.BROWSER_UNCERTAIN_AFTER_MS,
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
        setConnected(false);
        store.markAllStale({ exclude: id => id.startsWith('browser:') });
        mediaLog.wsDisconnected({});
      } else if (status && status.connected === true) {
        setConnected(true);
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
        name: entry.identity?.name ?? entry.snapshot?.displayName ?? (id === browserDeviceId(clientId) ? displayName : id.slice('browser:'.length)),
        room: entry.identity?.room,
        type: 'browser',
        isLocal: id === browserDeviceId(clientId),
        state: browserDisplayState({
          connected: entry.connected,
          lastHeardMs: Math.max(0, Date.now() - new Date(entry.lastSeenAt).getTime()),
          state: entry.snapshot?.state,
        }),
        isStale: entry.isStale,
        connected: entry.connected,
        lastHeardAt: entry.lastSeenAt,
      }));
    return sortFleetDevices([...devices, ...browsers.filter(browser => !devices.some(device => device.id === browser.id))]);
  }, [devices, browserEntries, clientId, displayName]);

  const value = useMemo(
    () => ({ devices: fleetDevices, store, loading, error, refresh, connected, identity: { clientId, deviceId: browserDeviceId(clientId) } }),
    [fleetDevices, store, loading, error, refresh, connected, clientId]
  );

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export default FleetProvider;
