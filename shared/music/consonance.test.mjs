import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHORD_TEMPLATES, slotConsonant, stackable } from './consonance.mjs';

/** Timeline literal helper — only `slots` matters to stackable (loops are
 *  key-conformed upstream, so root is irrelevant to the union test). */
const tl = (slots) => ({ slots, root: 0, specificity: 'triad' });

describe('CHORD_TEMPLATES', () => {
  it('contains the full 18-quality vocabulary', () => {
    assert.equal(Object.keys(CHORD_TEMPLATES).length, 18);
    assert.deepEqual(CHORD_TEMPLATES.maj, [0, 4, 7]);
    assert.deepEqual(CHORD_TEMPLATES.dim7, [0, 3, 6, 9]);
    assert.deepEqual(CHORD_TEMPLATES.min9, [0, 2, 3, 7, 10]);
  });

  it('every template starts on the root (pc 0)', () => {
    for (const [name, pcs] of Object.entries(CHORD_TEMPLATES)) {
      assert.ok(pcs.includes(0), `${name} must contain pc 0`);
    }
  });
});

describe('slotConsonant', () => {
  it('accepts every template verbatim', () => {
    for (const [name, pcs] of Object.entries(CHORD_TEMPLATES)) {
      assert.equal(slotConsonant(pcs), true, `${name} ${JSON.stringify(pcs)} should be consonant`);
    }
  });

  it('accepts subsets of templates ({0,4} ⊆ maj)', () => {
    assert.equal(slotConsonant([0, 4]), true);
    assert.equal(slotConsonant([0, 7]), true);
    assert.equal(slotConsonant([0, 3]), true);
  });

  it('empty set is consonant (silence clashes with nothing)', () => {
    assert.equal(slotConsonant([]), true);
    assert.equal(slotConsonant(new Set()), true);
  });

  it('accepts a Set as input', () => {
    assert.equal(slotConsonant(new Set([0, 4, 7, 10])), true);
  });

  it('normalizes out-of-range pcs via mod 12', () => {
    assert.equal(slotConsonant([12, 16, 19]), true); // {0,4,7} = maj
  });

  // THE ROTATION CRUX: slot sets are relative to the LOOP root, but a slot's
  // chord can be rooted anywhere. A V triad rel-C is [2,7,11] — no template
  // rooted at 0 contains it, yet re-rooted on G (rotation 7) it is {0,4,7}.
  // slotConsonant must therefore match under all 12 rotations.
  it('rotation: V triad rel-C [2,7,11] is consonant (maj re-rooted on 7)', () => {
    assert.equal(slotConsonant([2, 7, 11]), true);
  });

  it('rotation: V7 rel-C [2,5,7,11] is consonant (dom7 re-rooted on 7)', () => {
    assert.equal(slotConsonant([2, 5, 7, 11]), true);
  });

  it('rotation: IV∪I rel-C [0,4,5,7,9] is consonant (maj9 re-rooted on 5)', () => {
    assert.equal(slotConsonant([0, 4, 5, 7, 9]), true);
  });

  it('rejects the dim7-over-sus2 union {0,2,3,6,7,9} (6 pcs spell nothing)', () => {
    assert.equal(slotConsonant([0, 2, 3, 6, 7, 9]), false);
  });

  it('rejects a 5-pc dissonant union {0,1,4,7,10} under all rotations', () => {
    assert.equal(slotConsonant([0, 1, 4, 7, 10]), false);
  });

  it('rejects a chromatic cluster {0,1,2}', () => {
    assert.equal(slotConsonant([0, 1, 2]), false);
  });

  it('rejects ii∪I rel-C {0,2,4,5,7,9} (6 pcs)', () => {
    assert.equal(slotConsonant([0, 2, 4, 5, 7, 9]), false);
  });

  // Known leniencies of subset semantics — SPEC WINS over musical judgment:
  // a bare tritone {0,6} ⊆ dim {0,3,6}, and a bare semitone {0,1} rotated by 1
  // is {0,11} ⊆ maj7. Both pass as incomplete shells of nameable chords. The
  // specificity grading upstream keeps such bare dyads rare in practice.
  it('bare tritone {0,6} is consonant (subset of dim — documented leniency)', () => {
    assert.equal(slotConsonant([0, 6]), true);
  });

  it('bare semitone {0,1} is consonant (rotates to maj7 shell {0,11} — documented leniency)', () => {
    assert.equal(slotConsonant([0, 1]), true);
  });
});

