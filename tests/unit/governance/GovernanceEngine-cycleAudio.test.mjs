import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

/**
 * Task 19: Wire audio cues on cycle state transitions.
 *
 * The cycle challenge snapshot should include a `cycleAudioCue` field that
 * emits a specific cue string on edge events (and null otherwise):
 *
 *   - 'cycle_challenge_init'  — first snapshot of a fresh cycle challenge
 *   - 'cycle_phase_complete'  — phase advance (currentPhaseIndex increments)
 *   - 'cycle_success'         — transition to status 'success'
 *   - 'cycle_locked'          — transition into 'locked' cycleState
 *
 * Cues must be edge-triggered: only the first snapshot after the transition
 * carries the cue; subsequent snapshots in the same state emit null.
 */
describe('GovernanceEngine cycle audio cues', () => {
  let engine;

  beforeEach(() => {
    engine = new GovernanceEngine(null, { now: () => 10000 });
  });

  function makeActive(overrides = {}) {
    return {
      id: 'test_0',
      type: 'cycle',
      rider: 'felix',
      equipment: 'cycle_ace',
      cycleState: 'init',
      status: 'pending',
      currentPhaseIndex: 0,
      totalPhases: 2,
      generatedPhases: [
        { hiRpm: 60, loRpm: 45, rampSeconds: 10, maintainSeconds: 30 },
        { hiRpm: 70, loRpm: 55, rampSeconds: 15, maintainSeconds: 45 }
      ],
      selection: {
        init: { minRpm: 30, timeAllowedSeconds: 60 },
        boost: { zoneMultipliers: {}, maxTotalMultiplier: 3.0 }
      },
      initElapsedMs: 0,
      initTotalMs: 60000,
      rampElapsedMs: 0,
      phaseProgressMs: 0,
      totalLockEventsCount: 0,
      totalBoostedMs: 0,
      boostContributors: new Set(),
      startedAt: 10000,
      lockReason: null,
      ridersUsed: ['felix'],
      ...overrides
    };
  }

  it('first snapshot of a cycle challenge emits cycle_challenge_init cue', () => {
    engine.challengeState.activeChallenge = makeActive();
    const snap = engine._buildChallengeSnapshot(10000);
    expect(snap.cycleAudioCue).toBe('cycle_challenge_init');
  });

  it('subsequent snapshot in same state emits null', () => {
    const active = makeActive();
    engine.challengeState.activeChallenge = active;
    engine._buildChallengeSnapshot(10000); // consume init cue
    const snap2 = engine._buildChallengeSnapshot(10100);
    expect(snap2.cycleAudioCue).toBeNull();
  });

  it('transition to locked emits cycle_locked cue', () => {
    const active = makeActive();
    engine.challengeState.activeChallenge = active;
    engine._buildChallengeSnapshot(10000); // consume init cue
    active.cycleState = 'locked';
    active.lockReason = 'maintain';
    const snap = engine._buildChallengeSnapshot(10100);
    expect(snap.cycleAudioCue).toBe('cycle_locked');
  });

  it('subsequent snapshots while still locked emit null', () => {
    const active = makeActive();
    engine.challengeState.activeChallenge = active;
    engine._buildChallengeSnapshot(10000);
    active.cycleState = 'locked';
    active.lockReason = 'maintain';
    engine._buildChallengeSnapshot(10100); // consume locked cue
    const snap = engine._buildChallengeSnapshot(10200);
    expect(snap.cycleAudioCue).toBeNull();
  });

  it('transition to success emits cycle_success cue', () => {
    const active = makeActive();
    engine.challengeState.activeChallenge = active;
    engine._buildChallengeSnapshot(10000);
    active.status = 'success';
    const snap = engine._buildChallengeSnapshot(10100);
    expect(snap.cycleAudioCue).toBe('cycle_success');
  });

  it('phase advance emits cycle_phase_complete cue', () => {
    const active = makeActive({ cycleState: 'maintain' });
    engine.challengeState.activeChallenge = active;
    engine._buildChallengeSnapshot(10000); // consume init cue (first sight)
    active.currentPhaseIndex = 1;
    active.cycleState = 'ramp';
    const snap = engine._buildChallengeSnapshot(10100);
    expect(snap.cycleAudioCue).toBe('cycle_phase_complete');
  });

  it('phase advance cue does not refire on subsequent snapshots at same phase', () => {
    const active = makeActive({ cycleState: 'maintain' });
    engine.challengeState.activeChallenge = active;
    engine._buildChallengeSnapshot(10000); // init
    active.currentPhaseIndex = 1;
    active.cycleState = 'ramp';
    engine._buildChallengeSnapshot(10100); // phase_complete
    const snap = engine._buildChallengeSnapshot(10200);
    expect(snap.cycleAudioCue).toBeNull();
  });

  it('cleared cycle challenge resets tracker so new challenge emits init again', () => {
    // First challenge
    const activeA = makeActive({ id: 'cyc_A' });
    engine.challengeState.activeChallenge = activeA;
    engine._buildChallengeSnapshot(10000);

    // Clear + start a second (independent) cycle challenge
    const activeB = makeActive({ id: 'cyc_B' });
    engine.challengeState.activeChallenge = activeB;
    const snap = engine._buildChallengeSnapshot(10200);
    expect(snap.cycleAudioCue).toBe('cycle_challenge_init');
  });

  it('cycleAudioCue is null for non-cycle (zone) challenges', () => {
    engine.challengeState.activeChallenge = {
      id: 'zn_1',
      type: 'zone',
      status: 'pending',
      zone: 'hot',
      requiredCount: 2,
      summary: { zoneLabel: 'Hot', actualCount: 1, metUsers: [], missingUsers: [] },
      timeLimitSeconds: 60,
      startedAt: 10000,
      expiresAt: 70000
    };
    const snap = engine._buildChallengeSnapshot(10000);
    // Zone branch returns a different shape — cycleAudioCue should be absent/undefined
    // (it's a cycle-only field). Accept either null or undefined.
    expect(snap.cycleAudioCue == null).toBe(true);
  });
});
