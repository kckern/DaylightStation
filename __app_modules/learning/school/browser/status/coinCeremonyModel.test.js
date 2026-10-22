import { describe, it, expect } from 'vitest';
import {
  COIN_CEREMONY_DEFAULTS, normalizeCoinCeremonyConfig, observeEarnings,
  emptyQueue, enqueueRise, promote, finish, nextPromoteIn,
} from './coinCeremonyModel.js';

const WEEK = { from: '2026-10-19', to: '2026-10-25' };
const fig = (silver, week = WEEK) => ({ silver, gems: 0, ...week });
const ROSTER = new Set(['test-learner', 'test-learner-2']);
const rise = (learnerId, gained, total) => ({ learnerId, gained, total });

describe('normalizeCoinCeremonyConfig', () => {
  it('defaults: on, the coin sound on the media mount, 3.5 s on screen, a 1.5 s burst window', () => {
    expect(normalizeCoinCeremonyConfig(undefined)).toEqual({ enabled: true, sound: 'school/_ux/coin.mp3', volume: 0.8, durationMs: 3500, coalesceWindowMs: 1500 });
    expect(COIN_CEREMONY_DEFAULTS.sound).toBe('school/_ux/coin.mp3');
    // A YAML key left empty arrives as null: that is "not configured", not "silent".
    expect(normalizeCoinCeremonyConfig({ sound: null }).sound).toBe('school/_ux/coin.mp3');
  });
  it('config overrides, clamped', () => {
    expect(normalizeCoinCeremonyConfig({ sound: '/school/_ux/other.mp3', volume: 3, durationMs: 50, coalesceWindowMs: 99999, enabled: false }))
      .toEqual({ enabled: false, sound: 'school/_ux/other.mp3', volume: 1, durationMs: 1000, coalesceWindowMs: 10000 });
    expect(normalizeCoinCeremonyConfig({ duration_ms: 5000, coalesce_window_ms: 0 })).toMatchObject({ durationMs: 5000, coalesceWindowMs: 0 });
  });
  it('an empty or "none" sound silences the cue; the pop-up still shows', () => {
    expect(normalizeCoinCeremonyConfig({ sound: '' })).toMatchObject({ sound: null, enabled: true });
    expect(normalizeCoinCeremonyConfig({ sound: 'None' }).sound).toBeNull();
  });
});

describe('observeEarnings', () => {
  it('the first read of a learner is a baseline, never a rise', () => {
    const { seen, rises } = observeEarnings({}, { 'test-learner': fig(12) }, ROSTER);
    expect(rises).toEqual([]);
    expect(seen['test-learner']).toEqual({ silver: 12, from: WEEK.from, to: WEEK.to });
  });
  it('a rise in the same week is news: how much, and the new total', () => {
    const first = observeEarnings({}, { 'test-learner': fig(12) }, ROSTER).seen;
    expect(observeEarnings(first, { 'test-learner': fig(15) }, ROSTER).rises).toEqual([rise('test-learner', 3, 15)]);
  });
  it('a new week, a drop, no change, or a learner off the roster is not', () => {
    const first = observeEarnings({}, { 'test-learner': fig(12), stranger: fig(1) }, ROSTER).seen;
    expect(first.stranger).toBeUndefined();
    const next = { from: '2026-10-26', to: '2026-11-01' };
    const rolled = observeEarnings(first, { 'test-learner': fig(30, next) }, ROSTER);
    expect(rolled.rises).toEqual([]);
    expect(observeEarnings(rolled.seen, { 'test-learner': fig(25, next) }, ROSTER).rises).toEqual([]);
    expect(observeEarnings(rolled.seen, { 'test-learner': fig(30, next) }, ROSTER).rises).toEqual([]);
    expect(observeEarnings(first, { stranger: fig(9) }, ROSTER).rises).toEqual([]);
  });
  it('a learner missing from a read keeps their baseline', () => {
    const first = observeEarnings({}, { 'test-learner': fig(12) }, ROSTER).seen;
    const gap = observeEarnings(first, {}, ROSTER).seen;
    expect(observeEarnings(gap, { 'test-learner': fig(14) }, ROSTER).rises).toEqual([rise('test-learner', 2, 14)]);
  });
});

