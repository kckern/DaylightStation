import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import { useVisibleRefresh } from '../../../../frontend/src/lib/hooks/useVisibleRefresh.js';

/** Poll while visible. A stalled state read gets two polling periods before replacement. */
export default function useDetections(cameraId, logger, intervalMs = 2000) {
  const [snapshot, setSnapshot] = useState(null);
  const pending = useRef(null);
  const poll = useCallback(async () => {
    if (!cameraId || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const expire = setTimeout(() => controller.abort(), 2 * intervalMs);
    controller.signal.addEventListener('abort', () => {
      clearTimeout(expire);
      pending.current = null;
    }, { once: true });
    try {
      const data = await DaylightAPI(`/api/v1/camera/${encodeURIComponent(cameraId)}/state`, {}, 'GET', {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setSnapshot({ cameraId, detections: data.detections || [] });
    } catch (error) {
      if (!controller.signal.aborted) logger?.debug?.('detection.poll.error', { error: error.message });
    } finally {
      clearTimeout(expire);
      if (pending.current === controller) pending.current = null;
    }
  }, [cameraId, logger, intervalMs]);

  useEffect(() => {
    if (document.visibilityState === 'visible') poll();
    return () => pending.current?.abort();
  }, [poll]);
  useVisibleRefresh({ active: Boolean(cameraId), intervalMs, reload: poll });
  return snapshot && snapshot.cameraId === cameraId ? snapshot.detections : [];
}
