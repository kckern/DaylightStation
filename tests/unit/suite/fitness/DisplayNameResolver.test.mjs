/**
 * Unit tests for DisplayNameResolver
 *
 * Tests the single source of truth for fitness display name resolution.
 * These are pure function tests - no React, no browser, fast execution.
 */

// Jest globals are available automatically
import {
  shouldPreferGroupLabels,
  countActiveHrDevices,
  buildDisplayNameContext,
  resolveDisplayName,
  resolveAllDisplayNames,
  getPriorityChain,
} from '../../../../frontend/src/hooks/fitness/DisplayNameResolver.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST DATA FACTORIES
// ═══════════════════════════════════════════════════════════════════════════════

function createDevice(overrides = {}) {
  return {
    deviceId: '12345',
    type: 'heart_rate',
    heartRate: 120,
    inactiveSince: null,
    ...overrides,
  };
}

function createOwnership(overrides = {}) {
  return {
    name: 'Test User',
    groupLabel: null,
    profileId: 'test-user',
    ...overrides,
  };
}

function createAssignment(overrides = {}) {
  return {
    occupantType: 'member',
    occupantName: 'Test User',
    occupantId: 'test-user',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// shouldPreferGroupLabels
// ═══════════════════════════════════════════════════════════════════════════════

describe('shouldPreferGroupLabels', () => {
  test('returns false with null/undefined input', () => {
    expect(shouldPreferGroupLabels(null)).toBe(false);
    expect(shouldPreferGroupLabels(undefined)).toBe(false);
  });

  test('returns false with empty array', () => {
    expect(shouldPreferGroupLabels([])).toBe(false);
  });

  test('returns false with 0 active HR devices', () => {
    const devices = [
      createDevice({ type: 'cadence' }),
      createDevice({ type: 'power' }),
    ];
    expect(shouldPreferGroupLabels(devices)).toBe(false);
  });

  test('returns false with 1 active HR device', () => {
    const devices = [
      createDevice({ deviceId: '1', heartRate: 120 }),
    ];
    expect(shouldPreferGroupLabels(devices)).toBe(false);
  });

  test('returns true with 2 active HR devices', () => {
    const devices = [
      createDevice({ deviceId: '1', heartRate: 120 }),
      createDevice({ deviceId: '2', heartRate: 130 }),
    ];
    expect(shouldPreferGroupLabels(devices)).toBe(true);
  });

  test('returns true with 3+ active HR devices', () => {
    const devices = [
      createDevice({ deviceId: '1', heartRate: 120 }),
      createDevice({ deviceId: '2', heartRate: 130 }),
      createDevice({ deviceId: '3', heartRate: 140 }),
    ];
    expect(shouldPreferGroupLabels(devices)).toBe(true);
  });

  test('ignores devices without heartRate data', () => {
    const devices = [
      createDevice({ deviceId: '1', heartRate: 120 }),
      createDevice({ deviceId: '2', heartRate: null }),
      createDevice({ deviceId: '3', heartRate: undefined }),
      createDevice({ deviceId: '4', heartRate: 0 }),
    ];
    expect(shouldPreferGroupLabels(devices)).toBe(false);
  });

  test('ignores inactive devices', () => {
    const devices = [
      createDevice({ deviceId: '1', heartRate: 120 }),
      createDevice({ deviceId: '2', heartRate: 130, inactiveSince: Date.now() }),
    ];
    expect(shouldPreferGroupLabels(devices)).toBe(false);
  });

  test('ignores non-heart_rate devices', () => {
    const devices = [
      createDevice({ deviceId: '1', heartRate: 120 }),
      createDevice({ deviceId: '2', heartRate: 130, type: 'cadence' }),
    ];
    expect(shouldPreferGroupLabels(devices)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// countActiveHrDevices
// ═══════════════════════════════════════════════════════════════════════════════

describe('countActiveHrDevices', () => {
  test('returns 0 with null/undefined input', () => {
    expect(countActiveHrDevices(null)).toBe(0);
    expect(countActiveHrDevices(undefined)).toBe(0);
  });

  test('counts only active HR devices', () => {
    const devices = [
      createDevice({ deviceId: '1', heartRate: 120 }),
      createDevice({ deviceId: '2', heartRate: 130 }),
      createDevice({ deviceId: '3', heartRate: 0 }), // No HR
      createDevice({ deviceId: '4', type: 'cadence', heartRate: 60 }), // Wrong type
    ];
    expect(countActiveHrDevices(devices)).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildDisplayNameContext
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildDisplayNameContext', () => {
  test('builds context from Maps', () => {
    const devices = [createDevice({ deviceId: '1', heartRate: 120 })];
    const ownership = new Map([['1', createOwnership()]]);
    const assignments = new Map([['1', createAssignment()]]);

    const ctx = buildDisplayNameContext({
      devices,
      deviceOwnership: ownership,
      deviceAssignments: assignments,
    });

    expect(ctx.preferGroupLabels).toBe(false);
    expect(ctx.activeHrDeviceCount).toBe(1);
    expect(ctx.deviceOwnership.get('1')).toBeDefined();
    expect(ctx.deviceAssignments.get('1')).toBeDefined();
  });

  test('builds context from plain objects', () => {
    const devices = [
      createDevice({ deviceId: '1', heartRate: 120 }),
      createDevice({ deviceId: '2', heartRate: 130 }),
    ];
    const ownership = { '1': createOwnership({ name: 'User One' }) };
    const assignments = { '1': createAssignment() };

    const ctx = buildDisplayNameContext({
      devices,
      deviceOwnership: ownership,
      deviceAssignments: assignments,
    });

    expect(ctx.preferGroupLabels).toBe(true);
    expect(ctx.deviceOwnership.get('1').name).toBe('User One');
  });

  test('handles empty/missing sources', () => {
    const ctx = buildDisplayNameContext({});

    expect(ctx.preferGroupLabels).toBe(false);
    expect(ctx.activeHrDeviceCount).toBe(0);
    expect(ctx.deviceOwnership).toBeInstanceOf(Map);
    expect(ctx.deviceAssignments).toBeInstanceOf(Map);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// resolveDisplayName - Priority Chain
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveDisplayName', () => {
  describe('priority: guest', () => {
    test('uses guest name when occupantType is "guest"', () => {
      const ctx = buildDisplayNameContext({
        devices: [createDevice({ deviceId: '1', heartRate: 120 })],
        deviceOwnership: new Map([['1', createOwnership({ name: 'Owner' })]]),
        deviceAssignments: new Map([['1', createAssignment({
          occupantType: 'guest',
          occupantName: 'Guest User',
        })]]),
      });

      const result = resolveDisplayName('1', ctx);

      expect(result.displayName).toBe('Guest User');
      expect(result.source).toBe('guest');
    });

    test('ignores assignment when occupantType is "member"', () => {
      const ctx = buildDisplayNameContext({
        devices: [createDevice({ deviceId: '1', heartRate: 120 })],
        deviceOwnership: new Map([['1', createOwnership({ name: 'Owner' })]]),
        deviceAssignments: new Map([['1', createAssignment({
          occupantType: 'member',
          occupantName: 'Member User',
        })]]),
      });

      const result = resolveDisplayName('1', ctx);

      expect(result.displayName).toBe('Owner');
      expect(result.source).toBe('owner');
    });
  });

  describe('priority: groupLabel', () => {
    test('uses groupLabel when preferGroupLabels=true and groupLabel exists', () => {
      const ctx = buildDisplayNameContext({
        devices: [
          createDevice({ deviceId: '1', heartRate: 120 }),
          createDevice({ deviceId: '2', heartRate: 130 }),
        ],
        deviceOwnership: new Map([
          ['1', createOwnership({ name: 'KC Kern', groupLabel: 'Dad' })],
          ['2', createOwnership({ name: 'Felix', groupLabel: null })],
        ]),
        deviceAssignments: new Map(),
      });

      const result = resolveDisplayName('1', ctx);

      expect(result.displayName).toBe('Dad');
      expect(result.source).toBe('groupLabel');
      expect(result.preferredGroupLabel).toBe(true);
    });

    test('uses owner name when preferGroupLabels=false', () => {
      const ctx = buildDisplayNameContext({
        devices: [createDevice({ deviceId: '1', heartRate: 120 })],
        deviceOwnership: new Map([
          ['1', createOwnership({ name: 'KC Kern', groupLabel: 'Dad' })],
        ]),
        deviceAssignments: new Map(),
      });

      const result = resolveDisplayName('1', ctx);

      expect(result.displayName).toBe('KC Kern');
      expect(result.source).toBe('owner');
      expect(result.preferredGroupLabel).toBe(false);
    });

    test('uses owner name when groupLabel not configured', () => {
      const ctx = buildDisplayNameContext({
        devices: [
          createDevice({ deviceId: '1', heartRate: 120 }),
          createDevice({ deviceId: '2', heartRate: 130 }),
        ],
        deviceOwnership: new Map([
          ['1', createOwnership({ name: 'KC Kern', groupLabel: null })],
          ['2', createOwnership({ name: 'Felix' })],
        ]),
        deviceAssignments: new Map(),
      });

      const result = resolveDisplayName('1', ctx);

      expect(result.displayName).toBe('KC Kern');
      expect(result.source).toBe('owner');
    });
  });

  describe('priority: owner', () => {
    test('uses owner name as primary fallback', () => {
      const ctx = buildDisplayNameContext({
        devices: [createDevice({ deviceId: '1', heartRate: 120 })],
        deviceOwnership: new Map([
          ['1', createOwnership({ name: 'Test User' })],
        ]),
        deviceAssignments: new Map(),
      });

      const result = resolveDisplayName('1', ctx);

      expect(result.displayName).toBe('Test User');
      expect(result.source).toBe('owner');
    });
  });

  describe('priority: fallback', () => {
    test('uses deviceId when no other data available', () => {
      const ctx = buildDisplayNameContext({
        devices: [createDevice({ deviceId: '12345', heartRate: 120 })],
        deviceOwnership: new Map(),
        deviceAssignments: new Map(),
      });

      const result = resolveDisplayName('12345', ctx);

      expect(result.displayName).toBe('12345');
      expect(result.source).toBe('fallback');
    });

    test('handles null deviceId', () => {
      const ctx = buildDisplayNameContext({});
      const result = resolveDisplayName(null, ctx);

      expect(result.displayName).toBe('Unknown');
      expect(result.source).toBe('fallback');
    });
  });

  describe('source tracking', () => {
    test('returns source for debugging', () => {
      const ctx = buildDisplayNameContext({
        devices: [createDevice({ deviceId: '1', heartRate: 120 })],
        deviceOwnership: new Map([['1', createOwnership()]]),
      });

      const result = resolveDisplayName('1', ctx);

      expect(result.source).toBeDefined();
      expect(['guest', 'groupLabel', 'owner', 'profile', 'fallback']).toContain(result.source);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// resolveAllDisplayNames
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveAllDisplayNames', () => {
  test('resolves multiple devices at once', () => {
    const ctx = buildDisplayNameContext({
      devices: [
        createDevice({ deviceId: '1', heartRate: 120 }),
        createDevice({ deviceId: '2', heartRate: 130 }),
      ],
      deviceOwnership: new Map([
        ['1', createOwnership({ name: 'User One', groupLabel: 'Dad' })],
        ['2', createOwnership({ name: 'User Two', groupLabel: 'Son' })],
      ]),
    });

    const results = resolveAllDisplayNames(['1', '2'], ctx);

    expect(results.size).toBe(2);
    expect(results.get('1').displayName).toBe('Dad');
    expect(results.get('2').displayName).toBe('Son');
  });

  test('handles empty array', () => {
    const ctx = buildDisplayNameContext({});
    const results = resolveAllDisplayNames([], ctx);

    expect(results.size).toBe(0);
  });

  test('handles null input', () => {
    const ctx = buildDisplayNameContext({});
    const results = resolveAllDisplayNames(null, ctx);

    expect(results.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getPriorityChain
// ═══════════════════════════════════════════════════════════════════════════════

describe('getPriorityChain', () => {
  test('returns priority chain for documentation', () => {
    const chain = getPriorityChain();

    expect(chain).toBeInstanceOf(Array);
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0]).toHaveProperty('id');
    expect(chain[0]).toHaveProperty('description');
  });

  test('chain starts with guest and ends with fallback', () => {
    const chain = getPriorityChain();

    expect(chain[0].id).toBe('guest');
    expect(chain[chain.length - 1].id).toBe('fallback');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION TESTS - Bugs that were fixed
// ═══════════════════════════════════════════════════════════════════════════════

describe('regression tests', () => {
  test('group_label fallback bug: member assignment should not override groupLabel', () => {
    // This was the original bug - guestAssignment.occupantName was used
    // for members, bypassing the groupLabel logic
    const ctx = buildDisplayNameContext({
      devices: [
        createDevice({ deviceId: '40475', heartRate: 120 }),
        createDevice({ deviceId: '28812', heartRate: 130 }),
      ],
      deviceOwnership: new Map([
        ['40475', createOwnership({ name: 'KC Kern', groupLabel: 'Dad', profileId: 'kckern' })],
        ['28812', createOwnership({ name: 'Felix', groupLabel: null, profileId: 'felix' })],
      ]),
      deviceAssignments: new Map([
        ['40475', createAssignment({
          occupantType: 'member', // NOT a guest!
          occupantName: 'KC Kern',
          occupantId: 'kckern',
        })],
      ]),
    });

    // With 2 devices, preferGroupLabels should be true
    expect(ctx.preferGroupLabels).toBe(true);

    // kckern should show "Dad", not "KC Kern"
    const result = resolveDisplayName('40475', ctx);
    expect(result.displayName).toBe('Dad');
    expect(result.source).toBe('groupLabel');
  });

  test('single device should show full name, not group label', () => {
    const ctx = buildDisplayNameContext({
      devices: [createDevice({ deviceId: '40475', heartRate: 120 })],
      deviceOwnership: new Map([
        ['40475', createOwnership({ name: 'KC Kern', groupLabel: 'Dad' })],
      ]),
    });

    expect(ctx.preferGroupLabels).toBe(false);

    const result = resolveDisplayName('40475', ctx);
    expect(result.displayName).toBe('KC Kern');
    expect(result.source).toBe('owner');
  });
});
