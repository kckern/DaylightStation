/**
 * Phrase-aware Learn segment proposals: per-barline features from the kiosk's own
 * layout, a hand-tuned boundary probability, and a partition of the score's
 * measures into segments. Pure and deterministic.
 *
 * Positions are the kiosk's `layout.measures` (`buildMeasures(steps)`): each entry
 * `{ index, number, firstStep, lastStep }`, where `index` is the source measure and
 * `number` the printed one. A barline "after k" sits between layout positions k and
 * k+1. The kiosk's `buildSteps` merges onsets by time, so a repeat collapses into
 * one pass (no source measure appears twice) and an all-rest bar has no position:
 * consecutive positions can skip a source index but do not go backwards. The
 * backward branch in `gapAcross` is kept for layouts built some other way.
 *
 * How a proposal is made (the heuristic baseline that calibration compares against):
 *
 * 1. Features per barline (`barlineFeatures`): melody (staff 0) tail gap as a
 *    fraction of bar k's length, rehearsal section start, bass (the piece's lowest
 *    staff) motion into the next downbeat, change in notes per beat, and whether
 *    the next bar opens with a rest. Bar starts and lengths come from the score's
 *    `measureMap` when given (meter changes count), else from one meter.
 * 2. p(phrase ends) per barline (`heuristicBoundaryP`), a logistic over
 *      −1.2 + 2.2·min(tailGapRatio, 1)
 *           + 0.8·[bass falls a fifth or rises a fourth, any octave]·w
 *           + 0.4·min(densityChange, 2)
 *    with p = 1 at a section start. w = 1 − (share of the piece's barlines with a
 *    bass where that motion happens), and w = 0 once that share is over 40%: an
 *    oom-pah figure that rises G→C into every bar says nothing about phrases.
 *    `restBar` is recorded but not scored (the tail gap already counts the rest).
 * 3. Segments (`partitionSegments`): over every way to cut the bars, minimize the
 *    number of segments shorter than minLen, then maximize
 *      Σ log p (cuts) + Σ log(1 − p) (barlines left whole) − 0.6·Σ |len − targetLen|
 *    with p clamped to [0.02, 0.98], p = 1 always cut and no segment over maxLen.
 *    The length term keeps music with no phrase signal at targetLen instead of
 *    drifting to maxLen; a clear phrase mark (p ≈ 0.9) still outweighs it.
 */

const EPS = 1e-6;
const MELODY_STAFF = 0;

const round = (x, places = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** places) / 10 ** places : x);
const staffOf = (note) => (Number.isInteger(note?.staff) ? note.staff : 0);

function measureSteps(measure, steps) {
  const out = [];
  if (!measure) return out;
  for (let i = measure.firstStep; i <= measure.lastStep; i += 1) if (steps[i]) out.push(steps[i]);
  return out;
}

const hasStaff = (step, staff) => (step.notes || []).some((n) => staffOf(n) === staff);

/**
 * The bass staff: the highest staff id in the piece, when there is one below the
 * melody. On a piano score that is the left hand; on voice + piano (staves 0, 1, 2)
 * it is the piano's left hand, not its right. The lowest note across all lower
 * staves would follow the right hand whenever the left rests or holds, so the
 * notated bottom staff is the steadier choice. null for a single-staff piece.
 */
function bassStaffOf(steps) {
  let top = -1;
  for (const step of steps) for (const n of step.notes || []) top = Math.max(top, staffOf(n));
  return top > MELODY_STAFF ? top : null;
}

/**
 * Bar start and length (quarters) per source measure. From `measureMap`
 * ([{ index, onsetQuarter, durationQuarters }], the score's own bar boundaries)
 * when it covers the measure; otherwise one meter of `barLen`, anchored at the most
 * common (first onset − index × barLen) so a pickup shifts every bar alike.
 */
