// frontend/src/modules/Media/fleet/FleetProvider.jsx
// Wires the fleet store to the world: device roster from the Device API
// (refreshed when the tab regains focus), live state from device-state:*
// broadcasts, staleness from WS connection status.
import React, { createContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeTopic, subscribeTopicKind, onStatus, topics } from '../net/ws.js';
import { useDevices } from './useDevices.js';
import { createFleetStore } from './fleetStore.js';
import mediaLog from '../logging/mediaLog.js';
import { useClientIdentity } from '../identity/useClientIdentity.js';
import { TIMING } from '../constants.js';
import { UNNAMED_BROWSER } from './deviceDisplay.js';
import { browserDisplayState, mergeCanonicalFleetState, silenceMs, sortFleetDevices } from './browserLiveness.js';
import { useScreenRegistry, mergeRegistryNames, registryLagsLiveNames } from '../house/useScreenRegistry.js';

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
  const { clientId, displayName, markPlaying } = useClientIdentity();
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createFleetStore();
  const store = storeRef.current;
  const browserEntries = useSyncExternalStore(store.subscribeAll, store.getAll, store.getAll);
  // RQ-HOUSE-06: every row is named by the household screen registry.
  const registry = useScreenRegistry();
  const refreshRegistry = registry.refresh;
  const lastNameRef = useRef(displayName);
  useEffect(() => {
    // This browser was renamed here: re-read so every row (and the rename's
    // "(was …)") shows the registry's answer, not only this device's guess.
    if (lastNameRef.current === displayName) return;
    lastNameRef.current = displayName;
    refreshRegistry();
  }, [displayName, refreshRegistry]);
  // A browser that actually plays becomes a registered screen even if nobody named it.
  const localState = browserEntries.get(browserDeviceId(clientId))?.snapshot?.state;
  useEffect(() => {
    if (localState === 'playing' || localState === 'paused') markPlaying?.();
  }, [localState, markPlaying]);
  // RQ-STEER-13: the screens a Pause all paused, so Resume all brings back
  // exactly those. Shared by the house view and the handle.
  const [resumable, setResumable] = useState(null);
  const quiet = useMemo(() => ({ resumable, setResumable }), [resumable]);

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
      // `staleAfterMs` is left at the store's default (DEVICE_STALE_AFTER_MS,
      // 15s, §7.4's spec'd missed-heartbeat threshold). `isStale` here feeds
      // several OTHER consumers (RemoteSessionController, PeekPanel,
      // CastTargetProvider, AimLabel, useRemoteStopFeedback, FleetView's
      // "Out of date") that all expect the 15s meaning — widening it to the
      // fleet's own two-minute uncertainty window (previously done here)
      // silently widened staleness for all of them too. The two-minute
      // uncertainty re-render below is driven independently, without
      // touching this store timer or its `isStale` flag at all.
      store.receive({
        deviceId: msg.deviceId,
        snapshot: msg.snapshot ?? null,
        reason: msg.reason ?? 'change',
        ts: msg.ts,
        // Present only on a server replay of a cached snapshot (server-clock
        // age); keeps a long-silent screen from looking freshly heard.
        ageMs: msg.ageMs,
      });
    });
  }, [store]);

  // Nothing else re-renders this provider purely from the passage of time —
  // `browserEntries` only changes when a new message arrives or the WS
  // drops. A device that goes silent (no further device-state broadcasts,
  // with or without the WS itself staying up) would otherwise freeze on
  // whichever state was last rendered, forever. Schedule a re-render for the
  // EARLIEST upcoming two-minute-uncertainty boundary across all live
  // entries (browser and physical alike; markAllStale on a WS drop doesn't
  // touch `receivedAt`, so this boundary is unaffected by whether the store
  // itself is currently marking things stale for the unrelated 15s purpose
  // above), and reschedule for the next one each time it fires.
  const [uncertaintyTick, forceUncertaintyTick] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    let timer = null;
    const scheduleNext = () => {
      const now = Date.now();
      let earliestBoundary = Infinity;
      for (const [, entry] of browserEntries) {
        const heard = entry?.receivedAt ?? entry?.lastSeenAt;
        if (!entry || entry.offline === true || heard == null) continue;
        // Receipt time, not the sender's (possibly skewed) timestamp.
        const boundary = new Date(heard).getTime() + TIMING.BROWSER_UNCERTAIN_AFTER_MS;
        if (boundary > now && boundary < earliestBoundary) earliestBoundary = boundary;
      }
      if (earliestBoundary === Infinity) return;
      // A hair past the exact boundary — `setTimeout` never fires early, but
      // scheduling exactly on it (rather than past it) risks a re-render
      // whose own `Date.now()` reads a tick before the boundary on some
      // platforms. mergeCanonicalFleetState's own comparison is `>=`, so
      // this is a belt-and-suspenders margin, not the correctness boundary.
      timer = setTimeout(() => {
        forceUncertaintyTick();
        scheduleNext();
      }, Math.max(0, earliestBoundary - now) + 1);
    };
    scheduleNext();
    return () => { if (timer) clearTimeout(timer); };
  }, [browserEntries]);

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
    const configured = mergeCanonicalFleetState(devices, browserEntries);
    const browsers = [...browserEntries.entries()]
      .filter(([id]) => id.startsWith('browser:'))
      .map(([id, entry]) => ({
        id,
        name: entry.identity?.name ?? entry.snapshot?.displayName ?? (id === browserDeviceId(clientId) ? displayName : UNNAMED_BROWSER),
        liveName: entry.identity?.name ?? null,
        room: entry.identity?.room,
        type: 'browser',
        isLocal: id === browserDeviceId(clientId),
        state: browserDisplayState({
          connected: entry.connected,
          lastHeardMs: silenceMs(entry),
          state: entry.snapshot?.state,
        }),
        isStale: entry.isStale,
        connected: entry.connected,
        lastHeardAt: entry.lastSeenAt,
      }));
    return sortFleetDevices(mergeRegistryNames(
      [...configured, ...browsers.filter(browser => !configured.some(device => device.id === browser.id))],
      registry.byId,
    ));
  }, [devices, browserEntries, clientId, displayName, uncertaintyTick, registry.byId]);

  // Another device was renamed since the list was read: re-read it (at most
  // every 10 s) so its room and "(was …)" catch up too.
  const lastLagRefresh = useRef(0);
  useEffect(() => {
    if (!registryLagsLiveNames(fleetDevices, registry.byId)) return;
    if (Date.now() - lastLagRefresh.current < 10_000) return;
    lastLagRefresh.current = Date.now();
    refreshRegistry();
  }, [fleetDevices, registry.byId, refreshRegistry]);

  const value = useMemo(
    () => ({ devices: fleetDevices, store, loading, error, refresh, connected, identity: { clientId, deviceId: browserDeviceId(clientId) }, registry, quiet }),
    [fleetDevices, store, loading, error, refresh, connected, clientId, registry, quiet]
  );

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export default FleetProvider;
