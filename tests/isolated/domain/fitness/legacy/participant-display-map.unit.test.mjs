import { vi } from 'vitest';

// Provide window global for api.mjs which references window.location at module scope
globalThis.window = { location: { origin: 'http://localhost:3111', protocol: 'http:', host: 'localhost:3111' } };

// Test the pure function directly — no React dependencies needed
import { buildParticipantDisplayMap } from "../../../../../__app_modules/wellness/fitness/browser/hooks/fitness/participantDisplayMap.js";

describe('buildParticipantDisplayMap', () => {
  // The validated ladder a ZoneProfileStore profile carries (zoneConfig).
  const LADDER = [
    { id: 'cool', name: 'Cool', min: 0, color: 'blue' },
    { id: 'active', name: 'Active', min: 100, color: 'green' },
    { id: 'warm', name: 'Warm', min: 120, color: 'yellow' },
    { id: 'hot', name: 'Hot', min: 140, color: 'orange' },
    { id: 'fire', name: 'Fire', min: 160, color: 'red' },
  ];
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
      zoneConfig: LADDER,
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
    expect(entry.avatarSrc).toContain('/img/user-1.jpg');
    expect(entry.heartRate).toBe(130);
    expect(entry.zoneId).toBe('warm');
    expect(entry.zoneName).toBe('Warm');
    expect(entry.zoneColor).toBe('#eab308');
    // Progress is the display record's: 130 bpm on the 120→140 Warm band.
    expect(entry.progress).toBe(0.5);
    expect(entry.display).toMatchObject({ zoneId: 'warm', live: true, showBar: true });
  });

  test('display follows the BPM shown, not the committed zone held by the exit margin', () => {
    // Committed Hot (floor 140) held at 137 bpm: the chip and card show Warm,
    // measured on the Warm band — never a Hot colour over a Warm-band bar.
    const map = buildParticipantDisplayMap([
      { ...mockProfiles[0], heartRate: 137, currentZoneId: 'hot', currentZoneColor: 'orange' }
    ], mockRoster);
    const entry = map.get('user one');
    expect(entry.zoneId).toBe('hot');
    expect(entry.display.zoneId).toBe('warm');
    expect(entry.display.zoneColor).toBe('yellow');
    expect(entry.progress).toBeCloseTo(0.85, 5);
  });

  test('surfaces zoneIndex from profile.zoneSnapshot for sort keys', () => {
    const profiles = [
      {
        id: 'warm-user',
        name: 'Warm User',
        displayName: 'Warm User',
        heartRate: 136,
        currentZoneId: 'warm',
        currentZoneColor: '#eab308',
        progress: 0.8,
        zoneConfig: LADDER,
        zoneSnapshot: { zoneIndex: 2 }
      }
    ];
    const roster = [{ id: 'warm-user', name: 'Warm User' }];
    const map = buildParticipantDisplayMap(profiles, roster);
    const entry = map.get('warm user');
    expect(entry).toBeDefined();
    expect(entry.zoneIndex).toBe(2);
    expect(entry.progress).toBe(0.8);
  });

  test('falls back to null zoneIndex when zoneSnapshot is missing', () => {
    const profiles = [
      { id: 'no-snap', name: 'No Snap', displayName: 'No Snap', progress: null }
    ];
    const roster = [{ id: 'no-snap', name: 'No Snap' }];
    const map = buildParticipantDisplayMap(profiles, roster);
    const entry = map.get('no snap');
    expect(entry).toBeDefined();
    expect(entry.zoneIndex).toBeNull();
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
    // No profile entries — roster-only entries may be included
    const profileEntries = [...map.values()].filter(e => e.heartRate != null);
    expect(profileEntries.length).toBe(0);
  });

  test('normalizes keys for case-insensitive lookup', () => {
    const map = buildParticipantDisplayMap(mockProfiles, mockRoster);
    expect(map.get('user one')).toBeDefined();
    expect(map.get('USER ONE')).toBeUndefined();  // Map is pre-normalized
  });
});
