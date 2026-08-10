import { describe, expect, it } from 'vitest';
import { heroMetronomePlan } from './heroMetronome.js';

describe('heroMetronomePlan', () => {
  it('aligns a countdown click grid to the score downbeat', () => {
    expect(heroMetronomePlan({ elapsedMs: 0, leadInMs: 3000, bpm: 120, beatsPerBar: 4 }))
      .toEqual({ startDelayMs: 0, firstBeatIndex: 2 });
  });

  it('returns the next score-aligned beat when enabled during play', () => {
    const plan = heroMetronomePlan({ elapsedMs: 3225, leadInMs: 3000, bpm: 120, beatsPerBar: 4 });
    expect(plan.startDelayMs).toBe(275);
    expect(plan.firstBeatIndex).toBe(1);
  });

  it('supports non-4/4 measures', () => {
    expect(heroMetronomePlan({ elapsedMs: 0, leadInMs: 2500, bpm: 120, beatsPerBar: 3 }))
      .toEqual({ startDelayMs: 0, firstBeatIndex: 1 });
  });
});
