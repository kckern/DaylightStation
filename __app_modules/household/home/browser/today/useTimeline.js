import { useEffect } from 'react';
import { useApiResource } from '@/lib/hooks/useApiResource.js';
import { useVisibleRefresh } from '@/lib/hooks/useVisibleRefresh.js';
import homeLogger from '../homeLogger.js';

const logger = homeLogger.child({ component: 'timeline' });

const REFRESH_MS = 60_000;

/** The timeline path for a range (`today` | `yesterday` | `week`). */
export const timelinePath = (range) => `api/v1/home-dashboard/timeline?range=${range}`;

/**
 * The house's day as lanes: `{timeline, loading, error, reload}`. Today is
 * still being written, so it re-reads every minute while the page is
 * visible. Yesterday and Week revalidate on selection and keep their cached
 * range available when the user switches back.
 */
export function useTimeline(range) {
  const { data: timeline, loading, error, reload, poll } = useApiResource(timelinePath(range), { label: 'timeline', logger, swr: true });

  useVisibleRefresh({ active: range === 'today', reload, poll, intervalMs: REFRESH_MS });

  useEffect(() => {
    if (timeline) logger.debug('home.timeline.loaded', { range, lanes: timeline.lanes?.length ?? 0 });
  }, [timeline, range]);
  useEffect(() => {
    if (error) logger.warn('home.timeline.failed', { range, error: error.message });
  }, [error, range]);

  return { timeline: timeline || null, loading, error, reload };
}

export default useTimeline;
