// photoLabels.mjs — shared, pure presentation helpers for Immich photos.
//
// Single source of truth for how an Immich photo is described in human terms:
// who's in it, where/when it was taken, and a full readable capture date. Used
// by both the Feed (ImmichFeedAdapter) and the art screensaver (art/sources/
// immichSource) so the two never drift. No I/O, no dependencies — just strings.

const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Names → "A", "A and B", "A, B, and C".
export function formatPeopleList(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

// Coarse part-of-day for an ISO timestamp; null if the date is unparseable.
export function getTimeOfDayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  if (h < 6) return 'Late Night';
  if (h < 9) return 'Morning';
  if (h < 11) return 'Mid-Morning';
  if (h < 13) return 'Lunchtime';
  if (h < 17) return 'Afternoon';
  if (h < 21) return 'Evening';
  return 'Night';
}

// "Sunday Afternoon" — weekday + part-of-day, for when there's no place/people.
export function formatDayPeriod(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Memory';
  return `${DAYS_LONG[d.getDay()]} ${getTimeOfDayLabel(iso)}`;
}

// The headline line: who's pictured + where, else a sense of when/where, never
// empty. The date is rendered separately, so it's deliberately omitted here.
export function buildPhotoTitle(people, location, created) {
  const names = (people || []).filter((n) => n && n.trim());
  if (names.length > 0) {
    const parts = [formatPeopleList(names)];
    if (location) parts.push(location);
    return parts.join(' • ');
  }
  if (location && created) {
    const period = getTimeOfDayLabel(created);
    return period ? `${period} in ${location}` : location;
  }
  if (location) return location;
  return created ? formatDayPeriod(created) : 'Memory';
}

// The full, human-readable capture date + time, e.g. "Sat 15 Jun, 2025 10:00am".
// Null for a missing date; "Memory" for an unparseable one.
export function formatPhotoDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Memory';
  const mins = String(d.getMinutes()).padStart(2, '0');
  const ampm = d.getHours() >= 12 ? 'pm' : 'am';
  const hours = d.getHours() % 12 || 12;
  return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${d.getFullYear()} ${hours}:${mins}${ampm}`;
}
