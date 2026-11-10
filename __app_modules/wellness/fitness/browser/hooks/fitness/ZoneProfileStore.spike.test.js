import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), sampled: vi.fn() }));
vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => ({ default: () => logger }));

const { ZoneProfileStore } = await import('./ZoneProfileStore.js');
const { nextFireToasts, createFireZoneTracker } = await import('../../player/overlays/fireZoneTracker.js');

/**
 * 2026-10-23 (bug #10): one 204 bpm packet from Rider A's strap (152,152,204,153)
 * and one from Rider B's (111,204,110) each committed Fire on a single sample,
 * because a zone change after a quiet 5s committed instantly. An upward commit
 * now needs two separate samples in the higher zone spanning at least 1s.
 */
const LADDER = [
  { id: 'cool', name: 'Cool', min: 60 },
  { id: 'active', name: 'Active', min: 120 },
  { id: 'warm', name: 'Warm', min: 140 },
  { id: 'hot', name: 'Hot', min: 165 },
  { id: 'fire', name: 'Fire', min: 190 },
];
const advance = (ms) => vi.setSystemTime(Date.now() + ms);

describe('ZoneProfileStore — an upward zone change needs confirmation', () => {
  let store;
  let tracker;
  let toasts;
  let fireEntries;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T00:20:00Z'));
    store = new ZoneProfileStore();
    tracker = createFireZoneTracker();
    toasts = [];
    fireEntries = [];
    logger.info.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  // Each call is one real sample from the rider's own strap.
  const sample = (hr, id = 'rider-a') => {
    store.syncFromUsers([{ id, name: id, zoneConfig: LADDER, currentData: { heartRate: hr }, zoneReadingAt: Date.now() }]);
    const profile = store.getProfile(id);
    const result = nextFireToasts(tracker, [profile]);
    tracker = result.tracker;
    toasts.push(...result.entries);
    if (profile.currentZoneId === 'fire') fireEntries.push(profile);
    return profile;
  };
  const replay = (values, stepMs, id) => values.map((hr) => { advance(stepMs); return sample(hr, id); });
  const baseline = (id) => { sample(90, id); advance(6000); };

  it("Rider A: 152 x18, one 204, then 153 never commits Fire (1 Hz)", () => {
    baseline('rider-a');
    replay(Array(18).fill(152), 1000, 'rider-a');
    expect(store.getProfile('rider-a').currentZoneId).toBe('warm');
    replay([204, 153, 153, 153, 153], 1000, 'rider-a');
    expect(fireEntries).toEqual([]);
    expect(toasts).toEqual([]);
    expect(store.getProfile('rider-a')).toMatchObject({ currentZoneId: 'warm' });
    expect(store.getProfile('rider-a').zoneEntry.zoneId).not.toBe('fire');
  });

  it('Rider A at the strap rate (4 Hz) never commits Fire', () => {
    baseline('rider-a');
    replay(Array(40).fill(152), 250, 'rider-a');
    replay([204, 153, 153, 152], 250, 'rider-a');
    expect(fireEntries).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('Rider B: Cool 111, one 204, then 110 never leaves Cool', () => {
    baseline('rider-b');
    replay(Array(10).fill(111), 1000, 'rider-b');
    const zones = replay([204, 110, 110], 1000, 'rider-b').map((p) => p.currentZoneId);
    expect(zones).toEqual(['cool', 'cool', 'cool']);
    expect(fireEntries).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('a sustained climb 186 -> 190 -> 191 -> 192 commits Fire on the confirming sample', () => {
    baseline('rider-a');
    replay([170, 175, 180, 183, 186, 186, 186], 1000, 'rider-a');
    expect(store.getProfile('rider-a').currentZoneId).toBe('hot');
    const [at190, at191, at192] = replay([190, 191, 192], 1000, 'rider-a');
    expect(at190.currentZoneId).toBe('hot');
    expect(at191.currentZoneId).toBe('fire');
    expect(at191.zoneEntry).toMatchObject({ zoneId: 'fire', heartRate: 191, threshold: 190 });
    expect(at192.zoneEntry.id).toBe(at191.zoneEntry.id);
    expect(toasts).toEqual([]); // a ceremony needs Fire HELD (FIRE_CEREMONY_SUSTAIN_MS)
    replay([193, 193, 193, 193], 1000, 'rider-a');
    expect(toasts).toEqual([expect.objectContaining({ userId: 'rider-a', heartRate: 191, fireThreshold: 190 })]);
    const commit = logger.info.mock.calls.find(([event, data]) => event === 'fitness.zone_state.transition' && data.committedZoneId === 'fire');
    expect(commit[1]).toMatchObject({ commitPath: 'confirmed-upward', rawSamples: 2 });
  });

  it('two samples inside one second are not yet a confirmation', () => {
    baseline('rider-a');
    replay(Array(8).fill(152), 1000, 'rider-a');
    expect(replay([170, 171, 172], 250, 'rider-a').map((p) => p.currentZoneId)).toEqual(['warm', 'warm', 'warm']);
    advance(500);
    expect(sample(172, 'rider-a').currentZoneId).toBe('hot');
  });

  it("re-syncing the same reading (another rider's packet) does not confirm it", () => {
    baseline('rider-a');
    replay(Array(5).fill(152), 1000, 'rider-a');
    advance(1000);
    const readingAt = Date.now();
    const resync = () => {
      store.syncFromUsers([{ id: 'rider-a', name: 'rider-a', zoneConfig: LADDER, currentData: { heartRate: 204 }, zoneReadingAt: readingAt }]);
      return store.getProfile('rider-a').currentZoneId;
    };
    expect(resync()).toBe('warm');
    advance(1500);
    expect(resync()).toBe('warm');
    advance(1500);
    expect(resync()).toBe('warm');
  });

  it('a genuine drop still commits on its first sample', () => {
    baseline('rider-a');
    replay([170, 170, 170, 170, 170, 170, 170], 1000, 'rider-a');
    expect(store.getProfile('rider-a').currentZoneId).toBe('hot');
    const dropped = replay([150], 1000, 'rider-a')[0];
    expect(dropped.currentZoneId).toBe('warm');
  });
});
