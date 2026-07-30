import { describe, it, expect } from 'vitest';
import { countInPlan } from './countIn.js';

describe('countInPlan', () => {
  it('one measure of beats at the scaled tempo', () => {
    expect(countInPlan({ beats: 4, bpm: 120, tempoMult: 1 })).toEqual({ beats: 4, periodMs: 500, totalMs: 2000, subdivision: 1 });
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
    expect(countInPlan({ beats: 4, bpm: 0, tempoMult: 0 })).toEqual({ beats: 4, periodMs: 60000 / 90, totalMs: 4 * (60000 / 90), subdivision: 1 });
  });

  it('counts in half-notes above the countable rate', () => {
    const p = countInPlan({ beats: 4, bpm: 216, tempoMult: 1.25 }); // 270 effective bpm
    expect(p.subdivision).toBe(2);
    expect(p.periodMs).toBeCloseTo(444.4, 1); // 135 clicks/min — countable
    expect(p.beats).toBe(4); // two bars' worth: one bar is only 889ms (see lead-in test)
  });

  it('leaves a normal tempo on the quarter-note pulse', () => {
    const p = countInPlan({ beats: 4, bpm: 90, tempoMult: 1 });
    expect(p.subdivision).toBe(1);
    expect(p.beats).toBe(4);
    expect(p.periodMs).toBeCloseTo(666.7, 1);
  });

  // A pulse that doesn't divide the meter teaches the wrong downbeat: two clicks a
  // half-note apart in 3/4 puts click 2 on beat 3, so the player feels a duple bar
  // right up to their entry. Worse than buzzing.
  it('never gives a triple meter a duple pulse', () => {
    const p = countInPlan({ beats: 3, bpm: 216, tempoMult: 1.25 }); // 270 effective bpm
    expect(p.subdivision).toBe(3); // one click per bar — how a teacher counts in fast 3
    expect(p.subdivision % 2).not.toBe(0);
    expect(p.periodMs).toBeCloseTo(666.7, 1); // 3 quarters at 270bpm
    expect(3 % p.subdivision).toBe(0); // the pulse divides the bar
  });

  it('counts a fast 9/8 in dotted-quarters, not half-notes', () => {
    const p = countInPlan({ beats: 9, bpm: 200, tempoMult: 1 });
    expect(p.subdivision).toBe(3);
    expect(9 % p.subdivision).toBe(0);
  });

  it('leaves an irregular meter on the quarter pulse rather than pick a wrong one', () => {
    const p = countInPlan({ beats: 5, bpm: 216, tempoMult: 1.25 });
    expect(p.subdivision).toBe(1); // 5 has no 2-or-3-based divisor to escalate to
  });

  // TEMPO_STEPS reaches 1.75x, so one halving is not enough: 216 x 1.75 = 378 and a
  // half-note pulse there is still ~94 clicks/min.
  it('escalates the pulse until the click rate is countable at the top of the tempo range', () => {
    const p = countInPlan({ beats: 4, bpm: 216, tempoMult: 1.5 }); // 324 effective bpm
    expect(p.subdivision).toBe(4); // one click per bar
    expect(60000 / p.periodMs).toBeLessThanOrEqual(140);
    expect(4 % p.subdivision).toBe(0);
  });

  // The audit's grievance was "four beats in 0.89 seconds". Halving the pulse alone
  // leaves the count-in 0.89s long — countable, but no time to get hands to the keys.
  it('extends to more bars when one bar is too short to prepare in', () => {
    const p = countInPlan({ beats: 4, bpm: 216, tempoMult: 1.25 }); // one bar = 889ms
    expect(p.totalMs).toBeGreaterThanOrEqual(1500);
    expect(p.beats).toBe(4); // two bars of half-note clicks
    expect(p.totalMs).toBeCloseTo(1777.8, 1);
  });

  it('does not pad a count-in that is already long enough', () => {
    const p = countInPlan({ beats: 4, bpm: 120, tempoMult: 1 }); // one bar = 2000ms
    expect(p.beats).toBe(4);
    expect(p.totalMs).toBe(2000);
  });
});
