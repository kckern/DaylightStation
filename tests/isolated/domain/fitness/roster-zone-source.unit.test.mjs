import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock logger
jest.unstable_mockModule('../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({
    sampled: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  __esModule: true,
}));

describe('ParticipantRoster zone source preference', () => {
  let ParticipantRoster;

  beforeEach(async () => {
    const mod = await import('../../../../frontend/src/hooks/fitness/ParticipantRoster.js');
    ParticipantRoster = mod.ParticipantRoster;
  });

  it('prefers ZoneProfileStore committed zone over TreasureBox raw zone', () => {
    const roster = new ParticipantRoster();

    // TreasureBox says "active" (raw, no hysteresis)
    const mockTreasureBox = {
      getUserZoneSnapshot: () => [
        { trackingId: 'alice', userId: 'alice', zoneId: 'active', color: 'orange' }
      ]
    };

    // ZoneProfileStore says "warm" (committed, hysteresis suppressed the upgrade)
    const mockZoneProfileStore = {
      getZoneState: (id) => {
        if (id === 'alice') return { zoneId: 'warm', zoneColor: 'yellow' };
        return null;
      }
    };

    const mockDeviceManager = {
      getAllDevices: () => [
        { id: 'dev-1', type: 'heart_rate', heartRate: 119, name: 'HR Monitor' }
      ]
    };

    const mockUserManager = {
      assignmentLedger: new Map([
        ['dev-1', { occupantName: 'Alice', occupantId: 'alice', metadata: { profileId: 'alice' } }]
      ]),
      resolveUserForDevice: () => ({
        id: 'alice',
        name: 'Alice',
        source: 'Member',
        currentData: { heartRate: 119 }
      })
    };

    roster.configure({
      deviceManager: mockDeviceManager,
      userManager: mockUserManager,
      treasureBox: mockTreasureBox,
      zoneProfileStore: mockZoneProfileStore,
    });

    const entries = roster.getRoster();
    expect(entries).toHaveLength(1);
    // Should use ZoneProfileStore's committed zone, NOT TreasureBox's raw zone
    expect(entries[0].zoneId).toBe('warm');
    expect(entries[0].zoneColor).toBe('yellow');
  });

  it('falls back to TreasureBox when ZoneProfileStore has no data', () => {
    const roster = new ParticipantRoster();

    const mockTreasureBox = {
      getUserZoneSnapshot: () => [
        { trackingId: 'bob', userId: 'bob', zoneId: 'active', color: 'orange' }
      ]
    };

    const mockZoneProfileStore = {
      getZoneState: () => null  // No data for this user
    };

    const mockDeviceManager = {
      getAllDevices: () => [
        { id: 'dev-2', type: 'heart_rate', heartRate: 130, name: 'HR Monitor 2' }
      ]
    };

    const mockUserManager = {
      assignmentLedger: new Map([
        ['dev-2', { occupantName: 'Bob', occupantId: 'bob', metadata: { profileId: 'bob' } }]
      ]),
      resolveUserForDevice: () => ({
        id: 'bob',
        name: 'Bob',
        source: 'Member',
        currentData: { heartRate: 130 }
      })
    };

    roster.configure({
      deviceManager: mockDeviceManager,
      userManager: mockUserManager,
      treasureBox: mockTreasureBox,
      zoneProfileStore: mockZoneProfileStore,
    });

    const entries = roster.getRoster();
    expect(entries).toHaveLength(1);
    // Falls back to TreasureBox data
    expect(entries[0].zoneId).toBe('active');
    expect(entries[0].zoneColor).toBe('orange');
  });
});
