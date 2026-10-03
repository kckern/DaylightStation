// frontend/src/modules/Media/house/useHouseSignals.js
// What every house-view row knows beyond the screen's own state:
// - start progress / last failure (RQ-HOUSE-04): read once per screen from
//   GET /device/:id/start-status (a view opened after a failed start still
//   shows it), then followed live on `device-start:*` (§9.15);
// - how its playback started (RQ-HOUSE-07): GET /api/v1/media/started-by,
//   re-read whenever what is playing around the house changes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeTopicKind, parseDeviceTopic } from '../net/ws.js';
import { houseApi as defaultApi, screenIdFor, deviceIdForScreen } from './houseApi.js';
import houseLog from './houseLog.js';

const PHASES = new Set(['starting', 'delivered', 'queued', 'started', 'failed']);
const STARTED_BY_POLL_MS = 60_000;

function newer(prev, next) {
  if (!prev) return true;
  const a = Date.parse(prev.updatedAt ?? '');
  const b = Date.parse(next.updatedAt ?? '');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return b >= a;
}

/** Map deviceId → DeviceStartStatus for the given fleet screens. */
export function useStartStatuses(deviceIds, { api = defaultApi } = {}) {
  const [byDevice, setByDevice] = useState(() => new Map());
  const put = useCallback((deviceId, status) => {
    setByDevice((prev) => {
      if (!newer(prev.get(deviceId), status)) return prev;
      const next = new Map(prev);
      next.set(deviceId, status);
      return next;
    });
  }, []);

  useEffect(() => subscribeTopicKind('device-start', (msg) => {
    const parsed = typeof msg?.topic === 'string' ? parseDeviceTopic(msg.topic) : null;
    const deviceId = (parsed?.kind === 'device-start' ? parsed.deviceId : null) ?? msg?.deviceId;
    if (typeof deviceId !== 'string' || !deviceId || !PHASES.has(msg?.phase)) return;
    houseLog.startStatus({ deviceId, phase: msg.phase, step: msg.step ?? null, replay: !!msg.replay });
    put(deviceId, { ...msg, deviceId });
  }), [put]);

  const key = deviceIds.filter((id) => !id.startsWith('browser:')).join('|');
  useEffect(() => {
    let cancelled = false;
    for (const deviceId of key ? key.split('|') : []) {
      api.startStatus(deviceId)
        .then((res) => {
          if (!cancelled && res?.status && PHASES.has(res.status.phase)) put(deviceId, { ...res.status, deviceId });
        })
        .catch((error) => {
          if (!cancelled && error?.status !== 404) houseLog.startStatusFailed({ deviceId, status: error?.status ?? null, error: error?.message });
        });
    }
    return () => { cancelled = true; };
  }, [key, api, put]);

  return byDevice;
}

/**
 * Map deviceId → StartedBy (§2.7) for every screen playing now.
 * `playingKey` changes whenever what plays anywhere changes.
 */
export function useStartedByAll(playingKey, { api = defaultApi, pollMs = STARTED_BY_POLL_MS } = {}) {
  const [byDevice, setByDevice] = useState(() => new Map());
  const load = useCallback(async () => {
    try {
      const res = await api.startedByAll();
      const next = new Map();
      for (const item of Array.isArray(res?.items) ? res.items : []) {
        const id = deviceIdForScreen(item.deviceId);
        if (id) next.set(id, item);
      }
      houseLog.startedByLoaded({ screens: next.size });
      setByDevice(next);
    } catch (error) {
      houseLog.startedByFailed({ status: error?.status ?? null, error: error?.message });
    }
  }, [api]);
  useEffect(() => { load(); }, [load, playingKey]);
  useEffect(() => {
    if (!(pollMs > 0)) return undefined;
    const timer = setInterval(load, pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);
  return byDevice;
}

/** One screen's StartedBy — for a screen's controls header. */
export function useStartedBy(deviceId, { api = defaultApi, contentId = null } = {}) {
  const [info, setInfo] = useState(null);
  const latest = useRef(0);
  useEffect(() => {
    const id = screenIdFor(deviceId);
    if (!id) { setInfo(null); return undefined; }
    const ticket = ++latest.current;
    api.startedBy(id)
      .then((res) => { if (ticket === latest.current) setInfo(res ?? null); })
      .catch((error) => {
        if (ticket === latest.current) setInfo(null);
        houseLog.startedByFailed({ deviceId, status: error?.status ?? null, error: error?.message });
      });
    return undefined;
  }, [deviceId, contentId, api]);
  return info;
}