function barGeometry(measures, steps, barLen, measureMap) {
  const byIndex = new Map();
  for (const m of Array.isArray(measureMap) ? measureMap : []) {
    if (Number.isInteger(m?.index) && Number.isFinite(m.onsetQuarter) && m.durationQuarters > 0) byIndex.set(m.index, m);
  }
  const counts = new Map();
  for (const m of measures) {
    const first = steps[m.firstStep];
    if (!first) continue;
    const key = Math.round((first.onsetQuarter - m.index * barLen) * 1000);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let anchor = 0;
  let best = -1;
  for (const [key, n] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (n > best) { best = n; anchor = key / 1000; }
  }
  return (index) => {
    const known = byIndex.get(index);
    if (known) return { start: known.onsetQuarter, length: known.durationQuarters };
    return { start: Math.max(0, anchor + index * barLen), length: barLen };
  };
}

/**
 * Onset gap across a barline. Forward in the score it is the plain difference; a
 * backward jump (not produced by the kiosk's steps, see the header) adds what is
 * left of bar k to the lead-in of bar k+1.
 */
function gapAcross(lastOnset, firstOnset, left, right) {
  if (lastOnset == null || firstOnset == null) return null;
  if (firstOnset > lastOnset + EPS) return firstOnset - lastOnset;
  return Math.max(0, left.start + left.length - lastOnset) + Math.max(0, firstOnset - right.start);
}

/**
 * One record per barline after layout position k (k = 0..n-2):
 *   after           k
 *   tailGapQuarters onset gap from the last melody (staff 0) onset in k to the first in
 *                   k+1; over all staves when either side has no melody
 *   tailGapRatio    tailGapQuarters / bar k's length (>= 0.5 suggests a breath)
 *   sectionStart    a rehearsal section starts at k+1: the first position whose printed
 *                   number is the section's start, as the kiosk's sectionToRange finds it
 *   bassMotion      semitones from the lowest bass-staff note of k's last bass onset to
 *                   k+1's first; null when either side has none
 *   densityChange   |notes per beat in k+1 − notes per beat in k|
 *   restBar         k+1's first onset falls after its downbeat
 * @param {{ measures: Array, steps: Array, sections?: Array<{startMeasure:number}>,
 *   beatsPerMeasure?: number, measureMap?: Array }} input
 *   `beatsPerMeasure` is in quarter notes (4 for 4/4, 3 for 6/8), used for bars the
 *   `measureMap` does not cover.
 */
export function barlineFeatures({ measures = [], steps = [], sections = [], beatsPerMeasure = 4, measureMap = null } = {}) {
  if (!Array.isArray(measures) || measures.length < 2) return [];
  const barLen = Number.isFinite(beatsPerMeasure) && beatsPerMeasure > 0 ? beatsPerMeasure : 4;
  const bar = barGeometry(measures, steps, barLen, measureMap);
  const bassStaff = bassStaffOf(steps);
  const sectionAt = new Set();
  for (const s of sections || []) {
    const at = measures.findIndex((m) => m.number === s?.startMeasure);
    if (at > 0) sectionAt.add(at);
  }
  const per = measures.map((m) => {
    const list = measureSteps(m, steps);
    const melody = list.filter((s) => hasStaff(s, MELODY_STAFF));
    const bass = bassStaff == null ? [] : list.filter((s) => hasStaff(s, bassStaff));
    const lowestBass = (s) => Math.min(...s.notes.filter((n) => staffOf(n) === bassStaff).map((n) => n.midi));
    const geometry = bar(m.index);
    return {
      geometry,
      first: list[0]?.onsetQuarter ?? null,
      last: list[list.length - 1]?.onsetQuarter ?? null,
      melodyFirst: melody[0]?.onsetQuarter ?? null,
      melodyLast: melody[melody.length - 1]?.onsetQuarter ?? null,
      bassFirst: bass.length ? lowestBass(bass[0]) : null,
      bassLast: bass.length ? lowestBass(bass[bass.length - 1]) : null,
      density: list.reduce((sum, s) => sum + (s.notes?.length || 0), 0) / geometry.length,
    };
  });

  const out = [];
  for (let k = 0; k < measures.length - 1; k += 1) {
    const a = per[k];
    const b = per[k + 1];
    const useMelody = a.melodyLast != null && b.melodyFirst != null;
    const gap = gapAcross(useMelody ? a.melodyLast : a.last, useMelody ? b.melodyFirst : b.first, a.geometry, b.geometry) ?? 0;
    const lead = b.first == null ? 0 : b.first - b.geometry.start;
    out.push({
      after: k,
      tailGapQuarters: round(gap),
      tailGapRatio: round(gap / a.geometry.length),
      sectionStart: sectionAt.has(k + 1),
      bassMotion: a.bassLast != null && b.bassFirst != null ? b.bassFirst - a.bassLast : null,
      densityChange: round(Math.abs(b.density - a.density)),
      restBar: lead > EPS && lead < b.geometry.length,
    });
  }
  return out;
}

/** Column order of `compactFeatures` rows, for whoever reads a stored proposal. */
export const FEATURE_KEYS = Object.freeze(['after', 'tailGapQuarters', 'tailGapRatio', 'sectionStart', 'bassMotion', 'densityChange', 'restBar']);

/** Feature records as numeric rows (booleans → 0/1, null kept) in FEATURE_KEYS order. */
export function compactFeatures(records) {
  return (records || []).map((r) => FEATURE_KEYS.map((key) => {
    const v = r[key];
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v ?? null;
  }));
}

/** Bass falls a fifth or rises a fourth, in any octave (V→I with the bass displaced). */
const isCadentialBass = (motion) => Number.isInteger(motion) && ((motion % 12) + 12) % 12 === 5;
/** Above this share of barlines, a cadential bass motion is the texture, not a cadence. */
export const CADENCE_RATE_LIMIT = 0.4;

/**
 * What the boundary scorer needs to know about the whole piece: `cadenceRate`, the
 * share of barlines with a bass on both sides where it falls a fifth or rises a fourth.
 */
export function pieceContext(features) {
  const withBass = (features || []).filter((f) => f?.bassMotion != null);
  const cadences = withBass.filter((f) => isCadentialBass(f.bassMotion)).length;
  return { cadenceRate: withBass.length ? cadences / withBass.length : 0 };
}

/**
 * p(phrase ends after this barline) from features. Hand-tuned; calibrated in Task 16d.
 * `context.cadenceRate` (from pieceContext) discounts a bass motion the piece repeats.
 */
export function heuristicBoundaryP(f, context = {}) {
  if (f?.sectionStart) return 1;
  let score = -1.2;
  score += Math.min(Math.max(f?.tailGapRatio ?? 0, 0), 1) * 2.2;
  if (isCadentialBass(f?.bassMotion)) {
    const rate = Number.isFinite(context?.cadenceRate) ? context.cadenceRate : 0;
    score += rate > CADENCE_RATE_LIMIT ? 0 : 0.8 * (1 - rate);
  }
  score += Math.min(f?.densityChange ?? 0, 2) * 0.4;
  return 1 / (1 + Math.exp(-score));
}

/** Barline-after-k → p for a whole piece's features, with the piece's context. */
export function boundaryProbabilities(features) {
  const context = pieceContext(features);
  return new Map((features || []).map((f) => [f.after, heuristicBoundaryP(f, context)]));
}

const clampP = (p) => Math.min(0.98, Math.max(0.02, p));

/** Weight of the per-segment |len − targetLen| penalty against the log-likelihood. */
export const LENGTH_WEIGHT = 0.6;

/** Fewer short segments, then the higher score (likelihood − length penalty), then closer to target. */
function better(a, b) {
  if (!b) return true;
  if (a.short !== b.short) return a.short < b.short;
  const sa = a.ll - LENGTH_WEIGHT * a.dev;
  const sb = b.ll - LENGTH_WEIGHT * b.dev;
  if (Math.abs(sa - sb) > 1e-9) return sa > sb;
  return a.dev < b.dev - 1e-9;
}

/**
 * Cut `measureCount` layout positions into contiguous segments covering them all.
 * Maximizes Σ log p over cuts + Σ log(1 − p) over barlines left whole (p clamped to
 * [0.02, 0.98]; a missing p is 0.5) − LENGTH_WEIGHT · Σ |len − targetLen| over
 * segments. A barline with p >= 1 is always cut. No segment
 * is longer than maxLen. A segment shorter than minLen appears only where forced cuts
 * or the ends of the piece leave no other way, and then as few as possible. Exact ties
 * go to the partition whose lengths sit closest to targetLen. Deterministic.
 * @param {number} measureCount
 * @param {Map<number, number>|Record<number, number>} pAfter  barline-after-k → p
 * @returns {Array<{start:number,end:number}>}
 */
export function partitionSegments(measureCount, pAfter, { minLen = 2, maxLen = 8, targetLen = 4 } = {}) {
  const n = Number.isInteger(measureCount) && measureCount > 0 ? measureCount : 0;
  if (!n) return [];
  const lo = Math.max(1, Math.floor(minLen) || 1);
  const hi = Math.max(lo, Math.floor(maxLen) || lo);
  const target = Number.isFinite(targetLen) ? targetLen : 4;
  const rawP = (k) => {
    const v = pAfter instanceof Map ? pAfter.get(k) : pAfter?.[k];
    return Number.isFinite(v) ? v : 0.5;
  };
  // Prefix sums over barlines 0..n-2: log(1-p) and forced counts.
  const keepSum = new Array(n).fill(0);
  const forcedSum = new Array(n).fill(0);
  for (let k = 0; k < n - 1; k += 1) {
    keepSum[k + 1] = keepSum[k] + Math.log(1 - clampP(rawP(k)));
    forcedSum[k + 1] = forcedSum[k] + (rawP(k) >= 1 ? 1 : 0);
  }
  // best[i]: bars 0..i-1 segmented, with a cut after bar i-1 when i < n.
  const best = new Array(n + 1).fill(null);
  best[0] = { short: 0, ll: 0, dev: 0, prev: -1 };
  for (let i = 1; i <= n; i += 1) {
    for (let len = 1; len <= Math.min(hi, i); len += 1) {
      const s = i - len;
      if (!best[s]) continue;
      // Barlines inside the segment are s..i-2; none may be forced.
      if (forcedSum[i - 1] - forcedSum[s] > 0) continue;
      const cand = {
        short: best[s].short + (len < lo ? 1 : 0),
        ll: best[s].ll + (keepSum[i - 1] - keepSum[s]) + (i < n ? Math.log(clampP(rawP(i - 1))) : 0),
        dev: best[s].dev + Math.abs(len - target),
        prev: s,
      };
      if (better(cand, best[i])) best[i] = cand;
    }
  }
  const out = [];
  for (let i = n; i > 0; i = best[i].prev) out.unshift({ start: best[i].prev, end: i - 1 });
  return out;
}
