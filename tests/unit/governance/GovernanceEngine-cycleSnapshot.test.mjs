import { describe, it, expect, jest, beforeEach } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

/**
 * Build a configured engine with a minimal session + a baseline active cycle challenge.
 * The active challenge is attached to engine.challengeState.activeChallenge and the
 * per-test code mutates its cycleState / phaseProgressMs / etc. as needed.
 */
function buildEngine({
  eligibleUsers = ['felix', 'milo', 'kckern'],
  profiles = { felix: { name: 'Felix the Cat' }, milo: { name: 'Milo' }, kckern: { name: 'KC' } },
  nowValue = 30000
} = {}) {
  const session = {
    _deviceRouter: {
      getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: eligibleUsers }]
    },
    getParticipantProfile: (uid) => profiles[uid] || null
  };
  const engine = new GovernanceEngine(session, { now: () => nowValue });
  return engine;
}

function baseActiveCycle(overrides = {}) {
  return {
    id: 'cyc_1',
    type: 'cycle',
    status: 'pending',
    rider: 'felix',
    ridersUsed: ['felix'],
    equipment: 'cycle_ace',
    generatedPhases: [
      { hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 },
      { hiRpm: 70, loRpm: 55, rampSeconds: 20, maintainSeconds: 45 }
    ],
    totalPhases: 2,
    currentPhaseIndex: 0,
    cycleState: 'init',
    initStartedAt: 30000,
    initElapsedMs: 0,
    initTotalMs: 60000,
    rampElapsedMs: 0,
    phaseProgressMs: 0,
    totalLockEventsCount: 0,
    totalBoostedMs: 0,
    boostContributors: new Set(),
    lockReason: null,
    pausedAt: null,
    selectionId: 'sel_cycle_ace',
    selectionLabel: 'Cycle Challenge',
    selection: {
      init: { minRpm: 30, timeAllowedSeconds: 60 },
      boost: { zoneMultipliers: { hot: 0.5, fire: 1.0 }, maxTotalMultiplier: 3.0 }
    },
    ...overrides
  };
}

