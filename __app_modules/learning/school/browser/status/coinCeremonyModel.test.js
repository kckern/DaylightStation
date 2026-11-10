import { describe, it, expect } from 'vitest';
import {
  COIN_CEREMONY_DEFAULTS, normalizeCoinCeremonyConfig, observeMinted,
  emptyQueue, enqueueRise, promote, finish, nextPromoteIn,
} from './coinCeremonyModel.js';

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

const line = (id, source, delta, currency = 'silver') => ({ ids: [id], source, legs: [{ currency, delta }] });
const read = (silver, ...lines) => ({ silver, lines });

describe('observeMinted', () => {
  it('the first read per learner is a baseline, even with earnings in it', () => {
    const { seen, rises } = observeMinted({}, { 'test-learner': read(12, line('t1', 'payout', 3)), stranger: read(1, line('x', 'payout', 1)) }, ROSTER);
    expect(rises).toEqual([]);
    expect(seen['test-learner']).toEqual(['t1']);
    expect(seen.stranger).toBeUndefined();
  });
  it('a new payout is a rise of exactly the minted silver; the same read again is not', () => {
    const first = observeMinted({}, { 'test-learner': read(12, line('t1', 'payout', 3)) }, ROSTER).seen;
    const r = observeMinted(first, { 'test-learner': read(15, line('t2', 'payout', 3), line('t1', 'payout', 3)) }, ROSTER);
    expect(r.rises).toEqual([rise('test-learner', 3, 15)]);
    expect(observeMinted(r.seen, { 'test-learner': read(15, line('t2', 'payout', 3), line('t1', 'payout', 3)) }, ROSTER).rises).toEqual([]);
  });
  it('a deposit, correction, refund, conversion, spend, gold or a drop is never a rise', () => {
    const first = observeMinted({}, { 'test-learner': read(12) }, ROSTER).seen;
    const lines = [
      line('d', 'deposit', 5), line('c', 'correction', 2), line('r', 'refund', 4), line('v', 'conversion', 6),
      line('s', 'spend', -3), line('g', 'payout', 2, 'gold'),
    ];
    expect(observeMinted(first, { 'test-learner': read(30, ...lines) }, ROSTER).rises).toEqual([]);
  });
  it('a spend and a mint between two reads still pops the minted amount', () => {
    const first = observeMinted({}, { 'test-learner': read(12) }, ROSTER).seen;
    const r = observeMinted(first, { 'test-learner': read(11, line('s', 'spend', -4), line('e', 'earn', 3)) }, ROSTER);
    expect(r.rises).toEqual([rise('test-learner', 3, 11)]);
  });
  it('a learner missing from one read keeps their baseline', () => {
    const first = observeMinted({}, { 'test-learner': read(12, line('t1', 'payout', 3)) }, ROSTER).seen;
    const gap = observeMinted(first, {}, ROSTER).seen;
    expect(observeMinted(gap, { 'test-learner': read(14, line('t2', 'prize', 2), line('t1', 'payout', 3)) }, ROSTER).rises).toEqual([rise('test-learner', 2, 14)]);
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
