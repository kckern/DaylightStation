// pianoMenuActivityModel.js — time formatting + remembered-shape persistence
// for PianoMenuActivity.jsx, split out so Fast Refresh can hot-reload the
// activity strip on its own.

/** "just now" / "Nm ago" / "Nh ago" / "Nd ago" — coarse by design. */
export function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const mins = Math.floor(Math.max(0, now - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Remembered silhouette ───────────────────────────────────────────────────
// The strip's height and card count are entirely data-driven, so a cold load
// used to render nothing and then shove the tile grid down when the fetch
// landed. We remember the shape of the last strip this kiosk drew — the course
// count of each player card, in order — and reserve exactly that geometry with
// skeletons while loading. localStorage (not the IndexedDB list cache) because
// the reservation has to be there on the FIRST paint, before any async read.
const SHAPE_KEY = 'piano.menu-activity.shape';
const DEFAULT_SHAPE = [2, 2, 2]; // first visit ever: a plausible, modest row
const MAX_COURSES = 4;

/** Course-counts of the last strip drawn here, or a modest default. */
export function readShape() {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(SHAPE_KEY));
    if (Array.isArray(raw) && raw.every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_COURSES)) {
      return raw; // [] is meaningful: last visit had no players → reserve nothing
    }
  } catch { /* unparseable / no storage → default */ }
  return DEFAULT_SHAPE;
}

/** Record the shape just rendered so the next cold load reserves it. */
export function writeShape(players) {
  try {
    const shape = players.map((p) => Math.min(MAX_COURSES, (p.courses || []).length));
    globalThis.localStorage?.setItem(SHAPE_KEY, JSON.stringify(shape));
  } catch { /* private mode / quota → skeletons just fall back to the default */ }
}
