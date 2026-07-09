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

const courseKeyOf = (it) => (it?.piano?.course) || splitCoursePrefix(it?.title) || 'Course';

export function partitionCourses(seasonItems) {
  const items = (seasonItems || []).slice().sort((a, b) => (Number(a?.itemIndex) || 0) - (Number(b?.itemIndex) || 0));
  const groups = new Map();
  const order = [];
  for (const it of items) {
    const key = courseKeyOf(it);
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(it);
  }
  return order.map((label, i) => ({ floor: i + 1, label, lessons: groups.get(label) }));
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
    piano: p?.piano || null,
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
      const ordered = [...c.lessons].sort((a, b) => (Number(a?.itemIndex) || 0) - (Number(b?.itemIndex) || 0));
      const next = ordered.find((ep) => !lectureUserStatus(ep).watched);
      if (next) return { seasonId: s.id, floor: c.floor, lesson: next };
    }
  }
  return null;
}

/** The content category for a season: from season.piano.category, else reference-flag → 'reference', else 'lesson'. */
export function categoryOf(season) {
  const c = season?.piano?.category;
  if (c) return c;
  return season?.reference ? 'reference' : 'lesson';
}

/** Collect the available repertoire facet values across items (from item.piano). */
export function collectFacets(items) {
  const styles = new Set(); const skills = new Set(); const instructors = new Set();
  for (const it of items || []) {
    const p = it?.piano || {};
    (p.styles || []).forEach((s) => styles.add(s));
    if (p.skill) skills.add(p.skill);
    if (p.instructor) instructors.add(p.instructor);
  }
  return { styles: [...styles].sort(), skills: [...skills].sort(), instructors: [...instructors].sort() };
}

/** Filter items by selected facets ({ style?, skill?, instructor? }); styles match by membership. */
export function filterByFacets(items, sel = {}) {
  const { style, skill, instructor } = sel;
  return (items || []).filter((it) => {
    const p = it?.piano || {};
    if (style && !(p.styles || []).includes(style)) return false;
    if (skill && p.skill !== skill) return false;
    if (instructor && p.instructor !== instructor) return false;
    return true;
  });
}
