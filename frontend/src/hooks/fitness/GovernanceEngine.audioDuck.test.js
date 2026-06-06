import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

const baseConfig = (audioCues) => ({
  governed_types: ['test'],
  policies: { default: { base_requirement: [{ active: 'all' }], challenges: [] } },
  zoneConfig: [
    { id: 'cool', name: 'Cool', min: 0 },
    { id: 'active', name: 'Active', min: 100 }
  ],
  audio_cues: audioCues
});

describe('GovernanceEngine — audio_cues config parsing', () => {
  it('parses a valid cue and clamps duck_to into [0,1]', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig([
      { id: 'challenge_hurry', trigger: 'challenge_remaining', threshold_seconds: 12, sound: 'apps/fitness/ux/challenge-hurry.mp3', duck_to: 5 }
    ]));
    expect(engine._audioCues).toHaveLength(1);
    expect(engine._audioCues[0]).toMatchObject({
      id: 'challenge_hurry',
      trigger: 'challenge_remaining',
      thresholdSeconds: 12,
      sound: 'apps/fitness/ux/challenge-hurry.mp3',
      duckTo: 1
    });
  });

  it('drops cues with missing sound, non-finite threshold, or unknown trigger', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig([
      { id: 'no_sound', trigger: 'challenge_remaining', threshold_seconds: 10 },
      { id: 'bad_threshold', trigger: 'challenge_remaining', threshold_seconds: 'soon', sound: 'a.mp3' },
      { id: 'bad_trigger', trigger: 'nonsense', threshold_seconds: 10, sound: 'a.mp3' }
    ]));
    expect(engine._audioCues).toHaveLength(0);
  });

  it('defaults to an empty cue list when none configured', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig(undefined));
    expect(engine._audioCues).toEqual([]);
  });

  it('accepts camelCase threshold/duck aliases', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig([
      { id: 'alias_cue', trigger: 'challenge_remaining', thresholdSeconds: 12, sound: 'a.mp3', duckTo: 0.2 }
    ]));
    expect(engine._audioCues).toHaveLength(1);
    expect(engine._audioCues[0]).toMatchObject({ thresholdSeconds: 12, duckTo: 0.2 });
  });

  it('clamps a negative duck_to up to 0', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig([
      { id: 'neg_duck', trigger: 'challenge_remaining', threshold_seconds: 10, sound: 'a.mp3', duck_to: -0.5 }
    ]));
    expect(engine._audioCues[0].duckTo).toBe(0);
  });
});
