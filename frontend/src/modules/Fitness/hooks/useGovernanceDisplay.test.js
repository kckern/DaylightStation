import { describe, it, expect } from 'vitest';
import { resolveGovernanceDisplay } from './useGovernanceDisplay.js';

// Minimal stubs — resolveGovernanceDisplay is a pure function, no React needed.
const emptyDisplayMap = new Map();
const emptyZoneMeta = { map: {} };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGovState(overrides = {}) {
  return {
    isGoverned: true,
    status: 'unlocked',
    requirements: [],
    challenge: null,
    deadline: null,
    gracePeriodTotal: null,
    videoLocked: false,
    hrInactiveUsers: [],
    activeUserCount: 1,
    ...overrides
  };
}

function makeCycleChallenge(overrides = {}) {
  return {
    type: 'cycle',
    cycleState: 'maintain',
    lockReason: null,
    status: 'pending',
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Cycle health-lock: show must be false, videoLocked must be true
// ---------------------------------------------------------------------------

describe('resolveGovernanceDisplay — cycle health-lock', () => {
  it('returns show:false when cycleState=locked and lockReason=health', () => {
    const govState = makeGovState({
      challenge: makeCycleChallenge({ cycleState: 'locked', lockReason: 'health' })
    });
    const result = resolveGovernanceDisplay(govState, emptyDisplayMap, emptyZoneMeta);
    expect(result).not.toBeNull();
    expect(result.show).toBe(false);
  });

  it('returns videoLocked:true for a health-lock', () => {
    const govState = makeGovState({
      challenge: makeCycleChallenge({ cycleState: 'locked', lockReason: 'health' })
    });
    const result = resolveGovernanceDisplay(govState, emptyDisplayMap, emptyZoneMeta);
    expect(result.videoLocked).toBe(true);
  });

  it('still forwards the challenge object so callers can inspect it', () => {
    const challenge = makeCycleChallenge({ cycleState: 'locked', lockReason: 'health' });
    const govState = makeGovState({ challenge });
    const result = resolveGovernanceDisplay(govState, emptyDisplayMap, emptyZoneMeta);
    expect(result.challenge).toBe(challenge);
  });
});

// ---------------------------------------------------------------------------
// Non-health cycle lock (init/ramp): show must be true
// ---------------------------------------------------------------------------

describe('resolveGovernanceDisplay — non-health cycle locks', () => {
  it('returns show:true for lockReason=init (surface to GovernanceStateOverlay)', () => {
    const govState = makeGovState({
      challenge: makeCycleChallenge({ cycleState: 'locked', lockReason: 'init' })
    });
    const result = resolveGovernanceDisplay(govState, emptyDisplayMap, emptyZoneMeta);
    expect(result).not.toBeNull();
    expect(result.show).toBe(true);
  });

  it('returns show:true for lockReason=ramp', () => {
    const govState = makeGovState({
      challenge: makeCycleChallenge({ cycleState: 'locked', lockReason: 'ramp' })
    });
    const result = resolveGovernanceDisplay(govState, emptyDisplayMap, emptyZoneMeta);
    expect(result.show).toBe(true);
  });

  it('returns videoLocked:false for a non-health cycle lock', () => {
    const govState = makeGovState({
      challenge: makeCycleChallenge({ cycleState: 'locked', lockReason: 'init' })
    });
    const result = resolveGovernanceDisplay(govState, emptyDisplayMap, emptyZoneMeta);
    expect(result.videoLocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regression: normal HR-based governance lock still surfaces (show:true)
// ---------------------------------------------------------------------------

describe('resolveGovernanceDisplay — HR governance lock regression', () => {
  it('returns show:true for a normal HR phase=locked with no rows', () => {
    const govState = makeGovState({
      status: 'locked',
      challenge: null
    });
    const result = resolveGovernanceDisplay(govState, emptyDisplayMap, emptyZoneMeta);
    expect(result).not.toBeNull();
    expect(result.show).toBe(true);
  });

  it('returns show:true for a normal HR phase=pending with no rows', () => {
    const govState = makeGovState({
      status: 'pending',
      challenge: null
    });
    const result = resolveGovernanceDisplay(govState, emptyDisplayMap, emptyZoneMeta);
    expect(result.show).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Non-governed content returns null
// ---------------------------------------------------------------------------

describe('resolveGovernanceDisplay — non-governed', () => {
  it('returns null when isGoverned is false', () => {
    const govState = makeGovState({ isGoverned: false });
    const result = resolveGovernanceDisplay(govState, emptyDisplayMap, emptyZoneMeta);
    expect(result).toBeNull();
  });
});
