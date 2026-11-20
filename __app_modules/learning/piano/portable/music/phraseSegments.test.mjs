import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  barlineFeatures, heuristicBoundaryP, partitionSegments, compactFeatures, FEATURE_KEYS,
  pieceContext, boundaryProbabilities,
} from './phraseSegments.mjs';

/** The kiosk's buildMeasures, inlined so this test stays portable. */
function buildMeasures(steps) {
  const out = [];
  steps.forEach((s, i) => {
    const last = out[out.length - 1];
    if (last && last.index === s.measure) last.lastStep = i;
    else out.push({ index: s.measure, number: s.number ?? s.measure + 1, firstStep: i, lastStep: i });
  });
  return out;
}

/** Steps from per-bar onset lists: bars[m] = [[beatInBar, [{midi, staff}]], ...], 4/4. */
function stepsFrom(bars, barLen = 4) {
  const steps = [];
  bars.forEach((onsets, m) => {
    for (const [beat, notes] of onsets) {
      steps.push({ onsetQuarter: m * barLen + beat, measure: m, number: m + 1, notes });
    }
  });
  return steps;
}

const rh = (midi) => ({ midi, staff: 0 });
const lh = (midi) => ({ midi, staff: 1 });
const quarters = (midi) => [0, 1, 2, 3].map((b) => [b, [rh(midi)]]);

