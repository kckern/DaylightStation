import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { melodyFit, makeMelodyFitScorer } from './melodyFit.mjs';

/** Timeline literal helper — only `slots` matters to melodyFit (loops are
 *  key-conformed upstream, so root is irrelevant to the scoring). */
const tl = (slots) => ({ slots, root: 0, specificity: 'triad' });

describe('melodyFit', () => {
  it('chord-tone arpeggio over its own triad → 1.0 exactly', () => {
    const melody = tl([[0], [4], [7], [4]]);
    const harmony = tl([[0, 4, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]]);
    assert.equal(melodyFit(melody, harmony), 1);
  });

  it('chromatic run over a major triad → 0.0 exactly', () => {
    // Harmony union {0,4,7} has 4, no 3 → major scale {0,2,4,5,7,9,11}.
    // 1, 6, 10 chromatic; 3 chromatic in a MAJOR context. All → 0.
    const melody = tl([[1], [6], [10], [3]]);
    const harmony = tl([[0, 4, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]]);
    assert.equal(melodyFit(melody, harmony), 0);
  });

  it('passing tones: chord tones 1.0, diatonic neighbors 0.5 → 0.75 exactly', () => {
    // 0 → 1, 2 → 0.5 (diatonic), 4 → 1, 5 → 0.5 (diatonic): (1+0.5+1+0.5)/4.
    const melody = tl([[0], [2], [4], [5]]);
    const harmony = tl([[0, 4, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]]);
    assert.equal(melodyFit(melody, harmony), 0.75);
  });

  it('minor-context detection: harmony union with pc 3 (no 4) selects the natural-minor scale', () => {
    const minorTriad = tl([[0, 3, 7]]);
    // 10 ∈ natural minor {0,2,3,5,7,8,10} → diatonic 0.5.
    assert.equal(melodyFit(tl([[10]]), minorTriad), 0.5);
    // 11 ∉ natural minor → chromatic 0.
    assert.equal(melodyFit(tl([[11]]), minorTriad), 0);
  });

  it('harmony union with BOTH 3 and 4 reads as major', () => {
    const blurred = tl([[0, 3, 4, 7]]);
    // 9 ∈ major scale, ∉ natural minor → 0.5 proves major was chosen.
    assert.equal(melodyFit(tl([[9]]), blurred), 0.5);
  });

  it('occupancy weighting: pc-weighted mean, NOT mean-of-slot-means', () => {
    // Slot 0 has TWO chord tones, slot 1 one chromatic pc:
    // (1 + 1 + 0) / 3 = 2/3 — not the slot-mean average (1 + 0)/2 = 0.5.
    const melody = tl([[0, 4], [1]]);
    const harmony = tl([[0, 4, 7], [0, 4, 7]]);
    assert.equal(melodyFit(melody, harmony), 2 / 3);
  });

  it('LCM alignment: 4-slot melody tiles against an 8-slot harmony chord change', () => {
    // Harmony: I maj for 4 slots, then V (rel-root [2,7,11]) for 4 slots.
    // Union {0,2,4,7,11} has 4 → major scale.
    const harmony = tl([
      [0, 4, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7],
      [2, 7, 11], [2, 7, 11], [2, 7, 11], [2, 7, 11],
    ]);
    // Constant pc 11 melody, tiled twice across the 8-slot frame:
    // vs I (aligned 0–3): 11 ∉ {0,4,7}, diatonic → 0.5 each;
    // vs V (aligned 4–7): 11 ∈ {2,7,11} → 1.0 each.
    // (0.5·4 + 1·4)/8 = 0.75 — 0.5 if wrongly judged all-vs-I, 1.0 if all-vs-V.
    const melody = tl([[11], [11], [11], [11]]);
    assert.equal(melodyFit(melody, harmony), 0.75);
  });

  it('empty melody slots are skipped (silence neither fits nor clashes)', () => {
    const melody = tl([[0], [], [], []]);
    const harmony = tl([[0, 4, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]]);
    assert.equal(melodyFit(melody, harmony), 1);
  });

  it('empty harmony slot: melody judged against the scale only (empty union → major)', () => {
    // Chord-tone tier is impossible; diatonic pc 2 → 0.5, chromatic pc 1 → 0.
    assert.equal(melodyFit(tl([[2]]), tl([[]])), 0.5);
    assert.equal(melodyFit(tl([[1]]), tl([[]])), 0);
  });

  it('zero-length harmony timeline behaves like an all-silent harmony', () => {
    const empty = { slots: [], root: 0, specificity: 'root' };
    assert.equal(melodyFit(tl([[2]]), empty), 0.5);
    assert.equal(melodyFit(tl([[1]]), empty), 0);
  });

  it('melody with no sounding pcs anywhere → 0.5 (neutral: nothing to judge)', () => {
    const harmony = tl([[0, 4, 7]]);
    assert.equal(melodyFit(tl([[], [], [], []]), harmony), 0.5);
    assert.equal(melodyFit({ slots: [], root: 0, specificity: 'root' }, harmony), 0.5);
  });

  it('throws TypeError on a missing/invalid timeline (both arguments)', () => {
    const valid = tl([[0, 4, 7]]);
    for (const bad of [undefined, null, {}, { slots: 'nope' }, { slots: 42 }]) {
      assert.throws(() => melodyFit(bad, valid), { name: 'TypeError', message: /melodyTimeline/ });
      assert.throws(() => melodyFit(valid, bad), { name: 'TypeError', message: /harmonyTimeline/ });
    }
  });

  it('makeMelodyFitScorer: curried form scores identically to the two-arg form', () => {
    const harmony = tl([[0, 4, 7], [2, 7, 11], [], [5, 9, 0]]);
    const scorer = makeMelodyFitScorer(harmony);
    const melodies = [
      tl([[0], [2], [4], [5]]),
      tl([[1], [6], [10], [3]]),
      tl([[], [], [], []]),
      tl([[0, 4], [11], [9], []]),
    ];
    for (const melody of melodies) {
      assert.equal(scorer(melody), melodyFit(melody, harmony));
    }
  });

  it('makeMelodyFitScorer: harmony validated at creation, melody at call time', () => {
    assert.throws(() => makeMelodyFitScorer({}), { name: 'TypeError', message: /harmonyTimeline/ });
    const scorer = makeMelodyFitScorer(tl([[0, 4, 7]]));
    assert.throws(() => scorer(null), { name: 'TypeError', message: /melodyTimeline/ });
  });

  it('score is always in [0, 1] across mixed fixtures', () => {
    const fixtures = [
      [tl([[0, 1, 2], [3, 4, 5], [6, 7, 8]]), tl([[0, 3, 7], [2, 5, 9]])],
      [tl([[11], [10, 1]]), tl([[0, 4, 7], [], [2, 7, 11]])],
      [tl([[0], [], [5, 6]]), tl([[0, 3, 7]])],
      [tl([[7, 8, 9, 10, 11]]), tl([[]])],
    ];
    for (const [melody, harmony] of fixtures) {
      const score = melodyFit(melody, harmony);
      assert.ok(score >= 0 && score <= 1, `score ${score} out of [0,1]`);
    }
  });
});
