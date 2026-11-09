import { describe, it, expect } from 'vitest';
import { isCredited, gridBadge, creditedSessions, riderSummary, seasonCoverage, mosaicThumb } from './episodeHistory.js';

const r = (id, minutes, extra = {}) => ({ id, displayName: id, minutes, rings: 10, isGuest: false, ...extra });
const s = (sessionId, startTime, riders) => ({ sessionId, startTime, date: '2026-10-22', riders });

describe('episode history credit rule', () => {
  it('credits a rider who rode at least half the episode', () => {
    expect(isCredited(r('a', 15), 1800)).toBe(true);
    expect(isCredited(r('a', 14.9), 1800)).toBe(false);
    expect(isCredited(r('a', 3), 1800)).toBe(false);
  });

  it('credits when either side is unknown', () => {
    expect(isCredited(r('a', null), 1800)).toBe(true);
    expect(isCredited(r('a', 3), null)).toBe(true);
    expect(isCredited(r('a', 3), 0)).toBe(true);
  });

  it('drops sessions where nobody did enough of it', () => {
    const out = creditedSessions([s('1', 2, [r('a', 3)]), s('2', 1, [r('a', 20), r('b', 2)])], 1800);
    expect(out.map((x) => x.sessionId)).toEqual(['2']);
    expect(out[0].riders.map((x) => x.id)).toEqual(['a']);
  });
});

describe('gridBadge', () => {
  it('lists each household rider once, newest first, with the newest date', () => {
    const badge = gridBadge([
      s('3', 300, [r('a', 30), r('guest', 30, { isGuest: true })]),
      s('2', 200, [r('b', 30), r('a', 30)]),
      s('1', 100, [r('c', 30)]),
    ], 1800);
    expect(badge.riders.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(badge.overflow).toBe(0);
    expect(badge.latestStartTime).toBe(300);
  });

  it('caps at three avatars and counts the rest', () => {
    const badge = gridBadge([s('1', 100, ['a', 'b', 'c', 'd', 'e'].map((id) => r(id, 30)))], 1800);
    expect(badge.riders).toHaveLength(3);
    expect(badge.overflow).toBe(2);
  });

  it('dates the badge by the newest HOUSEHOLD session, not a guest-only one', () => {
    const badge = gridBadge([
      s('2', 200, [r('guest', 30, { isGuest: true })]),
      s('1', 100, [r('a', 30)]),
    ], 1800);
    expect(badge.latestStartTime).toBe(100);
  });

  it('is null when only guests or partial riders are on record', () => {
    expect(gridBadge([s('1', 1, [r('guest', 30, { isGuest: true }), r('a', 2)])], 1800)).toBeNull();
    expect(gridBadge([], 1800)).toBeNull();
    expect(gridBadge(undefined, 1800)).toBeNull();
  });
});

// ── The redesigned panel: one row per rider, season coverage, mosaic thumbs ──

describe('riderSummary', () => {
  const sessions = [
    s('s3', 3000, [r('rider-a', 30, { rings: 90 })]),
    s('s2', 2000, [r('rider-a', 25), r('rider-b', 3), r('guest-1', 28, { isGuest: true })]),
    s('s1', 1000, [r('rider-b', 29)]),
  ];
  const household = [{ id: 'rider-a', displayName: 'Rider A' }, { id: 'rider-b', displayName: 'Rider B' }, { id: 'rider-c', displayName: 'Rider C' }];

  it('gives one row per credited rider with their count and latest ride', () => {
    const rows = riderSummary(sessions, 1800, { household });
    expect(rows.find((x) => x.id === 'rider-a')).toMatchObject({ count: 2, lastStartTime: 3000, lastMinutes: 30, lastRings: 90, done: true });
    // Rider B's 3-minute drop-in does not count; his full ride on s1 does.
    expect(rows.find((x) => x.id === 'rider-b')).toMatchObject({ count: 1, lastStartTime: 1000, done: true });
    expect(rows.find((x) => x.id === 'guest-1')).toMatchObject({ isGuest: true, done: true });
  });

  it('lists household members who never did it, after everyone who did', () => {
    const rows = riderSummary(sessions, 1800, { household });
    expect(rows.at(-1)).toMatchObject({ id: 'rider-c', displayName: 'Rider C', count: 0, done: false });
    expect(rows.map((x) => x.id)).toEqual(['rider-a', 'guest-1', 'rider-b', 'rider-c']);
  });

  it('puts riders on the bike now first', () => {
    const rows = riderSummary(sessions, 1800, { household, activeIds: ['rider-c', 'rider-b'] });
    expect(rows.slice(0, 2).map((x) => [x.id, x.active])).toEqual([['rider-b', true], ['rider-c', true]]);
  });
});

describe('seasonCoverage', () => {
  it('counts the season episodes each household rider did', () => {
    const eps = [{ id: 'e1', duration: 1800 }, { id: 'e2', duration: 1800 }, { id: 'e3', duration: 1800 }];
    const history = {
      e1: [s('a', 1, [r('rider-a', 30), r('guest-1', 30, { isGuest: true })])],
      e2: [s('b', 2, [r('rider-a', 30), r('rider-b', 30)])],
      e3: [s('c', 3, [r('rider-b', 2)])],
    };
    const household = [{ id: 'rider-a', displayName: 'Rider A' }, { id: 'rider-b', displayName: 'Rider B' }, { id: 'rider-c', displayName: 'Rider C' }];
    expect(seasonCoverage(eps, (ep) => history[ep.id], household)).toEqual([
      { id: 'rider-a', displayName: 'Rider A', done: 2, total: 3 },
      { id: 'rider-b', displayName: 'Rider B', done: 1, total: 3 },
    ]);
  });
});

describe('mosaicThumb', () => {
  it('asks the image proxy for a small copy', () => {
    expect(mosaicThumb('/api/v1/proxy/plex/library/metadata/1/thumb/2', 160, 90)).toBe('/api/v1/proxy/plex/library/metadata/1/thumb/2?w=160&h=90');
    expect(mosaicThumb('/x?a=1', 160, 90)).toBe('/x?a=1&w=160&h=90');
    expect(mosaicThumb(null, 160, 90)).toBeNull();
  });
});
