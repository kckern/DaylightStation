import { jest } from '@jest/globals';

// Test the pure function directly — no React dependencies needed
import { buildParticipantDisplayMap } from '#frontend/hooks/fitness/participantDisplayMap.js';

describe('buildParticipantDisplayMap', () => {
  const mockProfiles = [
    {
      id: 'user-1',
      name: 'User One',
      displayName: 'User One',
      heartRate: 130,
      currentZoneId: 'warm',
      currentZoneName: 'Warm',
      currentZoneColor: '#eab308',
      progress: 0.65,
      targetHeartRate: 145,
      zoneSequence: [{ id: 'cool' }, { id: 'active' }, { id: 'warm' }],
      groupLabel: 'Adults',
      source: 'primary',
      updatedAt: 1000
    }
  ];

  const mockRoster = [
    { id: 'user-1', name: 'User One', avatarUrl: '/img/user-1.jpg' }
  ];

  test('produces display entry from ZoneProfileStore profile + roster', () => {
    const map = buildParticipantDisplayMap(mockProfiles, mockRoster);
    const entry = map.get('user one');  // normalized
    expect(entry).toBeDefined();
    expect(entry.id).toBe('user-1');
    expect(entry.displayName).toBe('User One');
    expect(entry.avatarSrc).toBe('/img/user-1.jpg');
    expect(entry.heartRate).toBe(130);
    expect(entry.zoneId).toBe('warm');
    expect(entry.zoneName).toBe('Warm');
    expect(entry.zoneColor).toBe('#eab308');
    expect(entry.progress).toBe(0.65);
  });

  test('zone data comes from ZoneProfileStore (stabilized), not raw', () => {
    const map = buildParticipantDisplayMap(mockProfiles, mockRoster);
    const entry = map.get('user one');
    // These fields come directly from ZoneProfileStore profile
    // which applies hysteresis — NOT from raw device data
    expect(entry.zoneId).toBe('warm');
    expect(entry.zoneColor).toBe('#eab308');
  });

  test('handles missing roster entry gracefully', () => {
    const map = buildParticipantDisplayMap(mockProfiles, []);
    const entry = map.get('user one');
    expect(entry).toBeDefined();
    expect(entry.displayName).toBe('User One');
    expect(entry.avatarSrc).toContain('user');  // fallback avatar
  });

  test('handles empty profiles', () => {
    const map = buildParticipantDisplayMap([], mockRoster);
    expect(map.size).toBe(0);
  });

  test('normalizes keys for case-insensitive lookup', () => {
    const map = buildParticipantDisplayMap(mockProfiles, mockRoster);
    expect(map.get('user one')).toBeDefined();
    expect(map.get('USER ONE')).toBeUndefined();  // Map is pre-normalized
  });
});
