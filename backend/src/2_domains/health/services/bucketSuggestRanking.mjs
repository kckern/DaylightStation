/**
 * Ranking for the add-combobox's suggestion list (PRD F8.1 / Task 9.1).
 *
 * PURE. Every time value arrives as an argument — `domains-no-ambient-clock` is
 * an enforced audit rule, and a ranking that reads the wall clock cannot be
 * tested at a boundary.
 *
 * The contract, in one place so the service and its tests cannot drift:
 *
 *   tier 0  favorites                      — the shipped favorites-first contract
 *   tier 1  entries used in THIS bucket    — blended bucket score
 *   tier 2  everything else                — global score, and ONLY when the
 *                                            bucket's history is thin
 *
 * Within a tier: blended bucket score desc, then global score desc, then name.
 * The global score is the tie-break for tiers where every bucket score is 0
 * (tier 2, and tier 0 when a favorite has never been eaten in this bucket), so
 * a food with no bucket history is never ordered alphabetically.
 *
 * "Backfill" is tier 2. It is admitted only while fewer than
 * `BUCKET_HISTORY_MIN_ENTRIES` catalog entries have any history in the bucket:
 * once a bucket knows five foods, the list is that bucket's foods (plus
 * favorites), not a global list wearing a bucket label. With no bucket asked
 * for, no entry has bucket history, so tier 2 is always admitted and the result
 * is exactly the shipped favorites → global-score → name ordering.
 */

/** Frequency is normalised over this window: a food eaten every day for 90 days scores 1.0. */
export const FREQUENCY_WINDOW_DAYS = 90;

/** Recency decays by half every 14 days since the last use IN THAT BUCKET. */
export const RECENCY_HALF_LIFE_DAYS = 14;

/**
 * Below this many entries with history in the bucket, the global ranking
 * backfills the list. At or above it, the bucket stands on its own.
 */
export const BUCKET_HISTORY_MIN_ENTRIES = 5;

const FREQUENCY_WEIGHT = 0.6;
const RECENCY_WEIGHT = 0.4;

/**
 * Whole and fractional days from a YYYY-MM-DD day to `nowMs`, anchored at noon
 * UTC (the convention the shipped global score already used — a bare date is a
 * day, not an instant, and noon keeps a timezone shift from moving it a day).
 * Returns null for anything that is not a parseable day string.
 * @returns {number|null}
 */
export function daysSince(dayIso, nowMs) {
  if (typeof dayIso !== 'string' || !dayIso) return null;
  const t = Date.parse(`${dayIso}T12:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (nowMs - t) / 86400000);
}

/** 1.0 today, 0.5 at 14 days, 0.25 at 28. 0 when there is no usable date. */
export function recencyDecay(dayIso, nowMs) {
  const days = daysSince(dayIso, nowMs);
  if (days === null) return 0;
  return 0.5 ** (days / RECENCY_HALF_LIFE_DAYS);
}

/**
 * The blend: `0.6 * bucketFrequency + 0.4 * recencyDecay(lastUsedInBucket)`.
 * @param {{count?: number, lastUsed?: string}|null|undefined} usage - one entry's
 *   `usageByBucket[bucket]` record
 */
export function bucketScore(usage, nowMs) {
  if (!usage || !(usage.count > 0)) return 0;
  const frequency = Math.min(1, usage.count / FREQUENCY_WINDOW_DAYS);
  return FREQUENCY_WEIGHT * frequency + RECENCY_WEIGHT * recencyDecay(usage.lastUsed, nowMs);
}

/**
 * The shipped bucket-blind score, moved here verbatim so there is one ranking
 * module rather than a copy in the service: use count damped by a 30-day
 * half-life-ish decay.
 */
export function globalScore(entry, nowMs) {
  const days = daysSince(entry?.lastUsed, nowMs) ?? 0;
  return (entry?.useCount || 0) / (1 + days / 30);
}

/**
 * @param {Array<Object>} entries - FoodCatalogEntry instances (already filtered by query)
 * @param {Object} opts
 * @param {string|null} [opts.bucket] - meal bucket id, or null for the bucket-blind list
 * @param {number} opts.nowMs - the clock, injected
 * @param {number} [opts.limit=12]
 * @returns {Array<Object>} the same entries, ranked and truncated
 */
export function rankSuggestions(entries, { bucket = null, nowMs, limit = 12 } = {}) {
  const list = Array.isArray(entries) ? [...entries] : [];
  const usageOf = (e) => (bucket ? e?.usageByBucket?.[bucket] : null);
  const hasBucketHistory = (e) => (usageOf(e)?.count > 0);

  const bucketHistoryCount = bucket ? list.filter(hasBucketHistory).length : 0;
  const backfillAdmitted = bucketHistoryCount < BUCKET_HISTORY_MIN_ENTRIES;

  const tierOf = (e) => (e?.favorite === true ? 0 : (hasBucketHistory(e) ? 1 : 2));

  return list
    .filter((e) => backfillAdmitted || tierOf(e) !== 2)
    .sort((a, b) => (
      tierOf(a) - tierOf(b)
      || bucketScore(usageOf(b), nowMs) - bucketScore(usageOf(a), nowMs)
      || globalScore(b, nowMs) - globalScore(a, nowMs)
      || String(a?.normalizedName ?? '').localeCompare(String(b?.normalizedName ?? ''))
    ))
    .slice(0, limit);
}
