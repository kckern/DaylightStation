// frontend/src/modules/Media/fleet/fleetStore.js
// Live per-device session state. Plain store with PER-DEVICE subscription
// granularity: a 5s heartbeat from one device re-renders that device's card,
// not the whole fleet (N2.1). Devices go stale individually when their
// heartbeats stop (§7.4 client side); a WS drop marks everything stale at
// once (C4.4). Offline broadcasts keep the last snapshot visible (C9.6).
import { TIMING } from '../constants.js';
import mediaLog from '../logging/mediaLog.js';

export function createFleetStore({ timing = TIMING, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  let byDevice = new Map();
  const allSubs = new Set();
  const deviceSubs = new Map(); // deviceId -> Set<fn>
  const staleTimers = new Map(); // deviceId -> timer

  function notify(deviceId) {
    const entry = byDevice.get(deviceId) ?? null;
    for (const fn of deviceSubs.get(deviceId) ?? []) fn(entry);
    for (const fn of allSubs) fn(byDevice);
  }

  function setEntry(deviceId, entry) {
    byDevice = new Map(byDevice);
    byDevice.set(deviceId, entry);
    notify(deviceId);
  }

  function armStaleTimer(deviceId, staleAfterMs = timing.DEVICE_STALE_AFTER_MS, lastSeenAt = null) {
    const existing = staleTimers.get(deviceId);
    if (existing) clearTimeoutFn(existing);
    const elapsed = lastSeenAt ? Math.max(0, Date.now() - new Date(lastSeenAt).getTime()) : 0;
    const delay = Math.max(0, staleAfterMs - elapsed);
    staleTimers.set(deviceId, setTimeoutFn(() => {
      staleTimers.delete(deviceId);
      const entry = byDevice.get(deviceId);
      if (!entry || entry.isStale || entry.offline) return;
      mediaLog.wsStale({ topic: `device-state:${deviceId}`, deviceId });
      setEntry(deviceId, { ...entry, isStale: true });
    }, delay));
  }

  return {
    getAll: () => byDevice,
    getEntry: (deviceId) => byDevice.get(deviceId) ?? null,

    subscribeAll(fn) {
      allSubs.add(fn);
      return () => allSubs.delete(fn);
    },

    subscribeDevice(deviceId, fn) {
      if (!deviceSubs.has(deviceId)) deviceSubs.set(deviceId, new Set());
      deviceSubs.get(deviceId).add(fn);
      return () => deviceSubs.get(deviceId)?.delete(fn);
    },

    /** Ingest a DeviceStateBroadcast (§9.7). */
    receive({ deviceId, snapshot, reason, ts, identity, connected, lastHeardAt, staleAfterMs }) {
      if (typeof deviceId !== 'string' || deviceId.length === 0) return;
      const prev = byDevice.get(deviceId) ?? {};
      const offline = reason === 'offline';
      const heardAt = lastHeardAt ?? ts ?? new Date().toISOString();
      setEntry(deviceId, {
        snapshot: snapshot ?? prev.snapshot ?? null,
        identity: identity ?? prev.identity ?? null,
        connected: connected ?? prev.connected ?? !offline,
        reason: reason ?? 'change',
        lastSeenAt: heardAt,
        isStale: false,
        offline,
      });
      if (offline) {
        const t = staleTimers.get(deviceId);
        if (t) { clearTimeoutFn(t); staleTimers.delete(deviceId); }
      } else {
        armStaleTimer(deviceId, staleAfterMs, heardAt);
      }
    },

    /** WS drop: every device's view is now stale until updates resume. */
    markAllStale({ exclude } = {}) {
      byDevice = new Map(
        [...byDevice.entries()].map(([id, e]) => [id, exclude?.(id, e) ? e : { ...e, isStale: true }])
      );
      for (const [deviceId] of byDevice) notify(deviceId);
      if (byDevice.size === 0) for (const fn of allSubs) fn(byDevice);
    },

    reset() {
      for (const t of staleTimers.values()) clearTimeoutFn(t);
      staleTimers.clear();
      byDevice = new Map();
      for (const fn of allSubs) fn(byDevice);
    },
  };
}

export default createFleetStore;
