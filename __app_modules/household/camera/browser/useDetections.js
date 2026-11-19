import { useCallback, useEffect, useState } from 'react';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import { useRefreshableRead } from '../../../../frontend/src/lib/hooks/useRefreshableRead.js';
import { useVisibleRefresh } from '../../../../frontend/src/lib/hooks/useVisibleRefresh.js';

/** Poll while visible. A stalled state read gets two polling periods before replacement. */
export default function useDetections(cameraId, logger, intervalMs = 2000) {
  const [snapshot, setSnapshot] = useState(null);
  const read = useCallback(async (isCurrent, signal) => {
    try {
      const data = await DaylightAPI(`/api/v1/camera/${encodeURIComponent(cameraId)}/state`, {}, 'GET', { signal });
      if (isCurrent()) setSnapshot({ cameraId, detections: data.detections || [] });
    } catch (error) {
      if (isCurrent()) logger?.debug?.('detection.poll.error', { error: error.message });
    }
  }, [cameraId, logger]);

  const { reload, poll } = useRefreshableRead(read, { timeoutMs: 2 * intervalMs });
  useEffect(() => {
    if (cameraId && document.visibilityState === 'visible') reload();
  }, [cameraId, reload]);
  useVisibleRefresh({ active: Boolean(cameraId), intervalMs, reload, poll });
  return snapshot && snapshot.cameraId === cameraId ? snapshot.detections : [];
}
