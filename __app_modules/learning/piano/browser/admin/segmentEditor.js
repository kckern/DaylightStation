/**
 * Segment editor state for the admin score page: a pure reducer over
 * `{ segments, measureCount }`. A segment is `{ id, start, end, name?, parts? }` with
 * `start`/`end` inclusive positions in the kiosk's layout.measures. Segments stay sorted
 * by start; no action mutates its input, and a no-op returns the same state object.
 * Ids only need to be stable inside the editor (progress is keyed by bar range).
 */
import { validateSegments } from '../../portable/music/sheetMusicLearnFile.mjs';

const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const byStart = (a, b) => a.start - b.start || a.end - b.end;

/** 0 → a, 25 → z, 26 → aa, 27 → ab … (bijective base 26). */
export function idForIndex(n) {
  let out = '';
  let i = n + 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    out = String.fromCharCode(97 + r) + out;
    i = Math.floor((i - 1) / 26);
  }
  return out;
}

/** The first id in the a, b, … z, aa, ab … sequence not already used. */
export function nextSegmentId(segments) {
  const used = new Set(segments.map((s) => s.id));
  for (let n = 0; ; n += 1) {
    const id = idForIndex(n);
    if (!used.has(id)) return id;
  }
}

function normalizeSegment(raw) {
  const out = { ...raw };
  out.id = typeof raw.id === 'string' ? raw.id.trim() : raw.id;
  if (typeof raw.name === 'string') {
    if (raw.name.trim()) out.name = raw.name.trim();
    else delete out.name;
  }
  return out;
}

function normalizeSegments(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(isObject).map(normalizeSegment).sort(byStart);
}

export function initSegmentEditor({ segments, measureCount } = {}) {
  return { segments: normalizeSegments(segments), measureCount };
}

const withSegments = (state, segments) => ({ ...state, segments: [...segments].sort(byStart) });

function split(state, atBarline) {
  const k = atBarline;
  if (!Number.isInteger(k)) return state;
  const idx = state.segments.findIndex((s) => s.start <= k && k < s.end);
  if (idx < 0) return state;
  const seg = state.segments[idx];
  const left = { ...seg, end: k };
  const right = { id: nextSegmentId(state.segments), start: k + 1, end: seg.end };
  const next = [...state.segments];
  next.splice(idx, 1, left, right);
  return withSegments(state, next);
}

function adjacentPair(state, id) {
  const idx = state.segments.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const left = state.segments[idx];
  const right = state.segments[idx + 1];
  if (!right || left.end + 1 !== right.start) return null;
  return { idx, left, right };
}

function merge(state, id) {
  const pair = adjacentPair(state, id);
  if (!pair) return state;
  const next = [...state.segments];
  next.splice(pair.idx, 2, { ...pair.left, end: pair.right.end });
  return withSegments(state, next);
}

function moveBoundary(state, leftId, newEnd) {
  if (!Number.isInteger(newEnd)) return state;
  const pair = adjacentPair(state, leftId);
  if (!pair) return state;
  const { idx, left, right } = pair;
  const end = Math.min(Math.max(newEnd, left.start), right.end - 1);
  if (end === left.end) return state;
  const next = [...state.segments];
  next.splice(idx, 2, { ...left, end }, { ...right, start: end + 1 });
  return withSegments(state, next);
}

function updateOne(state, id, fn) {
  const idx = state.segments.findIndex((s) => s.id === id);
  if (idx < 0) return state;
  const next = [...state.segments];
  next[idx] = fn({ ...state.segments[idx] });
  return withSegments(state, next);
}

function rename(state, id, name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return updateOne(state, id, (s) => {
    if (trimmed) s.name = trimmed;
    else delete s.name;
    return s;
  });
}

function setParts(state, id, parts) {
  const clean = Array.isArray(parts)
    ? parts.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim())
    : [];
  return updateOne(state, id, (s) => {
    if (clean.length) s.parts = clean;
    else delete s.parts;
    return s;
  });
}

function remove(state, id) {
  if (!state.segments.some((s) => s.id === id)) return state;
  return withSegments(state, state.segments.filter((s) => s.id !== id));
}

function cover(state) {
  const n = state.measureCount;
  if (!Number.isInteger(n) || n < 1) return { ...state, segments: [] };
  return { ...state, segments: [{ id: 'a', start: 0, end: n - 1 }] };
}

export function segmentEditorReducer(state, action) {
  const a = action || {};
  switch (a.type) {
    case 'split': return split(state, a.atBarline);
    case 'merge': return merge(state, a.id);
    case 'moveBoundary': return moveBoundary(state, a.leftId, a.newEnd);
    case 'rename': return rename(state, a.id, a.name);
    case 'replace': return { ...state, segments: normalizeSegments(a.segments) };
    case 'cover': return cover(state);
    case 'remove': return remove(state, a.id);
    case 'setParts': return setParts(state, a.id, a.parts);
    default: return state;
  }
}

/** Sorted measure indices that no segment covers. */
export function uncoveredBars(state) {
  const n = Number.isInteger(state.measureCount) ? state.measureCount : 0;
  const covered = new Array(Math.max(n, 0)).fill(false);
  for (const s of state.segments) {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end)) continue;
    for (let i = Math.max(s.start, 0); i <= Math.min(s.end, n - 1); i += 1) covered[i] = true;
  }
  const out = [];
  covered.forEach((c, i) => { if (!c) out.push(i); });
  return out;
}

/** validateSegments' errors, plus `empty` when there is nothing to approve. */
export function errors(state) {
  const out = validateSegments(state.segments, state.measureCount);
  if (!state.segments.length) out.push({ code: 'empty', id: null, index: -1 });
  return out;
}
