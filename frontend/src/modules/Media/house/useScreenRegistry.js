// frontend/src/modules/Media/house/useScreenRegistry.js
// The household screen registry (tech doc §2.5) as live client state: one
// list of every screen under its unique human name. Read on mount, when the
// tab is shown again, on a slow poll (another device may rename a screen),
// and after every change made here. An unwired registry (501) is
// "unavailable" — names then come from devices.yml and the browsers' own
// broadcasts, as before.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { houseApi as defaultApi, screenIdFor } from './houseApi.js';
import houseLog from './houseLog.js';

const EMPTY = { screens: [], notSeenLately: [], retired: [], unnamed: [], roomAdjacency: {} };
export const REGISTRY_POLL_MS = 120_000;

export function useScreenRegistry({ api = defaultApi, pollMs = REGISTRY_POLL_MS } = {}) {
  const [state, setState] = useState({ ...EMPTY, loaded: false, available: true, error: null });
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api.listScreens();
      if (!mounted.current) return;
      const next = {
        screens: Array.isArray(res?.screens) ? res.screens : [],
        notSeenLately: Array.isArray(res?.notSeenLately) ? res.notSeenLately : [],
        retired: Array.isArray(res?.retired) ? res.retired : [],
        unnamed: Array.isArray(res?.unnamed) ? res.unnamed : [],
        roomAdjacency: res?.roomAdjacency && typeof res.roomAdjacency === 'object' ? res.roomAdjacency : {},
      };
      houseLog.registryLoaded({ screens: next.screens.length, notSeenLately: next.notSeenLately.length, retired: next.retired.length });
      setState({ ...next, loaded: true, available: true, error: null });
    } catch (error) {
      if (!mounted.current) return;
      const unavailable = error?.status === 501 || error?.status === 404;
      houseLog.registryFailed({ status: error?.status ?? null, error: error?.message, unavailable });
      setState((prev) => ({ ...prev, loaded: true, available: !unavailable && prev.available, error: unavailable ? null : error }));
    }
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = pollMs > 0 ? setInterval(refresh, pollMs) : null;
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer) clearInterval(timer);
    };
  }, [refresh, pollMs]);

  const byId = useMemo(() => {
    const map = new Map();
    for (const list of [state.retired, state.unnamed, state.notSeenLately, state.screens]) {
      for (const s of list) {
        map.set(s.id, s);
        for (const alias of Array.isArray(s.aliases) ? s.aliases : []) map.set(alias, s);
      }
    }
    return map;
  }, [state.screens, state.notSeenLately, state.retired, state.unnamed]);

  return useMemo(() => ({ ...state, byId, refresh }), [state, byId, refresh]);
}

/** Browser rows whose live name differs from the cached registry: it is stale. */
export function registryLagsLiveNames(devices, byId) {
  return devices.some((device) => {
    if (!device.liveName) return false;
    const entry = byId?.get?.(device.screenId ?? device.id);
    return !!entry && entry.name !== device.liveName;
  });
}

/**
 * Fleet rows named by the registry (RQ-HOUSE-06): a configured screen's
 * rename/room override and a browser's registered name win over devices.yml
 * and the browser's own broadcast. `screenId` is the row's registry id.
 */
export function mergeRegistryNames(devices, byId) {
  return devices.map((device) => {
    const screenId = screenIdFor(device.id);
    const entry = byId?.get?.(screenId);
    if (!entry) return { ...device, screenId };
    return {
      ...device,
      screenId,
      // A browser adopts its registry name and reports it on every heartbeat,
      // so its live name is never older than this (polled) copy of the list.
      name: device.liveName || entry.name || device.name,
      ...(entry.room ? { location: entry.room, room: entry.room } : {}),
      wasName: entry.wasName ?? null,
      renamedAt: entry.renamedAt ?? null,
      wakeable: entry.wakeable ?? device.wakeable,
    };
  });
}
