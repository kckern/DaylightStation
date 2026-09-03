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