describe('stackable', () => {
  it('fixture 1: octaves over a dom7 progression sharing the root → ok', () => {
    const octaves = tl([[0], [0], [0], [0]]);
    const dom7s = tl([[0, 4, 7, 10], [0, 3, 5, 9]]); // I7, IV7 rel-C (both contain pc 0)
    assert.deepEqual(stackable(octaves, dom7s), { ok: true, worstSlot: -1, score: 1 });
  });

  it('fixture 2: alternating root/fifth bass under a sustained dom7 → ok', () => {
    const bass = tl([[0], [7], [0], [7]]);
    const seventh = tl([[0, 4, 7, 10]]); // 1-slot loop, tiled to 4
    assert.deepEqual(stackable(bass, seventh), { ok: true, worstSlot: -1, score: 1 });
  });

  it('fixture 3: dim7 over sus2 → NOT ok (union spells nothing)', () => {
    const r = stackable(tl([[0, 3, 6, 9]]), tl([[0, 2, 7]]));
    assert.deepEqual(r, { ok: false, worstSlot: 0, score: 0 });
  });

  it('fixture 4: I–V–vi–IV triads stack on the same progression in 7ths → ok', () => {
    const triads = tl([[0, 4, 7], [2, 7, 11], [0, 4, 9], [0, 5, 9]]);
    // Imaj7, V7 (+5 = F, the 7th of G), vi7 (+7 = G, the 7th of Am), IVmaj7 (+4 = E)
    const sevenths = tl([[0, 4, 7, 11], [2, 5, 7, 11], [0, 4, 7, 9], [0, 4, 5, 9]]);
    assert.deepEqual(stackable(triads, sevenths), { ok: true, worstSlot: -1, score: 1 });
  });

  it('fixture 5: I–V–vi–IV vs ii–V–I–I → NOT ok, worstSlot 0, score 0.75', () => {
    const pop = tl([[0, 4, 7], [2, 7, 11], [0, 4, 9], [0, 5, 9]]);
    const jazz = tl([[2, 5, 9], [2, 7, 11], [0, 4, 7], [0, 4, 7]]);
    // slot 0: I∪ii = {0,2,4,5,7,9} → clash; slot 1: V∪V ok; slot 2: vi∪I = min7
    // on 9 ok; slot 3: IV∪I = maj9 on 5 ok. → 3/4 consonant.
    assert.deepEqual(stackable(pop, jazz), { ok: false, worstSlot: 0, score: 0.75 });
  });

  it('fixture 6a: 4-slot bass tiles against an 8-slot progression → ok', () => {
    const bass = tl([[0], [7], [0], [7]]);
    const prog = tl([
      [0, 4, 7], [0, 4, 7], [0, 4, 7, 10], [0, 4, 7, 10],
      [0, 3, 7], [0, 3, 7], [0, 4, 7, 11], [0, 4, 7, 11],
    ]);
    assert.deepEqual(stackable(bass, prog), { ok: true, worstSlot: -1, score: 1 });
  });

  it('fixture 6b: 4 vs 6 slots aligns to 12; clash appears only in the tiled frame', () => {
    // A's dim7 sits in slot 3 (aligned 3, 7, 11); B's sus2 sits in slot 5
    // (aligned 5, 11). They only meet at aligned slot 11 — the second tiling
    // of A against the second tiling of B. Every earlier pairing is consonant.
    const a = tl([[0], [0], [0], [0, 3, 6, 9]]);
    const b = tl([[0], [0], [0], [0], [0], [0, 2, 7]]);
    const r = stackable(a, b);
    assert.equal(r.ok, false);
    assert.equal(r.worstSlot, 11); // proves the 12-slot aligned frame
    assert.equal(r.score, 11 / 12);
  });

  it('fixture 7: empty timeline vs anything → ok, score 1', () => {
    const empty = { slots: [], root: 0, specificity: 'root' };
    const busy = tl([[0, 3, 6, 9], [0, 1, 4, 7, 10]]);
    assert.deepEqual(stackable(empty, busy), { ok: true, worstSlot: -1, score: 1 });
    assert.deepEqual(stackable(busy, empty), { ok: true, worstSlot: -1, score: 1 });
    assert.deepEqual(stackable(empty, empty), { ok: true, worstSlot: -1, score: 1 });
  });

  it('worstSlot reports the FIRST dissonant slot when several clash', () => {
    const a = tl([[0], [0, 3, 6, 9], [0, 3, 6, 9], [0]]);
    const b = tl([[0], [0, 2, 7], [0, 2, 7], [0]]);
    const r = stackable(a, b);
    assert.deepEqual(r, { ok: false, worstSlot: 1, score: 0.5 });
  });

  it('throws TypeError on a missing/invalid timeline (hard gate must be loud)', () => {
    const valid = tl([[0, 4, 7]]);
    for (const bad of [undefined, null, {}, { slots: 'nope' }, { slots: 42 }]) {
      assert.throws(() => stackable(bad, valid), { name: 'TypeError', message: /timelineA/ });
      assert.throws(() => stackable(valid, bad), { name: 'TypeError', message: /timelineB/ });
    }
  });

  it('is symmetric', () => {
    const a = tl([[0, 4, 7], [2, 7, 11], [0, 4, 9], [0, 5, 9]]);
    const b = tl([[2, 5, 9], [2, 7, 11], [0, 4, 7]]);
    assert.deepEqual(stackable(a, b), stackable(b, a));
  });
});
