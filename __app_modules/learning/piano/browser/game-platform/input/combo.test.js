import { describe, it, expect } from 'vitest';
import { isComboHeld } from './combo.js';

const notes = (entries) => new Map(entries.map(([n, t]) => [n, { velocity: 100, timestamp: t }]));

describe('isComboHeld', () => {
  it('is true when every combo note is down within the window', () => {
    expect(isComboHeld(notes([[21, 1000], [108, 1120]]), [21, 108], 300)).toBe(true);
  });

  it('is false when a combo note is missing', () => {
    expect(isComboHeld(notes([[21, 1000]]), [21, 108], 300)).toBe(false);
  });

  it('is false when the notes are down but too far apart in time', () => {
    expect(isComboHeld(notes([[21, 1000], [108, 1400]]), [21, 108], 300)).toBe(false);
  });

  it('ignores unrelated notes that are also down', () => {
    expect(isComboHeld(notes([[21, 1000], [60, 1050], [108, 1100]]), [21, 108], 300)).toBe(true);
  });

  it('is false for an empty or missing combo', () => {
    expect(isComboHeld(notes([[21, 1000]]), [], 300)).toBe(false);
    expect(isComboHeld(notes([[21, 1000]]), null, 300)).toBe(false);
  });
});
