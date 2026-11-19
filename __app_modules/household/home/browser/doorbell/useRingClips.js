import { useCallback, useEffect, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import homeLogger from '../homeLogger.js';

const logger = homeLogger.child({ component: 'ring-clips' });

export const clipsPath = (camera, day) => `api/v1/camera/${encodeURIComponent(camera)}/clips?day=${day}`;

/**
 * A camera's recorded clips over the given local days (`YYYY-MM-DD`), one
 * request per day: `{clips, loading, error, reload}`. A day that fails to
 * load costs its own clips, not the others'; only when every day fails is
 * the list an error.
 */
export function useRingClips(camera, days) {
  const dayList = days?.join(',') || '';
  const [state, setState] = useState(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!camera || !dayList) {
      setState(null);
      return;
    }
    const controller = new AbortController();
    const list = dayList.split(',');
    setState({ camera, dayList, clips: [], loading: true, error: null });
    Promise.allSettled(list.map((day) => DaylightAPI(clipsPath(camera, day), {}, 'GET', { signal: controller.signal }))).then((results) => {
      if (controller.signal.aborted) return;
      const clips = results.flatMap((r) => (r.status === 'fulfilled' ? r.value?.clips || [] : []));
      const failed = results.filter((r) => r.status === 'rejected');
      logger.debug('home.ring.clips', { camera, days: list, clips: clips.length, failedDays: failed.length });
      if (failed.length) logger.warn('home.ring.clips.failed', { camera, failedDays: failed.length, error: failed[0].reason?.message });
      const error = failed.length === results.length ? (failed[0].reason || new Error('Clips failed to load')) : null;
      setState({ camera, dayList, clips, loading: false, error });
    });
    return () => controller.abort();
  }, [camera, dayList, nonce]);

  if (!state || state.camera !== camera || state.dayList !== dayList) {
    return { clips: [], loading: Boolean(camera && dayList), error: null, reload };
  }
  return { clips: state.clips, loading: state.loading, error: state.error, reload };
}

export default useRingClips;
