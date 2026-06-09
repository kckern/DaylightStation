import { describe, it, expect } from 'vitest';
import { resolveCycleAudioCue, CYCLE_HURRY_COOLDOWN_MS } from './challengeAudioCues.js';

describe('resolveCycleAudioCue — edge cues', () => {
  it('maps init→cycle_start, success→cycle_end, locked→cycle_fail', () => {
    expect(resolveCycleAudioCue({ cycleAudioCue: 'cycle_challenge_init' }, { now: 0 }).trigger).toBe('cycle_start');
    expect(resolveCycleAudioCue({ cycleAudioCue: 'cycle_success' }, { now: 0 }).trigger).toBe('cycle_end');
    expect(resolveCycleAudioCue({ cycleAudioCue: 'cycle_locked' }, { now: 0 }).trigger).toBe('cycle_fail');
  });

  it('ignores phase_complete (no cue)', () => {
    expect(resolveCycleAudioCue({ cycleAudioCue: 'cycle_phase_complete' }, { now: 0 }).trigger).toBeNull();
  });
});

describe('resolveCycleAudioCue — health-based hurry', () => {
  const danger = { cycleAudioCue: null, currentPhase: { loRpm: 60, hiRpm: 80 }, currentRpm: 50, cycleHealthPct: 0.8 };

  it('fires cycle_hurry when below red (loRpm) and health is dropping', () => {
    const r = resolveCycleAudioCue(danger, { now: 1000, cooldownUntil: 0 });
    expect(r.trigger).toBe('cycle_hurry');
    expect(r.cooldownUntil).toBe(1000 + CYCLE_HURRY_COOLDOWN_MS);
  });

  it('does NOT fire while above red even if health is below full', () => {
    expect(resolveCycleAudioCue({ ...danger, currentRpm: 75 }, { now: 1000 }).trigger).toBeNull();
  });

  it('does NOT fire while full health (needle just crossed, nothing dropping yet)', () => {
    expect(resolveCycleAudioCue({ ...danger, cycleHealthPct: 1 }, { now: 1000 }).trigger).toBeNull();
  });

  it('respects the cooldown to prevent thrashing across the line', () => {
    const r = resolveCycleAudioCue(danger, { now: 2000, cooldownUntil: 9000 });
    expect(r.trigger).toBeNull();
    expect(r.cooldownUntil).toBe(9000); // unchanged
  });
});
