import { spellMidi, soundingFifths, keyAlterations } from './spellMidi.js';

describe('keyAlterations', () => {
  it('sharps in fifths order, flats in reverse', () => {
    expect(keyAlterations(2)).toMatchObject({ F: 1, C: 1, G: 0 });   // D major: F#, C#
    expect(keyAlterations(-3)).toMatchObject({ B: -1, E: -1, A: -1, D: 0 }); // Eb major
  });
});

describe('spellMidi', () => {
  it('spells diatonic pitches per the key', () => {
    expect(spellMidi(70, -2)).toEqual({ step: 'B', alter: -1, octave: 4 }); // Bb in Bb major
    expect(spellMidi(66, 2)).toEqual({ step: 'F', alter: 1, octave: 4 });   // F# in D major
    expect(spellMidi(65, 6)).toEqual({ step: 'E', alter: 1, octave: 4 });   // E# in F# major (pc 5)
  });
  it('spells non-diatonic pitches sharps-default', () => {
    expect(spellMidi(61, 0)).toEqual({ step: 'C', alter: 1, octave: 4 });   // C# in C major
    expect(spellMidi(63, 0)).toEqual({ step: 'D', alter: 1, octave: 4 });   // D#, not Eb
  });
  it('octave math survives letter wrap (Cb)', () => {
    expect(spellMidi(59, -7)).toEqual({ step: 'C', alter: -1, octave: 4 }); // Cb4 = midi 59
  });
});

describe('soundingFifths', () => {
  it('zero transpose is identity (written spelling wins)', () => {
    expect(soundingFifths(7, 0)).toBe(7);
  });
  it('moves by 7 fifths per semitone, folded to -5..6', () => {
    expect(soundingFifths(0, 2)).toBe(2);    // C +2 → D
    expect(soundingFifths(0, -1)).toBe(5);   // C -1 → B (5 sharps; fold prefers the sharp side)
    expect(soundingFifths(1, 1)).toBe(-4);   // G +1 → Ab
  });
});
