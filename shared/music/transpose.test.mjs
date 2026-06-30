import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mod12, transposePitchClass, transposeNotes, semitonesToCanonical } from './transpose.mjs';

describe('mod12', () => {
  it('wraps into 0..11 including negatives', () => {
    assert.equal(mod12(0), 0);
    assert.equal(mod12(12), 0);
    assert.equal(mod12(-1), 11);
    assert.equal(mod12(13), 1);
    assert.equal(mod12(-13), 11);
  });
});

describe('transposePitchClass', () => {
  it('shifts and wraps a pitch class', () => {
    assert.equal(transposePitchClass(7, 5), 0); // G + 5 = C
    assert.equal(transposePitchClass(0, -1), 11); // C - 1 = B
    assert.equal(transposePitchClass(11, 3), 2); // B + 3 = D
  });
});

describe('transposeNotes', () => {
  it('shifts an array of MIDI note numbers', () => {
    assert.deepEqual(transposeNotes([60, 64, 67], 2), [62, 66, 69]);
    assert.deepEqual(transposeNotes([60], -12), [48]);
  });
  it('does not wrap MIDI octaves (absolute pitch, not pitch class)', () => {
    assert.deepEqual(transposeNotes([59], 1), [60]); // B3 -> C4 crosses octave
  });
});

describe('semitonesToCanonical', () => {
  it('returns the minimal signed shift from a tonic to the canonical tonic', () => {
    // canonical major tonic = C(0)
    assert.equal(semitonesToCanonical(5, 0), -5); // F -> C, down a fourth (minimal vs +7)
    assert.equal(semitonesToCanonical(7, 0), 5); // G -> C, up a fourth (minimal vs -7)
    assert.equal(semitonesToCanonical(0, 0), 0); // already canonical
    assert.equal(semitonesToCanonical(11, 0), 1); // B -> C up a semitone
  });
  it('keeps the shift within -6..+5 so transposed notes stay near the original register', () => {
    for (let from = 0; from < 12; from += 1) {
      const s = semitonesToCanonical(from, 0);
      assert.ok(s >= -6 && s <= 5, `shift ${s} for tonic ${from} out of range`);
    }
  });
});
