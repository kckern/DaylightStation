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
