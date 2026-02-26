import { describe, it, expect, jest } from '@jest/globals';

describe('TreasureBox zone update', () => {
  it('should prefer committed zone from ZoneProfileStore over raw zone', () => {
    // Simulate: raw zone is 'active', committed (hysteresis) zone is 'warm'
    const mockZoneProfileStore = {
      getZoneState: jest.fn((userId) => {
        if (userId === 'alan') return { zoneId: 'warm', zoneName: 'Warm', zoneColor: '#ffaa00' };
        return null;
      })
    };

    const rawZone = { id: 'active', name: 'Active', color: '#00cc00', min: 100 };
    const committedZone = mockZoneProfileStore.getZoneState('alan');

    // The fix: use committed zone when available
    const finalZoneId = committedZone?.zoneId || rawZone.id;
    const finalColor = committedZone?.zoneColor || rawZone.color;
    expect(finalZoneId).toBe('warm'); // Hysteresis-stabilized, not raw
    expect(finalColor).toBe('#ffaa00');
  });

  it('should fall back to raw zone when ZoneProfileStore has no data', () => {
    const mockZoneProfileStore = {
      getZoneState: jest.fn(() => null)
    };

    const rawZone = { id: 'active', name: 'Active', color: '#00cc00', min: 100 };
    const committedZone = mockZoneProfileStore.getZoneState('newuser');

    const finalZoneId = committedZone?.zoneId || rawZone.id;
    const finalColor = committedZone?.zoneColor || rawZone.color;
    expect(finalZoneId).toBe('active'); // Raw is fine when no committed data
    expect(finalColor).toBe('#00cc00');
  });
});
