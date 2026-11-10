import { useEffect } from 'react';
import { useApiResource } from '@/lib/hooks/useApiResource.js';
import homeLogger from '../homeLogger.js';

const logger = homeLogger.child({ component: 'timeline' });

const REFRESH_MS = 60_000;

/** The timeline path for a range (`today` | `yesterday` | `week`). */
export const timelinePath = (range) => `api/v1/home-dashboard/timeline?range=${range}`;

/**
 * The house's day as lanes: `{timeline, loading, error, reload}`. Today is
 * still being written, so it re-reads every minute while the page is
 * visible; yesterday and the week are settled and read once (cached per
 * range, so flipping back paints at once).
 */
export function useTimeline(range) {
  const { data: timeline, loading, error, reload } = useApiResource(timelinePath(range), { label: 'timeline', logger, swr: true });

  useEffect(() => {
    if (range !== 'today') return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [range, reload]);

  useEffect(() => {
    if (timeline) logger.debug('home.timeline.loaded', { range, lanes: timeline.lanes?.length ?? 0 });
  }, [timeline, range]);
  useEffect(() => {
    if (error) logger.warn('home.timeline.failed', { range, error: error.message });
  }, [error, range]);

  return { timeline: timeline || null, loading, error, reload };
}

export default useTimeline;
