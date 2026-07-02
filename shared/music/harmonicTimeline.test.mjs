import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { harmonicTimeline, MAX_SLOTS } from './harmonicTimeline.mjs';

const PPQ = 480;
const BAR = PPQ * 4;

/** Chord helper: one note object per midi, all sharing start/duration. */
function chord(midis, ticks, durationTicks) {
  return midis.map((midi) => ({ ticks, durationTicks, midi }));
}

describe('harmonicTimeline', () => {
  it('octave loop on C → every slot [0], root 0, specificity root', () => {
    const notes = [
      { ticks: 0, durationTicks: BAR, midi: 36 }, // C2
      { ticks: 0, durationTicks: BAR, midi: 48 }, // C3
    ];
    const r = harmonicTimeline(notes, PPQ);
    assert.deepEqual(r.slots, [[0], [0], [0], [0]]);
    assert.equal(r.root, 0);
    assert.equal(r.specificity, 'root');
  });

  it('open fifth (C+G whole notes) → slots [0,7], specificity fifth', () => {
    const notes = chord([48, 55], 0, BAR); // C3 + G3
    const r = harmonicTimeline(notes, PPQ);
    assert.deepEqual(r.slots, [[0, 7], [0, 7], [0, 7], [0, 7]]);
    assert.equal(r.root, 0);
    assert.equal(r.specificity, 'fifth');
  });

  it('C–F–G–C triads one per beat → per-slot relative triads, root 0, triad', () => {
    const notes = [
      ...chord([60, 64, 67], 0, PPQ), // C
      ...chord([65, 69, 72], PPQ, PPQ), // F
      ...chord([67, 71, 74], PPQ * 2, PPQ), // G
      ...chord([60, 64, 67], PPQ * 3, PPQ), // C
    ];
    const r = harmonicTimeline(notes, PPQ);
    assert.deepEqual(r.slots, [[0, 4, 7], [0, 5, 9], [2, 7, 11], [0, 4, 7]]);
    assert.equal(r.root, 0);
    assert.equal(r.specificity, 'triad');
  });

  it('sustained Cmaj7 whole note → all slots [0,4,7,11], specificity extended', () => {
    const notes = chord([60, 64, 67, 71], 0, BAR);
    const r = harmonicTimeline(notes, PPQ);
    assert.deepEqual(r.slots, [[0, 4, 7, 11], [0, 4, 7, 11], [0, 4, 7, 11], [0, 4, 7, 11]]);
    assert.equal(r.specificity, 'extended');
  });

  it('root detection: same triad loop transposed to G → root 7, identical relative slots', () => {
    const up = (ns) => ns.map((n) => ({ ...n, midi: n.midi + 7 }));
    const notes = [
      ...up(chord([60, 64, 67], 0, PPQ)),
      ...up(chord([65, 69, 72], PPQ, PPQ)),
      ...up(chord([67, 71, 74], PPQ * 2, PPQ)),
      ...up(chord([60, 64, 67], PPQ * 3, PPQ)),
    ];
    const r = harmonicTimeline(notes, PPQ);
    assert.equal(r.root, 7);
    assert.deepEqual(r.slots, [[0, 4, 7], [0, 5, 9], [2, 7, 11], [0, 4, 7]]);
  });

  it('a note spanning slots contributes to each; boundary-exact end does not bleed', () => {
    // Half note C: sounds through slots 0 and 1, ends exactly on the slot-2 boundary.
    const notes = [{ ticks: 0, durationTicks: PPQ * 2, midi: 60 }];
    const r = harmonicTimeline(notes, PPQ);
    assert.deepEqual(r.slots, [[0], [0], [], []]);
  });

  it('a note starting mid-slot contributes to that slot', () => {
    const notes = [
      { ticks: 0, durationTicks: BAR, midi: 48 }, // C anchor
      { ticks: PPQ + 240, durationTicks: 120, midi: 64 }, // E, inside slot 1 only
    ];
    const r = harmonicTimeline(notes, PPQ);
    assert.deepEqual(r.slots, [[0], [0, 4], [0], [0]]);
  });

  it('a zero-duration note still registers in its start slot', () => {
    const notes = [
      { ticks: 0, durationTicks: BAR, midi: 48 },
      { ticks: PPQ * 2, durationTicks: 0, midi: 67 }, // G hit at slot 2 boundary
    ];
    const r = harmonicTimeline(notes, PPQ);
    assert.deepEqual(r.slots, [[0], [0], [0, 7], [0]]);
  });

  it('empty notes → documented degenerate return', () => {
    assert.deepEqual(harmonicTimeline([], PPQ), { slots: [], root: 0, specificity: 'root' });
  });

  it('2-bar loop → 8 slots', () => {
    const notes = [
      { ticks: 0, durationTicks: BAR, midi: 48 },
      { ticks: BAR, durationTicks: BAR, midi: 48 },
    ];
    const r = harmonicTimeline(notes, PPQ);
    assert.equal(r.slots.length, 8);
    assert.deepEqual(r.slots[7], [0]);
  });

  it('a partial second bar rounds up to whole bars (loopLengthTicks parity)', () => {
    const notes = [{ ticks: 0, durationTicks: BAR + PPQ, midi: 48 }]; // 5 beats
    const r = harmonicTimeline(notes, PPQ);
    assert.equal(r.slots.length, 8);
    assert.deepEqual(r.slots[4], [0]);
    assert.deepEqual(r.slots[5], []);
  });

  it('is ppq-independent (same music at ppq 96 and 960)', () => {
    const make = (ppq) => [
      ...chord([60, 64, 67], 0, ppq),
      ...chord([65, 69, 72], ppq, ppq),
      ...chord([67, 71, 74], ppq * 2, ppq),
      ...chord([60, 64, 67], ppq * 3, ppq),
    ];
    const a = harmonicTimeline(make(96), 96);
    const b = harmonicTimeline(make(960), 960);
    assert.deepEqual(a, b);
  });

  it('honors slotsPerBar and timeSig options', () => {
    // 3/4 bar, one slot per beat: three quarter-note Cs → 3 slots.
    const notes = [
      { ticks: 0, durationTicks: PPQ, midi: 48 },
      { ticks: PPQ, durationTicks: PPQ, midi: 48 },
      { ticks: PPQ * 2, durationTicks: PPQ, midi: 48 },
    ];
    const r = harmonicTimeline(notes, PPQ, { slotsPerBar: 3, timeSig: [3, 4] });
    assert.deepEqual(r.slots, [[0], [0], [0]]);
  });

  it('alternating C/G quarter notes grade as fifth across separate slots', () => {
    const notes = [
      { ticks: 0, durationTicks: PPQ, midi: 48 }, // C3
      { ticks: PPQ, durationTicks: PPQ, midi: 55 }, // G3
      { ticks: PPQ * 2, durationTicks: PPQ, midi: 48 },
      { ticks: PPQ * 3, durationTicks: PPQ, midi: 55 },
    ];
    const r = harmonicTimeline(notes, PPQ);
    assert.deepEqual(r, { slots: [[0], [7], [0], [7]], root: 0, specificity: 'fifth' });
  });

  it('a negative-tick note clamps into the early slots without throwing', () => {
    const notes = [
      { ticks: 0, durationTicks: BAR, midi: 48 }, // C anchor
      { ticks: -120, durationTicks: 600, midi: 64 }, // E, pickup crossing tick 0
    ];
    const r = harmonicTimeline(notes, PPQ);
    assert.deepEqual(r.slots, [[0, 4], [0], [0], [0]]); // E sounds through slot 0 only
  });

  it('throws RangeError on invalid ppq instead of returning an empty timeline', () => {
    const notes = [{ ticks: 0, durationTicks: 480, midi: 60 }];
    for (const bad of [0, -480, NaN, Infinity, undefined]) {
      assert.throws(() => harmonicTimeline(notes, bad), RangeError);
    }
  });

  it('throws RangeError when corrupt durations push slot count past MAX_SLOTS', () => {
    const notes = [{ ticks: 0, durationTicks: 1e12, midi: 60 }];
    assert.throws(() => harmonicTimeline(notes, PPQ), RangeError);
    // Right at the cap is still accepted.
    const atCap = [{ ticks: 0, durationTicks: MAX_SLOTS * PPQ, midi: 60 }];
    assert.equal(harmonicTimeline(atCap, PPQ).slots.length, MAX_SLOTS);
  });

  it('root detection falls back to the lower pitch class when no note starts in slot 0', () => {
    const notes = [
      { ticks: PPQ, durationTicks: PPQ, midi: 64 }, // E
      { ticks: PPQ * 2, durationTicks: PPQ, midi: 62 }, // D — equal score, lower pc
    ];
    const r = harmonicTimeline(notes, PPQ);
    assert.equal(r.root, 2); // no bass anchor → tie resolves to the lower pc (D)
    assert.deepEqual(r.slots, [[], [2], [0], []]);
  });

  it('root detection ties break toward the bass of slot 0 (Am vs C)', () => {
    // A minor triad in root position: A is the lowest sounding note at slot 0,
    // so the tie among equally-weighted pcs resolves to A (9), not C (0).
    const notes = chord([57, 60, 64], 0, BAR); // A3 C4 E4
    const r = harmonicTimeline(notes, PPQ);
    assert.equal(r.root, 9);
    assert.deepEqual(r.slots[0], [0, 3, 7]); // minor triad relative to A
  });

  describe('rootOverride', () => {
    it('agreeing override: G-major triad loop with rootOverride 7 matches detection exactly', () => {
      const notes = chord([55, 59, 62], 0, BAR); // G3 B3 D4
      const detected = harmonicTimeline(notes, PPQ);
      const overridden = harmonicTimeline(notes, PPQ, { rootOverride: 7 });
      assert.equal(detected.root, 7); // sanity: detection agrees here
      assert.deepEqual(overridden, detected);
      assert.equal(overridden.root, 7);
    });

    it('disagreeing override renormalizes: C–G–Am–Dm shape stays C-relative under override 0', () => {
      // Duration-weighted detection favors D on this progression shape (D sounds
      // in both G and Dm, held long); the declared canonical key says C.
      const notes = [
        ...chord([48, 55, 60, 64], 0, PPQ * 2), // C: C3 G3 C4 E4, half note
        ...chord([50, 55, 59, 62], PPQ * 2, PPQ * 2), // G: D3 G3 B3 D4
        ...chord([57, 60, 64], BAR, PPQ), // Am
        ...chord([50, 53, 57, 62], BAR + PPQ, PPQ * 3), // Dm: D3 F3 A3 D4, held
      ];
      const detected = harmonicTimeline(notes, PPQ);
      assert.notEqual(detected.root, 0); // the heuristic miss this test guards against
      const r = harmonicTimeline(notes, PPQ, { rootOverride: 0 });
      assert.equal(r.root, 0);
      assert.deepEqual(r.slots[0], [0, 4, 7]); // C major triad, C-relative
      assert.deepEqual(r.slots[4], [0, 4, 9]); // Am = A C E → {9, 0, 4} relative to C
    });

    it('override changes only normalization, not occupancy (rotation identity)', () => {
      const notes = chord([57, 60, 64], 0, BAR); // Am: detection roots at A (9)
      const detected = harmonicTimeline(notes, PPQ); // A-relative [0,3,7]
      const r = harmonicTimeline(notes, PPQ, { rootOverride: 0 }); // C-relative
      assert.deepEqual(r.slots[0], [0, 4, 9]);
      // same pc set, rotated by the root delta
      const rotated = detected.slots[0].map((pc) => (pc + detected.root - 0 + 12) % 12).sort((a, b) => a - b);
      assert.deepEqual(r.slots[0], rotated);
    });

    it('empty notes with rootOverride returns the override as root', () => {
      assert.deepEqual(
        harmonicTimeline([], PPQ, { rootOverride: 5 }),
        { slots: [], root: 5, specificity: 'root' },
      );
    });

    it('throws TypeError on invalid rootOverride (non-finite or out of 0..11 after floor)', () => {
      const notes = chord([48], 0, BAR);
      for (const bad of [-1, 12, -0.5, NaN, Infinity, '7', null]) {
        assert.throws(() => harmonicTimeline(notes, PPQ, { rootOverride: bad }), TypeError, `expected throw for ${bad}`);
      }
      // fractional overrides floor into range (spec: invalid = out of 0..11 AFTER floor)
      assert.equal(harmonicTimeline(notes, PPQ, { rootOverride: 7.5 }).root, 7);
      // undefined = absent = detection path, no throw
      assert.equal(harmonicTimeline(notes, PPQ, { rootOverride: undefined }).root, 0);
    });
  });
});
