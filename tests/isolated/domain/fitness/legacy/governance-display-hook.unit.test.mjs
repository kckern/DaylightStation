import { jest } from '@jest/globals';

// Mock React hooks for unit testing
const mockUseMemo = jest.fn((fn) => fn());
jest.unstable_mockModule('react', () => ({
  useMemo: mockUseMemo,
  default: { useMemo: mockUseMemo }
}));

// Mock api.mjs to avoid window reference in Node test environment
jest.unstable_mockModule('#frontend/lib/api.mjs', () => ({
  DaylightMediaPath: (p) => p,
  default: {}
}));

const { resolveGovernanceDisplay } = await import(
  '#frontend/modules/Fitness/hooks/useGovernanceDisplay.js'
);

// Realistic zone sequence matching DEFAULT_ZONE_CONFIG thresholds
const FULL_ZONE_SEQUENCE = [
  { id: 'cool', name: 'Cool', color: '#38bdf8', threshold: 60, index: 0 },
  { id: 'active', name: 'Active', color: '#22c55e', threshold: 100, index: 1 },
  { id: 'warm', name: 'Warm', color: '#eab308', threshold: 120, index: 2 },
  { id: 'hot', name: 'Hot', color: '#fb923c', threshold: 140, index: 3 },
  { id: 'fire', name: 'On Fire', color: '#ef4444', threshold: 160, index: 4 }
];

const ZONE_META = {
  map: {
    cool: { id: 'cool', name: 'Cool', color: '#94a3b8', rank: 0, min: 0 },
    active: { id: 'active', name: 'Active', color: '#22c55e', rank: 1, min: 100 },
    warm: { id: 'warm', name: 'Warm', color: '#eab308', rank: 2, min: 130 },
    hot: { id: 'hot', name: 'Hot', color: '#fb923c', rank: 3, min: 140 },
    fire: { id: 'fire', name: 'On Fire', color: '#ef4444', rank: 4, min: 160 }
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

  test('computes target-aware progress for COOL user targeting HOT', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'user-1', displayName: 'Alice', avatarSrc: '/img/alice.jpg',
        heartRate: 85, zoneId: 'cool', zoneName: 'Cool', zoneColor: '#38bdf8',
        progress: 0.625, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 100
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'pending',
        requirements: [
          { zone: 'hot', rule: 'all', missingUsers: ['user-1'], satisfied: false }
        ]
      },
      displayMap,
      ZONE_META
    );

    const row = result.rows[0];

    // Progress should be toward HOT (140), not just ACTIVE (100)
    // rangeMin = max(0, 100 - 40) = 60, rangeMax = 140, span = 80
    // progress = (85 - 60) / 80 = 0.3125
    expect(row.progress).toBeCloseTo(0.3125, 2);

    // Should have intermediate zones: ACTIVE and WARM
    expect(row.intermediateZones).toHaveLength(2);
    expect(row.intermediateZones[0].id).toBe('active');
    expect(row.intermediateZones[0].position).toBeCloseTo(0.5, 2);
    expect(row.intermediateZones[1].id).toBe('warm');
    expect(row.intermediateZones[1].position).toBeCloseTo(0.75, 2);
  });

  test('single-zone transition has no intermediate zones', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'user-1', displayName: 'Alice', avatarSrc: '/img/alice.jpg',
        heartRate: 110, zoneId: 'active', zoneName: 'Active', zoneColor: '#22c55e',
        progress: 0.5, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 120
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'pending',
        requirements: [
          { zone: 'warm', rule: 'all', missingUsers: ['user-1'], satisfied: false }
        ]
      },
      displayMap,
      ZONE_META
    );

    const row = result.rows[0];
    // ACTIVE (100) → WARM (120), HR 110: progress = (110-100)/(120-100) = 0.5
    expect(row.progress).toBeCloseTo(0.5, 2);
    expect(row.intermediateZones).toHaveLength(0);
  });

  test('user at or above target zone has progress 1', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'user-1', displayName: 'Alice', avatarSrc: '/img/alice.jpg',
        heartRate: 145, zoneId: 'hot', zoneName: 'Hot', zoneColor: '#fb923c',
        progress: 0.25, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 160
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'pending',
        requirements: [
          { zone: 'warm', rule: 'all', missingUsers: ['user-1'], satisfied: false }
        ]
      },
      displayMap,
      ZONE_META
    );

    const row = result.rows[0];
    // HOT (index 3) >= WARM (index 2), so progress = 1
    expect(row.progress).toBe(1);
    expect(row.intermediateZones).toHaveLength(0);
  });

  test('falls back to display map progress when zoneSequence is empty', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'user-1', displayName: 'Alice', avatarSrc: '/img/alice.jpg',
        heartRate: 95, zoneId: 'cool', zoneName: 'Cool', zoneColor: '#38bdf8',
        progress: 0.3, zoneSequence: [], targetHeartRate: 100
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'pending',
        requirements: [
          { zone: 'warm', rule: 'all', missingUsers: ['user-1'], satisfied: false }
        ]
      },
      displayMap,
      ZONE_META
    );

    const row = result.rows[0];
    // Can't compute target-aware progress without zoneSequence, so fallback
    expect(row.progress).toBe(0.3);
    expect(row.intermediateZones).toHaveLength(0);
  });
});
