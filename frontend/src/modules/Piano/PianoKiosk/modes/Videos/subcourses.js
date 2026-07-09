// subcourses.js — pure helpers for "subcourses" multi-course shows.
// A subcourses show (Plex label `subcourses`) numbers episodes CNN: the hundreds
// digit is the COURSE within a season, the last two digits the LESSON within it.
import { lectureUserStatus } from './lectureMeta.js';

export function isSubcourseShow(info) {
  const labels = info?.labels;
  if (!Array.isArray(labels)) return false;
  return labels.some((l) => String(l).toLowerCase() === 'subcourses');
}

export const keyOf = (item) => String(item?.plex || item?.id || '');

export function floorOf(item) {
  const n = Number(item?.itemIndex);
  if (!Number.isFinite(n) || n < 100) return null;
  return Math.floor(n / 100);
}

export function roomOf(item) {
  const n = Number(item?.itemIndex);
  return Number.isFinite(n) ? n % 100 : Infinity;
}

export function splitCoursePrefix(title) {
  if (typeof title !== 'string') return null;
  const parts = title.split(/\s+[–—-]\s+/);
  return parts.length > 1 ? parts[0].trim() : null;
}

export function deriveCourseLabel(lessons, floor) {
  const prefixes = (lessons || []).map((l) => splitCoursePrefix(l?.title));
  const first = prefixes[0];
  if (first && prefixes.every((p) => p === first)) return first;
  return `Course ${floor}`;
}

export function partitionCourses(seasonItems) {
  const groups = new Map();
  for (const it of seasonItems || []) {
    const f = floorOf(it) ?? 0;
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(it);
  }
  return [...groups.keys()].sort((a, b) => a - b).map((floor) => {
    const lessons = groups.get(floor).slice().sort((a, b) => roomOf(a) - roomOf(b));
    return { floor, label: deriveCourseLabel(lessons, floor), lessons };
  });
}

export function partitionSeasons(items, parents, referenceUnitIds = []) {
  if (!parents || typeof parents !== 'object') return [];
  const refSet = new Set((referenceUnitIds || []).map(String));
  const seasons = Object.entries(parents).map(([id, p]) => ({
    id: String(id),
    index: Number.isFinite(p?.index) ? p.index : (parseInt(p?.index, 10) || 0),
    title: p?.title || null,
    thumbnail: p?.thumbnail || null,
    reference: refSet.has(String(id)),
  })).sort((a, b) => a.index - b.index);
  return seasons.map((s) => {
    const lessons = (items || []).filter((it) => String(it.parentId) === s.id);
    const courses = partitionCourses(lessons).map((c) => ({ ...c, reference: s.reference }));
    return { ...s, lessons, courses };
  });
}

export function progressOf(items) {
  const list = items || [];
  const watched = list.filter((it) => lectureUserStatus(it).watched).length;
  return { watched, total: list.length };
}

export function courseGate(sortedLessons) {
  const lockedIds = new Set();
  let currentId = null;
  let gateClosed = false;
  for (const ep of sortedLessons || []) {
    const k = keyOf(ep);
    if (gateClosed) { lockedIds.add(k); continue; }
    if (!lectureUserStatus(ep).watched) { currentId = k; gateClosed = true; }
  }
  return { lockedIds, currentId };
}

/**
 * Longest shared leading word-run across sibling course labels → {prefix, tails}.
 * Only fades when the prefix is ≥2 words AND every tail stays non-empty; otherwise
 * prefix is '' and tails are the full labels (so single/oddball seasons don't fade).
 */
export function sharedPrefix(labels) {
  const list = (labels || []).map((l) => String(l || ''));
  if (list.length < 2) return { prefix: '', tails: list };
  const wordLists = list.map((l) => l.split(/\s+/));
  const min = Math.min(...wordLists.map((w) => w.length));
  let n = 0;
  for (let i = 0; i < min; i += 1) {
    const w = wordLists[0][i];
    if (wordLists.every((wl) => wl[i] === w)) n += 1; else break;
  }
  // keep at least one word of tail on every label
  while (n > 0 && wordLists.some((wl) => wl.length <= n)) n -= 1;
  if (n < 2) return { prefix: '', tails: list };
  const prefix = wordLists[0].slice(0, n).join(' ');
  const tails = wordLists.map((wl) => wl.slice(n).join(' '));
  return { prefix, tails };
}

/** Per-course progress from per-user watched flags. */
export function courseStats(course) {
  const { watched, total } = progressOf(course?.lessons || []);
  const complete = total > 0 && watched === total;
  const percent = total > 0 ? Math.round((watched / total) * 100) : 0;
  return { watched, total, complete, percent };
}

/** Per-season progress: complete courses / total (reference seasons are exempt). */
export function seasonStats(season) {
  if (season?.reference) return { reference: true, completeCourses: 0, totalCourses: 0, percent: 0 };
  const courses = season?.courses || [];
  const totalCourses = courses.length;
  const completeCourses = courses.filter((c) => courseStats(c).complete).length;
  const percent = totalCourses > 0 ? Math.round((completeCourses / totalCourses) * 100) : 0;
  return { reference: false, completeCourses, totalCourses, percent };
}

/** Program progress across non-reference seasons. */
export function programStats(seasons) {
  const graded = (seasons || []).filter((s) => !s.reference);
  const totalCourses = graded.reduce((n, s) => n + s.courses.length, 0);
  const completeCourses = graded.reduce((n, s) => n + s.courses.filter((c) => courseStats(c).complete).length, 0);
  const percent = totalCourses > 0 ? Math.round((completeCourses / totalCourses) * 100) : 0;
  return { completeCourses, totalCourses, percent };
}

/**
 * The resume target: the first not-yet-watched lesson in linear order
 * (season index → floor → room), skipping reference seasons. Null when the whole
 * graded program is complete.
 */
export function continueTarget(seasons) {
  for (const s of (seasons || []).filter((x) => !x.reference)) {
    for (const c of s.courses) {
      const ordered = [...c.lessons].sort((a, b) => roomOf(a) - roomOf(b));
      const next = ordered.find((ep) => !lectureUserStatus(ep).watched);
      if (next) return { seasonId: s.id, floor: c.floor, lesson: next };
    }
  }
  return null;
}
