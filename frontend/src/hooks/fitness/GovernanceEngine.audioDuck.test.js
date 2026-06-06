import { describe, it, expect, vi } from 'vitest';

// Silence the structured logger in this unit suite. The engine emits warn/sampled
// events during cue parsing/evaluation; their console output otherwise races the
// vitest worker teardown ("Closing rpc while onUserConsoleLog was pending") when
// this file runs alongside the rest of the fitness suite. We assert on return
// values, never on logs.
vi.mock('../../lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

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

describe('GovernanceEngine — _computeAudioDuck', () => {
  const cue = {
    id: 'challenge_hurry',
    trigger: 'challenge_remaining',
    thresholdSeconds: 12,
    sound: 'apps/fitness/ux/challenge-hurry.mp3',
    duckTo: 0.1
  };

  const makeEngine = () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine._audioCues = [cue];
    return engine;
  };

  it('returns a duck descriptor when an unsatisfied challenge is within threshold', () => {
    const engine = makeEngine();
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 10, requiredCount: 2, actualCount: 1 };
    const duck = engine._computeAudioDuck(snapshot);
    expect(duck).toMatchObject({
      cueId: 'challenge_hurry',
      sound: 'apps/fitness/ux/challenge-hurry.mp3',
      duckTo: 0.1,
      token: 'ch1:challenge_hurry'
    });
  });

  it('returns null before the threshold is crossed', () => {
    const engine = makeEngine();
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 20, requiredCount: 2, actualCount: 1 };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });

  it('returns null when the challenge is already satisfied', () => {
    const engine = makeEngine();
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 8, requiredCount: 2, actualCount: 2 };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });

  it('returns null for a non-pending challenge', () => {
    const engine = makeEngine();
    const snapshot = { id: 'ch1', status: 'success', remainingSeconds: 5, requiredCount: 2, actualCount: 2 };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });

  it('returns null when there is no challenge snapshot', () => {
    const engine = makeEngine();
    expect(engine._computeAudioDuck(null)).toBeNull();
  });

  it('returns null when no cues are configured', () => {
    const engine = makeEngine();
    engine._audioCues = [];
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 5, requiredCount: 2, actualCount: 1 };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });

  it('returns null for a cycle challenge snapshot', () => {
    const engine = makeEngine();
    const snapshot = { id: 'ch1', type: 'cycle', status: 'pending', remainingSeconds: 5 };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });

  it('treats an empty missingUsers list (no counts) as satisfied → null', () => {
    const engine = makeEngine();
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 8, requiredCount: null, actualCount: null, missingUsers: [] };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });

  it('fires when missingUsers is non-empty (no counts)', () => {
    const engine = makeEngine();
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 8, requiredCount: null, actualCount: null, missingUsers: ['alice'] };
    expect(engine._computeAudioDuck(snapshot)).toMatchObject({ cueId: 'challenge_hurry', token: 'ch1:challenge_hurry' });
  });

  it('exposes audioDuck on the composed state', () => {
    const engine = makeEngine();
    // Stub the challenge snapshot used by _composeState.
    engine._buildChallengeSnapshot = () => ({ id: 'ch1', status: 'pending', remainingSeconds: 9, requiredCount: 2, actualCount: 0 });
    const state = engine._composeState();
    expect(state.audioDuck).toMatchObject({ cueId: 'challenge_hurry', token: 'ch1:challenge_hurry' });
  });
});

describe('GovernanceEngine — audio cues: start / complete / warning triggers', () => {
  const cues = [
    { id: 'c_start', trigger: 'challenge_start', sound: 'apps/fitness/ux/challenge-start.mp3', duckTo: 0.2 },
    { id: 'c_hurry', trigger: 'challenge_remaining', thresholdSeconds: 12, sound: 'apps/fitness/ux/challenge-hurry.mp3', duckTo: 0.1 },
    { id: 'c_done', trigger: 'challenge_complete', sound: 'apps/fitness/ux/challenge-complete.mp3', duckTo: 0.2 },
    { id: 'c_warn', trigger: 'governance_warning', sound: 'apps/fitness/ux/challenge-warning.mp3', duckTo: 0.15 }
  ];
  const makeEngine = (phase = 'unlocked') => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine._audioCues = cues;
    engine.phase = phase;
    return engine;
  };
  const pending = (remaining) => ({ id: 'ch1', status: 'pending', remainingSeconds: remaining, requiredCount: 2, actualCount: 1 });

  it('parses edge triggers (start/complete/warning) without a threshold', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig([
      { id: 'c_start', trigger: 'challenge_start', sound: 'a.mp3' },
      { id: 'c_done', trigger: 'challenge_complete', sound: 'b.mp3' },
      { id: 'c_warn', trigger: 'governance_warning', sound: 'c.mp3' }
    ]));
    expect(engine._audioCues).toHaveLength(3);
    expect(engine._audioCues.map((c) => c.trigger)).toEqual(['challenge_start', 'challenge_complete', 'governance_warning']);
    expect(engine._audioCues[0].thresholdSeconds).toBeNull();
  });

  it('still drops a challenge_remaining cue that is missing its threshold', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig([{ id: 'c_hurry', trigger: 'challenge_remaining', sound: 'a.mp3' }]));
    expect(engine._audioCues).toHaveLength(0);
  });

  it('fires challenge_start while pending, before the hurry window', () => {
    const engine = makeEngine();
    expect(engine._computeAudioDuck(pending(40))).toMatchObject({ cueId: 'c_start', token: 'ch1:c_start' });
  });

  it('fires challenge_remaining (hurry) inside the threshold window', () => {
    const engine = makeEngine();
    expect(engine._computeAudioDuck(pending(8))).toMatchObject({ cueId: 'c_hurry', token: 'ch1:c_hurry' });
  });

  it('fires challenge_complete when the challenge is satisfied by count', () => {
    const engine = makeEngine();
    const duck = engine._computeAudioDuck({ id: 'ch1', status: 'pending', remainingSeconds: 5, requiredCount: 2, actualCount: 2 });
    expect(duck).toMatchObject({ cueId: 'c_done', token: 'ch1:c_done' });
  });

  it('fires challenge_complete on success status', () => {
    const engine = makeEngine();
    const duck = engine._computeAudioDuck({ id: 'ch1', status: 'success', remainingSeconds: 0, requiredCount: 2, actualCount: 2 });
    expect(duck).toMatchObject({ cueId: 'c_done', token: 'ch1:c_done' });
  });

  it('fires governance_warning when phase is warning, keyed to the episode', () => {
    const engine = makeEngine('warning');
    engine._warningStartTime = 5000;
    expect(engine._computeAudioDuck(pending(8))).toMatchObject({ cueId: 'c_warn', token: 'c_warn:5000' });
  });

  it('warning takes precedence over an active challenge hurry cue', () => {
    const engine = makeEngine('warning');
    engine._warningStartTime = 5000;
    expect(engine._computeAudioDuck(pending(8)).cueId).toBe('c_warn');
  });

  it('warning token changes between episodes so it can refire', () => {
    const engine = makeEngine('warning');
    engine._warningStartTime = 5000;
    const first = engine._computeAudioDuck(null);
    engine._warningStartTime = 9000;
    const second = engine._computeAudioDuck(null);
    expect(first.token).not.toBe(second.token);
  });

  it('does not fire challenge_start when only a hurry cue is configured and we are before the window', () => {
    const engine = makeEngine();
    engine._audioCues = [cues[1]]; // hurry only
    expect(engine._computeAudioDuck(pending(40))).toBeNull();
  });
});
