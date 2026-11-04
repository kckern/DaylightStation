import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';

// Mock logger
const mockSampled = vi.fn();
const mockInfo = vi.fn();
const mockWarn = vi.fn();
const mockDebug = vi.fn();
const mockError = vi.fn();
vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug, error: mockError }),
  getLogger: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug, error: mockError })
}));

let ZoneProfileStore;
beforeAll(async () => {
  ({ ZoneProfileStore } = await import("../../../../../__app_modules/wellness/fitness/browser/hooks/fitness/ZoneProfileStore.js"));
});

const ZONE_CONFIG = [
  { id: 'cool', name: 'Cool', min: 0, color: 'gray', rings: 0 },
  { id: 'active', name: 'Active', min: 100, color: 'green', rings: 1 },
  { id: 'warm', name: 'Warm', min: 130, color: 'yellow', rings: 2 },
  { id: 'hot', name: 'Hot', min: 160, color: 'orange', rings: 3 }
];

const makeUser = (id, heartRate, opts = {}) => ({
  id,
  name: opts.name || id,
  displayName: opts.displayName || id,
  currentData: { heartRate },
  zoneConfig: opts.zoneConfig || null,
  source: 'test'
});

describe('ZoneProfileStore hysteresis', () => {
  let store;
  let realDateNow;
  let mockTime;

  beforeEach(() => {
    mockSampled.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();
    mockDebug.mockClear();
    mockError.mockClear();
    store = new ZoneProfileStore();
    store.setBaseZoneConfig(ZONE_CONFIG);
    realDateNow = Date.now;
    mockTime = realDateNow.call(Date);
    Date.now = () => mockTime;
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  // Zones are earned (ZoneProfileStore.startupTrust): a real Cool reading admits
  // the rider and commits at once; an upward move then needs a second sample at
  // least UPWARD_CONFIRM_MS later. `commitAt` walks a rider through both, past
  // the cooldown, and leaves them committed in the zone for `hr`.
  const sync = (hr) => { store.syncFromUsers([makeUser('user-1', hr)]); return store.getProfile('user-1'); };
  const commitAt = (hr) => {
    sync(50);
    mockTime += 6000;
    sync(hr);
    mockTime += 1000;
    return sync(hr);
  };

  test('a first real Cool reading is committed instantly; a higher first reading is not trusted', () => {
    expect(sync(110).currentZoneId).toBeNull();
    expect(sync(50).currentZoneId).toBe('cool');
  });

  test('an upward move commits on its confirming second sample', () => {
    sync(50);
    mockTime += 6000;
    expect(sync(110).currentZoneId).toBe('cool');
    mockTime += 1000;
    expect(sync(110).currentZoneId).toBe('active');
  });

  test('zone transitions after cooldown period commit once confirmed', () => {
    expect(commitAt(110).currentZoneId).toBe('active');
    mockTime += 6000;
    sync(140);
    mockTime += 1000;
    expect(sync(140).currentZoneId).toBe('warm');
  });

  test('rapid toggling within cooldown holds committed zone', () => {
    expect(commitAt(110).currentZoneId).toBe('active');

    // 100ms later: HR crosses into warm — one sample is not a climb
    mockTime += 100;
    expect(sync(140).currentZoneId).toBe('active');

    // 200ms later: HR drops back to active
    mockTime += 200;
    expect(sync(110).currentZoneId).toBe('active');

    // 100ms later: HR crosses into warm again — raw just changed, not stable
    mockTime += 100;
    expect(sync(140).currentZoneId).toBe('active');
  });

  test('new zone commits after stability period within cooldown', () => {
    expect(commitAt(110).currentZoneId).toBe('active');

    mockTime += 100;
    expect(sync(140).currentZoneId).toBe('active'); // Not stable yet

    // Warm stays for HYSTERESIS_STABILITY_MS (3000ms), still inside the 5s cooldown
    mockTime += 3000;
    expect(sync(141).currentZoneId).toBe('warm');
  });

  test('HR 0 is no reading: it earns no zone, and a trusted zone holds through it', () => {
    expect(sync(0).currentZoneId).toBeNull();
    commitAt(110);
    mockTime += 1000;
    expect(sync(0).currentZoneId).toBe('active');
  });

  test('missing HR (NaN/undefined) is shown as missing, not as 0', () => {
    store.syncFromUsers([{
      id: 'user-1',
      name: 'user-1',
      displayName: 'user-1',
      currentData: { heartRate: undefined },
      source: 'test'
    }]);
    const profile = store.getProfile('user-1');
    expect(profile.heartRate).toBeNull();
    expect(profile.currentZoneId).toBeNull();
  });

  test('profile returns stabilized zone, not raw snapshot zone', () => {
    commitAt(110);
    mockTime += 100;
    const profile = sync(140); // raw: warm
    expect(profile.currentZoneId).toBe('active');
    expect(profile.zoneSnapshot?.currentZoneId).toBe('warm');
  });

  test('getZoneState returns stabilized zone matching getProfile', () => {
    commitAt(110);
    mockTime += 100;
    const profile = sync(140);
    const zoneState = store.getZoneState('user-1');
    expect(zoneState.zoneId).toBe(profile.currentZoneId);
    expect(zoneState.zoneId).toBe('active'); // Stabilized, not raw warm
  });

  // --- Schmitt trigger exit margin tests ---

  test('exit margin suppresses downgrade when HR within margin', () => {
    commitAt(110);
    mockTime += 6000;
    // 97 — below active (100) but above exit threshold (100 - 5 = 95)
    expect(sync(97).currentZoneId).toBe('active');
  });

  test('exit margin allows downgrade when HR below exit threshold', () => {
    commitAt(110);
    mockTime += 6000;
    expect(sync(94).currentZoneId).toBe('cool');
  });

  test('exit margin does not apply to upgrades', () => {
    expect(sync(50).currentZoneId).toBe('cool');
    mockTime += 6000;
    // 101 — just above active (100); commits on the confirming sample 1s later
    sync(101);
    mockTime += 1000;
    expect(sync(101).currentZoneId).toBe('active');
  });

  test('exit margin and time-based hysteresis work together', () => {
    expect(commitAt(140).currentZoneId).toBe('warm');

    // 100ms later (within cooldown): 127 — below warm (130), above exit (125)
    mockTime += 100;
    expect(sync(127).currentZoneId).toBe('warm');

    // Past cooldown: exit margin still suppresses
    mockTime += 6000;
    expect(sync(127).currentZoneId).toBe('warm');

    // 124 — below exit threshold → downgrade commits
    mockTime += 6000;
    expect(sync(124).currentZoneId).toBe('active');
  });

  test('a ladder with an earned rung below the cool baseline is never committed', () => {
    // This used to assert the exit-margin clamp using an active rung at 2bpm.
    // As of 2026-09-16 that ladder cannot be committed at all: an EARNED rung
    // below MIN_COOL_BASELINE is exactly the defect that reported Fire at a
    // resting heart rate, so validateZoneLadder rejects it and the rider gets
    // no zone rather than a zone they did not earn. The clamp itself is now
    // unreachable for any committed ladder — every earned rung is >= 60, so
    // `min - EXIT_MARGIN_BPM` can never go negative.
    // See ops:docs/_wip/plans/2026-09-16-zone-ladder-validation-design.md
    const tightConfig = [
      { id: 'cool', name: 'Cool', min: 0, color: 'gray', rings: 0 },
      { id: 'active', name: 'Active', min: 2, color: 'green', rings: 1 }
    ];
    store.setBaseZoneConfig(tightConfig);

    store.syncFromUsers([makeUser('user-1', 65)]);
    expect(store.getProfile('user-1').currentZoneId).toBeNull();

    // And it stays rejected rather than drifting into a zone as HR moves.
    mockTime += 6000;
    store.syncFromUsers([makeUser('user-1', 1)]);
    expect(store.getProfile('user-1').currentZoneId).toBeNull();
  });
});
