import { invalidateApiResources } from '../../lib/hooks/useApiResource.js';

export const refreshHealthResources = () => invalidateApiResources(path =>
  path.startsWith('api/v1/health/') || path === 'api/v1/lifelog/weight');

// The per-day resources Today reads. One home, so the readers and the
// prefetcher build byte-identical cache keys.
export const healthDayPath = date => `api/v1/health/day?date=${date}`;
export const pendingReviewPath = date => `api/v1/health/nutrition/pending?date=${date}`;
export const observationsPath = date => `api/v1/health/nutrition/observations?date=${date}`;
export const healthDayPaths = date => [healthDayPath(date), pendingReviewPath(date), observationsPath(date)];

// A meal's zero-keystroke shortlist in the add row: this bucket's regulars
// (half most-used, half most-recent — FoodCatalogService.suggest), not a
// browse surface. Sixteen compact rows: the list is prefetched with the day
// and its icons are preloaded then, so opening a row no longer pays that
// burst — the old cap of eight existed for the cold-open icon herd. The
// typed list keeps the server default.
export const SHORTLIST_LIMIT = 16;
export const shortlistPath = bucket =>
  `api/v1/health/nutrition/catalog/suggest?${bucket ? `bucket=${encodeURIComponent(bucket)}&` : ''}limit=${SHORTLIST_LIMIT}`;