describe('barlineFeatures', () => {
  it('gives one record per barline, after: 0..n-2', () => {
    const steps = stepsFrom([quarters(60), quarters(62), quarters(64)]);
    const f = barlineFeatures({ measures: buildMeasures(steps), steps, beatsPerMeasure: 4 });
    assert.deepEqual(f.map((r) => r.after), [0, 1]);
    assert.equal(f[0].tailGapQuarters, 1);
    assert.equal(f[0].tailGapRatio, 0.25);
  });

  it('a held note at a bar end gives ratio >= 0.5', () => {
    const steps = stepsFrom([[[0, [rh(60)]], [1, [rh(62)]], [2, [rh(64)]]], quarters(60)]);
    const [f] = barlineFeatures({ measures: buildMeasures(steps), steps, beatsPerMeasure: 4 });
    assert.equal(f.tailGapQuarters, 2);
    assert.ok(f.tailGapRatio >= 0.5);
  });

  it('reads the melody gap, not a left hand that keeps time under a long note', () => {
    const bar1 = [[0, [rh(72), lh(48)]], [1, [lh(52)]], [2, [lh(55)]], [3, [lh(52)]]];
    const steps = stepsFrom([bar1, [[0, [rh(74), lh(43)]], [2, [rh(76)]]]]);
    const [f] = barlineFeatures({ measures: buildMeasures(steps), steps, beatsPerMeasure: 4 });
    assert.equal(f.tailGapQuarters, 4);
    assert.equal(f.tailGapRatio, 1);
  });

  it('flags a rehearsal section start by printed number', () => {
    const steps = stepsFrom([quarters(60), quarters(62), quarters(64), quarters(65)]);
    const sections = [{ label: 'A', startMeasure: 1, endMeasure: 2 }, { label: 'B', startMeasure: 3, endMeasure: 4 }];
    const f = barlineFeatures({ measures: buildMeasures(steps), steps, sections, beatsPerMeasure: 4 });
    assert.deepEqual(f.map((r) => r.sectionStart), [false, true, false]);
  });

  it('bass fifth down gives -7; no staff-1 notes gives null', () => {
    const steps = stepsFrom([[[0, [rh(67), lh(55)]], [2, [rh(65)]]], [[0, [rh(64), lh(48)]]], quarters(60)]);
    const f = barlineFeatures({ measures: buildMeasures(steps), steps, beatsPerMeasure: 4 });
    assert.equal(f[0].bassMotion, -7);
    assert.equal(f[1].bassMotion, null);
  });

  it('density change is notes per beat either side', () => {
    const eighths = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((b) => [b, [rh(60)]]);
    const steps = stepsFrom([quarters(60), eighths]);
    const [f] = barlineFeatures({ measures: buildMeasures(steps), steps, beatsPerMeasure: 4 });
    assert.equal(f.densityChange, 1);
  });

  it('marks a bar that starts after its downbeat as a rest bar', () => {
    const steps = stepsFrom([quarters(60), quarters(62), [[1, [rh(64)]], [2, [rh(65)]], [3, [rh(67)]]], quarters(60)]);
    const f = barlineFeatures({ measures: buildMeasures(steps), steps, beatsPerMeasure: 4 });
    assert.deepEqual(f.map((r) => r.restBar), [false, true, false]);
    assert.equal(f[1].tailGapQuarters, 2);
  });

  it('handles a repeat: a bar played twice gives a barline between layout positions', () => {
    // Bars 1-2 repeated, then bar 3: layout positions 0,1,0,1,2 by source measure.
    const once = stepsFrom([quarters(60), [[0, [rh(62)]], [2, [rh(64)]]], quarters(65)]);
    const [b0, b1, b2] = [once.slice(0, 4), once.slice(4, 6), once.slice(6)];
    const steps = [...b0, ...b1, ...b0, ...b1, ...b2];
    const measures = [
      { index: 0, number: 1, firstStep: 0, lastStep: 3 },
      { index: 1, number: 2, firstStep: 4, lastStep: 5 },
      { index: 0, number: 1, firstStep: 6, lastStep: 9 },
      { index: 1, number: 2, firstStep: 10, lastStep: 11 },
      { index: 2, number: 3, firstStep: 12, lastStep: 15 },
    ];
    const f = barlineFeatures({ measures, steps, beatsPerMeasure: 4 });
    assert.equal(f.length, 4);
    // The jump back from bar 2 to bar 1: a half note at beat 2, then bar 1's downbeat.
    assert.equal(f[1].tailGapQuarters, 2);
    assert.equal(f[1].restBar, false);
  });

  it('returns nothing for fewer than two measures', () => {
    const steps = stepsFrom([quarters(60)]);
    assert.deepEqual(barlineFeatures({ measures: buildMeasures(steps), steps, beatsPerMeasure: 4 }), []);
  });

  it('compacts records to numeric rows in FEATURE_KEYS order', () => {
    const rows = compactFeatures([{ after: 3, tailGapQuarters: 2, tailGapRatio: 0.5, sectionStart: true, bassMotion: null, densityChange: 0.25, restBar: false }]);
    assert.deepEqual(rows, [[3, 2, 0.5, 1, null, 0.25, 0]]);
    assert.equal(FEATURE_KEYS.length, rows[0].length);
  });
});

describe('heuristicBoundaryP', () => {
  it('a section start is a certain cut', () => {
    assert.equal(heuristicBoundaryP({ sectionStart: true, tailGapRatio: 0 }), 1);
  });
  it('a long note scores above steady quarters, and a cadential bass adds more', () => {
    const steady = heuristicBoundaryP({ tailGapRatio: 0.25, bassMotion: 2, densityChange: 0 });
    const held = heuristicBoundaryP({ tailGapRatio: 1, bassMotion: 2, densityChange: 0 });
    const cadence = heuristicBoundaryP({ tailGapRatio: 1, bassMotion: -7, densityChange: 0 });
    assert.ok(steady < 0.5 && held > 0.6 && cadence > held);
    assert.ok(held < 1 && cadence < 1);
  });

  it('a cadential bass that fires on most barlines earns nothing', () => {
    const f = { tailGapRatio: 0.25, bassMotion: 5, densityChange: 0 };
    const plain = heuristicBoundaryP({ ...f, bassMotion: 2 });
    assert.equal(heuristicBoundaryP(f, { cadenceRate: 0.9 }), plain);
    assert.equal(heuristicBoundaryP(f, { cadenceRate: 0.5 }), plain);
    // Rare (a few phrase ends): scaled by how rare it is.
    const rare = heuristicBoundaryP(f, { cadenceRate: 0.25 });
    assert.ok(rare > plain && rare < heuristicBoundaryP(f));
  });

  it('pieceContext measures how often the cadential bass fires among barlines with a bass', () => {
    const ctx = pieceContext([{ bassMotion: 5 }, { bassMotion: -7 }, { bassMotion: 2 }, { bassMotion: null }]);
    assert.equal(ctx.cadenceRate, 2 / 3);
    assert.equal(pieceContext([{ bassMotion: null }]).cadenceRate, 0);
  });
});

