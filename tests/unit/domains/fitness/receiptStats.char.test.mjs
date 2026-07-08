/**
 * Characterization tests for the fitness-receipt stats logic moved from
 * FitnessReceiptRenderer.mjs into SessionStatsService.mjs (audit R-3).
 *
 * The expected values were DERIVED FROM THE PRE-MOVE RENDERER CODE (verbatim
 * replication of FitnessReceiptRenderer.mjs @ 07381396d run against these
 * fixtures) — these tests pin the exact behavior across the move: histogram
 * buckets + zone majority votes, coins/min, event flattening across both
 * schema shapes, challenge dedup, and participant discovery.
 */
import { describe, it, expect } from 'vitest';
import {
  computeHrHistogram,
  coinsPerMinute,
  normalizeSessionEvents,
  dedupeChallengeEvents,
  discoverParticipants,
} from '#domains/fitness/services/SessionStatsService.mjs';

// ─── Fixtures (identical to the derivation run) ─────────────────────────────

const HR = [null, null, 78, 82, 90, 95, 101, 108, 115, 122, 128, 133, 139, 145, 152, 158, 163, 160, 149, 131, 118, 96, 80, null];
const ZONES = [null, null, 'cool', 'cool', 'cool', 'active', 'active', 'active', 'warm', 'warm', 'warm', 'hot', 'hot', 'hot', 'fire', 'fire', 'fire', 'hot', 'warm', 'cool', 'cool', 'cool', 'cool', null];

const ARRAY_EVENTS = [
  { at: '2026-07-01T10:01:00Z', type: 'media_start', data: { title: 'Bluey S1E3', grandparentTitle: 'Bluey' } },
  { at: '2026-07-01T10:03:00Z', type: 'challenge_start', data: { challengeId: 'ch1', title: 'Sprint!' } },
  { at: '2026-07-01T10:05:00Z', type: 'challenge_end', data: { challengeId: 'ch1', title: 'Sprint!', status: 'failed' } },
  { at: '2026-07-01T10:06:00Z', type: 'overlay.show', data: { id: 'x' } },
  { at: '2026-07-01T10:08:00Z', type: 'challenge_end', data: { challengeId: 'ch1', title: 'Sprint!', status: 'passed' } },
  { at: '2026-07-01T10:09:00Z', type: 'voice_memo', timestamp: '2026-07-01T10:09:01Z', data: { transcript: 'great ride' } },
  { at: '2026-07-01T10:10:00Z', type: 'challenge_end', data: { challengeId: 'ch2', title: 'Climb', status: 'passed' } },
];

const DICT_EVENTS = {
  media_start: [
    { at: '2026-07-01T09:01:00Z', data: { title: 'Song A' } },
  ],
  challenge_end: [
    { at: '2026-07-01T09:05:00Z', data: { challengeId: 'c9', status: 'passed' }, challengeId: 'c9-top' },
  ],
  notes: 'not-an-array',
  overlay_show: [{ at: '2026-07-01T09:06:00Z', data: {} }],
};

// ─── HR histogram + zone majority vote ───────────────────────────────────────

describe('computeHrHistogram (characterized from renderer)', () => {
  it('produces the exact buckets, maxCount, and zone majority votes the renderer produced', () => {
    const h = computeHrHistogram(HR, ZONES, { buckets: 10 });
    expect(h.minHr).toBe(78);
    expect(h.maxHr).toBe(163);
    expect(h.bucketSize).toBe(8.5);
    expect(h.counts).toEqual([3, 1, 3, 1, 2, 2, 2, 2, 2, 3]);
    expect(h.maxCount).toBe(3);
    // Zone-majority vote per bucket (tie → higher intensity wins)
    expect(h.bucketZones).toEqual([
      'cool', 'cool', 'active', 'active', 'warm',
      'warm', 'hot', 'hot', 'fire', 'fire',
    ]);
  });

  it('returns null when there are no valid HR samples (renderer skipped the histogram)', () => {
    expect(computeHrHistogram([null, 0], ['cool', 'cool'], { buckets: 10 })).toBeNull();
    expect(computeHrHistogram([], [], { buckets: 10 })).toBeNull();
  });
});

// ─── Coins per minute ────────────────────────────────────────────────────────

