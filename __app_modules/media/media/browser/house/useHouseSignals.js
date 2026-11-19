// frontend/src/modules/Media/house/useHouseSignals.js
// What every house-view row knows beyond the screen's own state:
// - start progress / last failure (RQ-HOUSE-04): read once per screen from
//   GET /device/:id/start-status (a view opened after a failed start still
//   shows it), then followed live on `device-start:*` (§9.15);
// - how its playback started (RQ-HOUSE-07): GET /api/v1/media/started-by,
//   re-read whenever what is playing around the house changes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRefreshableRead } from '@/lib/hooks/useRefreshableRead.js';
import { useVisibleRefresh } from '../../../../../frontend/src/lib/hooks/useVisibleRefresh.js';
import { observeSocketStatus } from '../../../../../frontend/src/services/observeSocketStatus.js';
import { subscribeTopicKind, parseDeviceTopic, onStatus } from "../net/ws.js";
import { houseApi as defaultApi, screenIdFor, deviceIdForScreen } from "./houseApi.js";
import houseLog from "./houseLog.js";

const PHASES = new Set(['starting', 'delivered', 'queued', 'started', 'failed']);
const STARTED_BY_POLL_MS = 60_000;

function newer(prev, next, preferPreviousOnTie) {
  if (!prev) return true;
  const a = Date.parse(prev.updatedAt ?? '');
  const b = Date.parse(next.updatedAt ?? '');
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return !preferPreviousOnTie;
  return b > a;
}

/** Map deviceId → DeviceStartStatus for the given fleet screens. */
export function useStartStatuses(deviceIds, { api = defaultApi } = {}) {
  const [byDevice, setByDevice] = useState(() => new Map());
  const put = useCallback((deviceId, status, preferPreviousOnTie = false) => {
    setByDevice((prev) => {
      if (!newer(prev.get(deviceId), status, preferPreviousOnTie)) return prev;
      const next = new Map(prev);
      next.set(deviceId, status);
      return next;
    });
  }, []);

  const key = deviceIds.filter(id => !id.startsWith('browser:')).join('|');
  const liveUpdates = useRef(new Set());
  const readStatuses = useCallback(async (isCurrent, signal) => {
    if (!key) return;
    const updates = new Set();
    liveUpdates.current = updates;
    await Promise.all(key.split('|').map(async deviceId => {
      try {
        const res = await api.startStatus(deviceId, { signal });
        if (!isCurrent()) return;
        if (res?.status === null && !updates.has(deviceId)) {
          setByDevice(previous => {
            if (!previous.has(deviceId)) return previous;
            const next = new Map(previous);
            next.delete(deviceId);
            return next;
          });
        } else if (PHASES.has(res?.status?.phase)) {
          put(deviceId, { ...res.status, deviceId }, updates.has(deviceId));
        }
      } catch (error) {
        if (isCurrent() && error?.status !== 404) {
          houseLog.startStatusFailed({ deviceId, status: error?.status ?? null, error: error?.message });
        }
      }
    }));
  }, [key, api, put]);
  const { reload } = useRefreshableRead(readStatuses);

  useEffect(() => {
    const stopEvents = subscribeTopicKind('device-start', msg => {
      const parsed = typeof msg?.topic === 'string' ? parseDeviceTopic(msg.topic) : null;
      const deviceId = (parsed?.kind === 'device-start' ? parsed.deviceId : null) ?? msg?.deviceId;
      if (typeof deviceId !== 'string' || !deviceId || !PHASES.has(msg?.phase)) return;
      liveUpdates.current.add(deviceId);
      houseLog.startStatus({ deviceId, phase: msg.phase, step: msg.step ?? null, replay: !!msg.replay });
      put(deviceId, { ...msg, deviceId });
    });
    return stopEvents;
  }, [put]);

  useEffect(() => {
    if (!key) return;
    reload();
    return observeSocketStatus(onStatus, (_status, recovered) => {
      if (recovered) reload();
    });
  }, [key, reload]);

  return byDevice;
}

function useVisibleAttribution(read, { active = true, pollMs = STARTED_BY_POLL_MS } = {}) {
  const { reload, poll } = useRefreshableRead(read);
  useEffect(() => {
    if (!active) return;
    if (document.visibilityState === 'visible') reload();
    return observeSocketStatus(onStatus, (_status, recovered) => {
      if (recovered && document.visibilityState === 'visible') reload();
    });
  }, [active, reload]);
  useVisibleRefresh({ active, intervalMs: pollMs, reload, poll });
}

/**
 * Map deviceId → StartedBy (§2.7) for every screen playing now.
 * `playingKey` changes whenever what plays anywhere changes.
 */
export function useStartedByAll(playingKey, { api = defaultApi, pollMs = STARTED_BY_POLL_MS } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const readAttribution = useCallback(async (isCurrent, signal) => {
    try {
      const res = await api.startedByAll({ signal });
      if (!isCurrent()) return;
      const next = new Map();
      for (const item of Array.isArray(res?.items) ? res.items : []) {
        const id = deviceIdForScreen(item.deviceId);
        if (id) next.set(id, item);
      }
      houseLog.startedByLoaded({ screens: next.size });
      setSnapshot({ playingKey, byDevice: next });
    } catch (error) {
      if (!isCurrent()) return;
      houseLog.startedByFailed({ status: error?.status ?? null, error: error?.message });
    }
  }, [api, playingKey]);
  useVisibleAttribution(readAttribution, { pollMs });
  return snapshot && snapshot.playingKey === playingKey ? snapshot.byDevice : new Map();
}

/** One screen's StartedBy — for a screen's controls header. */
export function useStartedBy(deviceId, { api = defaultApi, contentId = null } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const id = deviceId === 'local' ? null : screenIdFor(deviceId);
  const readAttribution = useCallback(async (isCurrent, signal) => {
    try {
      const info = await api.startedBy(id, { signal });
      if (isCurrent()) setSnapshot({ id, contentId, info });
    } catch (error) {
      if (!isCurrent()) return;
      setSnapshot(null);
      houseLog.startedByFailed({ deviceId, status: error?.status ?? null, error: error?.message });
    }
  }, [id, deviceId, contentId, api]);
  useVisibleAttribution(readAttribution, { active: Boolean(id) });
  return snapshot?.id === id && snapshot?.contentId === contentId ? snapshot?.info ?? null : null;
}
