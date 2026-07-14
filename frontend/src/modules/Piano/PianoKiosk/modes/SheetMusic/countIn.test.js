import { describe, it, expect } from 'vitest';
import { countInPlan } from './countIn.js';

describe('countInPlan', () => {
  it('one measure of beats at the scaled tempo', () => {
    expect(countInPlan({ beats: 4, bpm: 120, tempoMult: 1 })).toEqual({ beats: 4, periodMs: 500, totalMs: 2000 });
    const p = countInPlan({ beats: 3, bpm: 90, tempoMult: 0.5 });
    expect(p.beats).toBe(3);
    expect(p.periodMs).toBeCloseTo(60000 / 45, 6); // 90 * 0.5 = 45 bpm
    expect(p.totalMs).toBeCloseTo(3 * (60000 / 45), 6);
  });

  it('degenerate meter falls back to 4 beats', () => {
    expect(countInPlan({ beats: 0, bpm: 120, tempoMult: 1 }).beats).toBe(4);
    expect(countInPlan({ beats: undefined, bpm: 120, tempoMult: 1 }).beats).toBe(4);
    expect(countInPlan({ beats: 99, bpm: 120, tempoMult: 1 }).beats).toBe(4); // out of range
  });

  it('degenerate tempo falls back to 90 bpm and mult 1', () => {
    expect(countInPlan({ beats: 4, bpm: 0, tempoMult: 0 })).toEqual({ beats: 4, periodMs: 60000 / 90, totalMs: 4 * (60000 / 90) });
  });
});
