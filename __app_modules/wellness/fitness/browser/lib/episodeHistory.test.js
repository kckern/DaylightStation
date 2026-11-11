import { describe, it, expect } from 'vitest';
import { isCredited, gridBadge, creditedSessions, completionRows, whenInWords, mosaicThumb } from './episodeHistory.js';

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

describe('completionRows', () => {
  const sessions = [
    { ...s('s3', 3000, [r('rider-a', 30, { rings: 90 })]), durationMs: 2760000, totalRings: 848, videoCount: 3 },
    s('s2', 2000, [r('rider-a', 25), r('rider-b', 3), r('guest-1', 28, { isGuest: true })]),
    s('s1', 1000, [r('rider-b', 29)]),
  ];

  it('lists each time it was done, newest first, with who and the circumstances', () => {
    const rows = completionRows(sessions, 1800);
    expect(rows.map((x) => x.sessionId)).toEqual(['s3', 's2', 's1']);
    expect(rows[0]).toMatchObject({ startTime: 3000, minutes: 46, rings: 848, otherVideos: 2 });
    expect(rows[0].riders).toEqual([{ id: 'rider-a', displayName: 'rider-a', isGuest: false }]);
    // Rider B's 3-minute drop-in is not a completion; the guest's full ride is.
    expect(rows[1].riders.map((x) => x.id)).toEqual(['rider-a', 'guest-1']);
    // Without the session's totals, the longest rider's time and the riders' rings stand in.
    expect(rows[1]).toMatchObject({ minutes: 28, rings: 20, otherVideos: 0 });
  });

  it('names riders as the household knows them', () => {
    const rows = completionRows(sessions, 1800, { household: [{ id: 'rider-a', displayName: 'Rider A' }] });
    expect(rows[0].riders[0].displayName).toBe('Rider A');
    expect(rows[1].riders[1].displayName).toBe('guest-1');
  });

  it('lists nothing for people who have not done it, and caps the list', () => {
    expect(completionRows(sessions, 1800, { limit: 2 })).toHaveLength(2);
    expect(completionRows([s('x', 1, [r('rider-b', 3)])], 1800)).toEqual([]);
    expect(completionRows(null, 1800)).toEqual([]);
  });
});

describe('whenInWords', () => {
  const now = new Date(2026, 10, 10, 20, 0).getTime(); // Tue 10 Nov 2026
  const at = (y, m, d) => new Date(y, m - 1, d, 7).getTime();
  it('says it in words a child can read from the bike', () => {
    expect(whenInWords(at(2026, 11, 10), now)).toBe('Today');
    expect(whenInWords(at(2026, 11, 9), now)).toBe('Yesterday');
    expect(whenInWords(at(2026, 11, 7), now)).toBe('Saturday');
    expect(whenInWords(at(2026, 11, 1), now)).toBe('Last week');
    expect(whenInWords(at(2026, 10, 20), now)).toBe('3 weeks ago');
    expect(whenInWords(at(2026, 8, 20), now)).toBe('3 months ago');
    expect(whenInWords(at(2025, 5, 16), now)).toBe('May 2025');
    expect(whenInWords(null, now)).toBe('');
  });
});

describe('mosaicThumb', () => {
  it('asks the image proxy for a small copy', () => {
    expect(mosaicThumb('/api/v1/proxy/plex/library/metadata/1/thumb/2', 160, 90)).toBe('/api/v1/proxy/plex/library/metadata/1/thumb/2?w=160&h=90');
    expect(mosaicThumb('/x?a=1', 160, 90)).toBe('/x?a=1&w=160&h=90');
    expect(mosaicThumb(null, 160, 90)).toBeNull();
  });
});
