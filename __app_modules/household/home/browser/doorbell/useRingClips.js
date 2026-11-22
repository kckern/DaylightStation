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
  const read = useCallback(async (isCurrent, signal, retryDays) => {
    if (!camera || !dayList) {
      setState(null);
      return;
    }
    const allDays = dayList.split(',');
    const list = retryDays?.length
      ? [...new Set(retryDays.filter(day => allDays.includes(day)))]
      : allDays;
    if (!list.length) return;
    setState(current => {
      const retained = current?.camera === camera && current.dayList === dayList ? current : null;
      return {
        camera,
        dayList,
        clipsByDay: retained?.clipsByDay || {},
        failedDays: retained?.failedDays || [],
        loading: true,
        error: null,
      };
    });
    const results = await Promise.allSettled(list.map(day => DaylightAPI(clipsPath(camera, day), {}, 'GET', { signal })));
    if (!isCurrent()) return;
    const failed = results.flatMap((result, index) => result.status === 'rejected' ? [list[index]] : []);
    const fetchedClips = results.flatMap(result => result.status === 'fulfilled' ? result.value?.clips || [] : []);
    logger.debug('home.ring.clips', { camera, days: list, clips: fetchedClips.length, failedDays: failed.length });
    if (failed.length) {
      const firstFailure = results.find(result => result.status === 'rejected')?.reason;
      logger.warn('home.ring.clips.failed', { camera, failedDays: failed.length, error: firstFailure?.message });
    }
    setState(current => {
      const retained = current?.camera === camera && current.dayList === dayList ? current : null;
      const failedDaySet = new Set(retained?.failedDays || []);
      const clipsByDay = { ...(retained?.clipsByDay || {}) };
      list.forEach((day, index) => {
        if (results[index].status === 'rejected') failedDaySet.add(day);
        else {
          failedDaySet.delete(day);
          clipsByDay[day] = results[index].value?.clips || [];
        }
      });
      const failedDays = allDays.filter(day => failedDaySet.has(day));
      const error = failedDays.length === allDays.length
        ? (results.find(result => result.status === 'rejected')?.reason || retained?.error || new Error('Clips failed to load'))
        : null;
      return {
        camera,
        dayList,
        clipsByDay,
        failedDays,
        loading: false,
        error,
      };
    });
  }, [camera, dayList]);
  const { reload } = useRefreshableRead(read);
  useEffect(() => { reload(); }, [reload]);

  if (!state || state.camera !== camera || state.dayList !== dayList) {
    return { clips: [], failedDays: [], loading: Boolean(camera && dayList), error: null, reload };
  }
  const clips = dayList.split(',').flatMap(day => state.clipsByDay?.[day] || []);
  return { clips, failedDays: state.failedDays || [], loading: state.loading, error: state.error, reload };
}

export default useRingClips;
