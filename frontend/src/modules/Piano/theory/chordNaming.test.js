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

describe('identifyChord — inverted sevenths keep their identity (v2)', () => {
  it('C7 with the bottom C moved to the top is STILL C7 (first inversion / E)', () => {
    // C-E-G-Bb voiced E-G-Bb-C — the user's example: same chord, inverted.
    const r = identifyChord([E4, G4, Bb4, C4 + 12]);
    expect(r.root).toBe(0);
    expect(r.quality).toBe('dominant7');
    expect(r.inversion).toBe(1);
    expect(r.displayName).toBe('C 7 / E');
  });

  it('G7 in third inversion (F in bass) → G 7 / F', () => {
    const r = identifyChord([F4, G4 + 12, B4 + 12, D4 + 24]);
    expect(r.quality).toBe('dominant7');
    expect(r.displayName).toBe('G 7 / F');
  });
});

describe('identifyChord — tolerant voicings (dropped 5th, v2)', () => {
  it('C7 without the 5th is still C 7', () => {
    const r = identifyChord([C4, E4, Bb4]); // no G
    expect(r.quality).toBe('dominant7');
    expect(r.displayName).toBe('C 7');
  });

  it('C major 9 without the 5th is still C major 9', () => {
    const r = identifyChord([C4, D4 + 12, E4, B4]); // C E B D, no G
    expect(r.quality).toBe('major9');
    expect(r.displayName).toBe('C major 9');
  });

  it('a chromatic-ish cluster stays nameless (no blind guess)', () => {
    expect(identifyChord([C4, Gb4, F4]).displayName).toBe(''); // 0,5,6 — not a chord
  });
});

describe('identifyChord — broadened vocabulary (v2)', () => {
  it('C6 (major sixth)', () => {
    const r = identifyChord([C4, E4, G4, A4]);
    expect(r.quality).toBe('sixth');
    expect(r.displayName).toBe('C 6');
  });

  it('C add9', () => {
    const r = identifyChord([C4, D4, E4, G4]);
    expect(r.quality).toBe('add9');
    expect(r.displayName).toBe('C add9');
  });

  it('C dominant 9', () => {
    const r = identifyChord([C4, E4, G4, Bb4, D4 + 12]);
    expect(r.quality).toBe('dominant9');
    expect(r.displayName).toBe('C 9');
  });

  it('C minor 9', () => {
    const r = identifyChord([C4, Eb4, G4, Bb4, D4 + 12]);
    expect(r.quality).toBe('minor9');
    expect(r.displayName).toBe('C minor 9');
  });

  it('G 7 sus4', () => {
    const r = identifyChord([G4, C4 + 12, D4 + 12, F4 + 12]);
    expect(r.quality).toBe('dominant7sus4');
    expect(r.displayName).toBe('G 7 sus4');
  });
});

describe('identifyChord — added-fourth & lydian chords (v3)', () => {
  it('C add4 (major triad + perfect 4th) is add4, not a "major" with an extra note', () => {
    const r = identifyChord([C4, E4, F4, G4]); // 0,4,5,7
    expect(r.quality).toBe('add4');
    expect(r.displayName).toBe('C add4');
  });

  it('C minor add4', () => {
    const r = identifyChord([C4, Eb4, F4, G4]); // 0,3,5,7
    expect(r.quality).toBe('minorAdd4');
    expect(r.displayName).toBe('C minor add4');
  });

  it('C add ♯11 (major triad + ♯11 — the lydian color)', () => {
    const r = identifyChord([C4, E4, Gb4, G4]); // 0,4,6,7
    expect(r.quality).toBe('addSharp11');
    expect(r.displayName).toBe('C add ♯11');
  });

  it('C major 7 ♯11 (lydian) names the whole stack', () => {
    const r = identifyChord([C4, E4, Gb4, G4, B4]); // 0,4,6,7,11
    expect(r.quality).toBe('major7sharp11');
    expect(r.displayName).toBe('C major 7 ♯11');
  });

  it('C 7 ♭5', () => {
    const r = identifyChord([C4, E4, Gb4, Bb4]); // 0,4,6,10
    expect(r.quality).toBe('dominant7b5');
    expect(r.displayName).toBe('C 7 ♭5');
  });
});

describe('identifyChord — the bass disambiguates an ambiguous set (v2)', () => {
  it('C-D-G with C in the bass is C sus2', () => {
    expect(identifyChord([C4, D4, G4]).displayName).toBe('C sus2');
  });
  it('the SAME pitch classes with G in the bass is G sus4', () => {
    expect(identifyChord([G4 - 12, C4, D4]).displayName).toBe('G sus4');
  });
});

describe('PITCH_CLASS_NAMES', () => {
  it('maps 0 → C and 6 → F# (sharp default)', () => {
    expect(PITCH_CLASS_NAMES[0]).toBe('C');
    expect(PITCH_CLASS_NAMES[6]).toBe('F#');
  });
});
