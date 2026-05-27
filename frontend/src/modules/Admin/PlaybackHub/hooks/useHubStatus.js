import { useEffect, useState, useMemo, useCallback } from 'react';
import { wsService } from '../../../../services/WebSocketService.js';

/**
 * Live hub status. Returns BOTH a Map<color, SlotStatus> and the timestamp
 * of the most recent snapshot, so consumers can detect staleness.
 *
 * Wire shapes:
 *   GET response  → { ok, slots:   SlotStatus[], fetchedAt: <iso string> }
 *   WS message    → { data: { devices: SlotStatus[], fetchedAt: Date } }
 *
 * Race guard: GET (~100-500 ms) can land AFTER a WS tick. `accept()` only
 * applies payloads strictly newer than the current snapshot.
 *
 * @returns {{ devices: Map<string, object>, fetchedAt: Date | null }}
 */
export function useHubStatus() {
  const [snapshot, setSnapshot] = useState(null);

  const accept = useCallback((data) => {
    if (!data?.fetchedAt) return;
    const t = data.fetchedAt instanceof Date
      ? data.fetchedAt
      : new Date(data.fetchedAt);
    setSnapshot((prev) => {
      if (prev?.fetchedAt && prev.fetchedAt >= t) return prev;
      const list = data.devices ?? data.slots ?? [];
      return { devices: list, fetchedAt: t };
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/playback-hub/status')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.ok) accept(body);
      })
      .catch(() => { /* WS will deliver shortly */ });
    return () => { cancelled = true; };
  }, [accept]);

  useEffect(() => {
    return wsService.subscribe('playback-hub:status', (msg) => {
      if (msg?.type === 'playback-hub.status.snapshot') {
        accept(msg.data);
      }
    });
  }, [accept]);

  return useMemo(() => {
    const m = new Map();
    (snapshot?.devices ?? []).forEach((d) => m.set(d.color, d));
    return { devices: m, fetchedAt: snapshot?.fetchedAt ?? null };
  }, [snapshot]);
}

export default useHubStatus;
