import { describe, it, expect } from 'vitest';
import { isCredited, gridBadge, detailRows, creditedSessions } from './episodeHistory.js';

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

describe('detailRows', () => {
  it('keeps the newest five credited sessions, guests included', () => {
    const sessions = Array.from({ length: 7 }, (_, i) => s(String(7 - i), 7 - i, [r('guest', 30, { isGuest: true })]));
    const rows = detailRows(sessions, 1800);
    expect(rows.map((x) => x.sessionId)).toEqual(['7', '6', '5', '4', '3']);
  });
});
