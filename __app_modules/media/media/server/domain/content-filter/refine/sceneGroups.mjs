/**
 * Candidate scenes: runs of tagged visual cues close together. A run counts
 * when it spans at least MIN_SPAN_SEC or holds at least MIN_TAGS tags. These
 * are candidates only; refine finds the real scene edges and Jev the level.
 */
export const GAP_SEC = 20;
export const MIN_SPAN_SEC = 15;
export const MIN_TAGS = 3;

/** @returns {Array<{ in: number, out: number, cues: string[], categories: string[] }>} */
export function groupScenes(cues, { gap = GAP_SEC, minSpan = MIN_SPAN_SEC, minTags = MIN_TAGS } = {}) {
  const seen = new Set();
  const vis = cues
    .filter((c) => c.type !== 'mute' && !String(c.category || '').startsWith('credits') && !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => a.in - b.in);
  const runs = [];
  for (const c of vis) {
    const cur = runs[runs.length - 1];
    if (cur && c.in - cur.out < gap) { cur.out = Math.max(cur.out, c.out); cur.list.push(c); } else runs.push({ in: c.in, out: c.out, list: [c] });
  }
  return runs
    .filter((r) => r.out - r.in >= minSpan || r.list.length >= minTags)
    .map((r) => ({ in: r.in, out: r.out, cues: r.list.map((c) => c.id), categories: [...new Set(r.list.map((c) => c.category))] }));
}
