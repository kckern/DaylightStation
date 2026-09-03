export const BUCKETS = [
  { id: 'morning',   label: 'Breakfast' },
  { id: 'afternoon', label: 'Lunch' },
  { id: 'evening',   label: 'Dinner' },
  { id: 'night',     label: 'Snacks' },
];
export const UNGROUPED = { id: null, label: 'Ungrouped' };

/**
 * Today's date as YYYY-MM-DD in the browser's LOCAL timezone.
 * `new Date().toISOString()` is UTC — in this household's timezone
 * (UTC-7/8) that reads as tomorrow every evening after ~5pm. Build the
 * string from local date components instead (same pattern as
 * CoachingComplianceCard.jsx's todayISO).
 */
export function localTodayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Best-effort guess at which bucket a NEW entry submitted right now will
 * land in — mirrors the backend's own hour classification
 * (`getMealTimeFromHour` in backend/src/2_domains/nutrition/entities/schemas.mjs).
 * Client-side use ONLY: it drives where the in-place "Analyzing…" capture
 * placeholder appears while an AI capture is in flight. The backend's
 * classification at write time is the real source of truth for where the
 * row actually ends up — a mismatch here would only misplace a transient
 * placeholder for a few seconds, never the committed row.
 */
export function currentMealBucketId(d = new Date()) {
  const hour = d.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/**
 * Hour -> bucket default for the global QuickCaptureBar (Task 4.3).
 *
 * DELIBERATE DIVERGENCE from `currentMealBucketId` above: this codebase
 * already has TWO disagreeing hour->meal mappings server-side —
 * `getMealTimeFromHour` (backend/src/2_domains/nutrition/entities/schemas.mjs:
 * 5-12 morning / 12-17 afternoon / 17-21 evening / else night) and
 * `SavedMealsService`'s local `mealTimeFromHour`
 * (backend/src/3_applications/health/SavedMealsService.mjs:
 * <11 morning / <15 afternoon / <20 evening / else night). This function
 * matches **SavedMealsService's** thresholds, NOT `getMealTimeFromHour`'s
 * (which `currentMealBucketId` above already mirrors) — chosen because
 * SavedMealsService is the write path closest in spirit to what the bar
 * does here (defaulting a *new, undated* log's meal purely from the clock,
 * with no other signal), whereas `getMealTimeFromHour` backs the
 * request-time resolver that also considers an explicit bucket/utterance
 * override. Do NOT invent a third mapping — if these two ever need to
 * converge, fix it in both call sites, not by adding a fourth definition
 * here.
 */
export const bucketForHour = (h) => (h < 11 ? 'morning' : h < 15 ? 'afternoon' : h < 20 ? 'evening' : 'night');

/** Meal label for a bucket id (e.g. 'afternoon' -> 'Lunch') — falls back to
 * the raw id if it's somehow not one of the four known buckets. */
export function bucketLabel(id) {
  return BUCKETS.find((b) => b.id === id)?.label || id;
}