describe('coinsPerMinute (characterized from renderer)', () => {
  it('matches the renderer formatting: (coins/activeMin).toFixed(1)', () => {
    expect(coinsPerMinute(57, 1230 / 60)).toBe('2.8');
  });
  it('returns "0.0" for zero active time', () => {
    expect(coinsPerMinute(57, 0)).toBe('0.0');
  });
});

// ─── Event flattening (both schema shapes) ───────────────────────────────────

describe('normalizeSessionEvents (characterized from renderer)', () => {
  it('array shape: spreads data flat, keeps at/timestamp, maps types, skips challenge_start and overlay.*', () => {
    expect(normalizeSessionEvents({ events: ARRAY_EVENTS })).toEqual([
      { type: 'media', event: { title: 'Bluey S1E3', grandparentTitle: 'Bluey', at: '2026-07-01T10:01:00Z', timestamp: undefined, _type: 'media_start' } },
      { type: 'challenge', event: { challengeId: 'ch1', title: 'Sprint!', status: 'failed', at: '2026-07-01T10:05:00Z', timestamp: undefined, _type: 'challenge_end' } },
      { type: 'challenge', event: { challengeId: 'ch1', title: 'Sprint!', status: 'passed', at: '2026-07-01T10:08:00Z', timestamp: undefined, _type: 'challenge_end' } },
      { type: 'voice_memo', event: { transcript: 'great ride', at: '2026-07-01T10:09:00Z', timestamp: '2026-07-01T10:09:01Z', _type: 'voice_memo' } },
      { type: 'challenge', event: { challengeId: 'ch2', title: 'Climb', status: 'passed', at: '2026-07-01T10:10:00Z', timestamp: undefined, _type: 'challenge_end' } },
    ]);
  });

  it('dict shape: event fields override data fields, non-arrays and unmapped types skipped', () => {
    expect(normalizeSessionEvents({ events: DICT_EVENTS })).toEqual([
      { type: 'media', event: { title: 'Song A', at: '2026-07-01T09:01:00Z', data: { title: 'Song A' }, _type: 'media_start' } },
      // top-level challengeId (c9-top) wins over data.challengeId (c9) — spread order
      { type: 'challenge', event: { challengeId: 'c9-top', status: 'passed', at: '2026-07-01T09:05:00Z', data: { challengeId: 'c9', status: 'passed' }, _type: 'challenge_end' } },
    ]);
  });

  it('handles missing/empty events', () => {
    expect(normalizeSessionEvents({})).toEqual([]);
    expect(normalizeSessionEvents({ events: [] })).toEqual([]);
    expect(normalizeSessionEvents(null)).toEqual([]);
  });
});

// ─── Challenge dedup ─────────────────────────────────────────────────────────

describe('dedupeChallengeEvents (characterized from renderer)', () => {
  it('keeps only the LAST challenge_end per challengeId (final outcome wins)', () => {
    const deduped = dedupeChallengeEvents(normalizeSessionEvents({ events: ARRAY_EVENTS }));
    expect(deduped.map(e => ({ cid: e.event.challengeId, status: e.event.status }))).toEqual([
      { cid: 'ch1', status: 'passed' },
      { cid: 'ch2', status: 'passed' },
    ]);
  });

  it('ignores non-challenge events', () => {
    const deduped = dedupeChallengeEvents([
      { type: 'media', event: { _type: 'media_start', title: 'x' } },
    ]);
    expect(deduped).toEqual([]);
  });
});

// ─── Participant discovery ───────────────────────────────────────────────────

describe('discoverParticipants (characterized from renderer)', () => {
  it('unions series slug:zone keys with participants block keys, filtering global/device:/bike:', () => {
    const series = {
      'alice:zone': 'x', 'alice:hr': 'x', 'bob:zone': 'x', 'global:zone': 'x',
      'alice:coins': 'x', 'weird': 'x',
    };
    const participants = { alice: {}, carol: {}, 'device:ant-123': {}, 'bike:2': {} };
    expect(discoverParticipants(series, participants)).toEqual(['alice', 'bob', 'carol']);
  });

  it('works with only series or only participants', () => {
    expect(discoverParticipants({ 'kc:zone': 'x' }, {})).toEqual(['kc']);
    expect(discoverParticipants({}, { kc: {} })).toEqual(['kc']);
    expect(discoverParticipants({}, {})).toEqual([]);
  });
});
