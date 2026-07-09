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

export function partitionSeasons(items, parents) {
  if (!parents || typeof parents !== 'object') return [];
  const seasons = Object.entries(parents).map(([id, p]) => ({
    id: String(id),
    index: Number.isFinite(p?.index) ? p.index : (parseInt(p?.index, 10) || 0),
    title: p?.title || null,
    thumbnail: p?.thumbnail || null,
  })).sort((a, b) => a.index - b.index);
  return seasons.map((s) => {
    const lessons = (items || []).filter((it) => String(it.parentId) === s.id);
    return { ...s, lessons, courses: partitionCourses(lessons) };
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
