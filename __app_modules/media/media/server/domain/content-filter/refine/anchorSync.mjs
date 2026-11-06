/**
 * Fit one copy's sync from a refined EDL's anchors.
 *
 * matchAnchors: find each anchor word in the copy's transcript. A vote over all
 * same-word candidates gives a coarse offset; each anchor then keeps the
 * candidate near that offset whose transcript line best matches the anchor's.
 *
 * fitSegments: robust linear fit of copy time against VidAngel time. When the
 * offset jumps by more than JUMP_SEC and stays there, the copy's cut differs
 * (a scene added or removed): the sync becomes segments, split midway between
 * the last pair before the jump and the first after it.
 */

const JUMP_SEC = 1.0;
const MIN_SEGMENT_PAIRS = 3;
/** PAL speed-up is 25/23.976 (4.3%); allow a little beyond it. */
const MAX_SCALE_DEV = 0.06;

const norm = (w) => String(w || '').toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
const tokens = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);

/** Share of words two lines have in common (Dice coefficient over word sets). */
export function lineSimilarity(a, b) {
  const A = new Set(tokens(a)); const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let both = 0; for (const t of A) if (B.has(t)) both++;
  return (2 * both) / (A.size + B.size);
}

/**
 * @param {Array<{ t: number, text: string, line?: string }>} anchors - VidAngel time
 * @param {Array<{ w: string, s: number, seg: number }>} words - copy transcript
 * @param {Array<{ id: number, text: string }>} segments - copy transcript lines
 * @param {{ maxShift?: number, near?: number, minLine?: number }} [o]
 * @returns {{ coarse: number|null, pairs: Array<{ x: number, y: number, wi: number }>, matched: number, total: number }}
 */
export function matchAnchors(anchors, words, segments, { maxShift = 120, near = 8, minLine = 0.3 } = {}) {
  const lineOf = new Map((segments || []).map((s) => [s.id, s.text]));
  const byWord = new Map();
  words.forEach((w, i) => { const k = norm(w.w); if (!byWord.has(k)) byWord.set(k, []); byWord.get(k).push(i); });
  const votes = new Map();
  for (const a of anchors) {
    for (const i of byWord.get(norm(a.text)) || []) {
      const d = words[i].s - a.t;
      if (Math.abs(d) <= maxShift) { const b = Math.round(d); votes.set(b, (votes.get(b) || 0) + 1); }
    }
  }
  if (!votes.size) return { coarse: null, pairs: [], matched: 0, total: anchors.length };
  let best = null;
  for (const b of votes.keys()) {
    const score = (votes.get(b - 1) || 0) + votes.get(b) + (votes.get(b + 1) || 0);
    if (!best || score > best.score) best = { b, score };
  }
  const coarse = best.b;
  const pairs = [];
  for (const a of anchors) {
    const cands = (byWord.get(norm(a.text)) || []).filter((i) => Math.abs(words[i].s - (a.t + coarse)) <= near);
    if (!cands.length) continue;
    const scored = cands.map((i) => ({ i, sim: a.line ? lineSimilarity(a.line, lineOf.get(words[i].seg)) : 1 }))
      .sort((p, q) => q.sim - p.sim || Math.abs(words[p.i].s - a.t - coarse) - Math.abs(words[q.i].s - a.t - coarse));
    const top = scored[0];
    if (top.sim < minLine) continue;
    if (scored[1] && scored[1].sim === top.sim && Math.abs(words[scored[1].i].s - words[top.i].s) > 0.5) continue; // ambiguous
    pairs.push({ x: a.t, y: words[top.i].s, wi: top.i });
  }
  return { coarse, pairs, matched: pairs.length, total: anchors.length };
}

/**
 * @param {Array<{ x: number, y: number }>} pairs - VidAngel time -> copy time
 * @param {{ runtimeSec: number, tol?: number }} o
 * @returns {{ segments: Array<{ fromVa: number, toVa: number, scale: number, offsetSec: number }>, used: number, total: number, medAbsResidSec: number }|null}
 */
export function fitSegments(pairs, { runtimeSec, tol = JUMP_SEC } = {}) {
  const sorted = [...pairs].sort((a, b) => a.x - b.x);
  if (sorted.length < MIN_SEGMENT_PAIRS) return null;
  // A different cut changes offsets, never playback speed: one speed for all
  // segments. First estimate: median slope between neighbouring anchors (a cut
  // spoils only the one slope that spans it).
  let scale = neighbourSlope(sorted);
  // Group by offset level at that speed. A miss starts a new group only when the
  // next pairs agree with it; otherwise it is an outlier and is dropped.
  const group = () => {
    const d = sorted.map((p) => p.y - scale * p.x);
    const gs = [[0]];
    for (let i = 1; i < sorted.length; i++) {
      const cur = gs[gs.length - 1];
      const level = median(cur.slice(-3).map((k) => d[k]));
      if (Math.abs(d[i] - level) <= tol) { cur.push(i); continue; }
      const next = [];
      for (let k = i + 1; k < sorted.length && next.length < MIN_SEGMENT_PAIRS - 1; k++) next.push(k);
      if (next.length === MIN_SEGMENT_PAIRS - 1 && next.every((k) => Math.abs(d[k] - d[i]) <= tol)) gs.push([i]);
    }
    return gs.filter((g) => g.length >= MIN_SEGMENT_PAIRS);
  };
  let groups = group();
  if (!groups.length) return null;
  // Refine the shared speed with a pooled within-group fit, then regroup once.
  scale = pooledSlope(groups.map((g) => g.map((k) => sorted[k])));
  groups = group();
  if (!groups.length) return null;
  const fits = groups.map((g) => {
    const pts = g.map((k) => sorted[k]);
    const offset = median(pts.map((p) => p.y - scale * p.x));
    const resid = pts.map((p) => Math.abs(p.y - (scale * p.x + offset)));
    return { offset, used: pts.length, medResid: median(resid), first: pts[0].x, last: pts[pts.length - 1].x };
  });
  const segments = fits.map((f, k) => ({
    fromVa: k === 0 ? 0 : round3((fits[k - 1].last + f.first) / 2),
    toVa: k === fits.length - 1 ? runtimeSec : round3((f.last + fits[k + 1].first) / 2),
    scale: round6(scale),
    offsetSec: round3(f.offset),
  }));
  const used = fits.reduce((n, f) => n + f.used, 0);
  return { segments, used, total: pairs.length, medAbsResidSec: round3(median(fits.map((f) => f.medResid))) };
}

/** Median slope between neighbouring pairs at least 30 s apart; implausible speeds fall back to 1. */
function neighbourSlope(pts) {
  const slopes = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    if (dx >= 30) slopes.push((pts[i].y - pts[i - 1].y) / dx);
  }
  const m = slopes.length ? median(slopes) : 1;
  return Math.abs(m - 1) <= MAX_SCALE_DEV ? m : 1;
}

/** Least-squares slope with each group centred on its own mean (shared speed, separate offsets). */
function pooledSlope(groups) {
  let sxx = 0; let sxy = 0;
  for (const g of groups) {
    const mx = g.reduce((a, p) => a + p.x, 0) / g.length; const my = g.reduce((a, p) => a + p.y, 0) / g.length;
    for (const p of g) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); }
  }
  const k = sxx > 0 ? sxy / sxx : 1;
  return Math.abs(k - 1) <= MAX_SCALE_DEV ? k : 1;
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}
const round3 = (x) => Math.round(x * 1000) / 1000;
const round6 = (x) => Math.round(x * 1e6) / 1e6;
