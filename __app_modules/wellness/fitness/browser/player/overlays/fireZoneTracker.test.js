import { describe, it, expect } from 'vitest';
import { createFireZoneTracker, nextFireToasts, FIRE_TOAST_COOLDOWN_MS } from "./fireZoneTracker.js";

let serial = 0;
const profile = (id, zone, name = id) => ({
  id, name, currentZoneId: zone, zoneTrusted: true, heartRate: 181,
  zoneConfig: [{ id: 'cool', min: 60 }, { id: 'fire', min: 175 }],
  zoneEntry: { id: ++serial, zoneId: zone, heartRate: 181, threshold: 175, enteredAt: 1000 }
});

describe('nextFireToasts', () => {
  it('stays silent for a user first observed already in fire', () => {
    // A page reload mid-workout must not congratulate someone for a zone they
    // reached before this UI existed.
    const r = nextFireToasts(createFireZoneTracker(), [profile('learner-one', 'fire')], { now: 1000 });
    expect(r.entries).toEqual([]);
  });

  it('emits when a user crosses into fire from another zone', () => {
    let t = createFireZoneTracker();
    t = nextFireToasts(t, [profile('learner-one', 'hot')], { now: 1000 }).tracker;
    const r = nextFireToasts(t, [profile('learner-one', 'fire')], { now: 2000 });
    expect(r.entries).toEqual([{ userId: 'learner-one', name: 'learner-one', heartRate: 181, fireThreshold: 175, entryId: expect.any(Number), previousZoneId: 'hot' }]);
  });

  it('suppresses a second crossing inside the cooldown', () => {
    let t = createFireZoneTracker();
    t = nextFireToasts(t, [profile('learner-one', 'hot')], { now: 1000 }).tracker;
    t = nextFireToasts(t, [profile('learner-one', 'fire')], { now: 2000 }).tracker;
    t = nextFireToasts(t, [profile('learner-one', 'hot')], { now: 3000 }).tracker;
    const r = nextFireToasts(t, [profile('learner-one', 'fire')], { now: 4000 });
    expect(r.entries).toEqual([]);
  });

  it('emits again once the cooldown has elapsed', () => {
    let t = createFireZoneTracker();
    t = nextFireToasts(t, [profile('learner-one', 'hot')], { now: 1000 }).tracker;
    t = nextFireToasts(t, [profile('learner-one', 'fire')], { now: 2000 }).tracker;
    t = nextFireToasts(t, [profile('learner-one', 'hot')], { now: 3000 }).tracker;
    const later = 2000 + FIRE_TOAST_COOLDOWN_MS + 1;
    const r = nextFireToasts(t, [profile('learner-one', 'fire')], { now: later });
    expect(r.entries).toEqual([{ userId: 'learner-one', name: 'learner-one', heartRate: 181, fireThreshold: 175, entryId: expect.any(Number), previousZoneId: 'hot' }]);
  });

  it('does not re-emit while a user simply stays in fire', () => {
    let t = createFireZoneTracker();
    t = nextFireToasts(t, [profile('learner-one', 'hot')], { now: 1000 }).tracker;
    t = nextFireToasts(t, [profile('learner-one', 'fire')], { now: 2000 }).tracker;
    const r = nextFireToasts(t, [profile('learner-one', 'fire')], { now: 2500 });
    expect(r.entries).toEqual([]);
  });

  it('tracks each person independently', () => {
    let t = createFireZoneTracker();
    t = nextFireToasts(t, [profile('learner-one', 'hot'), profile('learner-two', 'warm')], { now: 1000 }).tracker;
    const r = nextFireToasts(t, [profile('learner-one', 'fire'), profile('learner-two', 'fire')], { now: 2000 });
    expect(r.entries).toEqual([
      { userId: 'learner-one', name: 'learner-one', heartRate: 181, fireThreshold: 175, entryId: expect.any(Number), previousZoneId: 'hot' },
      { userId: 'learner-two', name: 'learner-two', heartRate: 181, fireThreshold: 175, entryId: expect.any(Number), previousZoneId: 'warm' },
    ]);
  });

  it('ignores profiles with no id and non-fire zones', () => {
    let t = createFireZoneTracker();
    t = nextFireToasts(t, [profile('learner-one', 'hot')], { now: 1000 }).tracker;
    const r = nextFireToasts(t, [
      profile('learner-one', 'warm'),
      { id: null, currentZoneId: 'fire' },
    ], { now: 2000 });
    expect(r.entries).toEqual([]);
  });

  it('carries the display name through to the entry', () => {
    let t = createFireZoneTracker();
    t = nextFireToasts(t, [profile('learner-one', 'hot', 'Learner-Two')], { now: 1000 }).tracker;
    const r = nextFireToasts(t, [profile('learner-one', 'fire', 'Learner-Two')], { now: 2000 });
    expect(r.entries).toEqual([{ userId: 'learner-one', name: 'Learner-Two', heartRate: 181, fireThreshold: 175, entryId: expect.any(Number), previousZoneId: 'hot' }]);
  });

  it('carries the HR and the fire threshold that justified the celebration', () => {
    // Without these the toast cannot be audited: the 2026-09-16 false toast
    // logged only a userId, so disproving it meant correlating against
    // governance.user_zone_change, which reads a different HR source entirely.
    const zoneConfig = [
      { id: 'cool', min: 60 }, { id: 'active', min: 100 },
      { id: 'warm', min: 140 }, { id: 'hot', min: 160 }, { id: 'fire', min: 175 }
    ];
    const rider = (zone) => ({ ...profile('learner-one', zone, 'Learner-One'), zoneConfig });
    let t = createFireZoneTracker();
    t = nextFireToasts(t, [rider('hot')], { now: 1000 }).tracker;
    const r = nextFireToasts(t, [rider('fire')], { now: 2000 });
    expect(r.entries).toEqual([
      { userId: 'learner-one', name: 'Learner-One', heartRate: 181, fireThreshold: 175, entryId: expect.any(Number), previousZoneId: 'hot' }
    ]);
  });

  it('never mutates the tracker it was given', () => {
    const t0 = createFireZoneTracker();
    nextFireToasts(t0, [profile('learner-one', 'fire')], { now: 1000 });
    expect(t0.lastZone.size).toBe(0);
    expect(t0.lastFiredAt.size).toBe(0);
  });
  it.each([{ id: 'rider-a', hr: 115, fire: 190 }, { id: 'rider-b', hr: 169, fire: 185 }])(
    'rejects $id Fire without accepted threshold evidence', ({ id, hr, fire }) => {
      let t = nextFireToasts(createFireZoneTracker(), [profile(id, 'cool')]).tracker;
      const contradictory = { ...profile(id, 'fire'), heartRate: hr,
        zoneConfig: [{ id: 'fire', min: fire }],
        zoneEntry: { id: ++serial, zoneId: 'fire', heartRate: hr, threshold: fire, enteredAt: 1000 } };
      expect(nextFireToasts(t, [contradictory]).entries).toEqual([]);
    }
  );

  it('does not turn an untrusted default Cool into an initial Fire crossing', () => {
    let t = nextFireToasts(createFireZoneTracker(), [{ ...profile('rider-one', 'cool'), zoneTrusted: false }]).tracker;
    expect(nextFireToasts(t, [profile('rider-one', 'fire')]).entries).toEqual([]);
    t = nextFireToasts(t, [{ ...profile('rider-one', 'fire'), zoneTrusted: false }]).tracker;
    expect(nextFireToasts(t, [{ ...profile('rider-one', 'fire'), zoneTrusted: false }]).entries).toEqual([]);
  });

  it('requires entry evidence and rejects a reused pre-reset Fire entry', () => {
    let t = nextFireToasts(createFireZoneTracker(), [profile('rider-one', 'cool')]).tracker;
    const fire = profile('rider-one', 'fire');
    expect(nextFireToasts(t, [{ ...fire, zoneEntry: null }]).entries).toEqual([]);
    t = nextFireToasts(t, [fire], { now: 2000 }).tracker;
    t = nextFireToasts(t, [profile('rider-one', 'cool')], { now: 3000 }).tracker;
    expect(nextFireToasts(t, [fire], { now: 2000 + FIRE_TOAST_COOLDOWN_MS + 1 }).entries).toEqual([]);
  });

  it('carries the accepted entry HR through later hysteresis and queue delays', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('rider-one', 'cool')]).tracker;
    const r = nextFireToasts(t, [{ ...profile('rider-one', 'fire'), heartRate: 173 }], { now: 8000 });
    expect(r.entries).toEqual([{ userId: 'rider-one', name: 'rider-one', heartRate: 181, fireThreshold: 175, entryId: expect.any(Number), previousZoneId: 'cool' }]);
  });

  it('rejects entry evidence from a different threshold or zone', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('rider-one', 'cool')]).tracker;
    const fire = profile('rider-one', 'fire');
    expect(nextFireToasts(t, [{ ...fire, zoneEntry: { ...fire.zoneEntry, threshold: 170 } }]).entries).toEqual([]);
    expect(nextFireToasts(t, [{ ...fire, zoneEntry: { ...fire.zoneEntry, zoneId: 'hot' } }]).entries).toEqual([]);
  });

  // Bug #5: a rider resuming their zone after a water break did not just
  // cross into it. A resumed entry seeds; only a later real crossing counts.
  it('never celebrates a resumed Fire entry, then celebrates a later real crossing', () => {
    let t = nextFireToasts(createFireZoneTracker(), [profile('rider-c', 'hot')], { now: 1000 }).tracker;
    t = nextFireToasts(t, [{ ...profile('rider-c', 'hot'), zoneTrusted: false, currentZoneId: null, zoneEntry: null }], { now: 2000 }).tracker;
    const resumed = profile('rider-c', 'fire');
    resumed.zoneEntry = { ...resumed.zoneEntry, heartRate: 185, resumed: true };
    let r = nextFireToasts(t, [resumed], { now: 3000 });
    expect(r.entries).toEqual([]);
    t = nextFireToasts(r.tracker, [profile('rider-c', 'hot')], { now: 4000 }).tracker;
    r = nextFireToasts(t, [profile('rider-c', 'fire')], { now: 5000 });
    expect(r.entries).toHaveLength(1);
  });

  it('never celebrates a resumed entry even when the preserved last zone makes it look like a crossing', () => {
    let t = nextFireToasts(createFireZoneTracker(), [profile('rider-c', 'hot')], { now: 1000 }).tracker;
    const resumed = profile('rider-c', 'fire');
    resumed.zoneEntry = { ...resumed.zoneEntry, resumed: true };
    const r = nextFireToasts(t, [resumed], { now: 2000 });
    expect(r.entries).toEqual([]);
    expect(r.tracker.lastEntryId.get('rider-c')).toBe(resumed.zoneEntry.id);
  });
});
