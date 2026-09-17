import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZoneProfileStore } from './ZoneProfileStore.js';

vi.mock('../../lib/logging/Logger.js', () => {
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), sampled: vi.fn() };
  return { default: () => logger, __logger: logger };
});
const loggerOf = async () => (await import('../../lib/logging/Logger.js')).__logger;

/**
 * The false "ON FIRE" celebration, 2026-09-16 — replayed at the layer that
 * decides a rider's committed zone.
 *
 * Design: docs/_wip/plans/2026-09-16-zone-ladder-validation-design.md
 */

const GOOD = [
  { id: 'cool', name: 'Cool', min: 60 },
  { id: 'active', name: 'Active', min: 100 },
  { id: 'warm', name: 'Warm', min: 140 },
  { id: 'hot', name: 'Hot', min: 160 },
  { id: 'fire', name: 'On Fire', min: 175 }
];

// What a rebuild used to produce when thresholds could not be resolved: real
// zone ids, every threshold fabricated as 0.
const DEGENERATE = GOOD.map((zone) => ({ ...zone, min: 0 }));

const rider = (zoneConfig, heartRate) => ({
  id: 'rider-a', name: 'Rider A', zoneConfig, currentData: { heartRate }
});

const zoneOf = (store) => store.getProfile('rider-a')?.currentZoneId ?? null;

// The store debounces a zone change that lands within 5s of the last commit
// (HYSTERESIS_COOLDOWN_MS). Real ticks are seconds apart; back-to-back syncs in
// a test are not, so move the clock between them or every commit is debounced.
const settle = () => vi.setSystemTime(Date.now() + 6000);

describe('ZoneProfileStore — a degenerate ladder never commits a zone', () => {
  let store;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T20:00:00Z'));
    store = new ZoneProfileStore();
    const logger = await loggerOf();
    Object.values(logger).forEach((fn) => fn.mockClear?.());
  });
  afterEach(() => vi.useRealTimers());

  it('holds the rider at active through a degenerate rebuild at a steady 134bpm', () => {
    // The incident: 134bpm against a warm threshold of 140 reported FIRE.
    store.syncFromUsers([rider(GOOD, 134)]);
    expect(zoneOf(store)).toBe('active');

    store.syncFromUsers([rider(DEGENERATE, 134)]);
    expect(zoneOf(store)).toBe('active');
    expect(zoneOf(store)).not.toBe('fire');

    store.syncFromUsers([rider(GOOD, 134)]);
    expect(zoneOf(store)).toBe('active');
  });

  it('commits NO zone when the very first ladder is already degenerate', () => {
    store.syncFromUsers([rider(DEGENERATE, 134)]);
    expect(zoneOf(store)).toBeNull();

    settle();
    store.syncFromUsers([rider(GOOD, 134)]);
    expect(zoneOf(store)).toBe('active');
  });

  it('still lets a real Fire through on a valid ladder', () => {
    store.syncFromUsers([rider(GOOD, 134)]);
    settle();
    store.syncFromUsers([rider(GOOD, 185)]);
    expect(zoneOf(store)).toBe('fire');
  });

  it('does not memoize a profile built on a fallback ladder', () => {
    // Identical inputs twice. A cache hit would replay the fallback without
    // re-validating, turning one bad tick into a permanent one.
    store.syncFromUsers([rider(GOOD, 134)]);
    store.syncFromUsers([rider(DEGENERATE, 134)]);
    const cachedFallback = [...store._profileCache.values()]
      .some((profile) => profile.id === 'rider-a' && profile.zoneConfig.some((z) => z.min === 0));
    expect(cachedFallback).toBe(false);

    store.syncFromUsers([rider(DEGENERATE, 134)]);
    expect(zoneOf(store)).toBe('active');
  });

  it('warns once on entering the rejected state, not once per tick', async () => {
    const logger = await loggerOf();
    store.syncFromUsers([rider(GOOD, 134)]);
    for (let i = 0; i < 5; i += 1) store.syncFromUsers([rider(DEGENERATE, 134 + i)]);

    const rejects = logger.warn.mock.calls.filter(([event]) => event === 'fitness.zone_ladder.rejected');
    expect(rejects).toHaveLength(1);
    expect(rejects[0][1].reason).toBe('below-baseline');
    expect(rejects[0][1].fellBackTo).toBe('last-good');
  });

  it('logs recovery once the ladder validates again', async () => {
    const logger = await loggerOf();
    store.syncFromUsers([rider(GOOD, 134)]);
    store.syncFromUsers([rider(DEGENERATE, 134)]);
    store.syncFromUsers([rider(GOOD, 135)]);

    const recovered = logger.info.mock.calls.filter(([event]) => event === 'fitness.zone_ladder.recovered');
    expect(recovered).toHaveLength(1);
    expect(recovered[0][1].rejectedTicks).toBe(1);
  });

  it('does not carry a rider ladder across a session reset', () => {
    store.syncFromUsers([rider(GOOD, 134)]);
    store.clear();
    store.syncFromUsers([rider(DEGENERATE, 134)]);
    expect(zoneOf(store)).toBeNull();
  });

  it('treats an absent config as unconfigured, not as a rejection', async () => {
    const logger = await loggerOf();
    store.syncFromUsers([rider([], 134)]);
    expect(zoneOf(store)).toBeNull();
    expect(logger.warn.mock.calls.filter(([e]) => e === 'fitness.zone_ladder.rejected')).toHaveLength(0);
  });
});
