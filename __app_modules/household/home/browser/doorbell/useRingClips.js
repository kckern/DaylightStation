import { useCallback, useEffect, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import { useRefreshableRead } from '@/lib/hooks/useRefreshableRead.js';
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
  const read = useCallback(async (isCurrent, signal) => {
    if (!camera || !dayList) {
      setState(null);
      return;
    }
    const list = dayList.split(',');
    setState({ camera, dayList, clips: [], loading: true, error: null });
    const results = await Promise.allSettled(list.map(day => DaylightAPI(clipsPath(camera, day), {}, 'GET', { signal })));
    if (!isCurrent()) return;
    const clips = results.flatMap(result => result.status === 'fulfilled' ? result.value?.clips || [] : []);
    const failed = results.filter(result => result.status === 'rejected');
    logger.debug('home.ring.clips', { camera, days: list, clips: clips.length, failedDays: failed.length });
    if (failed.length) logger.warn('home.ring.clips.failed', { camera, failedDays: failed.length, error: failed[0].reason?.message });
    const error = failed.length === results.length ? (failed[0].reason || new Error('Clips failed to load')) : null;
    setState({ camera, dayList, clips, loading: false, error });
  }, [camera, dayList]);
  const { reload } = useRefreshableRead(read);
  useEffect(() => { reload(); }, [reload]);

  if (!state || state.camera !== camera || state.dayList !== dayList) {
    return { clips: [], loading: Boolean(camera && dayList), error: null, reload };
  }
  return { clips: state.clips, loading: state.loading, error: state.error, reload };
}

export default useRingClips;
