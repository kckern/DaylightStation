// chordName.test.js
import { describe, it, expect } from 'vitest';
import { describeChord } from './chordName.js';
// MIDI: C4=60 D4=62 E4=64 F4=65 G4=67 A4=69 B4=71, C5=72, E5=76

describe('describeChord', () => {
  it('names a major triad in root position and inversion', () => {
    expect(describeChord([60, 64, 67]).name).toBe('C major');
    expect(describeChord([64, 67, 72]).name).toBe('C major'); // E G C (1st inv)
  });
  it('names a minor triad', () => {
    expect(describeChord([69, 72, 76]).name).toBe('A minor'); // A C E
  });
  it('names a dominant seventh', () => {
    expect(describeChord([67, 71, 74, 77]).name).toBe('G7'); // G B D F
  });
  it('lists note names low-to-high regardless of input order', () => {
    expect(describeChord([67, 60, 64]).notes).toEqual(['C4', 'E4', 'G4']);
  });
  it('returns a null name for non-chords / too few notes', () => {
    expect(describeChord([60, 62]).name).toBeNull();
    expect(describeChord([]).name).toBeNull();
  });
});
