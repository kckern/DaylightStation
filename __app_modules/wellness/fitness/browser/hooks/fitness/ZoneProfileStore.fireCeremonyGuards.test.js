import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), sampled: vi.fn() }));
vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => ({ default: () => logger }));

const { ZoneProfileStore } = await import('./ZoneProfileStore.js');
const { nextFireToasts, createFireZoneTracker } = await import('../../player/overlays/fireZoneTracker.js');

/**
 * Owner rule: a Fire ceremony never happens unless the rider is actually in
 * Fire. These are the store-side ways a rider could be PUT in Fire without a
 * real upward HR crossing — a ladder change, a reload restore with no
 * evidence, a simulated strap — and each must leave a mark on the entry that
 * the tracker refuses to celebrate.
 */
const ladder = (fireMin) => [
  { id: 'cool', name: 'Cool', min: 60 },
  { id: 'active', name: 'Active', min: 120 },
  { id: 'warm', name: 'Warm', min: 140 },
  { id: 'hot', name: 'Hot', min: 160 },
  { id: 'fire', name: 'Fire', min: fireMin },
];
const advance = (ms) => vi.setSystemTime(Date.now() + ms);

describe('ZoneProfileStore — Fire reached without a real crossing never celebrates', () => {
  let store;
  let tracker;
  let toasts;
  let fireMin;
  let simulated;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));
    store = new ZoneProfileStore();
    tracker = createFireZoneTracker();
    toasts = [];
    fireMin = 190;
    simulated = false;
    Object.values(logger).forEach((fn) => fn.mockClear?.());
  });
  afterEach(() => vi.useRealTimers());

  const sample = (hr, id = 'rider-a') => {
    store.syncFromUsers([{
      id, name: id, zoneConfig: ladder(fireMin), currentData: { heartRate: hr },
      zoneReadingAt: Date.now(), zoneReadingDeviceId: 'strap-1', zoneReadingSimulated: simulated
    }]);
    const result = nextFireToasts(tracker, store.getProfiles());
    tracker = result.tracker;
    toasts.push(...result.entries);
    return store.getProfile(id);
  };
  const replay = (values, stepMs = 1000) => values.map((hr) => { advance(stepMs); return sample(hr); });
  const toHot = () => {
    sample(90); advance(6000);
    replay([120, 140, 150, 160, 170, 178, 180, 180, 180, 180]);
    expect(store.getProfile('rider-a')).toMatchObject({ zoneTrusted: true, currentZoneId: 'hot' });
  };

  it('a genuine climb into Fire, held for 6s at 1 Hz, celebrates once', () => {
    toHot();
    replay([186, 192, 194, 195, 195, 195, 195, 195, 195, 195]);
    expect(store.getProfile('rider-a').currentZoneId).toBe('fire');
    expect(toasts).toEqual([expect.objectContaining({ userId: 'rider-a', fireThreshold: 190, deviceId: 'strap-1' })]);
  });

  it('keeps the latest reading time on the profile even when the HR repeats', () => {
    toHot();
    const before = store.getProfile('rider-a').zoneReadingAt;
    advance(1000);
    sample(180);
    const after = store.getProfile('rider-a');
    expect(after.zoneReadingAt).toBeGreaterThan(before);
    expect(after).toMatchObject({ zoneReadingDeviceId: 'strap-1', zoneReadingEligible: true, zoneReadingSimulated: false });
  });

  it('a lowered ladder at a constant HR reclassifies into Fire but never celebrates', () => {
    toHot();
    fireMin = 175; // the rider's thresholds are edited mid-session; HR stays 180
    const zones = replay(Array(15).fill(180)).map((p) => p.currentZoneId);
    expect(zones.at(-1)).toBe('fire');
    expect(store.getProfile('rider-a').zoneEntry).toMatchObject({ zoneId: 'fire', reclassified: true });
    expect(toasts).toEqual([]);
    expect(logger.info.mock.calls.some(([event, data]) => event === 'fitness.zone_ladder.changed' && data.userId === 'rider-a')).toBe(true);
  });

  it('a lowered ladder through a config rebuild (clear preserveTrust) never celebrates either', () => {
    toHot();
    store.clear({ preserveTrust: true });
    fireMin = 175;
    replay(Array(15).fill(180));
    expect(store.getProfile('rider-a')).toMatchObject({ currentZoneId: 'fire', zoneEntry: { reclassified: true } });
    expect(toasts).toEqual([]);
  });

  it('after a lowered ladder, a real crossing under the NEW ladder still celebrates', () => {
    toHot();
    fireMin = 175;
    replay(Array(10).fill(180));
    expect(toasts).toEqual([]);
    // A real drop below the new Fire line, then a real climb back over it.
    replay([165, 165, 165, 165, 165, 165, 165, 165]);
    expect(store.getProfile('rider-a').currentZoneId).toBe('hot');
    replay([172, 178, 180, 181, 181, 181, 181, 181, 181, 181]);
    expect(store.getProfile('rider-a').zoneEntry).toMatchObject({ zoneId: 'fire' });
    expect(store.getProfile('rider-a').zoneEntry.reclassified).toBeUndefined();
    expect(toasts).toHaveLength(1);
  });

  it('a v1-restored rider (trust with no evidence) never celebrates the first Fire reading', () => {
    // The tracker has already seen this rider at Hot (same UI, store rebuilt).
    tracker = nextFireToasts(tracker, [{ id: 'rider-a', zoneTrusted: true, currentZoneId: 'hot', zoneEntry: null }]).tracker;
    store.restoreTrust('rider-a');
    replay(Array(12).fill(204));
    const profile = store.getProfile('rider-a');
    expect(profile.currentZoneId).toBe('fire');
    expect(profile.zoneEntry).toMatchObject({ zoneId: 'fire', resumed: true });
    expect(toasts).toEqual([]);
  });

  it('a v1-restored rider still celebrates a later real crossing', () => {
    store.restoreTrust('rider-a');
    replay([170, 170, 170, 170, 170, 170, 170]);
    expect(store.getProfile('rider-a').zoneEntry).toMatchObject({ zoneId: 'hot', resumed: true });
    replay([186, 192, 194, 195, 195, 195, 195, 195, 195, 195]);
    expect(toasts).toHaveLength(1);
  });

  it('a simulated strap reaches Fire (governance still sees it) but never celebrates', () => {
    simulated = true;
    toHot();
    replay([186, 192, 194, 195, 195, 195, 195, 195, 195, 195]);
    const profile = store.getProfile('rider-a');
    expect(profile.currentZoneId).toBe('fire');
    expect(profile.zoneReadingSimulated).toBe(true);
    expect(profile.zoneEntry).toMatchObject({ zoneId: 'fire', simulated: true });
    expect(toasts).toEqual([]);
  });
});
