import { describe, it, expect } from 'vitest';
import { CIRCLE_ORDER, circlePositions, activeSlots, keyArc } from './circleOfFifths.js';

describe('CIRCLE_ORDER', () => {
  it('has 12 entries in fifths order starting at C', () => {
    expect(CIRCLE_ORDER).toHaveLength(12);
    expect(CIRCLE_ORDER[0].label).toBe('C');
    expect(CIRCLE_ORDER[1].label).toBe('G');
    expect(CIRCLE_ORDER[11].label).toBe('F');
  });

  it('each next entry is a perfect fifth (7 semitones) up', () => {
    for (let i = 1; i < CIRCLE_ORDER.length; i++) {
      const prev = CIRCLE_ORDER[i - 1].pitchClass;
      const cur = CIRCLE_ORDER[i].pitchClass;
      expect((cur - prev + 12) % 12).toBe(7);
    }
  });
});

describe('circlePositions', () => {
  it('returns 12 positions with C at the top (angle 0, y ≈ -1)', () => {
    const p = circlePositions();
    expect(p).toHaveLength(12);
    expect(p[0].label).toBe('C');
    expect(p[0].angle).toBe(0);
    expect(p[0].y).toBeCloseTo(-1, 5);
    expect(p[0].x).toBeCloseTo(0, 5);
  });

  it('spaces slots 30° apart', () => {
    const p = circlePositions();
    expect(p[1].angle).toBe(30);
    expect(p[3].angle).toBe(90);
  });

  it('places the 4th slot (A, 90°) on the right edge (x ≈ 1, y ≈ 0)', () => {
    const p = circlePositions();
    expect(p[3].x).toBeCloseTo(1, 5);
    expect(p[3].y).toBeCloseTo(0, 5);
  });
});

describe('activeSlots', () => {
  it('lights the slots for the sounding pitch classes', () => {
    // C major triad = pitch classes 0 (C), 4 (E), 7 (G) → slots C, E, G.
    const slots = activeSlots([0, 4, 7]);
    const labels = [...slots].map((i) => CIRCLE_ORDER[i].label).sort();
    expect(labels).toEqual(['C', 'E', 'G']);
  });

  it('returns an empty set for no notes', () => {
    expect(activeSlots([]).size).toBe(0);
  });

  it('normalises out-of-range pitch classes (modulo 12)', () => {
    const slots = activeSlots([12, 16, 19]); // C, E, G one octave up as raw pcs
    const labels = [...slots].map((i) => CIRCLE_ORDER[i].label).sort();
    expect(labels).toEqual(['C', 'E', 'G']);
  });
});

describe('keyArc', () => {
  it('returns I/IV/V neighbours for C major (F, C, G)', () => {
    const slots = keyArc('C');
    const labels = [...slots].map((i) => CIRCLE_ORDER[i].label).sort();
    expect(labels).toEqual(['C', 'F', 'G']);
  });

  it('returns empty for an unknown key', () => {
    expect(keyArc('H').size).toBe(0);
  });
});
