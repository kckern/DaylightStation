/**
 * Phrase-aware Learn segment proposals: per-barline features from the kiosk's own
 * layout, a hand-tuned boundary probability, and a partition of the score's
 * measures into segments. Pure and deterministic.
 *
 * Positions are the kiosk's `layout.measures` (`buildMeasures(steps)`): each entry
 * `{ index, number, firstStep, lastStep }`, where `index` is the source measure and
 * `number` the printed one. A barline "after k" sits between layout positions k and
 * k+1; a repeat can put the same source measure at two positions, so a barline can
 * jump backwards in the score.
 */

const EPS = 1e-6;
const MELODY_STAFF = 0;
const BASS_STAFF = 1;

const round = (x, places = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** places) / 10 ** places : x);

function measureSteps(measure, steps) {
  const out = [];
  if (!measure) return out;
  for (let i = measure.firstStep; i <= measure.lastStep; i += 1) if (steps[i]) out.push(steps[i]);
  return out;
}

const hasStaff = (step, staff) => (step.notes || []).some((n) => (Number.isInteger(n.staff) ? n.staff : 0) === staff);

/**
 * Where each source measure starts, in quarters: anchor + index × barLen, with the
 * anchor the most common (first onset − index × barLen) across measures, so most
 * bars start on their first onset and a pickup shifts every bar alike. A guess for
 * a single meter; good enough to read a late first onset or bridge a repeat jump.
 */
function measureStarts(measures, steps, barLen) {
  const counts = new Map();
  const seen = new Set();
  for (const m of measures) {
    if (seen.has(m.index)) continue;
    seen.add(m.index);
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
  return (index) => Math.max(0, anchor + index * barLen);
}

/**
 * Onset gap across a barline. Forward in the score it is the plain difference; a
 * jump back (repeat) adds what is left of bar k to the lead-in of bar k+1.
 */
function gapAcross(lastOnset, firstOnset, left, right, startOf, barLen) {
  if (lastOnset == null || firstOnset == null) return null;
  if (firstOnset > lastOnset + EPS) return firstOnset - lastOnset;
  return Math.max(0, startOf(left.index) + barLen - lastOnset) + Math.max(0, firstOnset - startOf(right.index));
}

/**
 * One record per barline after layout position k (k = 0..n-2):
 *   after           k
 *   tailGapQuarters onset gap from the last melody (staff 0) onset in k to the first in
 *                   k+1; over all staves when either side has no melody
 *   tailGapRatio    tailGapQuarters / beatsPerMeasure (>= 0.5 suggests a breath)
 *   sectionStart    a rehearsal section starts at k+1 (printed number, as sectionToRange)
 *   bassMotion      semitones from the lowest staff-1 note of k's last bass onset to
 *                   k+1's first; null when either side has none
 *   densityChange   |notes per beat in k+1 − notes per beat in k|
 *   restBar         k+1's first onset falls after its downbeat (estimated)
 * @param {{ measures: Array, steps: Array, sections?: Array<{startMeasure:number}>, beatsPerMeasure?: number }} input
 *   `beatsPerMeasure` is in quarter notes (4 for 4/4, 3 for 6/8).
 */
export function barlineFeatures({ measures = [], steps = [], sections = [], beatsPerMeasure = 4 } = {}) {
  if (!Array.isArray(measures) || measures.length < 2) return [];
  const barLen = Number.isFinite(beatsPerMeasure) && beatsPerMeasure > 0 ? beatsPerMeasure : 4;
  const startOf = measureStarts(measures, steps, barLen);
  const sectionNumbers = new Set((sections || []).map((s) => s?.startMeasure).filter((n) => n != null));
  const per = measures.map((m) => {
    const list = measureSteps(m, steps);
    const melody = list.filter((s) => hasStaff(s, MELODY_STAFF));
    const bass = list.filter((s) => hasStaff(s, BASS_STAFF));
    const lowestBass = (s) => Math.min(...s.notes.filter((n) => n.staff === BASS_STAFF).map((n) => n.midi));
    return {
      first: list[0]?.onsetQuarter ?? null,
      last: list[list.length - 1]?.onsetQuarter ?? null,
      melodyFirst: melody[0]?.onsetQuarter ?? null,
      melodyLast: melody[melody.length - 1]?.onsetQuarter ?? null,
      bassFirst: bass.length ? lowestBass(bass[0]) : null,
      bassLast: bass.length ? lowestBass(bass[bass.length - 1]) : null,
      density: list.reduce((sum, s) => sum + (s.notes?.length || 0), 0) / barLen,
    };
  });

  const out = [];
  for (let k = 0; k < measures.length - 1; k += 1) {
    const a = per[k];
    const b = per[k + 1];
    const useMelody = a.melodyLast != null && b.melodyFirst != null;
    const gap = gapAcross(useMelody ? a.melodyLast : a.last, useMelody ? b.melodyFirst : b.first, measures[k], measures[k + 1], startOf, barLen);
    const lead = b.first == null ? 0 : b.first - startOf(measures[k + 1].index);
    out.push({
      after: k,
      tailGapQuarters: round(gap ?? 0),
      tailGapRatio: round((gap ?? 0) / barLen),
      sectionStart: sectionNumbers.has(measures[k + 1].number),
      bassMotion: a.bassLast != null && b.bassFirst != null ? b.bassFirst - a.bassLast : null,
      densityChange: round(Math.abs(b.density - a.density)),
      restBar: lead > EPS && lead < barLen,
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

/** p(phrase ends after this barline) from features. Hand-tuned; calibrated in Task 16d. */
export function heuristicBoundaryP(f) {
  if (f?.sectionStart) return 1;
  let score = -1.2;
  score += Math.min(Math.max(f?.tailGapRatio ?? 0, 0), 1) * 2.2;
  if (f?.bassMotion === -7 || f?.bassMotion === 5) score += 0.8;
  score += Math.min(f?.densityChange ?? 0, 2) * 0.4;
  return 1 / (1 + Math.exp(-score));
}

const clampP = (p) => Math.min(0.98, Math.max(0.02, p));

/** Lexicographic: fewer short segments, then higher likelihood, then closer to target. */
function better(a, b) {
  if (!b) return true;
  if (a.short !== b.short) return a.short < b.short;
  if (Math.abs(a.ll - b.ll) > 1e-9) return a.ll > b.ll;
  return a.dev < b.dev - 1e-9;
}

/**
 * Cut `measureCount` layout positions into contiguous segments covering them all.
 * Maximizes Σ log p over cuts + Σ log(1 − p) over barlines left whole (p clamped to
 * [0.02, 0.98]; a missing p is 0.5). A barline with p >= 1 is always cut. No segment
 * is longer than maxLen. A segment shorter than minLen appears only where forced cuts
 * or the ends of the piece leave no other way, and then as few as possible. Ties go to
 * the partition whose lengths sit closest to targetLen. Deterministic.
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
