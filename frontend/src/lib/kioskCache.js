/**
 * kioskCache — last-known payloads in localStorage, for stale-while-revalidate
 * paints on kiosk screens (the Gem Board, the fitness family card).
 *
 * A screen paints FROM the cache the moment it opens, then replaces it in place
 * when its fresh read lands (a fresh payload always wins). An entry is
 * `{v, week, at, data}`:
 *  - `v` is the caller's schema version: an entry from another version is dropped;
 *  - `week` is the week the payload belongs to: an entry from another week is
 *    dropped, so a gem held last week never shows as held in a new one (the
 *    caller draws its placeholder instead);
 *  - an entry larger than `maxBytes` is never written (kiosk storage is small).
 *
 * Every read and write is guarded: kiosk storage can be blocked, full or
 * throwing on access, and a cache that fails is just a miss.
 * Logs `kiosk-cache.hit` / `.miss` / `.stale` / `.skip` at debug.
 */
import getLogger from '@/lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'kiosk-cache' }));

const PREFIX = 'daylight.cache.';
export const DEFAULT_MAX_BYTES = 256 * 1024;

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // a blocked storage throws on access itself
  }
}

/**
 * The cached payload for `key` when it is this `version` and this `week`, else null.
 * A mismatched entry is removed.
 * @param {string} key
 * @param {{version: number, week: string|number}} opts
 */
export function readCache(key, { version, week }) {
  const store = storage();
  const full = PREFIX + key;
  if (!store) { logger().debug('kiosk-cache.miss', { key, why: 'no-storage' }); return null; }
  let entry = null;
  try {
    entry = JSON.parse(store.getItem(full) ?? 'null');
  } catch (err) {
    logger().debug('kiosk-cache.miss', { key, why: 'unreadable', error: err?.message });
    try { store.removeItem(full); } catch { /* blocked */ }
    return null;
  }
  if (!entry) { logger().debug('kiosk-cache.miss', { key, why: 'empty' }); return null; }
  if (entry.v !== version || String(entry.week) !== String(week) || entry.data == null) {
    logger().debug('kiosk-cache.stale', { key, cachedVersion: entry.v, version, cachedWeek: entry.week, week });
    try { store.removeItem(full); } catch { /* blocked */ }
    return null;
  }
  logger().debug('kiosk-cache.hit', { key, week, ageMs: Number.isFinite(entry.at) ? Date.now() - entry.at : null });
  return entry.data;
}

/**
 * Keep `data` as the last good payload for `key`. Returns whether it was written.
 * @param {string} key
 * @param {unknown} data
 * @param {{version: number, week: string|number, maxBytes?: number}} opts
 */
export function writeCache(key, data, { version, week, maxBytes = DEFAULT_MAX_BYTES }) {
  const store = storage();
  if (!store || data == null || week == null) return false;
  let text;
  try {
    text = JSON.stringify({ v: version, week, at: Date.now(), data });
  } catch {
    return false;
  }
  if (text.length > maxBytes) {
    logger().debug('kiosk-cache.skip', { key, why: 'too-big', bytes: text.length, maxBytes });
    return false;
  }
  try {
    store.setItem(PREFIX + key, text);
    return true;
  } catch (err) {
    logger().debug('kiosk-cache.skip', { key, why: 'write-failed', error: err?.message });
    return false;
  }
}

/** Today's local calendar date as 'YYYY-MM-DD' for the Monday of its week (Monday-first). */
export function localMonday(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
