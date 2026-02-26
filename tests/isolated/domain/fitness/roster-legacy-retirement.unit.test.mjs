import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock logger BEFORE importing modules (matches existing roster-zone-source pattern)
jest.unstable_mockModule('../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    sampled: jest.fn(),
  }),
  getLogger: () => ({
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    sampled: jest.fn(),
  }),
  __esModule: true,
}));

// Mock resolveDisplayLabel
jest.unstable_mockModule('../../../../frontend/src/hooks/fitness/types.js', () => ({
  resolveDisplayLabel: ({ name }) => name,
}));

// Mock ParticipantStatus
jest.unstable_mockModule('../../../../frontend/src/modules/Fitness/domain/types.js', () => ({
  ParticipantStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' },
}));

describe('ParticipantRoster legacy retirement', () => {
  let ParticipantRoster;

  beforeEach(async () => {
    const mod = await import('../../../../frontend/src/hooks/fitness/ParticipantRoster.js');
    ParticipantRoster = mod.ParticipantRoster;
  });

  it('returns [] when not configured (no legacy fallback)', () => {
    const roster = new ParticipantRoster();
    // Without calling configure(), getRoster() should return empty array
    const entries = roster.getRoster();
    expect(entries).toEqual([]);
  });

  it('returns isActive from device.inactiveSince, NOT hardcoded true (V4 fix)', () => {
    const roster = new ParticipantRoster();

    roster.configure({
      deviceManager: {
        getAllDevices: () => [
          { id: 'dev-active', type: 'heart_rate', heartRate: 120 },
          { id: 'dev-inactive', type: 'heart_rate', heartRate: 80, inactiveSince: '2026-01-01T00:00:00Z' },
        ],
      },
      userManager: {
        assignmentLedger: new Map([
          ['dev-active', { occupantName: 'Alice', occupantId: 'alice', occupantType: 'member' }],
          ['dev-inactive', { occupantName: 'Bob', occupantId: 'bob', occupantType: 'member' }],
        ]),
        resolveUserForDevice: (id) => {
          if (id === 'dev-active') return { id: 'alice', name: 'Alice', source: 'Member' };
          if (id === 'dev-inactive') return { id: 'bob', name: 'Bob', source: 'Member' };
          return null;
        },
      },
      treasureBox: { getUserZoneSnapshot: () => [] },
      zoneProfileStore: { getZoneState: () => null },
    });

    const entries = roster.getRoster();
    expect(entries).toHaveLength(2);

    const alice = entries.find((e) => e.name === 'Alice');
    const bob = entries.find((e) => e.name === 'Bob');

    // Active device (no inactiveSince) => isActive: true
    expect(alice.isActive).toBe(true);
    // Inactive device (has inactiveSince) => isActive: false
    expect(bob.isActive).toBe(false);
  });

  it('produces entries with both id and profileId fields (V5 consistency)', () => {
    const roster = new ParticipantRoster();

    roster.configure({
      deviceManager: {
        getAllDevices: () => [
          { id: 'dev-active', type: 'heart_rate', heartRate: 120 },
        ],
      },
      userManager: {
        assignmentLedger: new Map([
          ['dev-active', { occupantName: 'Alice', occupantId: 'alice', occupantType: 'member' }],
        ]),
        resolveUserForDevice: (id) => {
          if (id === 'dev-active') return { id: 'alice', name: 'Alice', source: 'Member' };
          return null;
        },
      },
      treasureBox: { getUserZoneSnapshot: () => [] },
      zoneProfileStore: { getZoneState: () => null },
    });

    const entries = roster.getRoster();
    expect(entries).toHaveLength(1);

    const alice = entries[0];
    // Both id and profileId should be set to the same userId
    expect(alice.id).toBe('alice');
    expect(alice.profileId).toBe('alice');
    expect(alice.id).toBe(alice.profileId);
  });
});
