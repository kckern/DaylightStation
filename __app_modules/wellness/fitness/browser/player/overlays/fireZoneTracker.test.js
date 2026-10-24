import { describe, it, expect } from 'vitest';
import {
  createFireZoneTracker, nextFireToasts, FIRE_TOAST_COOLDOWN_MS,
  FIRE_CEREMONY_SUSTAIN_MS, FIRE_CEREMONY_MIN_SAMPLES
} from "./fireZoneTracker.js";

let serial = 0;
let readingClock = 0;
// One profile per call, each a NEW reading (zoneReadingAt advances).
const profile = (id, zone, name = id, over = {}) => ({
  id, name, currentZoneId: zone, zoneTrusted: true, heartRate: 181,
  zoneConfig: [{ id: 'cool', min: 60 }, { id: 'fire', min: 175 }],
  zoneEntry: { id: ++serial, zoneId: zone, heartRate: 181, threshold: 175, enteredAt: 1000 },
  zoneReadingAt: ++readingClock, zoneReadingDeviceId: 'strap-1', zoneReadingEligible: true,
  ...over
});
// The same Fire stint (same entry), a fresh reading at `hr`.
const holding = (crossed, hr = crossed.heartRate, over = {}) => ({
  ...crossed, heartRate: hr, zoneReadingAt: ++readingClock, ...over
});

/** Cross at `from`, then hold Fire with a reading every `stepMs` until `from + spanMs`. */
function crossAndHold(t, id, { from = 2000, spanMs = 6000, stepMs = 1000, previousZone = 'hot', name = id, hrs = null } = {}) {
  t = nextFireToasts(t, [profile(id, previousZone, name)], { now: from - 1000 }).tracker;
  const crossed = profile(id, 'fire', name);
  let r = nextFireToasts(t, [crossed], { now: from });
  const all = [...r.entries];
  let i = 0;
  for (let at = from + stepMs; at <= from + spanMs; at += stepMs) {
    const hr = hrs ? hrs[i] : undefined;
    i += 1;
    r = nextFireToasts(r.tracker, [holding(crossed, hr ?? crossed.heartRate)], { now: at });
    all.push(...r.entries);
  }
  return { tracker: r.tracker, entries: all, crossed };
}

const expected = (id, over = {}) => ({
  userId: id, name: id, heartRate: 181, fireThreshold: 175, entryId: expect.any(Number),
  previousZoneId: 'hot', deviceId: 'strap-1', sustainedMs: expect.any(Number), samples: expect.any(Number),
  ...over
});

/** Hold an existing stint with fresh readings; returns every entry emitted. */
function holdFor(r, crossed, from, to, over = {}) {
  const all = [];
  for (let at = from; at <= to; at += 1000) {
    r = nextFireToasts(r.tracker, [holding(crossed, crossed.heartRate, over)], { now: at });
    all.push(...r.entries);
  }
  return { r, all };
}

