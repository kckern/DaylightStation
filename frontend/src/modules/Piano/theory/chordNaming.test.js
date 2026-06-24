import { describe, it, expect } from 'vitest';
import { identifyChord, PITCH_CLASS_NAMES } from './chordNaming.js';

// MIDI helpers: C4 = 60. pitch class = midi % 12.
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71;
const Eb4 = 63, Gb4 = 66, Bb4 = 70, Ab4 = 68;

describe('identifyChord — empty / sparse', () => {
  it('returns empty name for no notes', () => {
    const r = identifyChord([]);
    expect(r.quality).toBe(null);
    expect(r.displayName).toBe('');
  });

  it('names a single note', () => {
    const r = identifyChord([C4]);
    expect(r.root).toBe(0);
    expect(r.quality).toBe(null);
    expect(r.displayName).toBe('C');
  });

  it('names a bare fifth as a power chord', () => {
    const r = identifyChord([C4, G4]);
    expect(r.quality).toBe('power');
    expect(r.displayName).toBe('C5');
  });
});

describe('identifyChord — triads (root position)', () => {
  it('C major', () => {
    const r = identifyChord([C4, E4, G4]);
    expect(r.root).toBe(0);
    expect(r.quality).toBe('major');
    expect(r.inversion).toBe(0);
    expect(r.displayName).toBe('C major');
  });

  it('D minor', () => {
    const r = identifyChord([D4, F4, A4]);
    expect(r.quality).toBe('minor');
    expect(r.displayName).toBe('D minor');
  });

  it('B diminished', () => {
    const r = identifyChord([B4, D4 + 12, F4 + 12]);
    expect(r.quality).toBe('diminished');
    expect(r.displayName).toBe('B diminished');
  });

  it('C augmented', () => {
    const r = identifyChord([C4, E4, Ab4]);
    expect(r.quality).toBe('augmented');
    expect(r.displayName).toBe('C augmented');
  });
});

describe('identifyChord — inversions / slash chords', () => {
  it('C major first inversion (E in bass) → C major / E', () => {
    const r = identifyChord([E4, G4, C4 + 12]);
    expect(r.root).toBe(0);
    expect(r.quality).toBe('major');
    expect(r.inversion).toBe(1);
    expect(r.displayName).toBe('C major / E');
  });

  it('C major second inversion (G in bass) → C major / G', () => {
    const r = identifyChord([G4, C4 + 12, E4 + 12]);
    expect(r.inversion).toBe(2);
    expect(r.displayName).toBe('C major / G');
  });
});

describe('identifyChord — sevenths & sus', () => {
  it('G dominant 7', () => {
    const r = identifyChord([G4, B4, D4 + 12, F4 + 12]);
    expect(r.quality).toBe('dominant7');
    expect(r.displayName).toBe('G 7');
  });

  it('C major 7', () => {
    const r = identifyChord([C4, E4, G4, B4]);
    expect(r.quality).toBe('major7');
    expect(r.displayName).toBe('C major 7');
  });

  it('D minor 7', () => {
    const r = identifyChord([D4, F4, A4, C4 + 12]);
    expect(r.quality).toBe('minor7');
    expect(r.displayName).toBe('D minor 7');
  });

  it('B half-diminished (minor 7 ♭5)', () => {
    const r = identifyChord([B4, D4 + 12, F4 + 12, A4 + 12]);
    expect(r.quality).toBe('minor7b5');
    expect(r.displayName).toBe('B minor 7 ♭5');
  });

  it('C sus4', () => {
    const r = identifyChord([C4, F4, G4]);
    expect(r.quality).toBe('sus4');
    expect(r.displayName).toBe('C sus4');
  });

  it('C sus2', () => {
    const r = identifyChord([C4, D4, G4]);
    expect(r.quality).toBe('sus2');
    expect(r.displayName).toBe('C sus2');
  });

  it('C diminished 7', () => {
    const r = identifyChord([C4, Eb4, Gb4, A4]);
    expect(r.quality).toBe('diminished7');
    expect(r.displayName).toBe('C diminished 7');
  });
});

describe('identifyChord — duplicate octaves collapse', () => {
  it('C major across two octaves is still C major', () => {
    const r = identifyChord([C4, E4, G4, C4 + 12, E4 + 12]);
    expect(r.quality).toBe('major');
    expect(r.displayName).toBe('C major');
  });
});

describe('identifyChord — unknown set', () => {
  it('returns null quality / empty name for a non-chord cluster', () => {
    const r = identifyChord([C4, C4 + 1, C4 + 2]); // chromatic cluster
    expect(r.quality).toBe(null);
    expect(r.displayName).toBe('');
  });
});

describe('PITCH_CLASS_NAMES', () => {
  it('maps 0 → C and 6 → F# (sharp default)', () => {
    expect(PITCH_CLASS_NAMES[0]).toBe('C');
    expect(PITCH_CLASS_NAMES[6]).toBe('F#');
  });
});
