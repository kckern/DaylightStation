import { invalidateApiResources, patchApiResource } from '../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../lib/ui/createAppLogger.js';

let _logger;
const logger = () => (_logger ??= createAppLogger('health').child('health-resources'));

// /dashboard re-aggregates two years of history on every request — about two
// seconds of server work that stalls every other request behind it, including
// the day refetch a write is waiting on. Nothing a food write changes reaches
// what Today reads from it (the coach line), so a write leaves it alone.
const DASHBOARD_PATH = 'api/v1/health/dashboard';
const isHealthResource = path => path.startsWith('api/v1/health/') || path === 'api/v1/lifelog/weight';

/**
 * The error a reader should show in place of its content: only when there is
 * no content. A refresh that fails while data is on screen (the 15 s poll
 * during a backend restart) keeps that data; useApiResource still reports the
 * error, so a view can add its own quiet cue.
 */
export const unavailableError = resource => (resource?.data == null ? resource?.error ?? null : null);

export const refreshHealthResources = () => invalidateApiResources(path =>
  isHealthResource(path) && path !== DASHBOARD_PATH);

/** After a coach turn, which may have written the day's coaching. */
export const refreshHealthResourcesWithDashboard = () => invalidateApiResources(isHealthResource);

// The per-day resources Today reads. One home, so the readers and the
// prefetcher build byte-identical cache keys.
export const healthDayPath = date => `api/v1/health/day?date=${date}`;
export const pendingReviewPath = date => `api/v1/health/nutrition/pending?date=${date}`;
export const observationsPath = date => `api/v1/health/nutrition/observations?date=${date}`;
export const healthDayPaths = date => [healthDayPath(date), pendingReviewPath(date), observationsPath(date)];

/**
 * Show a day's new closure (Done logging / Fasted / reopened) now, from the
 * POST response, instead of waiting for the day refetch. Returns whether the
 * day was loaded here to patch.
 */
export function showDayStatus(date, dayStatus) {
  return patchApiResource(healthDayPath(date), day => (day && typeof day === 'object' ? { ...day, dayStatus } : undefined));
}

/**
 * Put food rows a write has just committed on their day now. The quick-add
 * response carries the saved row, so the row need not wait for the day
 * refetch — which, on a busy page, queues behind a dozen other requests on the
 * browser's six connections. The refetch still follows and brings the budget
 * and totals; it replaces this copy of the row with the server's.
 */
export function showCommittedFoodRows(rows) {
  const byDate = new Map();
  for (const row of rows || []) {
    const id = row?.uuid ?? row?.id;
    if (!row?.date || id == null) continue;
    byDate.set(row.date, [...(byDate.get(row.date) || []), row]);
  }
  for (const [date, added] of byDate) {
    const shown = patchApiResource(healthDayPath(date), day => {
      if (!Array.isArray(day?.items)) return undefined;
      const present = new Set(day.items.map(row => String(row.uuid ?? row.id)));
      const fresh = added.filter(row => !present.has(String(row.uuid ?? row.id)));
      return fresh.length ? { ...day, items: [...day.items, ...fresh] } : undefined;
    });
    // `shown: false` means the row waits for the day refetch: the day was
    // never loaded here, or it already holds the row.
    logger().info('day.rows.committed', { date, rows: added.length, shown });
  }
}

// A meal's zero-keystroke shortlist in the add row: this bucket's regulars
// (half most-used, half most-recent — FoodCatalogService.suggest), not a
// browse surface. Sixteen compact rows: the list is prefetched with the day
// and its icons are preloaded then, so opening a row no longer pays that
// burst — the old cap of eight existed for the cold-open icon herd. The
// typed list keeps the server default.
export const SHORTLIST_LIMIT = 16;
export const shortlistPath = bucket =>
  `api/v1/health/nutrition/catalog/suggest?${bucket ? `bucket=${encodeURIComponent(bucket)}&` : ''}limit=${SHORTLIST_LIMIT}`;
