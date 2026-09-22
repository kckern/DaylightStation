import { useEffect, useRef } from 'react';
import { peekApiResource, prefetchApiResources } from '../../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { healthDayPaths, shortlistPath } from '../healthResources.js';
import { BUCKETS, localTodayISO } from './mealBuckets.js';
import { addDays, weekEnd } from './WeekStrip.jsx';
import { preloadFoodIcon } from './FoodIcon.jsx';
import { budgetRangePath } from './useBudgetRange.js';

const logger = createAppLogger('health').child('day-prefetch');

export const PREFETCH_RADIUS = 7;

/**
 * The days around `date` to warm, nearest first. At equal distance the side
 * the user is moving toward goes first (`direction` -1 = earlier, 1 = later).
 * Days after `today` hold nothing and are never requested.
 */
export function prefetchOrder(date, today, direction = -1, radius = PREFETCH_RADIUS) {
  const days = [];
  for (let distance = 1; distance <= radius; distance += 1) {
    const offsets = direction > 0 ? [distance, -distance] : [-distance, distance];
    for (const offset of offsets) {
      const day = addDays(date, offset);
      if (day <= today) days.push(day);
    }
  }
  return days;
}

// Rows of a prefetched day, or a shortlist: decode their icons too, so the
// flip paints pictures rather than placeholders that fade in.
const itemsOf = payload => (Array.isArray(payload) ? payload : payload?.data || payload?.items || []);
const preloadIcons = payload => { for (const item of itemsOf(payload)) preloadFoodIcon(item?.icon); };

// The sidebar's 30-day window ends on the viewed day (capped at today) and
// the week strip shows one week; both move as the user flips.
const monthRangePath = (day, today) => { const end = day < today ? day : today; return budgetRangePath(addDays(end, -29), end); };
const weekRangePath = end => budgetRangePath(addDays(end, -6), end);

/**
 * Keep a ±7-day buffer of Today's per-day resources warm around the viewed
 * day, plus every meal's add-row shortlist, so flipping days and opening an
 * add row paint from cache. Waits until the viewed day itself has loaded:
 * the day on screen always goes first. Each move replaces the queue with the
 * new neighbourhood.
 */
export function useHealthDayPrefetch(date, { enabled = true, ready = true } = {}) {
  const previous = useRef(date);
  const direction = useRef(-1);
  if (date !== previous.current) {
    direction.current = date < previous.current ? -1 : 1;
    previous.current = date;
  }

  useEffect(() => {
    if (!enabled || !ready) return;
    const today = localTodayISO();
    // The one or two days a single flip reaches go first; the rest after.
    const order = prefetchOrder(date, today, direction.current);
    const nearest = order.slice(0, 2);
    const farther = order.slice(2);
    const week = weekEnd(date);
    const paths = [
      ...nearest.flatMap(healthDayPaths),
      ...BUCKETS.map(bucket => shortlistPath(bucket.id)),
      ...nearest.map(day => monthRangePath(day, today)),
      weekRangePath(addDays(week, -7)),
      ...(addDays(week, 7) <= weekEnd(today) ? [weekRangePath(addDays(week, 7))] : []),
      ...farther.flatMap(healthDayPaths),
    ];
    const queued = prefetchApiResources(paths, {
      onDone: (error, path) => {
        if (error) { logger.debug('prefetch.failed', { path, error: error.message }); return; }
        if (path.includes('catalog/suggest') || path.includes('health/day?')) preloadIcons(peekApiResource(path));
      },
    });
    logger.debug('prefetch.queued', { date, direction: direction.current, queued, candidates: paths.length });
  }, [date, enabled, ready]);
}
