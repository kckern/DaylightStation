/**
 * Merge refine results into a title's override, and list what was not settled.
 *
 * Rules:
 * - A refined cue writes `cueOverrides[id]` with in/out (media seconds), its
 *   precision, segments (when more than one), region track, and a `refine`
 *   stamp binding it to the media part.
 * - A cue override WITHOUT a `refine` stamp is manual (or an older tool's)
 *   work and is never replaced; the result goes to the review list instead.
 * - Keys a person may set on an override (disabled, effect, nudgeMs, …) are
 *   kept when a refined entry is replaced.
 * - Cues that end unknown or giveup leave existing entries alone and go to
 *   the review list.
 */

const REFINE_KEYS = ['in', 'out', 'precision', 'frameIn', 'frameOut', 'segments', 'regions', 'refine'];

/**
 * @param {object|null} override - current override document
 * @param {Array<object>} results - CueRefiner results
 * @param {{ part: string|number, at: string, version?: number }} stamp
 * @returns {{ override: object, review: Array<object>, counts: object }}
 */
export function mergeRefine(override, results, { part, at, version = 1 }) {
  const doc = { ...(override || {}) };
  const cueOverrides = { ...(doc.cueOverrides || {}) };
  const review = [];
  const counts = { written: 0, keptManual: 0, unknown: 0, giveup: 0, region: 0 };

  for (const r of results) {
    if (r.status === 'region') {
      // Edges unsure, region tracked: the cue keeps its coarse times and gains the track.
      // Never replaces a measured cue (refined or manual); edges still go to review.
      const prev = cueOverrides[r.id];
      const regions = regionsOf(r);
      review.push({ ...reviewItem(r), status: 'coarse-edges' });
      if (!regions || (prev && (prev.in != null || prev.out != null))) { counts.unknown++; continue; }
      const kept = {};
      for (const [k, v] of Object.entries(prev || {})) if (!REFINE_KEYS.includes(k)) kept[k] = v;
      cueOverrides[r.id] = { ...kept, regions, refine: { v: version, part: String(part), at, edges: 'coarse' } };
      counts.region++;
      continue;
    }
    if (r.status !== 'refined') {
      counts[r.status === 'giveup' ? 'giveup' : 'unknown']++;
      review.push(reviewItem(r));
      continue;
    }
    const prev = cueOverrides[r.id];
    if (prev && !prev.refine && (prev.in != null || prev.out != null)) {
      counts.keptManual++;
      review.push({ ...reviewItem(r), status: 'kept-manual', proposed: { in: r.in, out: r.out } });
      continue;
    }
    const kept = {};
    for (const [k, v] of Object.entries(prev || {})) if (!REFINE_KEYS.includes(k)) kept[k] = v;
    const entry = { ...kept, in: r.in, out: r.out, precision: r.precision };
    if (r.precision === 'frame') { entry.frameIn = r.frameIn; entry.frameOut = r.frameOut; }
    if (r.segments?.length > 1) entry.segments = r.segments.map((s) => ({ in: s.in, out: s.out }));
    const regions = regionsOf(r);
    if (regions) entry.regions = regions;
    entry.refine = { v: version, part: String(part), at, ...(r.conf != null ? { conf: round2(r.conf) } : {}), ...(r.how ? { how: r.how } : {}) };
    cueOverrides[r.id] = entry;
    counts.written++;
  }
  doc.cueOverrides = cueOverrides;
  return { override: doc, review, counts };
}

/** A cue's region keyframes across its segments, or null when every segment is whole-frame. */
function regionsOf(r) {
  const tracks = (r.segments || []).map((s) => s.region).filter(Boolean);
  if (!tracks.length || tracks.every((t) => t.whole)) return null;
  const keys = [];
  for (const s of r.segments) {
    const t = s.region;
    if (!t || t.whole) { keys.push({ in: s.in, whole: true }, { in: s.out, cells: [] }); continue; }
    keys.push(...t.track);
  }
  return keys;
}

function reviewItem(r) {
  return {
    id: r.id,
    status: r.status,
    kind: r.kind,
    reason: r.reason || null,
    ...(r.estimate ? { estimate: r.estimate } : {}),
    ...(r.expected != null ? { expected: r.expected } : {}),
    steps: (r.path || []).map((p) => p.step + (p.action ? `:${p.action}` : '') + (p.reason ? `(${p.reason})` : '')),
    decision: null,
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
