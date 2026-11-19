// frontend/src/modules/Media/house/useHouseSignals.js
// What every house-view row knows beyond the screen's own state:
// - start progress / last failure (RQ-HOUSE-04): read once per screen from
//   GET /device/:id/start-status (a view opened after a failed start still
//   shows it), then followed live on `device-start:*` (§9.15);
// - how its playback started (RQ-HOUSE-07): GET /api/v1/media/started-by,
//   re-read whenever what is playing around the house changes.
import { useCallback, useEffect, useState } from 'react';
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

  const key = deviceIds.filter((id) => !id.startsWith('browser:')).join('|');
  useEffect(() => {
    let generation = 0;
    const liveUpdates = new Set();
    const stopEvents = subscribeTopicKind('device-start', msg => {
      const parsed = typeof msg?.topic === 'string' ? parseDeviceTopic(msg.topic) : null;
      const deviceId = (parsed?.kind === 'device-start' ? parsed.deviceId : null) ?? msg?.deviceId;
      if (typeof deviceId !== 'string' || !deviceId || !PHASES.has(msg?.phase)) return;
      liveUpdates.add(deviceId);
      houseLog.startStatus({ deviceId, phase: msg.phase, step: msg.step ?? null, replay: !!msg.replay });
      put(deviceId, { ...msg, deviceId });
    });
    if (!key) return stopEvents;
    const refresh = () => {
      const current = ++generation;
      liveUpdates.clear();
      for (const deviceId of key.split('|')) {
        api.startStatus(deviceId)
          .then(res => {
            if (current !== generation) return;
            if (res?.status === null && !liveUpdates.has(deviceId)) {
              setByDevice(previous => {
                if (!previous.has(deviceId)) return previous;
                const next = new Map(previous);
                next.delete(deviceId);
                return next;
              });
            } else if (PHASES.has(res?.status?.phase)) {
              put(deviceId, { ...res.status, deviceId }, liveUpdates.has(deviceId));
            }
          })
          .catch(error => {
            if (current === generation && error?.status !== 404) {
              houseLog.startStatusFailed({ deviceId, status: error?.status ?? null, error: error?.message });
            }
          });
      }
    };
    refresh();
    const unsubscribe = observeSocketStatus(onStatus, (_status, recovered) => {
      if (recovered) refresh();
    });
    return () => { generation++; unsubscribe(); stopEvents(); };
  }, [key, api, put]);

  return byDevice;
}

/**
 * Map deviceId → StartedBy (§2.7) for every screen playing now.
 * `playingKey` changes whenever what plays anywhere changes.
 */
export function useStartedByAll(playingKey, { api = defaultApi, pollMs = STARTED_BY_POLL_MS } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const readAttribution = useCallback(async isCurrent => {
    try {
      const res = await api.startedByAll();
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
  const { reload, poll } = useRefreshableRead(readAttribution);
  useEffect(() => {
    if (document.visibilityState === 'visible') reload();
  }, [reload]);
  useVisibleRefresh({ intervalMs: pollMs, reload, poll });
  return snapshot && snapshot.playingKey === playingKey ? snapshot.byDevice : new Map();
}

/** One screen's StartedBy — for a screen's controls header. */
export function useStartedBy(deviceId, { api = defaultApi, contentId = null } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const id = screenIdFor(deviceId);
  useEffect(() => {
    if (!id) return;
    let active = true;
    api.startedBy(id)
      .then(info => { if (active) setSnapshot({ id, contentId, info }); })
      .catch(error => {
        if (!active) return;
        setSnapshot(null);
        houseLog.startedByFailed({ deviceId, status: error?.status ?? null, error: error?.message });
      });
    return () => { active = false; };
  }, [id, deviceId, contentId, api]);
  return snapshot?.id === id && snapshot?.contentId === contentId ? snapshot?.info ?? null : null;
}
