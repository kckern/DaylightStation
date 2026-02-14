import { jest } from '@jest/globals';

// Mock React hooks for unit testing
const mockUseMemo = jest.fn((fn) => fn());
jest.unstable_mockModule('react', () => ({
  useMemo: mockUseMemo,
  default: { useMemo: mockUseMemo }
}));

const { resolveGovernanceDisplay } = await import(
  '#frontend/modules/Fitness/hooks/useGovernanceDisplay.js'
);

const ZONE_META = {
  map: {
    cool: { id: 'cool', name: 'Cool', color: '#94a3b8', rank: 0, min: 0 },
    active: { id: 'active', name: 'Active', color: '#22c55e', rank: 1, min: 100 },
    warm: { id: 'warm', name: 'Warm', color: '#eab308', rank: 2, min: 130 }
  },
  rankMap: { cool: 0, active: 1, warm: 2 },
  infoMap: {
    cool: { id: 'cool', name: 'Cool', color: '#94a3b8' },
    active: { id: 'active', name: 'Active', color: '#22c55e' },
    warm: { id: 'warm', name: 'Warm', color: '#eab308' }
  }
};

const makeDisplayMap = (entries) => {
  const map = new Map();
  entries.forEach(e => map.set(e.id.toLowerCase(), e));
  return map;
};

describe('resolveGovernanceDisplay', () => {
  test('returns null for ungoverned content', () => {
    const result = resolveGovernanceDisplay(
      { isGoverned: false },
      new Map(),
      ZONE_META
    );
    expect(result).toBeNull();
  });

  test('returns show:false for unlocked', () => {
    const result = resolveGovernanceDisplay(
      { isGoverned: true, status: 'unlocked', requirements: [] },
      new Map(),
      ZONE_META
    );
    expect(result.show).toBe(false);
    expect(result.status).toBe('unlocked');
  });

  test('resolves pending rows from requirements + display map', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'user-1', displayName: 'Alice', avatarSrc: '/img/alice.jpg',
        heartRate: 95, zoneId: 'cool', zoneName: 'Cool', zoneColor: '#94a3b8',
        progress: 0.3, zoneSequence: [], targetHeartRate: 100
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'pending',
        requirements: [
          { zone: 'warm', rule: 'all', missingUsers: ['user-1'], satisfied: false }
        ],
        activeParticipants: ['user-1']
      },
      displayMap,
      ZONE_META
    );

    expect(result.show).toBe(true);
    expect(result.status).toBe('pending');
    expect(result.rows.length).toBe(1);

    const row = result.rows[0];
    expect(row.displayName).toBe('Alice');
    expect(row.avatarSrc).toBe('/img/alice.jpg');
    expect(row.heartRate).toBe(95);
    expect(row.currentZone.id).toBe('cool');
    expect(row.currentZone.color).toBe('#94a3b8');
    expect(row.targetZone.id).toBe('warm');
    expect(row.targetZone.color).toBe('#eab308');
  });

  test('warning includes deadline and gracePeriodTotal', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'user-1', displayName: 'Alice', avatarSrc: '/img/alice.jpg',
        heartRate: 85, zoneId: 'cool', zoneName: 'Cool', zoneColor: '#94a3b8',
        progress: 0.2, zoneSequence: [], targetHeartRate: 100
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'warning',
        requirements: [
          { zone: 'active', rule: 'all', missingUsers: ['user-1'], satisfied: false }
        ],
        deadline: Date.now() + 20000,
        gracePeriodTotal: 30,
        activeParticipants: ['user-1']
      },
      displayMap,
      ZONE_META
    );

    expect(result.status).toBe('warning');
    expect(result.deadline).toBeDefined();
    expect(result.gracePeriodTotal).toBe(30);
    expect(result.rows.length).toBe(1);
  });

  test('deduplicates users across multiple requirements', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'user-1', displayName: 'Alice', avatarSrc: '/img/a.jpg',
        heartRate: 85, zoneId: 'cool', zoneName: 'Cool', zoneColor: '#94a3b8',
        progress: 0.2, zoneSequence: [], targetHeartRate: 100
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'pending',
        requirements: [
          { zone: 'active', rule: 'all', missingUsers: ['user-1'], satisfied: false },
          { zone: 'warm', rule: 'all', missingUsers: ['user-1'], satisfied: false }
        ],
        activeParticipants: ['user-1']
      },
      displayMap,
      ZONE_META
    );

    // User appears once, with highest-severity target zone
    expect(result.rows.length).toBe(1);
  });

  test('handles missing user in display map gracefully', () => {
    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'pending',
        requirements: [
          { zone: 'warm', rule: 'all', missingUsers: ['unknown-user'], satisfied: false }
        ],
        activeParticipants: ['unknown-user']
      },
      new Map(),
      ZONE_META
    );

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].displayName).toBe('unknown-user');  // fallback
    expect(result.rows[0].currentZone).toBeNull();
  });

  test('includes challenge rows when challenge has missingUsers', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'user-1', displayName: 'Alice', avatarSrc: '/img/a.jpg',
        heartRate: 120, zoneId: 'active', zoneName: 'Active', zoneColor: '#22c55e',
        progress: 0.6, zoneSequence: [], targetHeartRate: 130
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'locked',
        requirements: [],
        videoLocked: true,
        challenge: {
          id: 'ch-1', status: 'active', zone: 'warm',
          missingUsers: ['user-1'], metUsers: [],
          requiredCount: 1, actualCount: 0
        },
        activeParticipants: ['user-1']
      },
      displayMap,
      ZONE_META
    );

    expect(result.show).toBe(true);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].targetZone.id).toBe('warm');
  });
});
