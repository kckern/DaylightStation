import { describe, it, expect } from 'vitest';
import { shouldReassertRate, RATE_EPSILON } from './rateDrift.js';

describe('shouldReassertRate', () => {
  it('leaves an element that already matches alone', () => {
    expect(shouldReassertRate(1, 1)).toBe(false);
    expect(shouldReassertRate(1.5, 1.5)).toBe(false);
  });

  it('catches the measured 2026-08-17 drift: element at 2x while the app intends 1x', () => {
    expect(shouldReassertRate(1.98, 1)).toBe(true);
    expect(shouldReassertRate(2, 1)).toBe(true);
  });

  it('catches drift the other way: element at 1x while the app intends 1.5x', () => {
    expect(shouldReassertRate(1.02, 1.5)).toBe(true);
  });

  it('ignores float noise below epsilon', () => {
    expect(shouldReassertRate(1 + RATE_EPSILON / 2, 1)).toBe(false);
    expect(shouldReassertRate(0.7500001, 0.75)).toBe(false);
  });

  it('asserts nothing when the intended rate is not a usable number', () => {
    // A missing/zero/NaN intent must never be forced onto the element — that
    // would freeze playback rather than correct it.
    for (const bad of [undefined, null, NaN, 0, -1, 'fast']) {
      expect(shouldReassertRate(2, bad)).toBe(false);
    }
  });

  it('does nothing when the element cannot report a rate', () => {
    for (const bad of [undefined, null, NaN]) {
      expect(shouldReassertRate(bad, 1)).toBe(false);
    }
  });

  it('treats every ladder pair as drift', () => {
    const ladder = [0.5, 0.75, 1, 1.25, 1.5, 2];
    for (const a of ladder) {
      for (const b of ladder) {
        expect(shouldReassertRate(a, b)).toBe(a !== b);
      }
    }
  });
});
