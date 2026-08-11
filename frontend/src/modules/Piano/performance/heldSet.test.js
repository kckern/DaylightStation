import { describe, it, expect } from 'vitest';
import { matchHeldSet } from './heldSet.js';

const cMajor = { root: 0, pitchClasses: new Set([0, 4, 7]) }; // C E G
const held = (...notes) => new Map(notes.map((n) => [n, { velocity: 90 }]));

describe('matchHeldSet', () => {
  it('is idle with nothing held or no target', () => {
    expect(matchHeldSet(held(), cMajor)).toBe('idle');
    expect(matchHeldSet(held(60), null)).toBe('idle');
  });

  it('accepts the full set in any octave, root in the bass', () => {
    expect(matchHeldSet(held(60, 64, 67), cMajor)).toBe('correct'); // C4 E4 G4
    expect(matchHeldSet(held(48, 76, 91), cMajor)).toBe('correct'); // C3 E5 G6
  });

  it('a full set with a non-root bass is wrong by default (inversion rejected)', () => {
    expect(matchHeldSet(held(64, 67, 72), cMajor)).toBe('wrong'); // E4 G4 C5 — E in the bass
  });

  it('bassMustBeRoot:false accepts inversions', () => {
    expect(matchHeldSet(held(64, 67, 72), cMajor, { bassMustBeRoot: false })).toBe('correct');
  });

  it('any wrong pitch class held is wrong; a subset is partial', () => {
    expect(matchHeldSet(held(60, 63), cMajor)).toBe('wrong');   // Eb
    expect(matchHeldSet(held(60, 64), cMajor)).toBe('partial'); // C E only
  });
});
