import { describe, it, expect } from 'vitest';
import { createFireZoneTracker, nextFireToasts, FIRE_TOAST_COOLDOWN_MS } from './fireZoneTracker.js';

const profile = (id, zone, name = id) => ({ id, name, currentZoneId: zone });

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
    expect(r.entries).toEqual([{ userId: 'learner-one', name: 'learner-one' }]);
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
    expect(r.entries).toEqual([{ userId: 'learner-one', name: 'learner-one' }]);
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
      { userId: 'learner-one', name: 'learner-one' },
      { userId: 'learner-two', name: 'learner-two' },
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
    expect(r.entries).toEqual([{ userId: 'learner-one', name: 'Learner-Two' }]);
  });

  it('never mutates the tracker it was given', () => {
    const t0 = createFireZoneTracker();
    nextFireToasts(t0, [profile('learner-one', 'fire')], { now: 1000 });
    expect(t0.lastZone.size).toBe(0);
    expect(t0.lastFiredAt.size).toBe(0);
  });
});
