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

/**
 * A food shown before the server has confirmed it. `provisionalFoodRow` builds
 * the row from what the suggestion already carries; `settleProvisionalRow`
 * swaps it for the server's row (or, with none, takes it back out); a day
 * reload that lands in between simply drops it, and the swap re-adds the real
 * row. Provisional ids never reach the server: the row is untappable-by-id
 * only for the second or so the save takes.
 */
export const PROVISIONAL_PREFIX = 'pending-';
export function provisionalFoodRow(entry, { date, mealTime, at = Date.now() }) {
  const nutrients = entry.nutrients || entry;
  const number = value => (Number.isFinite(value) ? value : 0);
  return {
    uuid: `${PROVISIONAL_PREFIX}${crypto.randomUUID()}`, foodId: entry.id, item: entry.name, name: entry.name, kind: 'item', parentId: null,
    calories: number(nutrients.calories), protein: number(nutrients.protein), carbs: number(nutrients.carbs), fat: number(nutrients.fat),
    grams: entry.grams ?? null, unit: entry.unit || (entry.grams > 0 ? 'g' : 'serving'), amount: entry.amount ?? entry.grams ?? 1,
    color: 'yellow', icon: entry.icon ?? null, photoRef: entry.photoRef ?? null, date, mealTime, settled: true, version: 1, provisional: true, createdAt: at,
  };
}
export const isProvisionalRow = row => String(row?.uuid ?? row?.id ?? '').startsWith(PROVISIONAL_PREFIX);

export function settleProvisionalRow(provisional, saved = null) {
  const gone = String(provisional.uuid);
  const shown = patchApiResource(healthDayPath(provisional.date), day => {
    if (!Array.isArray(day?.items)) return undefined;
    const items = day.items.filter(row => String(row.uuid ?? row.id) !== gone);
    const savedId = saved ? String(saved.uuid ?? saved.id) : null;
    if (saved && !items.some(row => String(row.uuid ?? row.id) === savedId)) items.push(saved);
    return { ...day, items };
  });
  logger().info(saved ? 'day.rows.settled' : 'day.rows.retracted', { date: provisional.date, shown });
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
