/**
 * Which hours of a day to fetch, and in what order.
 *
 * Sequential day-by-day processing is the wrong shape for a long backfill: a
 * third of the way through you have a third of the days complete and the rest
 * untouched. Measured across 17 July days, only 33% of hours contain a person
 * or pet, but a naive pass spends 67% of its time on hours where nothing
 * happened before reaching the last day.
 *
 * Prioritising by what the ledger already knows means the interesting content
 * lands across the WHOLE timeline first, and the quiet hours backfill behind it.
 *
 * Pure functions over ledger records.
 *
 * @module 2_domains/camera/hourSelection
 */

const STRONG = ['person', 'visitor', 'pet'];

/**
 * Priority tiers, cheapest-and-most-valuable first.
 *
 * `density` records are excluded from the detection tiers: they are the NVR's
 * bitrate timeline, present for every hour of every day, so counting them would
 * mark all 24 hours as "having detections" and defeat the prioritisation.
 */
export const HOUR_TIERS = ['person', 'detections', 'all'];

/**
 * Hours (0-23) matching a tier.
 *
 * @param {Array<Object>} ledger - records for one camera-day
 * @param {'person'|'detections'|'all'} tier
 * @returns {number[]} sorted hour indices
 */
export function hoursForTier(ledger, tier) {
  if (tier === 'all') return Array.from({ length: 24 }, (_, i) => i);

  const hours = new Set();
  for (const rec of ledger ?? []) {
    if (rec.source === 'density') continue;
    const labels = rec.labels ?? [];
    if (tier === 'person' && !labels.some((l) => STRONG.includes(l))) continue;
    const start = new Date(rec.ts);
    const end = new Date(rec.endTs ?? rec.ts);
    // A detection spanning an hour boundary makes both hours interesting.
    for (let h = start.getHours(); h <= Math.min(23, end.getHours()); h++) hours.add(h);
    if (end < start) hours.add(start.getHours());
  }
  return [...hours].sort((a, b) => a - b);
}

/**
 * Hours still to do for a tier, given what previous passes completed.
 *
 * @param {Array<Object>} ledger
 * @param {string} tier
 * @param {number[]} [done] - hours already materialised
 */
export function pendingHours(ledger, tier, done = []) {
  const complete = new Set(done);
  return hoursForTier(ledger, tier).filter((h) => !complete.has(h));
}

/**
 * Does a segment belong to any of the wanted hours?
 *
 * Segments are ~1h but not clock-aligned (a real day had one running
 * 05:59:59-06:35:56), so a segment is wanted if ANY hour it covers is wanted —
 * otherwise boundary-straddling segments would be skipped and leave holes.
 */
export function segmentWanted(segment, wantedHours) {
  const wanted = new Set(wantedHours);
  const first = segment.start.getHours();
  const last = segment.end.getHours();
  for (let h = first; h <= Math.max(first, last); h++) {
    if (wanted.has(h)) return true;
  }
  return false;
}

/** Hours a segment covers, for recording completion. */
export function hoursCovered(segment) {
  const out = [];
  for (let h = segment.start.getHours(); h <= Math.max(segment.start.getHours(), segment.end.getHours()); h++) {
    out.push(h);
  }
  return out;
}
