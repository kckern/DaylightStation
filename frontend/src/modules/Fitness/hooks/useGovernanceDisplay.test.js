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

// ---------------------------------------------------------------------------
// metRows: participants who HAVE satisfied their requirement.
// `rows` is missing-only by construction, so without metRows a rider who
// reaches their target disappears from the lock screen the moment they earn it.
// ---------------------------------------------------------------------------

const zoneMetaWithCardio = {
  map: {
    cardio: { id: 'cardio', name: 'Cardio', rank: 3, color: '#f97316' },
    'fat-burn': { id: 'fat-burn', name: 'Fat Burn', rank: 2, color: '#facc15' }
  }
};

function makeDisplayMap(entries) {
  return new Map(Object.entries(entries));
}

describe('resolveGovernanceDisplay — metRows', () => {
  it('resolves met users of an unsatisfied requirement against the display map', () => {
    const govState = makeGovState({
      status: 'locked',
      requirements: [{
        satisfied: false,
        zone: 'cardio',
        missingUsers: ['rider-b'],
        metUsers: ['rider-a']
      }]
    });
    const displayMap = makeDisplayMap({
      'rider-a': { displayName: 'Rider A', avatarSrc: '/img/a', heartRate: 150, zoneId: 'cardio' },
      'rider-b': { displayName: 'Rider B', avatarSrc: '/img/b', heartRate: 95, zoneId: 'fat-burn' }
    });

    const result = resolveGovernanceDisplay(govState, displayMap, zoneMetaWithCardio);

    expect(result.metRows).toHaveLength(1);
    expect(result.metRows[0]).toMatchObject({
      key: 'rider-a',
      displayName: 'Rider A',
      avatarSrc: '/img/a',
      heartRate: 150
    });
    expect(result.metRows[0].currentZone).toMatchObject({ id: 'cardio', name: 'Cardio' });
  });

  it('keeps met and missing participants disjoint — missing wins', () => {
    const govState = makeGovState({
      status: 'locked',
      requirements: [
        { satisfied: false, zone: 'cardio', missingUsers: ['rider-a'], metUsers: [] },
        { satisfied: false, zone: 'fat-burn', missingUsers: [], metUsers: ['rider-a'] }
      ]
    });
    const displayMap = makeDisplayMap({
      'rider-a': { displayName: 'Rider A', avatarSrc: '/img/a', heartRate: 120, zoneId: 'fat-burn' }
    });

    const result = resolveGovernanceDisplay(govState, displayMap, zoneMetaWithCardio);

    expect(result.rows.map((r) => r.key)).toContain('rider-a');
    expect(result.metRows.map((r) => r.key)).not.toContain('rider-a');
  });

  it('credits met users from an active challenge', () => {
    const govState = makeGovState({
      status: 'locked',
      challenge: {
        type: 'zone',
        status: 'pending',
        zone: 'cardio',
        missingUsers: ['rider-b'],
        metUsers: ['rider-a']
      }
    });
    const displayMap = makeDisplayMap({
      'rider-a': { displayName: 'Rider A', avatarSrc: '/img/a', heartRate: 160, zoneId: 'cardio' },
      'rider-b': { displayName: 'Rider B', avatarSrc: '/img/b', heartRate: 90, zoneId: 'fat-burn' }
    });

    const result = resolveGovernanceDisplay(govState, displayMap, zoneMetaWithCardio);

    expect(result.metRows.map((r) => r.key)).toEqual(['rider-a']);
  });

  it('dedupes a user credited by more than one requirement', () => {
    const govState = makeGovState({
      status: 'locked',
      requirements: [
        { satisfied: false, zone: 'cardio', missingUsers: ['rider-b'], metUsers: ['rider-a'] },
        { satisfied: false, zone: 'fat-burn', missingUsers: ['rider-b'], metUsers: ['rider-a'] }
      ]
    });
    const displayMap = makeDisplayMap({
      'rider-a': { displayName: 'Rider A', avatarSrc: '/img/a', heartRate: 150, zoneId: 'cardio' },
      'rider-b': { displayName: 'Rider B', avatarSrc: '/img/b', heartRate: 80, zoneId: 'fat-burn' }
    });

    const result = resolveGovernanceDisplay(govState, displayMap, zoneMetaWithCardio);

    expect(result.metRows).toHaveLength(1);
  });

  it('still credits a met user the display map has no entry for', () => {
    const govState = makeGovState({
      status: 'locked',
      requirements: [{ satisfied: false, zone: 'cardio', missingUsers: [], metUsers: ['ghost'] }]
    });

    const result = resolveGovernanceDisplay(govState, emptyDisplayMap, zoneMetaWithCardio);

    expect(result.metRows).toHaveLength(1);
    expect(result.metRows[0].displayName).toBe('ghost');
    expect(result.metRows[0].avatarSrc).toBeTruthy();
  });

  it('returns an empty metRows when nobody has satisfied yet', () => {
    const govState = makeGovState({
      status: 'pending',
      requirements: [{ satisfied: false, zone: 'cardio', missingUsers: ['rider-a'], metUsers: [] }]
    });
    const displayMap = makeDisplayMap({
      'rider-a': { displayName: 'Rider A', avatarSrc: '/img/a', heartRate: 80, zoneId: 'fat-burn' }
    });

    const result = resolveGovernanceDisplay(govState, displayMap, zoneMetaWithCardio);

    expect(result.metRows).toEqual([]);
  });
});