const lens = (segs) => segs.map((s) => s.end - s.start + 1);
const pMap = (n, fill, over = {}) => new Map(Array.from({ length: n - 1 }, (_, k) => [k, over[k] ?? fill]));

describe('partitionSegments', () => {
  it('cuts a clear phrase end at bar 4', () => {
    assert.deepEqual(partitionSegments(8, pMap(8, 0.1, { 3: 0.95 })), [{ start: 0, end: 3 }, { start: 4, end: 7 }]);
  });

  it('a forced cut after bar 1 makes a 2-bar first segment', () => {
    const segs = partitionSegments(8, pMap(8, 0.1, { 1: 1 }));
    assert.deepEqual(segs[0], { start: 0, end: 1 });
    assert.ok(lens(segs).every((l) => l >= 2 && l <= 8));
  });

  it('all p = 0.5 lands on targetLen', () => {
    assert.deepEqual(lens(partitionSegments(16, pMap(16, 0.5))), [4, 4, 4, 4]);
    assert.deepEqual(lens(partitionSegments(12, pMap(12, 0.5), { targetLen: 3 })), [3, 3, 3, 3]);
  });

  it('20 uniform bars: no segment over maxLen, none under minLen, full cover', () => {
    for (const p of [0.02, 0.2, 0.5, 0.8]) {
      const segs = partitionSegments(20, pMap(20, p));
      assert.ok(lens(segs).every((l) => l >= 2 && l <= 8), `p=${p}: ${lens(segs)}`);
      assert.equal(segs[0].start, 0);
      assert.equal(segs[segs.length - 1].end, 19);
      segs.slice(1).forEach((s, i) => assert.equal(s.start, segs[i].end + 1));
    }
  });

  it('steady music with no phrase signal lands on targetLen, not maxLen', () => {
    assert.deepEqual(lens(partitionSegments(16, pMap(16, 0.34))), [4, 4, 4, 4]);
    assert.deepEqual(lens(partitionSegments(16, pMap(16, 0.2))), [4, 4, 4, 4]);
    assert.deepEqual(lens(partitionSegments(18, pMap(18, 0.34), { targetLen: 6 })), [6, 6, 6]);
  });

  it('clear phrase marks still win over the target length', () => {
    const segs = partitionSegments(18, pMap(18, 0.34, { 5: 0.9, 11: 0.9 }));
    assert.deepEqual(segs.map((s) => s.end), [5, 11, 17]);
  });

  it('is deterministic', () => {
    const p = pMap(23, 0.4, { 2: 0.7, 5: 0.7, 9: 0.62, 13: 0.9, 17: 1 });
    assert.deepEqual(partitionSegments(23, p), partitionSegments(23, new Map(p)));
  });

  it('handles 1 and 2 measures', () => {
    assert.deepEqual(partitionSegments(1, new Map()), [{ start: 0, end: 0 }]);
    assert.deepEqual(partitionSegments(2, pMap(2, 0.9)), [{ start: 0, end: 1 }]);
    assert.deepEqual(partitionSegments(2, pMap(2, 1)), [{ start: 0, end: 0 }, { start: 1, end: 1 }]);
    assert.deepEqual(partitionSegments(0, new Map()), []);
  });

  it('a forced cut makes a 1-bar segment only when unavoidable', () => {
    // After bar 0: bar 0 alone is unavoidable.
    assert.deepEqual(partitionSegments(8, pMap(8, 0.5, { 0: 1 }))[0], { start: 0, end: 0 });
    // After bar 4 of 8 with a strong pull to cut after bar 5: still no 1-bar segment.
    const segs = partitionSegments(8, pMap(8, 0.1, { 4: 1, 5: 0.98 }));
    assert.ok(lens(segs).every((l) => l >= 2), JSON.stringify(segs));
    assert.deepEqual(segs.map((s) => s.end).includes(4), true);
    // Two forced cuts one bar apart: that bar stands alone, nothing else short.
    const two = partitionSegments(10, pMap(10, 0.3, { 3: 1, 4: 1 }));
    assert.deepEqual(two.filter((s) => s.start === s.end), [{ start: 4, end: 4 }]);
  });

  it('never crosses a forced cut, even a long way from targetLen', () => {
    const segs = partitionSegments(12, pMap(12, 0.02, { 6: 1 }));
    assert.ok(segs.some((s) => s.end === 6));
  });

  it('accepts a plain object for pAfter', () => {
    assert.deepEqual(partitionSegments(8, { 3: 0.95, 0: 0.1, 1: 0.1, 2: 0.1, 4: 0.1, 5: 0.1, 6: 0.1 }), [{ start: 0, end: 3 }, { start: 4, end: 7 }]);
  });
});

