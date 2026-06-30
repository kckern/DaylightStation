// loopQuery — pure filtering + faceting over the loop library (index.yml
// entries). Powers the browse surface in Producer/Playalong. No DOM.

import { roleOf } from './layerMatch.mjs';

/**
 * Filter loops by any combination of role / mood / source / free text (AND).
 * @param {object[]} loops index entries
 * @param {{role?:string, mood?:string, source?:string, text?:string}} filters
 */
export function queryLoops(loops, filters = {}) {
  const { role, mood, source, text } = filters;
  const needle = text ? text.toLowerCase() : null;
  return loops.filter((l) => {
    if (role && roleOf(l) !== role) return false;
    if (mood && (l.mood || '').toLowerCase() !== mood.toLowerCase()) return false;
    if (source && !(l.sources || []).includes(source)) return false;
    if (needle) {
      const hay = [l.slug, l.descriptor, l.artist, ...(l.chords || [])].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/** Count loops by role / mood / source for building filter chips. */
export function facets(loops) {
  const roles = {}; const moods = {}; const sources = {};
  for (const l of loops) {
    const r = roleOf(l);
    roles[r] = (roles[r] || 0) + 1;
    if (l.mood) moods[l.mood] = (moods[l.mood] || 0) + 1;
    for (const s of l.sources || []) sources[s] = (sources[s] || 0) + 1;
  }
  return { roles, moods, sources };
}

export default { queryLoops, facets };
