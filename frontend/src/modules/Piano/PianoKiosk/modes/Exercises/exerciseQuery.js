import { DEFAULT_FILTERS } from './filters.js';

/**
 * Turns the browser's filter state into a bank search URL.
 *
 * Kept pure and separate from the view so the query rules — which defaults are
 * omitted, how a level band is expressed — can be tested without a DOM, and so
 * the card game can build the same query without importing a component.
 */
export function buildSearchPath(filters = {}, { limit = 120, offset = 0 } = {}) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const params = new URLSearchParams();
  params.set('mode', f.mode);
  // Only send a bound when it actually narrows anything; a full-range query
  // should read as "everything" in the log, not as a filter that does nothing.
  if (f.levelMin > 1) params.set('level_min', String(f.levelMin));
  if (f.levelMax < 10) params.set('level_max', String(f.levelMax));
  if (f.collection) params.set('collection', f.collection);
  if (f.form) params.set('form', f.form);
  if (f.tradition) params.set('tradition', f.tradition);
  if (f.hands) params.set('hands', f.hands);
  if (f.tags?.length) params.set('tags', f.tags.join(','));
  params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  return `api/v1/piano/bank/search?${params.toString()}`;
}

/** A level band a person would say out loud, for the filter chips. */
export function levelBandLabel(min, max) {
  if (min <= 1 && max >= 10) return 'Any level';
  if (min === max) return `Level ${min}`;
  return `Level ${min}–${max}`;
}

/** Groups a page of instances by their level, so the browser can show bands. */
export function groupByLevel(instances, mode) {
  const groups = new Map();
  for (const instance of instances) {
    const level = instance.level?.[mode];
    if (!Number.isFinite(level)) continue;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(instance);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([level, items]) => ({ level, items }));
}

/**
 * A short human description of what an instance asks for.
 *
 * Built from the axes rather than the title, because the title belongs to the
 * seed and every instance of a seed shares it — "Triads" tells a player nothing
 * about which of the 288 they are being handed.
 */
export function describeInstance(instance) {
  const axes = instance?.axes ?? {};
  const parts = [];
  if (axes.root) parts.push(String(axes.root));
  if (axes.quality) parts.push(String(axes.quality).replace(/-/g, ' '));
  if (axes.mode) parts.push(String(axes.mode).replace(/-/g, ' '));
  if (axes.inversion && axes.inversion !== 'root') parts.push(`${axes.inversion} inv`);
  if (axes.direction && axes.direction !== 'up') parts.push(String(axes.direction).replace(/-/g, ' '));
  if (Number(axes.span_octaves) > 1) parts.push(`${axes.span_octaves} oct`);
  if (axes.pitch !== undefined) parts.push(noteName(Number(axes.pitch)));
  return parts.join(' · ') || instance?.title || instance?.id || '';
}

/** Human-friendly local search across the authored seed card's visible meaning. */
export function matchesExerciseSearch(seed, query) {
  const terms = String(query ?? '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = [seed?.title, seed?.subtitle, seed?.focus, seed?.form, seed?.category, ...(seed?.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export function noteName(midi) {
  if (!Number.isFinite(midi)) return '';
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