describe('nextFireToasts', () => {
  it('stays silent for a user first observed already in fire', () => {
    // A page reload mid-workout must not congratulate someone for a zone they
    // reached before this UI existed.
    const r = nextFireToasts(createFireZoneTracker(), [profile('learner-one', 'fire')], { now: 1000 });
    expect(r.entries).toEqual([]);
  });

  it('never celebrates on the crossing tick itself — Fire must be held first', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('learner-one', 'hot')], { now: 1000 }).tracker;
    expect(nextFireToasts(t, [profile('learner-one', 'fire')], { now: 2000 }).entries).toEqual([]);
  });

  it('celebrates a genuine crossing held for 6s with at least 3 samples', () => {
    const { entries } = crossAndHold(createFireZoneTracker(), 'learner-one', { spanMs: 6000 });
    expect(entries).toEqual([expected('learner-one')]);
    expect(entries[0].sustainedMs).toBeGreaterThanOrEqual(FIRE_CEREMONY_SUSTAIN_MS);
    expect(entries[0].samples).toBeGreaterThanOrEqual(FIRE_CEREMONY_MIN_SAMPLES);
  });

  it('does not celebrate a 4s Fire stint', () => {
    const { entries } = crossAndHold(createFireZoneTracker(), 'learner-one', { spanMs: 4000 });
    expect(entries).toEqual([]);
  });

  it('does not celebrate 5s of Fire carried by fewer than 3 distinct readings', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('rider-a', 'hot')], { now: 1000 }).tracker;
    const crossed = profile('rider-a', 'fire');
    let r = nextFireToasts(t, [crossed], { now: 2000 });
    // The same reading re-synced (another rider's packet) is not a new sample.
    for (const at of [3000, 4000, 5000, 6000, 7000, 8000]) {
      r = nextFireToasts(r.tracker, [crossed], { now: at });
      expect(r.entries).toEqual([]);
    }
    r = nextFireToasts(r.tracker, [holding(crossed)], { now: 9000 });
    expect(r.entries).toEqual([]); // only 2 samples
    r = nextFireToasts(r.tracker, [holding(crossed)], { now: 10000 });
    expect(r.entries).toHaveLength(1);
  });

  it('abandons the stint if any sample in it is below the Fire minimum', () => {
    // The committed zone may hold Fire through the exit margin; the stint does not.
    const { entries } = crossAndHold(createFireZoneTracker(), 'rider-a', { spanMs: 8000, hrs: [181, 172, 181, 181, 181, 181, 181, 181] });
    expect(entries).toEqual([]);
  });

  it('abandons the stint when the rider leaves Fire, and a new real crossing starts a new one', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('rider-a', 'hot')], { now: 1000 }).tracker;
    const crossed = profile('rider-a', 'fire');
    let r = nextFireToasts(t, [crossed], { now: 2000 });
    r = nextFireToasts(r.tracker, [holding(crossed)], { now: 3000 });
    r = nextFireToasts(r.tracker, [profile('rider-a', 'hot', 'rider-a', { heartRate: 170 })], { now: 4000 });
    expect(r.dropped).toEqual([expect.objectContaining({ userId: 'rider-a', reason: 'left-fire' })]);
    const again = crossAndHold(r.tracker, 'rider-a', { from: 6000, spanMs: 6000 });
    expect(again.entries).toHaveLength(1);
  });

  it('abandons the stint when the reading jumps to another strap', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('rider-a', 'hot')], { now: 1000 }).tracker;
    const crossed = profile('rider-a', 'fire');
    let r = nextFireToasts(t, [crossed], { now: 2000 });
    r = nextFireToasts(r.tracker, [holding(crossed)], { now: 3000 });
    const { all } = holdFor(r, crossed, 4000, 10_000, { zoneReadingDeviceId: 'strap-2' });
    expect(all).toEqual([]);
  });

  it('never celebrates a simulated rider', () => {
    const sim = (zone) => profile('rider-sim', zone, 'rider-sim', { zoneReadingSimulated: true });
    const t = nextFireToasts(createFireZoneTracker(), [sim('hot')], { now: 1000 }).tracker;
    const crossed = sim('fire');
    const r = nextFireToasts(t, [crossed], { now: 2000 });
    expect(r.dropped).toEqual([expect.objectContaining({ userId: 'rider-sim', reason: 'simulated' })]);
    expect(holdFor(r, crossed, 3000, 10_000).all).toEqual([]);
  });

  it('never celebrates an entry the store marked simulated', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('rider-a', 'hot')], { now: 1000 }).tracker;
    const crossed = profile('rider-a', 'fire');
    crossed.zoneEntry.simulated = true;
    const r = nextFireToasts(t, [crossed], { now: 2000 });
    expect(holdFor(r, crossed, 3000, 10_000).all).toEqual([]);
  });

  it('never celebrates an entry produced by reclassification (ladder change)', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('rider-a', 'hot')], { now: 1000 }).tracker;
    const crossed = profile('rider-a', 'fire');
    crossed.zoneEntry.reclassified = true;
    const r = nextFireToasts(t, [crossed], { now: 2000 });
    expect(holdFor(r, crossed, 3000, 10_000).all).toEqual([]);
  });

  it('abandons a stint when the Fire minimum changes under it', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('rider-a', 'hot')], { now: 1000 }).tracker;
    const crossed = profile('rider-a', 'fire');
    const r = nextFireToasts(t, [crossed], { now: 2000 });
    const lowered = [{ id: 'cool', min: 60 }, { id: 'fire', min: 170 }];
    expect(holdFor(r, crossed, 3000, 10_000, { zoneConfig: lowered }).all).toEqual([]);
  });

  it('suppresses a second crossing inside the cooldown', () => {
    const first = crossAndHold(createFireZoneTracker(), 'learner-one', { from: 2000 });
    expect(first.entries).toHaveLength(1);
    const second = crossAndHold(first.tracker, 'learner-one', { from: 20_000 });
    expect(second.entries).toEqual([]);
  });

  it('emits again once the cooldown has elapsed', () => {
    const first = crossAndHold(createFireZoneTracker(), 'learner-one', { from: 2000 });
    const second = crossAndHold(first.tracker, 'learner-one', { from: 8000 + FIRE_TOAST_COOLDOWN_MS + 1 });
    expect(second.entries).toEqual([expected('learner-one')]);
  });

  it('does not re-emit while a user simply stays in fire', () => {
    const { tracker, crossed } = crossAndHold(createFireZoneTracker(), 'learner-one', { spanMs: 6000 });
    expect(holdFor({ tracker }, crossed, 9000, 30_000).all).toEqual([]);
  });

  it('tracks each person independently', () => {
    let t = createFireZoneTracker();
    t = nextFireToasts(t, [profile('learner-one', 'hot'), profile('learner-two', 'warm')], { now: 1000 }).tracker;
    const one = profile('learner-one', 'fire');
    const two = profile('learner-two', 'fire');
    let r = nextFireToasts(t, [one, two], { now: 2000 });
    const all = [];
    for (let at = 3000; at <= 8000; at += 1000) {
      r = nextFireToasts(r.tracker, [holding(one), holding(two)], { now: at });
      all.push(...r.entries);
    }
    expect(all).toEqual([expected('learner-one'), expected('learner-two', { previousZoneId: 'warm' })]);
  });

  it('ignores profiles with no id and non-fire zones', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('learner-one', 'hot')], { now: 1000 }).tracker;
    const r = nextFireToasts(t, [profile('learner-one', 'warm'), { id: null, currentZoneId: 'fire' }], { now: 2000 });
    expect(r.entries).toEqual([]);
  });

  it('carries the display name, the entry HR and the fire threshold through to the entry', () => {
    const { entries } = crossAndHold(createFireZoneTracker(), 'learner-one', { name: 'Learner-Two' });
    expect(entries).toEqual([expected('learner-one', { name: 'Learner-Two' })]);
  });

  it('never mutates the tracker it was given', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('learner-one', 'hot')], { now: 1000 }).tracker;
    const crossed = profile('learner-one', 'fire');
    const t1 = nextFireToasts(t, [crossed], { now: 2000 }).tracker;
    const snapshot = JSON.stringify([...t1.stints.entries()]);
    nextFireToasts(t1, [holding(crossed)], { now: 3000 });
    expect(JSON.stringify([...t1.stints.entries()])).toBe(snapshot);
    const t0 = createFireZoneTracker();
    nextFireToasts(t0, [profile('learner-one', 'fire')], { now: 1000 });
    expect(t0.lastZone.size).toBe(0);
    expect(t0.lastFiredAt.size).toBe(0);
  });

  it.each([{ id: 'rider-a', hr: 115, fire: 190 }, { id: 'rider-b', hr: 169, fire: 185 }])(
    'rejects $id Fire without accepted threshold evidence', ({ id, hr, fire }) => {
      const t = nextFireToasts(createFireZoneTracker(), [profile(id, 'cool')], { now: 1000 }).tracker;
      const contradictory = { ...profile(id, 'fire'), heartRate: hr,
        zoneConfig: [{ id: 'fire', min: fire }],
        zoneEntry: { id: ++serial, zoneId: 'fire', heartRate: hr, threshold: fire, enteredAt: 1000 } };
      const r = nextFireToasts(t, [contradictory], { now: 2000 });
      expect(holdFor(r, contradictory, 3000, 9000).all).toEqual([]);
    }
  );

  it('does not turn an untrusted default Cool into an initial Fire crossing', () => {
    const t = nextFireToasts(createFireZoneTracker(), [{ ...profile('rider-one', 'cool'), zoneTrusted: false }], { now: 1000 }).tracker;
    const fire = profile('rider-one', 'fire');
    const r = nextFireToasts(t, [fire], { now: 2000 });
    expect(holdFor(r, fire, 3000, 9000).all).toEqual([]);
  });

  it('requires entry evidence', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('rider-one', 'cool')], { now: 1000 }).tracker;
    const fire = { ...profile('rider-one', 'fire'), zoneEntry: null };
    const r = nextFireToasts(t, [fire], { now: 2000 });
    expect(holdFor(r, fire, 3000, 9000).all).toEqual([]);
  });

  it('rejects a reused, already-celebrated Fire entry', () => {
    const first = crossAndHold(createFireZoneTracker(), 'rider-one', { previousZone: 'cool' });
    expect(first.entries).toHaveLength(1);
    const t = nextFireToasts(first.tracker, [profile('rider-one', 'cool')], { now: 20_000 }).tracker;
    const back = FIRE_TOAST_COOLDOWN_MS + 30_000;
    const r = nextFireToasts(t, [holding(first.crossed)], { now: back });
    expect(holdFor(r, first.crossed, back + 1000, back + 9000).all).toEqual([]);
  });

  it('rejects entry evidence from a different threshold or zone', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('rider-one', 'cool')], { now: 1000 }).tracker;
    for (const bad of [{ threshold: 170 }, { zoneId: 'hot' }]) {
      const fire = profile('rider-one', 'fire');
      fire.zoneEntry = { ...fire.zoneEntry, ...bad };
      const r = nextFireToasts(t, [fire], { now: 2000 });
      expect(holdFor(r, fire, 3000, 9000).all).toEqual([]);
    }
  });

  // A rider resuming their zone after a water break did not just cross into
  // it. A resumed entry seeds; only a later real crossing counts.
  it('never celebrates a resumed Fire entry, then celebrates a later real crossing', () => {
    let t = nextFireToasts(createFireZoneTracker(), [profile('rider-c', 'hot')], { now: 1000 }).tracker;
    t = nextFireToasts(t, [{ ...profile('rider-c', 'hot'), zoneTrusted: false, currentZoneId: null, zoneEntry: null }], { now: 2000 }).tracker;
    const resumed = profile('rider-c', 'fire');
    resumed.zoneEntry = { ...resumed.zoneEntry, heartRate: 185, resumed: true };
    const held = holdFor({ tracker: t }, resumed, 3000, 10_000);
    expect(held.all).toEqual([]);
    const later = crossAndHold(held.r.tracker, 'rider-c', { from: 12_000 });
    expect(later.entries).toHaveLength(1);
  });

  it('never celebrates a resumed entry even when the preserved last zone makes it look like a crossing', () => {
    const t = nextFireToasts(createFireZoneTracker(), [profile('rider-c', 'hot')], { now: 1000 }).tracker;
    const resumed = profile('rider-c', 'fire');
    resumed.zoneEntry = { ...resumed.zoneEntry, resumed: true };
    const r = nextFireToasts(t, [resumed], { now: 2000 });
    expect(r.entries).toEqual([]);
    expect(r.tracker.lastEntryId.get('rider-c')).toBe(resumed.zoneEntry.id);
    expect(r.tracker.stints.has('rider-c')).toBe(false);
  });
});