/** Steps for 16 bars of 4/4 in 4-bar phrases; `bass(m, beat)` gives the left hand. */
function phrasePiece({ normalBass, endBass }) {
  const bars = Array.from({ length: 16 }, (_, m) => {
    if (m % 4 === 3) return [[0, [rh(64), ...endBass[0]]], ...(endBass[1] ? [[2, endBass[1]]] : [])];
    return [[0, [rh(64), ...normalBass[0]]], [1, [rh(64)]], [2, [rh(64), ...normalBass[1]]], [3, [rh(67)]]];
  });
  return stepsFrom(bars);
}
const proposeEnds = (steps, opts) => {
  const features = barlineFeatures({ measures: buildMeasures(steps), steps, beatsPerMeasure: 4 });
  return partitionSegments(16, boundaryProbabilities(features), opts).map((s) => s.end);
};

describe('synthetic 16-bar phrase pieces through the whole pipeline', () => {
  it('a whole note closing every 4th bar, melody only, gives 4-bar segments', () => {
    assert.deepEqual(proposeEnds(phrasePiece({ normalBass: [[], []], endBass: [[]] })), [3, 7, 11, 15]);
  });

  it('an oom-pah left hand rising G to C into every bar does not fragment it', () => {
    const steps = phrasePiece({ normalBass: [[lh(48)], [lh(43)]], endBass: [[lh(48)], [lh(43)]] });
    assert.deepEqual(proposeEnds(steps), [3, 7, 11, 15]);
  });

  it('cuts at 4, 8 and 12', () => {
    // Steady quarters with a left hand on beats 1 and 3 (C, E); each phrase's last
    // bar holds a whole note over C then G, so the bass rises a fourth (G up to C)
    // into the next phrase.
    const bars = Array.from({ length: 16 }, (_, m) => {
      if (m % 4 === 3) return [[0, [rh(64), lh(48)]], [2, [lh(43)]]];
      return [[0, [rh(64), lh(48)]], [1, [rh(64)]], [2, [rh(64), lh(52)]], [3, [rh(67)]]];
    });
    const steps = stepsFrom(bars);
    const features = barlineFeatures({ measures: buildMeasures(steps), steps, beatsPerMeasure: 4 });
    const segs = partitionSegments(16, boundaryProbabilities(features), { targetLen: 4 });
    assert.deepEqual(segs.map((s) => s.end), [3, 7, 11, 15]);
  });
});
