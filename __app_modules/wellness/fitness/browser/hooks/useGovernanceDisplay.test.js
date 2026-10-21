import { describe, it, expect } from 'vitest';
import { resolveGovernanceDisplay } from "./useGovernanceDisplay.js";

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

describe('resolveGovernanceDisplay — activity rate', () => {
  it('surfaces an unsatisfied step-rate requirement without inventing an HR row', () => {
    const requirement = {
      id: 'keep-stepping', type: 'activity_rate', equipment: 'step_mat',
      currentRate: 12, targetRate: 30, satisfied: false, missingUsers: [], metUsers: [],
    };
    const result = resolveGovernanceDisplay(makeGovState({
      status: 'locked', requirements: [requirement], activeUserCount: 0,
    }), emptyDisplayMap, emptyZoneMeta);
    expect(result.show).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.activityRequirements).toEqual([requirement]);
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


describe('resolveGovernanceDisplay — cadence sensor recovery', () => {
  it.each(['init', 'ramp', 'health'])('does not infer a video lock from frozen %s cycling state', (lockReason) => {
    const result = resolveGovernanceDisplay(makeGovState({
      challenge: makeCycleChallenge({ cycleState: 'locked', lockReason, sensorUnavailable: true }),
    }), emptyDisplayMap, emptyZoneMeta);
    expect(result.show).toBe(false);
    expect(Boolean(result.videoLocked)).toBe(false);
  });

  it('keeps the base HR requirement without stale cycle targets or credits during recovery', () => {
    const result = resolveGovernanceDisplay(makeGovState({
      status: 'locked', videoLocked: true,
      requirements: [{ satisfied: false, zone: 'fat-burn', missingUsers: ['rider-b'], metUsers: [], requiredCount: 1 }],
      challenge: makeCycleChallenge({
        cycleState: 'locked', sensorUnavailable: true, zone: 'cardio', missingUsers: ['rider-a'], metUsers: ['stale-credit'],
      }),
    }), makeDisplayMap({
      'rider-b': { displayName: 'Rider B', heartRate: 90, zoneId: 'fat-burn' },
    }), zoneMetaWithCardio);
    expect(result.show).toBe(true);
    expect(result.videoLocked).toBe(true);
    expect(result.rows.map((row) => row.userId)).toEqual(['rider-b']);
    expect(result.rows[0].targetZone.id).toBe('fat-burn');
    expect(result.metRows).toEqual([]);
    expect(result.challenge).toBeNull();
  });
});

describe('resolveGovernanceDisplay — unattended start state and challenge holds', () => {
  const unattendedStart = {
    zone: 'cardio',
    zoneLabel: 'Cardio',
    children: {
      'child-a': { started: true, overdue: false, remainingMs: 0 },
      'child-b': { started: false, overdue: false, remainingMs: 80_000 },
      'child-c': { started: false, overdue: true, remainingMs: 0 },
    },
  };

  it('maps not-started children to reach-start / start-overdue, even while unlocked', () => {
    const result = resolveGovernanceDisplay(makeGovState({ unattendedStart }), emptyDisplayMap, zoneMetaWithCardio);
    expect(result.show).toBe(false);
    expect(result.participantStatuses['child-a']).toBeUndefined();
    expect(result.participantStatuses['child-b']).toEqual({ status: 'reach-start', zoneLabel: 'Cardio', remainingMs: 80_000 });
    expect(result.participantStatuses['child-c']).toEqual({ status: 'start-overdue', zoneLabel: 'Cardio', remainingMs: 0 });
  });

  it('marks the overdue child\'s warning row as start-overdue', () => {
    const result = resolveGovernanceDisplay(makeGovState({
      status: 'warning',
      unattendedStart,
      requirements: [{ id: '__unattended_child_start', satisfied: false, zone: 'cardio', missingUsers: ['child-c'], metUsers: [] }],
    }), makeDisplayMap({ 'child-c': { displayName: 'Child C', heartRate: 100, zoneId: 'fat-burn' } }), zoneMetaWithCardio);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ userId: 'child-c', status: 'start-overdue', statusZoneLabel: 'Cardio' });
  });

  it('a rider mid-hold is holding, not missing', () => {
    const result = resolveGovernanceDisplay(makeGovState({
      status: 'warning',
      challenge: {
        type: 'zone', status: 'pending', zone: 'cardio', zoneLabel: 'Cardio',
        metUsers: [], missingUsers: ['child-a', 'child-b'], holding: ['child-a'], holdRemainingMs: 4_000,
      },
    }), makeDisplayMap({
      'child-a': { displayName: 'Child A', heartRate: 150, zoneId: 'cardio' },
      'child-b': { displayName: 'Child B', heartRate: 100, zoneId: 'fat-burn' },
    }), zoneMetaWithCardio);
    const byId = Object.fromEntries(result.rows.map((row) => [row.userId, row.status]));
    expect(byId).toEqual({ 'child-a': 'holding', 'child-b': 'missing' });
    expect(result.participantStatuses['child-a']).toMatchObject({ status: 'holding', zoneLabel: 'Cardio' });
  });

  it('no unattended state and no holds means no participant statuses', () => {
    const result = resolveGovernanceDisplay(makeGovState(), emptyDisplayMap, emptyZoneMeta);
    expect(result.participantStatuses).toEqual({});
  });
});
