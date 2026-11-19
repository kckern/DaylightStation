// systemPaging.js — the Learn score as pages of whole systems.
//
// The Learn score never scrolls: a window shorter than the piece would always
// slice a staff at its edge. It shows as many whole systems as fit and turns to
// the next ones. Everything here is plain geometry in the engraving's own
// coordinates, so it can be tested without a browser.

/** One entry per engraved system, top to bottom, from the measure rectangles. */
export function engravedSystems(measureRects = []) {
  const bySystem = new Map();
  measureRects.forEach((rect, index) => {
    if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) return;
    const key = rect.system ?? 0;
    const entry = bySystem.get(key) || { system: key, top: Infinity, bottom: -Infinity, firstMeasure: index, lastMeasure: index };
    entry.top = Math.min(entry.top, rect.top);
    entry.bottom = Math.max(entry.bottom, rect.bottom);
    entry.firstMeasure = Math.min(entry.firstMeasure, index);
    entry.lastMeasure = Math.max(entry.lastMeasure, index);
    bySystem.set(key, entry);
  });
  return [...bySystem.values()].sort((a, b) => a.top - b.top);
}

/** Merge [top, bottom] intervals into a sorted list with no overlaps. */
function mergeIntervals(intervals) {
  const sorted = intervals.filter((item) => item && item[1] > item[0]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [top, bottom] of sorted) {
    const last = merged[merged.length - 1];
    if (last && top <= last[1]) last[1] = Math.max(last[1], bottom);
    else merged.push([top, bottom]);
  }
  return merged;
}

/**
 * Where to cut between systems: `cuts[i]` is the line above system `i`, and
 * `cuts[systems.length]` the line under the last one. A cut falls in the middle
 * of the widest strip between two systems that carries no ink (a pedal bracket
 * under one staff, a tempo mark or passage number over the next), so a page
 * never shows a sliver of its neighbour.
 *
 * @param {Array} systems - from `engravedSystems`
 * @param {number} height - the engraving's height
 * @param {Array<[number, number]>} ink - occupied [top, bottom] strips
 */
export function systemCuts(systems = [], height = 0, ink = []) {
  if (!systems.length) return [];
  // Something that runs through a whole gap is a frame, not a system's ink.
  const frames = (item) => systems.some((system, i) => i > 0 && systems[i - 1].bottom < system.top
    && item[0] <= systems[i - 1].bottom && item[1] >= system.top);
  const merged = mergeIntervals(ink.filter((item) => item && !frames(item)));
  const first = merged.length ? Math.min(merged[0][0], systems[0].top) : 0;
  const last = merged.length ? Math.max(merged[merged.length - 1][1], systems[systems.length - 1].bottom) : height;
  const cuts = [Math.max(0, first)];
  for (let i = 1; i < systems.length; i++) {
    const from = systems[i - 1].bottom;
    const to = systems[i].top;
    if (!(to > from)) { cuts.push((from + to) / 2); continue; }
    // The free strips of [from, to] once the ink is taken out.
    let cursor = from;
    let best = null;
    const consider = (a, b) => { if (b > a && (!best || b - a > best[1] - best[0])) best = [a, b]; };
    for (const [top, bottom] of merged) {
      if (bottom <= from || top >= to) continue;
      consider(cursor, Math.min(top, to));
      cursor = Math.max(cursor, bottom);
    }
    consider(cursor, to);
    cuts.push(best ? (best[0] + best[1]) / 2 : (from + to) / 2);
  }
  cuts.push(Math.max(cuts[cuts.length - 1], height > 0 ? Math.min(height, last) : last));
  return cuts;
}

const count = (cuts) => Math.max(0, cuts.length - 1);

/** The first system after the window that starts at `start`. Always at least one system. */
export function windowEnd(cuts, start, viewport) {
  const total = count(cuts);
  let end = Math.min(total, start + 1);
  while (end < total && cuts[end + 1] - cuts[start] <= viewport) end++;
  return end;
}

/** The latest start whose window reaches the end of the piece: the last page is a full one. */
export function lastStart(cuts, viewport) {
  const total = count(cuts);
  let start = Math.max(0, total - 1);
  while (start > 0 && cuts[total] - cuts[start - 1] <= viewport) start--;
  return start;
}

/** The fixed pages of the piece, as the system each one starts at. */
export function pageStops(cuts, viewport) {
  const total = count(cuts);
  if (!total) return [];
  const final = lastStart(cuts, viewport);
  const stops = [];
  let start = 0;
  while (start < final) { stops.push(start); start = windowEnd(cuts, start, viewport); }
  stops.push(final);
  return stops;
}

/** The page on screen: which systems, where to cut, and how far to move the engraving. */
export function pageAt(cuts, start, viewport) {
  const total = count(cuts);
  if (!total) return null;
  const from = Math.min(Math.max(0, start), lastStart(cuts, viewport));
  const end = windowEnd(cuts, from, viewport);
  const top = cuts[from];
  const bottom = cuts[end];
  // Centred in the window; a system taller than the window starts at its top.
  const shift = Math.round(Math.max(0, (viewport - (bottom - top)) / 2) - top);
  const stops = pageStops(cuts, viewport);
  let index = 0;
  stops.forEach((stop, i) => { if (stop <= from) index = i; });
  return { start: from, end, top, bottom, shift, index, pages: stops.length, hasPrev: from > 0, hasNext: end < total };
}

export function nextStart(cuts, start, viewport) {
  return Math.min(windowEnd(cuts, start, viewport), lastStart(cuts, viewport));
}

export function prevStart(cuts, start, viewport) {
  let from = Math.max(0, start - 1);
  while (from > 0 && cuts[start] - cuts[from - 1] <= viewport) from--;
  return from;
}

/**
 * The page that shows systems `first`..`last` whole. It stays where it is when
 * they are already on screen, prefers a fixed page that holds them all, and
 * otherwise starts at the first of them.
 */
export function startForSystems(cuts, viewport, current, first, last) {
  const holds = (start) => start <= first && windowEnd(cuts, start, viewport) > last;
  if (holds(current)) return current;
  const stop = pageStops(cuts, viewport).find(holds);
  if (stop != null) return stop;
  return Math.min(first, lastStart(cuts, viewport));
}

export default { engravedSystems, systemCuts, pageAt, pageStops, nextStart, prevStart, startForSystems, windowEnd, lastStart };
