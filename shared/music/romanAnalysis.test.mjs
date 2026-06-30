import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { romanAnalysis, degreeNumeral, bestTonic } from './romanAnalysis.mjs';

describe('degreeNumeral', () => {
  it('names every semitone relative to the tonic using major-scale reference', () => {
    assert.equal(degreeNumeral(0), 'I');
    assert.equal(degreeNumeral(1), 'bII');
    assert.equal(degreeNumeral(3), 'bIII');
    assert.equal(degreeNumeral(5), 'IV');
    assert.equal(degreeNumeral(6), '#IV');
    assert.equal(degreeNumeral(10), 'bVII');
    assert.equal(degreeNumeral(11), 'VII');
  });
});

describe('romanAnalysis', () => {
  it('analyses a minor progression relative to its tonic', () => {
    // Dm-C-F-Gm in D minor
    assert.deepEqual(romanAnalysis(['Dm', 'C', 'F', 'Gm'], 2), ['i', 'bVII', 'bIII', 'iv']);
  });

  it('analyses a I-IV-V-I in C major', () => {
    assert.deepEqual(romanAnalysis(['C', 'F', 'G', 'C'], 0), ['I', 'IV', 'V', 'I']);
  });

  it('handles the classic i-bVI-bIII-bVII (Am-F-C-G in A minor)', () => {
    assert.deepEqual(romanAnalysis(['Am', 'F', 'C', 'G'], 9), ['i', 'bVI', 'bIII', 'bVII']);
  });

  it('lowercases minor and marks diminished/augmented', () => {
    assert.deepEqual(romanAnalysis(['Bdim'], 0), ['vii°']);
    assert.deepEqual(romanAnalysis(['Caug'], 0), ['I+']);
    assert.deepEqual(romanAnalysis(['Dsus4'], 0), ['IIsus4']);
  });

  it('accepts already-parsed chord objects', () => {
    assert.deepEqual(romanAnalysis([{ root: 2, quality: 'minor' }], 2), ['i']);
  });

  it('emits ? for unparseable chords without breaking alignment', () => {
    assert.deepEqual(romanAnalysis(['C', 'xyz', 'G'], 0), ['I', '?', 'V']);
  });
});

describe('bestTonic', () => {
  it('finds the key that makes a progression most diatonic (fewest accidentals)', () => {
    assert.equal(bestTonic(['C', 'F', 'G', 'Am']), 0); // clean in C
    assert.equal(bestTonic(['Gb', 'Bbm7', 'Ab(add2)', 'Ebm']), 6); // Gb, not C
    assert.equal(bestTonic(['Am', 'F', 'C', 'G']), 0); // relative-minor still reads against C
  });

  it('yields clean roman numerals when used as the analysis tonic', () => {
    const chords = ['Gb', 'Bbm7', 'Ab(add2)', 'Ebm', 'Gb', 'Ab'];
    const roman = romanAnalysis(chords, bestTonic(chords));
    assert.ok(roman.every((r) => !/[#b]/.test(r)), `expected no accidentals, got ${roman.join(' ')}`);
  });
});
