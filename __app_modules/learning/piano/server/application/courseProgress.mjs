// courseProgress.mjs
// Pure helpers backing the course progress aggregate (GET /piano/courses/progress).
// Kept side-effect-free so the recency window, reference exclusion, and ranking
// rules are unit-testable without Plex or the filesystem.

const stripPlex = (id) => String(id ?? '').replace(/^plex:/i, '');

/**
 * Remove reference/practice units from a course's lecture items so they don't
 * count toward completed/total. A `videos.reference_units` rule matches a course
 * by id (ignoring the `plex:` prefix); an item is excluded when its `parentId`
 * is in `unitIds` or its parentTitle/label matches any `titlePatterns` entry
 * (case-insensitive substring).
 */
export function excludeReferenceUnits(items, courseId, referenceUnits = []) {
  if (!Array.isArray(items)) return [];
  const rule = (referenceUnits || []).find((r) => stripPlex(r.courseId) === stripPlex(courseId));
  if (!rule) return items;
  const patterns = (rule.titlePatterns || []).map((p) => String(p).toLowerCase());
  const unitIds = new Set((rule.unitIds || []).map(String));
  return items.filter((it) => {
    if (unitIds.has(String(it.parentId))) return false;
    const hay = `${it.parentTitle || ''} ${it.label || it.title || ''}`.toLowerCase();
    return !patterns.some((p) => p && hay.includes(p));
  });
}

/** True when `lastPlayedAt` falls within `recencyDays` of `now`. */
export function isRecent(lastPlayedAt, recencyDays, now) {
  if (!lastPlayedAt) return false;
  const then = new Date(lastPlayedAt).getTime();
  if (!Number.isFinite(then)) return false;
  const windowMs = Math.max(0, recencyDays) * 24 * 60 * 60 * 1000;
  return now.getTime() - then <= windowMs;
}

/** Sort users by completed desc, tie-broken by most-recent play, then cap to `max`. */
export function rankAndCapUsers(users, max) {
  const sorted = [...(users || [])].sort((a, b) => {
    if (b.completed !== a.completed) return b.completed - a.completed;
    return String(b.lastPlayedAt || '').localeCompare(String(a.lastPlayedAt || ''));
  });
  const cap = Number.isFinite(max) && max > 0 ? max : sorted.length;
  return sorted.slice(0, cap);
}
