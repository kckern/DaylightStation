import { describe, it, expect } from 'vitest';
import { midiToAbc, generateAbc, generateScaleAbc, generateMelodyAbc, abcNoteLine } from './abc.js';

describe('midiToAbc', () => {
  it('middle C is "C" in C major', () => {
    expect(midiToAbc(60, 'C')).toBe('C');
  });
  it('octave up uses lowercase', () => {
    expect(midiToAbc(72, 'C')).toBe('c');
  });
  it('octave down uses commas', () => {
    expect(midiToAbc(48, 'C')).toBe('C,');
  });
  it('F# in G major needs no accidental (key handles it)', () => {
    expect(midiToAbc(66, 'G')).toBe('F');
  });
  it('F# in C major needs an explicit sharp', () => {
    expect(midiToAbc(66, 'C')).toBe('^F');
  });
});

describe('generateAbc', () => {
  it('renders a single treble note on the RH staff', () => {
    const abc = generateAbc(new Map([[60, {}]]), 'C');
    expect(abc).toContain('[V:RH] x x C x x |]');
    expect(abc).toContain('[V:LH] x x x x x |]');
    expect(abc).toContain('K:C');
  });
  it('puts an octave dyad on the bass staff', () => {
    const abc = generateAbc(new Map([[48, {}], [60, {}]]), 'C');
    expect(abc).toContain('[V:LH] x x [C,C] x x |]');
  });
  it('applies 8va for very high notes', () => {
    const abc = generateAbc(new Map([[96, {}]]), 'C');
    expect(abc).toContain('8va');
  });
});

describe('generateScaleAbc', () => {
  it.each([
    ['C', [60, 62, 64, 65, 67, 69, 71, 72], 'C D E F G A B c'],
    ['G', [67, 69, 71, 72, 74, 76, 78, 79], 'G A B c d e f g'],
    ['F', [65, 67, 69, 70, 72, 74, 76, 77], 'F G A B c d e f'],
    ['D', [62, 64, 66, 67, 69, 71, 73, 74], 'D E F G A B c d'],
  ])('engraves the exact MIDI octave for %s major', (key, midi, melody) => {
    expect(generateScaleAbc(midi, key)).toBe(`X:1\nL:1/4\nK:${key}\n${melody} |]`);
  });
});

/**
 * Note values and beaming — the difference between a published exercise and a
 * wall of flags. `generateMelodyAbc` wrote `L:1/16` with no length on any token,
 * so every note of every two-hand exercise engraved as a sixteenth whatever the
 * bank said it was, while the single-staff sibling of the same exercise drew the
 * same notes as quarters.
 */
describe('abcNoteLine', () => {
  // C major stepwise, so the tokens read as letters rather than accidentals.
  const notes = (...values) => values.map((value, i) => ({ midi: [60, 62, 64, 65, 67][i], value }));

  it('engraves an undeclared value as a plain quarter — no flag, no rhythm claimed', () => {
    expect(abcNoteLine(notes(undefined, undefined), 'C')).toBe('C D');
  });

  it('carries the length an authored value asks for', () => {
    expect(abcNoteLine([{ midi: 60, value: 'half' }, { midi: 62, value: 'whole' }], 'C')).toBe('C2 D4');
  });

  it('beams a run of flagged notes, four to a group', () => {
    const line = abcNoteLine(notes('8th', '8th', '8th', '8th', '8th'), 'C');
    // Adjacent tokens beam; the space is where the beam breaks.
    expect(line).toBe('C/2D/2E/2F/2 G/2');
  });

  it('never beams quarters, and a rest breaks the group', () => {
    expect(abcNoteLine(notes('quarter', 'quarter'), 'C')).toBe('C D');
    expect(abcNoteLine([
      { midi: 60, value: '16th' }, { rest: true }, { midi: 62, value: '16th' },
    ], 'C')).toBe('C/4 x D/4');
  });

  it('carries fingering decorations through', () => {
    expect(abcNoteLine([{ midi: 60, finger: 1, value: '8th' }], 'C')).toBe('!1!C/2');
  });
});

describe('generateMelodyAbc', () => {
  const hand = (...midis) => [{ notes: midis.map((midi) => ({ midi })) }];

  it('writes the same unit length as every other generator in this file', () => {
    const abc = generateMelodyAbc({ meter: 'none', hands: { right: hand(60, 62), left: hand(48, 50) } }, 'C');
    expect(abc).toContain('L:1/4');
    expect(abc).not.toContain('L:1/16');
  });

  it('draws undeclared two-hand material as quarters, matching its one-hand sibling', () => {
    const abc = generateMelodyAbc({ meter: 'none', hands: { right: hand(60, 62), left: hand(48, 50) } }, 'C');
    expect(abc).toContain('[V:RH] C D |]');
    expect(abc).toContain('[V:LH] C, D, |]');
  });
});
