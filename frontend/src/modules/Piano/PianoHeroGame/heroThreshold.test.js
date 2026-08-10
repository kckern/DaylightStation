import { describe, expect, it } from 'vitest';
import { heroThresholdState } from './heroThreshold.js';

describe('heroThresholdState', () => {
  it('pulses only just after a score-aligned metronome beat', () => {
    const base = { leadInMs: 3000, bpm: 120, beatsPerBar: 4, pulseBeat: true };
    expect(heroThresholdState({ ...base, elapsedMs: 2490 }).beatIndex).toBeNull();
    expect(heroThresholdState({ ...base, elapsedMs: 2500 }))
      .toMatchObject({ beatIndex: -1, downbeat: false });
    expect(heroThresholdState({ ...base, elapsedMs: 3000 }))
      .toMatchObject({ beatIndex: 0, downbeat: true });
    expect(heroThresholdState({ ...base, elapsedMs: 3160 }).beatIndex).toBeNull();
  });

  it('returns lane effects briefly for both hits and misses', () => {
    const state = heroThresholdState({
      elapsedMs: 1200,
      targets: [
        { id: 1, state: 'hit', resolvedAt: 1100, pitches: [60, 64] },
        { id: 2, state: 'missed', resolvedAt: 1190, pitches: [67] },
        { id: 3, state: 'hit', resolvedAt: 800, pitches: [72] },
      ],
    });
    expect(state.effects.map(({ pitch, kind }) => [pitch, kind]))
      .toEqual([[60, 'hit'], [64, 'hit'], [67, 'miss']]);
  });

  it('does not pulse the beat when the metronome visual is disabled', () => {
    expect(heroThresholdState({ elapsedMs: 3000, leadInMs: 3000, bpm: 120, pulseBeat: false }).beatIndex)
      .toBeNull();
  });
});
