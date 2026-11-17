import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), sampled: vi.fn() }));
vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => ({ default: () => logger }));

const { ZoneProfileStore, FIRE_UPWARD_CONFIRM_MS } = await import('./ZoneProfileStore.js');
const { nextFireToasts, createFireZoneTracker } = await import('../../player/overlays/fireZoneTracker.js');

/**
 * 2026-11-17, one rider, one strap, readings as the garage sensor logged them
 * (one per line, timestamped to the second). The first stint touched the 160
 * floor at exactly 160 for under 4s; the 1s confirm committed Fire, the garage
 * went red and the ceremony played. The second held 160-162 for ~13s and was
 * real. Fire must be held FIRE_UPWARD_CONFIRM_MS.
 */
const LADDER = [
  { id: 'cool', name: 'Cool', min: 0 },
  { id: 'active', name: 'Active', min: 100 },
  { id: 'warm', name: 'Warm', min: 120 },
  { id: 'hot', name: 'Hot', min: 140 },
  { id: 'fire', name: 'Fire', min: 160 },
];

// [second offset, bpm] from the sensor log, 21:56:30 onward / 22:03:50 onward.
const TOUCHED = [[0, 152], [2, 154], [3, 155], [4, 156], [5, 157], [6, 158], [9, 160], [10, 160], [12, 160],
  [13, 159], [14, 159], [16, 158], [17, 157], [18, 156], [20, 154], [21, 153], [22, 153]];
const HELD = [[0, 154], [1, 154], [2, 154], [3, 154], [5, 155], [6, 157], [7, 158], [8, 159], [9, 161], [11, 162],
  [12, 162], [13, 162], [14, 161], [16, 161], [17, 161], [18, 161], [19, 160], [21, 160], [22, 159], [23, 159],
  [24, 159], [25, 159], [27, 159], [28, 159], [29, 159], [30, 158]];

describe('ZoneProfileStore — Fire must be held, not touched', () => {
  let store;
  let tracker;
  let toasts;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T21:50:00Z'));
    store = new ZoneProfileStore();
    tracker = createFireZoneTracker();
    toasts = [];
  });
  afterEach(() => vi.useRealTimers());

  const sample = (hr) => {
    store.syncFromUsers([{ id: 'rider', name: 'rider', zoneConfig: LADDER, currentData: { heartRate: hr }, zoneReadingAt: Date.now() }]);
    const profile = store.getProfile('rider');
    const result = nextFireToasts(tracker, [profile]);
    tracker = result.tracker;
    toasts.push(...result.entries);
    return profile;
  };
  // Settle into Hot well before the stint, then play it at its real timing.
  const play = (readings) => {
    sample(90);
    vi.setSystemTime(Date.now() + 6000);
    for (const hr of [100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 150, 150, 150, 150, 150]) {
      vi.setSystemTime(Date.now() + 1000);
      sample(hr);
    }
    expect(store.getProfile('rider').currentZoneId).toBe('hot');
    const start = Date.now();
    return readings.map(([s, hr]) => { vi.setSystemTime(start + s * 1000); return sample(hr).currentZoneId; });
  };

  it('the 21:56 stint (160 for under 4s) never commits Fire and plays no ceremony', () => {
    expect(play(TOUCHED)).not.toContain('fire');
    expect(toasts).toEqual([]);
  });

  it('the 22:04 stint (160-162 for ~13s) commits Fire once held, with its ceremony', () => {
    const zones = play(HELD);
    const first = zones.indexOf('fire');
    // Fire from 22:03:59 (offset 9); committed on the first reading 5s on.
    expect(HELD[first][0] - 9).toBeGreaterThanOrEqual(FIRE_UPWARD_CONFIRM_MS / 1000);
    expect(HELD[first][0]).toBe(14);
    expect(toasts).toEqual([expect.objectContaining({ userId: 'rider', path: 'climb' })]);
  });

  it('the other zones still confirm in 1s', () => {
    play([]);
    sample(119);
    vi.setSystemTime(Date.now() + 60_000);
    // From Hot down to Active, back up: Warm commits on the second reading 1s apart.
    sample(110);
    vi.setSystemTime(Date.now() + 6000);
    sample(125);
    vi.setSystemTime(Date.now() + 1000);
    expect(sample(125).currentZoneId).toBe('warm');
  });

  describe('a rider coming back from a strap dropout', () => {
    const syncAt = (hr) => {
      store.syncFromUsers([{ id: 'rider', name: 'rider', zoneConfig: LADDER, currentData: { heartRate: hr },
        zoneReadingAt: Date.now(), zoneReadingDeviceId: '40475' }]);
      return store.getProfile('rider');
    };
    const tickTo = (hr) => { vi.setSystemTime(Date.now() + 1000); return syncAt(hr); };
    const loseStrap = () => { vi.setSystemTime(Date.now() + 1000); store.resetZoneState('rider', 'confirmed-loss'); vi.setSystemTime(Date.now() + 10_000); };
    const settleAt = (hr) => {
      syncAt(90);
      vi.setSystemTime(Date.now() + 6000);
      for (const h of [110, 120, 130, 140, 145, 150, 150, 150, hr, hr, hr, hr, hr, hr, hr]) tickTo(h);
    };

    it('evidence below Fire: returning at 161 is Hot until Fire is held 5s', () => {
      settleAt(150);
      expect(store.getProfile('rider').currentZoneId).toBe('hot');
      loseStrap();
      expect(syncAt(161)).toMatchObject({ zoneTrusted: true, currentZoneId: 'hot' });
      expect([tickTo(161), tickTo(162), tickTo(161), tickTo(161)].map((p) => p.currentZoneId)).toEqual(['hot', 'hot', 'hot', 'hot']);
      expect(tickTo(161).currentZoneId).toBe('fire');
    });

    it('evidence in Fire: resumes Fire at once, as before, with no new ceremony', () => {
      settleAt(150);
      for (let i = 0; i < 8; i += 1) tickTo(165);
      expect(store.getProfile('rider').currentZoneId).toBe('fire');
      loseStrap();
      expect(syncAt(166)).toMatchObject({ zoneTrusted: true, currentZoneId: 'fire', zoneEntry: { resumed: true } });
    });
  });
});
