import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseChordSymbol, PITCH_CLASS } from './chords.mjs';

describe('parseChordSymbol', () => {
  it('parses a bare major triad to root pitch-class + major quality', () => {
    assert.deepEqual(parseChordSymbol('C'), { root: 0, quality: 'major', symbol: 'C' });
    assert.deepEqual(parseChordSymbol('G'), { root: 7, quality: 'major', symbol: 'G' });
  });

  it('parses minor via trailing m', () => {
    assert.deepEqual(parseChordSymbol('Dm'), { root: 2, quality: 'minor', symbol: 'Dm' });
    assert.deepEqual(parseChordSymbol('Am'), { root: 9, quality: 'minor', symbol: 'Am' });
  });

  it('parses flat and sharp roots', () => {
    assert.equal(parseChordSymbol('Bb').root, PITCH_CLASS.Bb); // 10
    assert.equal(parseChordSymbol('Eb').root, 3);
    assert.equal(parseChordSymbol('F#').root, 6);
    assert.equal(parseChordSymbol('Db').root, 1);
  });

  it('strips numeric/added extensions but keeps the core quality', () => {
    assert.deepEqual(parseChordSymbol('Gm7'), { root: 7, quality: 'minor', symbol: 'Gm7' });
    assert.deepEqual(parseChordSymbol('FMaj9'), { root: 5, quality: 'major', symbol: 'FMaj9' });
    assert.deepEqual(parseChordSymbol('Dm11'), { root: 2, quality: 'minor', symbol: 'Dm11' });
    assert.deepEqual(parseChordSymbol('C7'), { root: 0, quality: 'major', symbol: 'C7' });
  });

  it('parses sus and add chords', () => {
    assert.equal(parseChordSymbol('BbSus2').quality, 'sus2');
    assert.equal(parseChordSymbol('Csus4').quality, 'sus4');
    assert.equal(parseChordSymbol('Gm(add4)').quality, 'minor'); // add tone doesn't change triad quality
    assert.equal(parseChordSymbol('Gm(add4)').root, 7);
  });

  it('parses diminished and augmented', () => {
    assert.equal(parseChordSymbol('Bdim').quality, 'diminished');
    assert.equal(parseChordSymbol('Caug').quality, 'augmented');
  });

  it('returns null for unparseable input', () => {
    assert.equal(parseChordSymbol(''), null);
    assert.equal(parseChordSymbol('xyz'), null);
    assert.equal(parseChordSymbol(null), null);
  });
});
