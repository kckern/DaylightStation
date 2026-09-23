import { describe, it, expect } from 'vitest';
import { checkSessionIntegrity, seriesLength } from '#domains/fitness/services/sessionIntegrity.mjs';

const strava = (overrides = {}) => ({
  session: { id: '20260919104104', duration_seconds: 50, source: 'strava' },
  timeline: {
    interval_seconds: 5,
    tick_count: 10,
    series: { 'kc:hr': '[[130,10]]', 'global:rings': JSON.stringify([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]) },
  },
  treasureBox: { totalRings: 20 },
  summary: { rings: { total: 20 } },
  ...overrides,
});

describe('seriesLength', () => {
  it('counts RLE runs in stored strings and plain arrays', () => {
    expect(seriesLength('[1,[2,3],[null,2]]')).toBe(6);
    expect(seriesLength([1, 2, null])).toBe(3);
    expect(seriesLength('["w",["fire",4]]')).toBe(5);
  });
  it('returns null for unreadable series', () => {
    expect(seriesLength('not json')).toBeNull();
    expect(seriesLength(42)).toBeNull();
  });
});

describe('checkSessionIntegrity', () => {
  it('passes a consistent session', () => {
    expect(checkSessionIntegrity(strava())).toEqual({ ok: true, violations: [] });
  });

  it('flags a Strava timeline that covers far less than the duration', () => {
    const s = strava({ session: { duration_seconds: 4920, source: 'strava' } });
    const { ok, violations } = checkSessionIntegrity(s);
    expect(ok).toBe(false);
    expect(violations[0]).toMatchObject({ check: 'coverage', expectedSeconds: 4920, coveredSeconds: 50 });
  });

  it('does not apply coverage to home sessions', () => {
    const s = strava({ session: { duration_seconds: 4920 } });
    expect(checkSessionIntegrity(s).ok).toBe(true);
  });

  it('flags a series whose length differs from tick_count', () => {
    const s = strava();
    s.timeline.series['kc:zone'] = '[["w",7]]';
    expect(checkSessionIntegrity(s).violations).toEqual([
      { check: 'series-length', series: 'kc:zone', length: 7, tickCount: 10 },
    ]);
  });

  it('skips the series check when tick_count is missing (legacy files)', () => {
    const s = strava();
    delete s.timeline.tick_count;
    s.session.source = undefined;
    expect(checkSessionIntegrity(s).ok).toBe(true);
  });

  it('flags ring totals that disagree', () => {
    const s = strava({ treasureBox: { totalRings: 863 } });
    expect(checkSessionIntegrity(s).violations).toEqual([
      { check: 'rings', summary: 20, treasureBox: 863, series: 20 },
    ]);
  });

  it('ignores the integrity stamp itself and missing sections', () => {
    expect(checkSessionIntegrity({}).ok).toBe(true);
    expect(checkSessionIntegrity(null).ok).toBe(true);
  });
});
