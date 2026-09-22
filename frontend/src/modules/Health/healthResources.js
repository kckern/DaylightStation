import { invalidateApiResources } from '../../lib/hooks/useApiResource.js';

export const refreshHealthResources = () => invalidateApiResources(path =>
  path.startsWith('api/v1/health/') || path === 'api/v1/lifelog/weight');

// The per-day resources Today reads. One home, so the readers and the
// prefetcher build byte-identical cache keys.
export const healthDayPath = date => `api/v1/health/day?date=${date}`;
export const pendingReviewPath = date => `api/v1/health/nutrition/pending?date=${date}`;
export const observationsPath = date => `api/v1/health/nutrition/observations?date=${date}`;
export const healthDayPaths = date => [healthDayPath(date), pendingReviewPath(date), observationsPath(date)];

// A meal's zero-keystroke shortlist in the add row: this bucket's regulars,
// not a browse surface. It opens with no user intent behind it and every row
// draws an icon, so eight — a phone screen without scrolling — keeps that
// burst small. The typed list keeps the server default.
export const SHORTLIST_LIMIT = 8;
export const shortlistPath = bucket =>
  `api/v1/health/nutrition/catalog/suggest?${bucket ? `bucket=${encodeURIComponent(bucket)}&` : ''}limit=${SHORTLIST_LIMIT}`;
