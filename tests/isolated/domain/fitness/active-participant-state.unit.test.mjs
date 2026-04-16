/**
 * Tests ParticipantRoster.getActiveParticipantState() — the canonical method
 * for "who is participating and what zone are they in?"
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockDebug = jest.fn();
const mockWarn = jest.fn();
jest.unstable_mockModule('../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ debug: mockDebug, warn: mockWarn, info: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: mockDebug, warn: mockWarn, info: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  __esModule: true,
}));

jest.unstable_mockModule('../../../../frontend/src/hooks/fitness/types.js', () => ({
  resolveDisplayLabel: ({ name }) => name,
}));

jest.unstable_mockModule('../../../../frontend/src/modules/Fitness/domain/types.js', () => ({
  ParticipantStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' },
}));

let ParticipantRoster;
beforeAll(async () => {
  ({ ParticipantRoster } = await import('../../../../frontend/src/hooks/fitness/ParticipantRoster.js'));
});

describe('ParticipantRoster.getActiveParticipantState()', () => {
  let roster;

  const configureWithParticipants = (devices, users, zones = []) => {
    roster.configure({
      deviceManager: { getAllDevices: () => devices },
      userManager: {
        assignmentLedger: new Map(
          users.map(u => [u.deviceId, { occupantName: u.name, occupantId: u.id, occupantType: 'member' }])
        ),
        resolveUserForDevice: (deviceId) => {
          const u = users.find(x => x.deviceId === deviceId);
          return u ? { id: u.id, name: u.name, source: 'Member', currentData: {} } : null;
        }
      },
      treasureBox: { getUserZoneSnapshot: () => zones },
      zoneProfileStore: { getZoneState: () => null }
    });
  };

  beforeEach(() => {
    roster = new ParticipantRoster();
  });

  it('returns empty state when not configured', () => {
    const state = roster.getActiveParticipantState();
    expect(state).toEqual({ participants: [], zoneMap: {}, totalCount: 0 });
  });

  it('returns active participants with their zone IDs', () => {
    configureWithParticipants(
      [
        { id: 'dev-1', type: 'heart_rate', heartRate: 120 },
        { id: 'dev-2', type: 'heart_rate', heartRate: 90 }
      ],
      [
        { deviceId: 'dev-1', id: 'alice', name: 'Alice' },
        { deviceId: 'dev-2', id: 'bob', name: 'Bob' }
      ],
      [
        { trackingId: 'alice', userId: 'alice', zoneId: 'active', color: 'orange' },
        { trackingId: 'bob', userId: 'bob', zoneId: 'warm', color: 'yellow' }
      ]
    );

    const state = roster.getActiveParticipantState();
    expect(state.participants).toEqual(['alice', 'bob']);
    expect(state.zoneMap).toEqual({ alice: 'active', bob: 'warm' });
    expect(state.totalCount).toBe(2);
  });

  it('excludes inactive participants (device.inactiveSince set)', () => {
    configureWithParticipants(
      [
        { id: 'dev-1', type: 'heart_rate', heartRate: 120 },
        { id: 'dev-2', type: 'heart_rate', heartRate: 80, inactiveSince: '2026-01-01T00:00:00Z' }
      ],
      [
        { deviceId: 'dev-1', id: 'alice', name: 'Alice' },
        { deviceId: 'dev-2', id: 'bob', name: 'Bob' }
      ],
      [
        { trackingId: 'alice', userId: 'alice', zoneId: 'active', color: 'orange' },
        { trackingId: 'bob', userId: 'bob', zoneId: 'warm', color: 'yellow' }
      ]
    );

    const state = roster.getActiveParticipantState();
    expect(state.participants).toEqual(['alice']);
    expect(state.zoneMap).toEqual({ alice: 'active' });
    expect(state.totalCount).toBe(1);
  });

  it('includes participants without zone data (no ghost-filtering)', () => {
    configureWithParticipants(
      [
        { id: 'dev-1', type: 'heart_rate', heartRate: 120 },
        { id: 'dev-2', type: 'heart_rate', heartRate: 90 }
      ],
      [
        { deviceId: 'dev-1', id: 'alice', name: 'Alice' },
        { deviceId: 'dev-2', id: 'bob', name: 'Bob' }
      ],
      [] // No zone data yet — startup scenario
    );

    const state = roster.getActiveParticipantState();
    expect(state.participants).toEqual(['alice', 'bob']);
    expect(state.zoneMap).toEqual({}); // No zones, but participants are present
    expect(state.totalCount).toBe(2);
  });

  it('lowercases zone IDs for consistent matching', () => {
    configureWithParticipants(
      [{ id: 'dev-1', type: 'heart_rate', heartRate: 120 }],
      [{ deviceId: 'dev-1', id: 'alice', name: 'Alice' }],
      [{ trackingId: 'alice', userId: 'alice', zoneId: 'Active', color: 'orange' }]
    );

    const state = roster.getActiveParticipantState();
    expect(state.zoneMap.alice).toBe('active'); // lowercased
  });
});
