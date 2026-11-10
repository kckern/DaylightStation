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
  const key = camera && days?.length ? `${camera}|${days.join(',')}` : null;
  const [state, setState] = useState({ clips: [], loading: Boolean(key), error: null });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!key) { setState({ clips: [], loading: false, error: null }); return undefined; }
    let live = true;
    const [cam, dayList] = key.split('|');
    const list = dayList.split(',');
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.allSettled(list.map((day) => DaylightAPI(clipsPath(cam, day)))).then((results) => {
      if (!live) return;
      const clips = results.flatMap((r) => (r.status === 'fulfilled' ? r.value?.clips || [] : []));
      const failed = results.filter((r) => r.status === 'rejected');
      logger.debug('home.ring.clips', { camera: cam, days: list, clips: clips.length, failedDays: failed.length });
      if (failed.length) logger.warn('home.ring.clips.failed', { camera: cam, failedDays: failed.length, error: failed[0].reason?.message });
      const error = failed.length === results.length ? (failed[0].reason || new Error('Clips failed to load')) : null;
      setState({ clips, loading: false, error });
    });
    return () => { live = false; };
  }, [key, nonce]);

  return { ...state, reload };
}

export default useRingClips;
