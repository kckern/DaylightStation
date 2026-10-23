import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZoneProfileStore } from "./ZoneProfileStore.js";

vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => {
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), sampled: vi.fn() };
  return { default: () => logger };
});

/**
 * A strap that drops its readings is not a rider who cooled down.
 *
 * 2026-10-21, arcade: a rider's strap lost readings for ~5s at a time. The gap read
 * as HR 0 = Cool and was COMMITTED as a zone change, which armed the anti-toggle
 * cooldown — so when the strap came back at 168-171 bpm, Hot had to sit stable
 * for 3s before it counted. Governance saw "Cool at 170 bpm" in between and
 * flashed 0.1s warnings at a child who was working hard.
 */
const ZONES = [
  { id: 'cool', name: 'Cool', min: 60 },
  { id: 'active', name: 'Active', min: 120 },
  { id: 'warm', name: 'Warm', min: 140 },
  { id: 'hot', name: 'Hot', min: 160 },
  { id: 'fire', name: 'On Fire', min: 180 },
];
const rider = (heartRate) => ({ id: 'rider-a', name: 'Rider A', zoneConfig: ZONES, currentData: { heartRate } });
const zoneOf = (store) => store.getProfile('rider-a')?.currentZoneId ?? null;
const advance = (ms) => vi.setSystemTime(Date.now() + ms);

describe('ZoneProfileStore — a reading gap does not count as a zone change', () => {
  let store;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T03:05:00Z'));
    store = new ZoneProfileStore();
    store.syncFromUsers([rider(90)]);
    advance(6000);
  });
  afterEach(() => vi.useRealTimers());

  it('returns straight to Hot when a brief same-wearer gap ends at 168 bpm', () => {
    store.syncFromUsers([rider(170)]);
    advance(10_000);
    store.syncFromUsers([rider(170)]);
    expect(zoneOf(store)).toBe('hot');

    advance(1_000);
    store.syncFromUsers([rider(null)]);   // strap sends no reading
    advance(2_000);
    expect(zoneOf(store)).toBe('hot');
    store.syncFromUsers([rider(168)]);    // reading restored
    expect(zoneOf(store)).toBe('hot');
  });

  it('still debounces a real rapid toggle between two readings', () => {
    store.syncFromUsers([rider(170)]);
    advance(10_000);
    store.syncFromUsers([rider(130)]);    // a real drop: commits instantly
    expect(zoneOf(store)).toBe('active');
    advance(1_000);
    store.syncFromUsers([rider(170)]);    // bouncing straight back is debounced
    expect(zoneOf(store)).toBe('active');
  });
});
