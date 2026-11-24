import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZoneProfileStore, ZONE_STABILITY_DEFAULTS } from "./ZoneProfileStore.js";

vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => {
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), sampled: vi.fn() };
  return { default: () => logger };
});

/**
 * The zone commit tunables come from the household `zone_stability:` block,
 * with the built-in values as defaults for any key that is missing or bad.
 */
const ZONES = [
  { id: 'cool', name: 'Cool', min: 60 },
  { id: 'active', name: 'Active', min: 120 },
  { id: 'warm', name: 'Warm', min: 140 },
];
const rider = (heartRate) => ({ id: 'rider-a', name: 'Rider A', zoneConfig: ZONES, currentData: { heartRate } });
const zoneOf = (store) => store.getProfile('rider-a')?.currentZoneId ?? null;
const advance = (ms) => vi.setSystemTime(Date.now() + ms);
// Trust starts in Cool; then a confirmed climb to Active and a quiet cooldown.
const climbToActive = (store) => {
  store.syncFromUsers([rider(90)]);
  advance(6000);
  store.syncFromUsers([rider(130)]);
  advance(1000);
  store.syncFromUsers([rider(130)]);
  expect(zoneOf(store)).toBe('active');
  advance(6000);
};

describe('ZoneProfileStore — zone_stability config', () => {
  let store;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T03:05:00Z'));
    store = new ZoneProfileStore();
  });
  afterEach(() => vi.useRealTimers());

  it('keeps every default when no block is configured', () => {
    store.configureStability(null);
    expect(store._stability).toEqual(ZONE_STABILITY_DEFAULTS);
  });

  it('overrides only valid keys', () => {
    store.configureStability({ exit_margin_bpm: 0, hysteresis_cooldown_ms: 'soon', upward_confirm_ms: -5 });
    expect(store._stability).toEqual({ ...ZONE_STABILITY_DEFAULTS, exitMarginBpm: 0 });
  });

  it('exit_margin_bpm: 0 drops a zone as soon as HR falls under its floor', () => {
    store.configureStability({ exit_margin_bpm: 0 });
    climbToActive(store);
    advance(1000);
    store.syncFromUsers([rider(118)]);
    expect(zoneOf(store)).toBe('cool');
  });

  it('the default 5 bpm margin holds the zone at the same reading', () => {
    climbToActive(store);
    advance(1000);
    store.syncFromUsers([rider(118)]);
    expect(zoneOf(store)).toBe('active');
  });
});
