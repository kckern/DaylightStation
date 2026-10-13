import { describe, it, expect } from 'vitest';
import { generateScrollerTargets, MIN_ACTION_SEPARATION } from './sideScrollerTargets.js';

const all = (targets) => Object.values(targets).flat();
const disjoint = (targets) => new Set(all(targets)).size === all(targets).length;

describe('generateScrollerTargets', () => {
  it('keeps today\'s two staves when a level has no blocks', () => {
    const targets = generateScrollerTargets([48, 72], 'single', true);
    expect(Object.keys(targets).sort()).toEqual(['duck', 'jump']);
  });

  it('adds a shoot target from treble when the range spans both clefs', () => {
    for (let i = 0; i < 50; i++) {
      const targets = generateScrollerTargets([48, 84], 'single', false, { shoot: true });
      expect(targets.jump[0]).toBeGreaterThanOrEqual(60);
      expect(targets.shoot[0]).toBeGreaterThanOrEqual(60);
      expect(targets.duck[0]).toBeLessThan(60);
      expect(disjoint(targets)).toBe(true);
    }
  });

  it('never lets two actions share a pitch, at any complexity', () => {
    for (const complexity of ['single', 'dyad', 'triad']) {
      for (const range of [[60, 72], [48, 60], [48, 84]]) {
        for (let i = 0; i < 30; i++) {
          const targets = generateScrollerTargets(range, complexity, true, { shoot: true });
          expect(disjoint(targets), `${complexity} ${range}`).toBe(true);
          expect(targets.shoot.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps three single notes in one clef apart where the pool allows', () => {
    for (let i = 0; i < 50; i++) {
      const { jump, duck, shoot } = generateScrollerTargets([60, 72], 'single', false, { shoot: true });
      expect(Math.abs(jump[0] - duck[0])).toBeGreaterThanOrEqual(MIN_ACTION_SEPARATION);
      expect(Math.abs(shoot[0] - duck[0])).toBeGreaterThanOrEqual(MIN_ACTION_SEPARATION);
      expect(Math.abs(shoot[0] - jump[0])).toBeGreaterThanOrEqual(MIN_ACTION_SEPARATION);
    }
  });

  it('falls back to single notes when one clef cannot hold three chords', () => {
    // C4–C5 white keys: 8 notes, not enough for three triads
    const targets = generateScrollerTargets([60, 72], 'triad', true, { shoot: true });
    expect([targets.jump.length, targets.duck.length, targets.shoot.length]).toEqual([1, 1, 1]);
  });
});
