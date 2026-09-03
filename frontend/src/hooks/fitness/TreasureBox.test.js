import { describe, expect, it, vi } from 'vitest';
import { FitnessTreasureBox } from './TreasureBox.js';
import { ZoneProfileStore } from './ZoneProfileStore.js';

describe('FitnessTreasureBox ring award callback', () => {
  it('publishes a canonical completed award after totals have been updated', () => {
    const box = new FitnessTreasureBox({ startTime: Date.now(), timebase: {} });
    box.perUser.set('user_4', { profileId: 'user_4', totalRings: 100 });
    box.totalRings = 300;
    const onAward = vi.fn();
    box.setRingAwardCallback(onAward);

    box._awardRings('user_4', { id: 'hot', name: 'Hot', rings: 5, color: 'orange' });

    expect(onAward).toHaveBeenCalledOnce();
    expect(onAward).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_4', zone: 'hot', color: 'orange', rings: 5,
      userTotal: 105, totalRings: 305,
    }));
  });
});

describe('FitnessTreasureBox explicit challenge bonus', () => {
  it('awards exactly once and records it in totals, timeline, event log, and callback', () => {
    const logEvent = vi.fn();
    const session = { startTime: Date.now(), timebase: {}, timeline: { events: [] }, logEvent };
    const box = new FitnessTreasureBox(session);
    box.perUser.set('user_2', { profileId: 'user_2', totalRings: 5 });
    const onAward = vi.fn();
    box.setRingAwardCallback(onAward);

    const first = box.awardBonus({
      idempotencyKey: 'step-1:user_2:completion', userId: 'user_2', rings: 3,
      zoneId: 'warm', color: 'yellow', source: 'step_challenge',
    });
    const duplicate = box.awardBonus({
      idempotencyKey: 'step-1:user_2:completion', userId: 'user_2', rings: 3,
      zoneId: 'warm', color: 'yellow', source: 'step_challenge',
    });

    expect(first.awarded).toBe(true);
    expect(duplicate).toEqual({ awarded: false, reason: 'duplicate' });
    expect(box.totalRings).toBe(3);
    expect(box.perUser.get('user_2').totalRings).toBe(8);
    expect(box._timeline.cumulative[0]).toBe(3);
    expect(logEvent).toHaveBeenCalledOnce();
    expect(onAward).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 2026-09-01: user_4's first HR sample reached the box 1ms before ZoneProfileStore
// had built his profile. The box cached the miss and scored him on GLOBAL
// thresholds (active=100) for the whole session while the roster, LED and zone
// series used his personal ones (active=120).
//
// The two zone tables below are deliberately hand-written: they pin that
// HISTORICAL incident (global active=100 vs user_4's personal active=120), not
// the current contents of data/household/fitness/config.yml. Everything else
// here comes from the real ZoneProfileStore and the real configure() call shape
// used by FitnessSession, so the profile shape cannot drift from production.
// ---------------------------------------------------------------------------
const GLOBAL_ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', rings: 0 },
  { id: 'active', name: 'Active', min: 100, color: 'green', rings: 1 },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow', rings: 2 },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange', rings: 3 },
  { id: 'fire', name: 'Fire', min: 160, color: 'red', rings: 5 },
];
// user_4's personal table from the incident: active 120 / warm 140 / hot 160.
const MILO_ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', rings: 0 },
  { id: 'active', name: 'Active', min: 120, color: 'green', rings: 1 },
  { id: 'warm', name: 'Warm', min: 140, color: 'yellow', rings: 2 },
  { id: 'hot', name: 'Hot', min: 160, color: 'orange', rings: 3 },
];

const miloUser = (zoneConfig, heartRate) => ({
  id: 'user_4', name: 'User_4', zoneConfig, currentData: { heartRate }
});

function boxWithStore() {
  const store = new ZoneProfileStore();
  store.setBaseZoneConfig(GLOBAL_ZONES);
  const box = new FitnessTreasureBox({ startTime: Date.now(), timebase: {} });
  // Production order (FitnessSession): store first, THEN zones from its base
  // config. configure() runs _backfillExistingUsers(), which calls resolveZone
  // and seeds accumulators — so it must see the store, and setZoneProfileStore()
  // must not run after it and wipe what it built.
  box.setZoneProfileStore(store);
  box.configure({ zones: store.getBaseZoneConfig() });
  return { box, store };
}

describe('FitnessTreasureBox.resolveZone with a late ZoneProfileStore profile', () => {
  it('does not cache a missing profile — the next sample uses the personal thresholds', () => {
    const { box, store } = boxWithStore();

    expect(store.getProfile('user_4')).toBeNull();              // the 1ms race
    expect(box.resolveZone('user_4', 105).id).toBe('active');   // no profile yet: global

    store.syncFromUsers([miloUser(MILO_ZONES, 105)]);         // store catches up
    expect(box.resolveZone('user_4', 105).id).toBe('cool');     // personal active=120
  });

  it('re-reads a profile whose thresholds changed, and only then', () => {
    const { box, store } = boxWithStore();

    store.syncFromUsers([miloUser(GLOBAL_ZONES, 105)]);
    expect(box.resolveZone('user_4', 105).id).toBe('active');

    // HR churn — what nearly every packet produces — must not drop the cache.
    const getProfileSpy = vi.spyOn(store, 'getProfile');
    store.syncFromUsers([miloUser(GLOBAL_ZONES, 106)]);
    expect(box.resolveZone('user_4', 106).id).toBe('active');
    expect(getProfileSpy).not.toHaveBeenCalled();

    // A real threshold change is picked up on the next read, with nothing
    // having to remember to tell the box.
    store.syncFromUsers([miloUser(MILO_ZONES, 106)]);
    expect(box.resolveZone('user_4', 106).id).toBe('cool');
    expect(getProfileSpy).toHaveBeenCalled();
  });

  it('warns once per user for a profile-less user, not once per HR sample', () => {
    const { box } = boxWithStore();
    const logSpy = vi.spyOn(box, '_log');

    // A guest the store never learns about: without a guard this warn would fire
    // on every HR sample for the whole session.
    for (let i = 0; i < 5; i++) {
      expect(box.resolveZone('guest-1', 105).id).toBe('active'); // global, every time
    }

    const misses = logSpy.mock.calls.filter(([event]) => event === 'zone_override_miss');
    expect(misses).toHaveLength(1);
    expect(misses[0][1]).toEqual({ userId: 'guest-1' });
    expect(misses[0][2]).toBe('warn');
  });
});
