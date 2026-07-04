// loopQuery — pure filtering + faceting over the loop manifest (brick entries).
// Powers the browse surface in Producer/Playalong. No DOM.

import { roleOf } from './layerMatch.mjs';

const has = (arr, v) => Array.isArray(arr) && arr.some((x) => String(x).toLowerCase() === String(v).toLowerCase());

/**
 * Filter bricks by any combination of role / genre / emotion / quality / free
 * text (AND). Array fields (genre/emotion/tags) match by membership.
 * @param {object[]} loops manifest entries
 * @param {{role?:string, genre?:string, emotion?:string, quality?:string, text?:string}} filters
 */
export function queryLoops(loops, filters = {}) {
  const { role, genre, emotion, quality, text } = filters;
  const needle = text ? text.toLowerCase() : null;
  return loops.filter((l) => {
    if (role && roleOf(l) !== role) return false;
    if (genre && !has(l.genre, genre)) return false;
    if (emotion && !has(l.emotion, emotion)) return false;
    if (quality && (l.quality || '').toLowerCase() !== quality.toLowerCase()) return false;
    if (needle) {
      const hay = [l.title, l.slug, l.artist, ...(l.tags || [])].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/** Count bricks by role / genre / emotion / quality for building filter chips. */
export function facets(loops) {
  const roles = {}; const genres = {}; const emotions = {}; const qualities = {};
  const bump = (obj, key) => { if (key) obj[key] = (obj[key] || 0) + 1; };
  for (const l of loops) {
    bump(roles, roleOf(l));
    for (const g of l.genre || []) bump(genres, g);
    for (const e of l.emotion || []) bump(emotions, e);
    bump(qualities, l.quality);
  }
  return { roles, genres, emotions, qualities };
}

export default { queryLoops, facets };
