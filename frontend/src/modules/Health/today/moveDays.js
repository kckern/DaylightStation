// Which days a food can be moved to, and what to call them.
//
// The choices are the week ending today, minus the day being viewed: a food
// that was logged on the wrong day is almost always one or two days off, so the
// nearest days are one tap away and anything older goes through a date picker.
import { localDateISO } from '@shared-contracts/health/isoDate.mjs';

export const DAY_DROP_PREFIX = 'day:';
export const dayDropId = iso => `${DAY_DROP_PREFIX}${iso}`;
export const dayFromDropId = id => (typeof id === 'string' && id.startsWith(DAY_DROP_PREFIX) ? id.slice(DAY_DROP_PREFIX.length) : null);

// Noon keeps the arithmetic clear of any DST edge.
const at = iso => new Date(`${iso}T12:00:00`);
export const addDaysISO = (iso, days) => { const d = at(iso); d.setDate(d.getDate() + days); return localDateISO(d); };

export function dayLabel(iso, today) {
  if (iso === today) return 'Today';
  if (iso === addDaysISO(today, -1)) return 'Yesterday';
  return at(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** The week ending `today`, newest first, without the viewed day. */
export function recentDays(today, viewed, count = 7) {
  return Array.from({ length: count }, (_, index) => addDaysISO(today, -index)).filter(iso => iso !== viewed);
}