describe('the ceremony queue', () => {
  it('waits out the burst window, merging a learner\'s rises into one pop', () => {
    let q = enqueueRise(emptyQueue(), rise('test-learner', 2, 14), 1000);
    q = enqueueRise(q, rise('test-learner', 1, 15), 1800);
    expect(promote(q, 2000, 1500).showing).toBeNull();
    expect(nextPromoteIn(q, 2000, 1500)).toBe(500);
    q = promote(q, 2500, 1500);
    expect(q.showing).toEqual({ id: 1, learnerId: 'test-learner', gained: 3, total: 15, revision: 0 });
    expect(q.pending).toEqual([]);
  });
  it('a rise for the learner on screen updates that pop in place', () => {
    let q = promote(enqueueRise(emptyQueue(), rise('test-learner', 2, 14), 0), 0, 0);
    q = enqueueRise(q, rise('test-learner', 1, 15), 10);
    expect(q.showing).toEqual({ id: 1, learnerId: 'test-learner', gained: 3, total: 15, revision: 1 });
    expect(q.pending).toEqual([]);
  });
  it('learners queue one at a time, in the order they rose', () => {
    let q = enqueueRise(emptyQueue(), rise('test-learner', 2, 14), 0);
    q = enqueueRise(q, rise('test-learner-2', 5, 9), 0);
    q = promote(q, 0, 0);
    expect(q.showing.learnerId).toBe('test-learner');
    expect(promote(q, 9999, 0)).toBe(q);
    expect(nextPromoteIn(q, 0, 0)).toBeNull();
    q = promote(finish(q, 1), 10, 0);
    expect(q.showing).toEqual({ id: 2, learnerId: 'test-learner-2', gained: 5, total: 9, revision: 0 });
    expect(finish(q, 99)).toBe(q);
  });
});

describe('observeEarnings: first paint and week rollover (extra guards)', () => {
  it('a baseline seeded from the cache, then the first network read in a later week, is not a rise', () => {
    const cacheSeed = observeEarnings({}, { 'test-learner': fig(12) }, ROSTER).seen;
    const next = { from: '2026-10-26', to: '2026-11-01' };
    // Rollover: silver is lower or higher than the seed; either way not news.
    expect(observeEarnings(cacheSeed, { 'test-learner': fig(40, next) }, ROSTER).rises).toEqual([]);
    expect(observeEarnings(cacheSeed, { 'test-learner': fig(2, next) }, ROSTER).rises).toEqual([]);
  });
  it('after a rollover the new week is the baseline: a later rise in it counts', () => {
    const first = observeEarnings({}, { 'test-learner': fig(12) }, ROSTER).seen;
    const next = { from: '2026-10-26', to: '2026-11-01' };
    const rolled = observeEarnings(first, { 'test-learner': fig(30, next) }, ROSTER).seen;
    expect(rolled['test-learner']).toEqual({ silver: 30, from: next.from, to: next.to });
    expect(observeEarnings(rolled, { 'test-learner': fig(33, next) }, ROSTER).rises).toEqual([rise('test-learner', 3, 33)]);
  });
  it('a change of only one week boundary is also a rollover', () => {
    const first = observeEarnings({}, { 'test-learner': fig(12) }, ROSTER).seen;
    expect(observeEarnings(first, { 'test-learner': fig(20, { from: WEEK.from, to: '2026-10-26' }) }, ROSTER).rises).toEqual([]);
  });
  it('a figure without a finite silver is skipped and keeps the baseline', () => {
    const first = observeEarnings({}, { 'test-learner': fig(12) }, ROSTER).seen;
    const r = observeEarnings(first, { 'test-learner': { ...WEEK } }, ROSTER);
    expect(r.rises).toEqual([]);
    expect(r.seen['test-learner'].silver).toBe(12);
  });
});
