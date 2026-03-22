import { describe, it, expect, vi } from 'vitest';

vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
    error: vi.fn(), sampled: vi.fn(), child: vi.fn().mockReturnThis()
  }),
  getLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
    error: vi.fn(), sampled: vi.fn(), child: vi.fn().mockReturnThis()
  })
}));

const { FitnessTreasureBox } = await import('#frontend/hooks/fitness/TreasureBox.js');

const GLOBAL_ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', coins: 0 },
  { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow', coins: 2 },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange', coins: 3 },
  { id: 'fire', name: 'Fire', min: 160, color: 'red', coins: 5 },
];

const SOREN_ZONE_CONFIG = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', coins: 0 },
  { id: 'active', name: 'Active', min: 125, color: 'green', coins: 1 },
  { id: 'warm', name: 'Warm', min: 150, color: 'yellow', coins: 2 },
  { id: 'hot', name: 'Hot', min: 170, color: 'orange', coins: 3 },
  { id: 'fire', name: 'Fire', min: 190, color: 'red', coins: 5 },
];

function createMockZoneProfileStore(profiles = {}) {
  return {
    getProfile: vi.fn((userId) => {
      const config = profiles[userId];
      if (!config) return null;
      return { id: userId, zoneConfig: config };
    }),
    getZoneState: vi.fn(() => null),
  };
}

function createTreasureBox(zoneProfileStore = null) {
  const mockSession = {
    _log: vi.fn(),
    startTime: Date.now(),
    timebase: { startAbsMs: Date.now(), intervalMs: 5000, intervalCount: 0 },
    timeline: { series: {} },
    snapshot: {},
    roster: [],
  };
  const tb = new FitnessTreasureBox(mockSession);
  tb.configure({ zones: GLOBAL_ZONES });
  if (zoneProfileStore) tb.setZoneProfileStore(zoneProfileStore);
  return tb;
}

describe('TreasureBox per-user zone resolution', () => {
  it('uses global zones when no ZoneProfileStore is set', () => {
    const tb = createTreasureBox();
    const zone = tb.resolveZone('soren', 113);
    expect(zone.id).toBe('active');
    expect(zone.coins).toBe(1);
  });

  it('uses per-user zones from ZoneProfileStore when available', () => {
    const store = createMockZoneProfileStore({ soren: SOREN_ZONE_CONFIG });
    const tb = createTreasureBox(store);
    const zone = tb.resolveZone('soren', 113);
    expect(zone.id).toBe('cool');
    expect(zone.coins).toBe(0);
  });

  it('falls back to global zones for users without custom profiles', () => {
    const store = createMockZoneProfileStore({ soren: SOREN_ZONE_CONFIG });
    const tb = createTreasureBox(store);
    const zone = tb.resolveZone('alan', 113);
    expect(zone.id).toBe('active');
    expect(zone.coins).toBe(1);
  });

  it('respects per-user active threshold exactly at boundary', () => {
    const store = createMockZoneProfileStore({ soren: SOREN_ZONE_CONFIG });
    const tb = createTreasureBox(store);
    const zone = tb.resolveZone('soren', 125);
    expect(zone.id).toBe('active');
    expect(zone.coins).toBe(1);
  });

  it('resolves higher zones correctly with per-user thresholds', () => {
    const store = createMockZoneProfileStore({ soren: SOREN_ZONE_CONFIG });
    const tb = createTreasureBox(store);
    const zone = tb.resolveZone('soren', 155);
    expect(zone.id).toBe('warm');
    expect(zone.coins).toBe(2);
  });

  it('still uses usersConfigOverrides if populated (backward compat)', () => {
    const tb = createTreasureBox();
    tb.usersConfigOverrides.set('soren', { active: 125, warm: 150, hot: 170, fire: 190 });
    const zone = tb.resolveZone('soren', 113);
    expect(zone.id).toBe('cool');
    expect(zone.coins).toBe(0);
  });
});
