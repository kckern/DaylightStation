import { useEffect, useState, useMemo, useCallback } from 'react';
import { wsService } from '../../../../services/WebSocketService.js';

/**
 * Live hub status. Performs an initial GET /api/v1/playback-hub/status on
 * mount for immediate first paint, then subscribes to the WS topic
 * `playback-hub:status` to overlay subsequent broadcaster ticks.
 *
 * Race guard: the GET response (~100-500ms) can land AFTER a WS message
 * with a newer `fetchedAt` (the broadcaster ticks every 3s, and a tick
 * may already be in flight when we mount). The `accept()` helper only
 * applies payloads strictly newer than the current snapshot.
 *
 * Snapshot shape on the wire:
 *  - GET response  → { ok, slots:   SlotStatus[], fetchedAt: <iso string> }
 *  - WS message    → { data: { devices: SlotStatus[], fetchedAt: Date } }
 *
 * Both are normalised: `accept` reads `fetchedAt`; the returned Map looks
 * at `snapshot.devices ?? snapshot.slots`.
 *
 * @returns {Map<string, object>} color → SlotStatus
 */
export function useHubStatus() {
  const [snapshot, setSnapshot] = useState(null);

  const accept = useCallback((data) => {
    if (!data?.fetchedAt) return;
    setSnapshot((prev) =>
      (prev?.fetchedAt && prev.fetchedAt >= data.fetchedAt) ? prev : data
    );
  }, []);

  // 1. Initial GET — immediate first paint.
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

  // 2. WS overlay — every broadcaster tick.
  useEffect(() => {
    return wsService.subscribe('playback-hub:status', (msg) => {
      if (msg?.type === 'playback-hub.status.snapshot') {
        accept(msg.data);
      }
    });
  }, [accept]);

  return useMemo(() => {
    const m = new Map();
    const list = snapshot?.devices ?? snapshot?.slots ?? [];
    list.forEach((d) => m.set(d.color, d));
    return m;
  }, [snapshot]);
}

export default useHubStatus;
