import { describe, it, expect } from 'vitest';
import { spellNoteName, spellPitchClass, isMinorish, rootQualityOf } from './spelling.js';

const name = (pc, keySignature, rootQuality) => spellNoteName(pc, { keySignature, rootQuality });

describe('spelling — tier 1: the key decides for its own notes', () => {
  it('spells the 4th degree of F major as B♭', () => {
    expect(name(10, 'F')).toBe('B♭');
  });

  it('spells the same sound as A♯ in B major, where it is the leading tone', () => {
    expect(name(10, 'B')).toBe('A♯');
  });

  it('spells every note of E♭ major from the key', () => {
    expect([0, 2, 3, 5, 7, 8, 10].map((pc) => name(pc, 'Eb')))
      .toEqual(['C', 'D', 'E♭', 'F', 'G', 'A♭', 'B♭']);
  });

  it('spells every note of A major from the key', () => {
    expect([9, 11, 1, 2, 4, 6, 8].map((pc) => name(pc, 'A')))
      .toEqual(['A', 'B', 'C♯', 'D', 'E', 'F♯', 'G♯']);
  });

  it('leaves naturals alone in every key', () => {
    for (const key of ['C', 'G', 'F', 'Bb', 'F#']) {
      expect(name(0, key)).toBe('C');
      expect(name(4, key)).toBe('E');
    }
  });
});

describe('spelling — tier 2: chromatic notes lean by DEGREE, not pitch class', () => {
  // The point of degree-relative: the same pitch class must spell differently
  // depending on which degree of the current key it is.
  it('pitch class 3 is E♭ in C (the ♭3) but D♯ in A (the ♯4)', () => {
    expect(name(3, 'C')).toBe('E♭');
    expect(name(3, 'A')).toBe('D♯');
  });

  it('pitch class 6 is F♯ in C (the ♯4) but G♭ where it is the ♭7… of A♭', () => {
    expect(name(6, 'C')).toBe('F♯');
    expect(name(6, 'Ab')).toBe('G♭'); // ♭7 of A♭ → flat
  });

  it('spells C major chromatics the conventional way', () => {
    expect([1, 3, 6, 8, 10].map((pc) => name(pc, 'C')))
      .toEqual(['C♯', 'E♭', 'F♯', 'A♭', 'B♭']);
  });

  it('spells the ♭7 flat in a flat key (D♭ in E♭ major, not C♯)', () => {
    expect(name(1, 'Eb')).toBe('D♭');
  });

  it('spells the raised 4th sharp in flat keys too (F♯ in F major, not G♭)', () => {
    // The most common chromatic note in any major key — the third of V/V.
    expect(name(6, 'F')).toBe('F♯');
    expect(name(5, 'Eb')).toBe('F'); // …while in-key naturals are untouched
  });
});

describe('spelling — tier 3: chord quality breaks the ♭6 tie', () => {
  it('a minor chord on ♭6 is G♯ minor, a major chord is A♭ major', () => {
    expect(name(8, 'C', 'minor')).toBe('G♯');
    expect(name(8, 'C', 'major')).toBe('A♭');
  });

  it('a major chord on ♭2 is D♭ major, a minor chord is C♯ minor', () => {
    // 5 flats vs 7 sharps for the major; 4 sharps vs 8 flats for the minor.
    expect(name(1, 'C', 'major')).toBe('D♭');
    expect(name(1, 'C', 'minor')).toBe('C♯');
  });

  it('a note with NO chord takes the degree lean, not a quality side', () => {
    // A passing C♯ in C major is a chromatic rise into D; it is not a D♭ chord.
    expect(name(1, 'C', null)).toBe('C♯');
    expect(name(8, 'C', null)).toBe('A♭');
  });

  it('quality does not disturb the other degrees', () => {
    for (const pc of [3, 6, 10]) {
      expect(name(pc, 'C', 'minor')).toBe(name(pc, 'C', 'major'));
    }
  });

  it('the key still wins over quality (A♭ is in E♭ major either way)', () => {
    expect(name(8, 'Eb', 'minor')).toBe('A♭');
  });

  it('maps chord qualities to a tier-3 side, and non-chords to none', () => {
    expect(rootQualityOf('minor7b5')).toBe('minor');
    expect(rootQualityOf('diminished7')).toBe('minor');
    expect(rootQualityOf('dominant7')).toBe('major');
    expect(rootQualityOf(null)).toBe(null);
  });
});

describe('spelling — the complaint that started this', () => {
  it('never says A♯ without a key that asks for it', () => {
    for (const key of ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'G', 'D']) {
      expect(name(10, key)).toBe('B♭');
    }
  });

  it('says A♯ only in the sharp keys that contain it', () => {
    for (const key of ['B', 'F#']) expect(name(10, key)).toBe('A♯');
  });
});

describe('spelling — plumbing', () => {
  it('spells the exotic degrees the extreme keys actually need', () => {
    // No 12-entry pitch-class table can hold these; tier 1 derives them from the key
    // name. Their absence used to print F♯ major's leading tone as F♮ with a natural.
    expect(name(5, 'F#')).toBe('E♯');   // leading tone of F♯ major
    expect(name(11, 'Gb')).toBe('C♭');  // 4th degree of G♭ major
    expect([6, 8, 10, 11, 1, 3, 5].map((pc) => name(pc, 'F#')))
      .toEqual(['F♯', 'G♯', 'A♯', 'B', 'C♯', 'D♯', 'E♯']);
    expect([6, 8, 10, 11, 1, 3, 5].map((pc) => name(pc, 'Gb')))
      .toEqual(['G♭', 'A♭', 'B♭', 'C♭', 'D♭', 'E♭', 'F']);
  });

  it('returns letter + alteration, not just a string', () => {
    expect(spellPitchClass(10, { keySignature: 'C' })).toEqual({ letter: 'B', alter: -1 });
    expect(spellPitchClass(6, { keySignature: 'C' })).toEqual({ letter: 'F', alter: 1 });
    expect(spellPitchClass(0, { keySignature: 'C' })).toEqual({ letter: 'C', alter: 0 });
  });

  it('reduces any integer mod 12 and survives an unknown key', () => {
    expect(name(22, 'C')).toBe('B♭');
    expect(name(-2, 'C')).toBe('B♭');
    expect(name(10, 'not-a-key')).toBe('B♭');
    expect(name(10, undefined)).toBe('B♭');
  });

  it('classifies minor-ish qualities', () => {
    for (const q of ['minor', 'minor7', 'minor7b5', 'minor9', 'diminished', 'diminished7'])
      expect(isMinorish(q)).toBe(true);
    for (const q of ['major', 'major7', 'dominant7', 'sus4', 'augmented', 'power', null, undefined])
      expect(isMinorish(q)).toBe(false);
  });
});