describe('GovernanceEngine cycle challenge snapshot', () => {
  let engine;
  const now = 30000;

  beforeEach(() => {
    engine = buildEngine({ nowValue: now });
  });

  it('snapshot during init has correct shape and key fields', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({
      cycleState: 'init',
      initElapsedMs: 10000,
      initTotalMs: 60000
    });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 25, ts: now } };
    engine._latestInputs.activeParticipants = ['felix'];
    engine._latestInputs.userZoneMap = { felix: 'warm' };

    const snap = engine._buildChallengeSnapshot(now);

    expect(snap).not.toBeNull();
    expect(snap.id).toBe('cyc_1');
    expect(snap.type).toBe('cycle');
    expect(snap.status).toBe('pending');
    expect(snap.rider).toEqual({ id: 'felix', name: 'Felix the Cat' });
    expect(snap.cycleState).toBe('init');
    expect(snap.currentPhaseIndex).toBe(0);
    expect(snap.totalPhases).toBe(2);
    expect(snap.currentPhase).toEqual({ hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 });
    expect(Array.isArray(snap.generatedPhases)).toBe(true);
    expect(snap.generatedPhases).toHaveLength(2);
    expect(snap.currentRpm).toBe(25);
    expect(snap.phaseProgressPct).toBe(0);
    expect(snap.allPhasesProgress).toEqual([0, 0]);
    expect(snap.initRemainingMs).toBe(50000);
    expect(snap.initTotalMs).toBe(60000);
    expect(snap.rampRemainingMs).toBe(15000);
    expect(snap.rampTotalMs).toBe(15000);
    expect(snap.dimFactor).toBe(0);
    expect(snap.boostMultiplier).toBe(1.0);
    expect(Array.isArray(snap.boostingUsers)).toBe(true);
    expect(snap.lockReason).toBeNull();
    expect(snap.swapAllowed).toBe(true);
    expect(Array.isArray(snap.swapEligibleUsers)).toBe(true);
  });

  it('snapshot during ramp has rampRemainingMs counting down', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({
      cycleState: 'ramp',
      rampElapsedMs: 6000
    });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 50, ts: now } };

    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.cycleState).toBe('ramp');
    expect(snap.rampTotalMs).toBe(15000);
    expect(snap.rampRemainingMs).toBe(9000);
    // In ramp, dim doesn't apply
    expect(snap.dimFactor).toBe(0);
  });

  it('snapshot during maintain — dimFactor = 0 when rpm at hi', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({ cycleState: 'maintain' });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 60, ts: now } }; // at hi

    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.cycleState).toBe('maintain');
    // rpm >= hiRpm → dimFactor = 0 (not in dim band)
    expect(snap.dimFactor).toBe(0);
  });

  it('snapshot during maintain — dimFactor ~0.5 when rpm midway between lo and hi', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({ cycleState: 'maintain' });
    // lo=45, hi=60 → midway is 52.5
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 52.5, ts: now } };

    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.cycleState).toBe('maintain');
    expect(snap.dimFactor).toBeCloseTo(0.5, 5);
  });

  it('snapshot during maintain — dimFactor = 0 when rpm below lo (locked state — dim does not apply)', () => {
    // When RPM < lo we're below the dim band. _buildChallengeSnapshot branch only
    // computes a non-zero dim when rpm is within [lo, hi). Below lo it stays 0.
    engine.challengeState.activeChallenge = baseActiveCycle({ cycleState: 'maintain' });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 30, ts: now } };
    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.dimFactor).toBe(0);
  });

  it('snapshot during locked — lockReason set, dimFactor 0', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({
      cycleState: 'locked',
      lockReason: 'maintain'
    });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 30, ts: now } };

    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.cycleState).toBe('locked');
    expect(snap.lockReason).toBe('maintain');
    expect(snap.dimFactor).toBe(0);
  });

  it('swapAllowed: true in init', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({ cycleState: 'init' });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 10, ts: now } };
    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.swapAllowed).toBe(true);
  });

  it('swapAllowed: true in phase-1 ramp (currentPhaseIndex === 0)', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({
      cycleState: 'ramp',
      currentPhaseIndex: 0,
      rampElapsedMs: 1000
    });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 40, ts: now } };
    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.swapAllowed).toBe(true);
  });

  it('swapAllowed: false in maintain', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({ cycleState: 'maintain' });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 60, ts: now } };
    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.swapAllowed).toBe(false);
  });

  it('swapAllowed: false in phase-2 ramp (currentPhaseIndex > 0)', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({
      cycleState: 'ramp',
      currentPhaseIndex: 1,
      rampElapsedMs: 2000
    });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 60, ts: now } };
    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.swapAllowed).toBe(false);
  });

  it('swapEligibleUsers excludes current rider and cooldown users', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({ cycleState: 'init' });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 10, ts: now } };
    // Set milo on cooldown
    engine._cycleCooldowns = { milo: now + 10000 };
    const snap = engine._buildChallengeSnapshot(now);
    // Eligible pool: felix, milo, kckern
    // Remove felix (rider) and milo (cooldown) → kckern remains
    expect(snap.swapEligibleUsers).toEqual(['kckern']);
  });

  it('swapEligibleUsers includes users whose cooldown has expired', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({ cycleState: 'init' });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 10, ts: now } };
    // milo cooldown expired (<= now)
    engine._cycleCooldowns = { milo: now - 1000 };
    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.swapEligibleUsers).toContain('milo');
    expect(snap.swapEligibleUsers).toContain('kckern');
    expect(snap.swapEligibleUsers).not.toContain('felix');
  });

  it('phaseProgressPct clamps to 1.0 — never exceeds', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({
      cycleState: 'maintain',
      phaseProgressMs: 99999 // massively over maintainSeconds*1000 (30_000)
    });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 60, ts: now } };
    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.phaseProgressPct).toBe(1.0);
    // And the clamped entry in allPhasesProgress for current phase
    expect(snap.allPhasesProgress[0]).toBe(1.0);
  });

  it('allPhasesProgress shows past phases as 1.0 and future phases as 0', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({
      cycleState: 'maintain',
      currentPhaseIndex: 1,
      phaseProgressMs: 22500 // half of phase[1].maintainSeconds*1000 (45_000)
    });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 70, ts: now } };
    const snap = engine._buildChallengeSnapshot(now);
    // phase 0 is past → 1.0; phase 1 is current → 0.5
    expect(snap.allPhasesProgress[0]).toBe(1.0);
    expect(snap.allPhasesProgress[1]).toBeCloseTo(0.5, 5);
  });

  it('boostMultiplier computed correctly with boosters and self-boost', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({ cycleState: 'maintain' });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 60, ts: now } };
    // felix (rider) is in fire (+1.0), milo is in hot (+0.5) → 1.0 + 1.0 + 0.5 = 2.5
    engine._latestInputs.userZoneMap = { felix: 'fire', milo: 'hot' };
    engine._latestInputs.activeParticipants = ['felix', 'milo'];
    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.boostMultiplier).toBeCloseTo(2.5, 5);
    expect(snap.boostingUsers).toEqual(expect.arrayContaining(['felix', 'milo']));
    expect(snap.boostingUsers).toHaveLength(2);
  });

  it('falls back to rider id as name when session.getParticipantProfile returns null', () => {
    engine = buildEngine({ nowValue: now, profiles: {} });
    engine.challengeState.activeChallenge = baseActiveCycle({ cycleState: 'init' });
    engine._latestInputs.equipmentCadenceMap = { cycle_ace: { rpm: 10, ts: now } };
    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.rider).toEqual({ id: 'felix', name: 'felix' });
  });

  it('currentRpm is 0 when equipmentCadenceMap missing', () => {
    engine.challengeState.activeChallenge = baseActiveCycle({ cycleState: 'init' });
    // No equipmentCadenceMap entry set
    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.currentRpm).toBe(0);
  });

  it('does not affect zone challenge snapshot shape', () => {
    // Pre-existing zone branch must still emit a zone-shaped snapshot
    engine.challengeState.activeChallenge = {
      id: 'zn_1',
      type: 'zone',
      status: 'pending',
      zone: 'hot',
      requiredCount: 2,
      summary: { zoneLabel: 'Hot', actualCount: 1, metUsers: ['a'], missingUsers: ['b'] },
      timeLimitSeconds: 60,
      startedAt: now,
      expiresAt: now + 60000,
      selectionLabel: 'Zone Thing'
    };
    const snap = engine._buildChallengeSnapshot(now);
    expect(snap.type).toBeUndefined(); // zone snapshots don't set type
    expect(snap.zone).toBe('hot');
    expect(snap.zoneLabel).toBe('Hot');
    expect(snap.requiredCount).toBe(2);
  });
});
