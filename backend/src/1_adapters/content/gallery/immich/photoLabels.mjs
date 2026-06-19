// photoLabels.mjs — shared, pure presentation helpers for Immich photos.
//
// Single source of truth for how an Immich photo is described in human terms:
// who's in it, where/when it was taken, and a full readable capture date. Used
// by both the Feed (ImmichFeedAdapter) and the art screensaver (art/sources/
// immichSource) so the two never drift. No I/O, no dependencies — just strings.
//
// TIMEZONE CONTRACT: the date helpers expect Immich's `localDateTime` — the
// wall-clock time at the place the photo was taken, which Immich serializes with
// a trailing `Z` even though it is NOT UTC. We therefore read it with getUTC*
// getters so the wall-clock is rendered verbatim, independent of the server's
// timezone. (Reading it with local getters re-applies the server offset and a
// 10am photo on a UTC-7 host prints as 3am — the bug this contract prevents.)
// Do NOT pass `dateTimeOriginal`/`fileCreatedAt` here: those are true UTC
// instants and would render shifted.

const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Largest group photos get a runaway placard, so cap the named people and roll the
// rest into "and N others".
const MAX_NAMES = 5;

// Names → "A", "A and B", "A, B, and C". Beyond MAX_NAMES, the first five are named
// and the remainder collapses: "A, B, C, D, E, and 11 others".
export function formatPeopleList(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length <= MAX_NAMES) {
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  }
  const others = names.length - MAX_NAMES;
  return `${names.slice(0, MAX_NAMES).join(', ')}, and ${others} other${others === 1 ? '' : 's'}`;
}

// EXIF orientation → how to project a RAW face-box center onto a horizontal sort
// key in DISPLAY space. Immich face boxes are in raw sensor pixels (face.imageWidth/
// Height), so for a quarter-turn orientation raw-X runs vertically on screen and we
// must use raw-Y instead. Only relative order matters, so signs count but offsets
// don't. Orientation values: 1 normal, 2 mirror-H, 3 180°, 4 mirror-V, 5 transpose,
// 6 90°CW, 7 transverse, 8 90°CCW.
//
// Accepts both face shapes the codebase produces: the raw Immich client shape
// (`boundingBoxX1`…) and ImmichAdapter's curated shape (`x1`…, the contract the
// frontend ImageFrame reads). `??` (not `||`) so a legitimate 0 coordinate isn't
// discarded.
function faceSortKey(face, orientation) {
  const cx = (Number(face.boundingBoxX1 ?? face.x1) + Number(face.boundingBoxX2 ?? face.x2)) / 2;
  const cy = (Number(face.boundingBoxY1 ?? face.y1) + Number(face.boundingBoxY2 ?? face.y2)) / 2;
  const w = Number(face.imageWidth) || 0;
  const h = Number(face.imageHeight) || 0;
  switch (Number(orientation)) {
    case 2: case 3: return w - cx;   // horizontal flip / 180° → x reads right-to-left
    case 5: case 8: return cy;       // transpose / 90° CCW → raw-Y becomes display-X
    case 6: case 7: return h - cy;   // 90° CW / transverse → inverted raw-Y is display-X
    default:        return cx;       // 1, 4, or missing → raw-X is display-X
  }
}

// People ordered left-to-right by the horizontal center of their (leftmost) face,
// projected into display space via the photo's EXIF orientation — so a placard's
// names read in the same order the faces appear in the picture. People with no face
// box sort last, keeping Immich's original order among themselves. Returns the
// people objects reordered (the caller maps to names).
export function orderPeopleByFace(people, orientation) {
  const keyFor = (p) => {
    const faces = Array.isArray(p?.faces) ? p.faces : [];
    if (!faces.length) return null;
    return Math.min(...faces.map((f) => faceSortKey(f, orientation)));
  };
  return [...(people || [])]
    .map((p, i) => ({ p, i, k: keyFor(p) }))
    .sort((a, b) => {
      if (a.k == null && b.k == null) return a.i - b.i;
      if (a.k == null) return 1;
      if (b.k == null) return -1;
      return a.k - b.k || a.i - b.i;
    })
    .map((e) => e.p);
}

// Coarse part-of-day for an ISO timestamp; null if the date is unparseable.
export function getTimeOfDayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getUTCHours();
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
  return `${DAYS_LONG[d.getUTCDay()]} ${getTimeOfDayLabel(iso)}`;
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
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm = d.getUTCHours() >= 12 ? 'pm' : 'am';
  const hours = d.getUTCHours() % 12 || 12;
  return `${DAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}, ${d.getUTCFullYear()} ${hours}:${mins}${ampm}`;
}
