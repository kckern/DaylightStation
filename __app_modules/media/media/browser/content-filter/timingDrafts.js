import { baseId } from './contentFilter.js';

/**
 * Unsaved timing drafts (Admin review: a dragged handle, or I / O) applied to the effective cues,
 * so the preview plays what the grown-up dragged before they save it (owner, 2026-11-22: "I can't
 * hear what I did unless I save the timing"). `drafts` maps a cue id (or its base id) to [in, out].
 * Nothing changes without drafts: the same array comes back.
 *
 * @param {Array<{id:string, in:number, out:number}>} cues
 * @param {Record<string, [number, number]>|null} drafts
 */
export function applyTimingDrafts(cues, drafts) {
  if (!drafts || !Array.isArray(cues)) return cues;
  const keys = Object.keys(drafts).filter((k) => {
    const d = drafts[k];
    return Array.isArray(d) && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[1] > d[0];
  });
  if (!keys.length) return cues;
  return cues.map((c) => {
    const k = keys.find((key) => c.id === key || baseId(c.id) === key);
    return k ? { ...c, in: drafts[k][0], out: drafts[k][1] } : c;
  });
}

export default applyTimingDrafts;
