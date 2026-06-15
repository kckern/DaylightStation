import { describe, it, expect } from 'vitest';
import { msToTickX, computeRaceBands, computeSeamLines } from './timelineOverlay.js';

const OPTS = { intervalMs: 5000, effectiveTicks: 5, plotWidth: 100, marginLeft: 0 };

describe('msToTickX', () => {
  it('maps compressed-axis ms to an x position via tick index', () => {
    expect(msToTickX(0, OPTS)).toBe(0);          // tick 0
    expect(msToTickX(15000, OPTS)).toBe(75);     // tick 3 -> (3/4)*100
    expect(msToTickX(20000, OPTS)).toBe(100);    // tick 4
  });
  it('clamps to marginLeft when effectiveTicks <= 1', () => {
    expect(msToTickX(9999, { ...OPTS, effectiveTicks: 1, marginLeft: 7 })).toBe(7);
  });
});

describe('computeRaceBands', () => {
  it('produces x/width rects for each race item with winner + raceId', () => {
    const activities = [{ type: 'cycle-game', items: [
      { axisStartMs: 15000, axisEndMs: 20000, meta: { winnerId: 'user_3', raceId: 'r1' } },
    ] }];
    const bands = computeRaceBands(activities, OPTS);
    expect(bands).toEqual([{ x: 75, width: 25, winnerId: 'user_3', raceId: 'r1' }]);
  });
  it('falls back to a 0-width-safe band and skips items without axis fields', () => {
    const activities = [{ type: 'cycle-game', items: [ { meta: {} } ] }];
    expect(computeRaceBands(activities, OPTS)).toEqual([]);
  });
  it('returns [] for no activities', () => {
    expect(computeRaceBands(undefined, OPTS)).toEqual([]);
    expect(computeRaceBands([], OPTS)).toEqual([]);
  });
  it('rebases raw single-session items against sessionStartMs when axis fields are absent', () => {
    // Standalone session: items carry absolute startMs/endMs, no axisStartMs.
    const sessionStartMs = 1_000_000;
    const activities = [{ type: 'cycle-game', items: [
      { startMs: sessionStartMs + 15000, endMs: sessionStartMs + 20000, meta: { winnerId: 'user_2', raceId: 'r1' } },
    ] }];
    const bands = computeRaceBands(activities, { ...OPTS, sessionStartMs });
    expect(bands).toEqual([{ x: 75, width: 25, winnerId: 'user_2', raceId: 'r1' }]);
  });
  it('still skips raw items when no sessionStartMs is available', () => {
    const activities = [{ type: 'cycle-game', items: [{ startMs: 5000, endMs: 9000, meta: {} }] }];
    expect(computeRaceBands(activities, OPTS)).toEqual([]); // OPTS has no sessionStartMs
  });
});

describe('computeSeamLines', () => {
  it('places a dashed line at each seam atMs with its gapMs', () => {
    expect(computeSeamLines([{ atMs: 15000, gapMs: 585000 }], OPTS))
      .toEqual([{ x: 75, gapMs: 585000 }]);
  });
  it('returns [] for no seams', () => {
    expect(computeSeamLines(undefined, OPTS)).toEqual([]);
  });
});

describe('clamping to the plot', () => {
  const OPTS = { intervalMs: 5000, effectiveTicks: 5, plotWidth: 100, marginLeft: 10 };
  it('clamps a band that would overflow the right edge', () => {
    const activities = [{ items: [{ axisStartMs: 18000, axisEndMs: 40000, meta: {} }] }];
    const [b] = computeRaceBands(activities, OPTS);
    expect(b.x).toBeGreaterThanOrEqual(10);
    expect(b.x + b.width).toBeLessThanOrEqual(110); // marginLeft + plotWidth
  });
  it('clamps a seam to the plot bounds', () => {
    const [s] = computeSeamLines([{ atMs: 999999, gapMs: 1 }], OPTS);
    expect(s.x).toBeLessThanOrEqual(110);
    expect(s.x).toBeGreaterThanOrEqual(10);
  });
});

import { computeVideoMarkers, computeChallengeMarkers } from './timelineOverlay.js';

const MARKER_OPTS = { intervalMs: 5000, effectiveTicks: 121, plotWidth: 600, marginLeft: 0, sessionStartMs: 1_000_000 };

const videoEvent = (startOffsetSec, over = {}) => ({
  type: 'media',
  data: { contentId: 'plex:1', title: 'Ep', grandparentId: 'plex:9', start: 1_000_000 + startOffsetSec * 1000, ...over }
});

describe('computeVideoMarkers', () => {
  it('omits the first video (opening slot) and marks the rest', () => {
    const events = [videoEvent(0, { title: 'Warmup' }), videoEvent(300, { title: 'Hero', contentId: 'plex:2' })];
    const markers = computeVideoMarkers(events, MARKER_OPTS);
    expect(markers).toHaveLength(1);
    expect(markers[0].episodeName).toBe('Hero');
    expect(markers[0].thumbUrl).toBe('/api/v1/display/plex/2');
    expect(markers[0].posterUrl).toBe('/api/v1/display/plex/9');
    expect(markers[0].x).toBeGreaterThan(0);
  });

  it('returns no markers for a single-video session', () => {
    expect(computeVideoMarkers([videoEvent(0)], MARKER_OPTS)).toHaveLength(0);
  });

  it('ignores audio (track) media', () => {
    const events = [videoEvent(0), { type: 'media', data: { contentId: 'plex:3', artist: 'X', start: 1_300_000 } }];
    expect(computeVideoMarkers(events, MARKER_OPTS)).toHaveLength(0);
  });
});

describe('computeChallengeMarkers', () => {
  it('places a dotted marker per challenge with a resolved type', () => {
    const events = [
      { type: 'challenge', data: { challengeId: 'a', type: 'cycle', start: 1_060_000, result: 'success' } },
      { type: 'challenge', data: { challengeId: 'b', zoneId: 'warm', start: 1_120_000, result: 'fail', zoneLabel: 'Warm' } }
    ];
    const markers = computeChallengeMarkers(events, MARKER_OPTS);
    expect(markers).toHaveLength(2);
    expect(markers[0].type).toBe('cycle');
    expect(markers[1].type).toBe('zone');
    expect(markers[1].label).toBe('Warm');
    expect(markers[0].x).toBeGreaterThan(0);
  });

  it('returns [] when there are no challenge events', () => {
    expect(computeChallengeMarkers([{ type: 'media', data: {} }], MARKER_OPTS)).toHaveLength(0);
  });

  it('carries the duration as x..xEnd (width) and the zoneId', () => {
    const events = [
      { type: 'challenge', data: { challengeId: 'a', zoneId: 'warm', zoneLabel: 'Warm', start: 1_060_000, end: 1_120_000, result: 'success' } }
    ];
    const [m] = computeChallengeMarkers(events, MARKER_OPTS);
    expect(m.zoneId).toBe('warm');
    expect(m.xEnd).toBeGreaterThan(m.x);
    expect(m.width).toBeCloseTo(m.xEnd - m.x, 5);
    // 60s start, 120s end at 5s/tick over 600px/120ticks => 5px/tick => start tick12=60px, end tick24=120px
    expect(m.x).toBeCloseTo(60, 1);
    expect(m.xEnd).toBeCloseTo(120, 1);
  });

  it('extends an unfinished challenge (end:null) to the axis end', () => {
    const events = [
      { type: 'challenge', data: { challengeId: 'a', zoneId: 'hot', start: 1_060_000, end: null, result: 'started' } }
    ];
    const [m] = computeChallengeMarkers(events, MARKER_OPTS);
    expect(m.zoneId).toBe('hot');
    // axis end = (effectiveTicks-1)*intervalMs from start => clamps to right edge (plotWidth)
    expect(m.xEnd).toBeCloseTo(MARKER_OPTS.marginLeft + MARKER_OPTS.plotWidth, 5);
    expect(m.width).toBeGreaterThan(0);
  });
});

import { resolveBadgeXs, withBadgeXs } from './timelineOverlay.js';

describe('resolveBadgeXs', () => {
  it('leaves well-separated positions unchanged', () => {
    expect(resolveBadgeXs([10, 60, 120], { minGap: 24, min: 0, max: 200 }))
      .toEqual([10, 60, 120]);
  });
  it('pushes overlapping badges apart left-to-right', () => {
    expect(resolveBadgeXs([50, 55, 58], { minGap: 24, min: 0, max: 400 }))
      .toEqual([50, 74, 98]);
  });
  it('walks a crowded cluster back inside the right edge', () => {
    const xs = resolveBadgeXs([180, 190, 200], { minGap: 24, min: 0, max: 200 });
    expect(xs[2]).toBe(200);
    expect(xs[1]).toBe(176);
    expect(xs[0]).toBe(152);
  });
  it('clamps the left edge and re-spreads forward', () => {
    const xs = resolveBadgeXs([-10, 0, 5], { minGap: 24, min: 0, max: 400 });
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBe(24);
    expect(xs[2]).toBe(48);
  });
});

describe('withBadgeXs', () => {
  it('adds badgeX without reordering markers, even when xEnd is unsorted', () => {
    // Marker 0 is an unfinished challenge whose xEnd extends past marker 1's.
    const markers = [
      { x: 10, xEnd: 300, width: 290, requiredCount: 1 },
      { x: 40, xEnd: 60, width: 20, requiredCount: 3 }
    ];
    const out = withBadgeXs(markers, { minGap: 24, min: 0, max: 300 });
    expect(out[0].requiredCount).toBe(1);          // order preserved
    expect(out[1].requiredCount).toBe(3);
    expect(out[0].badgeX).toBe(300);
    expect(out[1].badgeX).toBe(60);
    expect(markers[0].badgeX).toBeUndefined();      // input not mutated
  });
  it('separates two badges whose ends collide', () => {
    const out = withBadgeXs(
      [{ x: 0, xEnd: 100, width: 100 }, { x: 50, xEnd: 105, width: 55 }],
      { minGap: 24, min: 0, max: 400 }
    );
    expect(Math.abs(out[1].badgeX - out[0].badgeX)).toBeGreaterThanOrEqual(24);
  });
});

import { snapChallengeEndsToZoneTicks } from './timelineOverlay.js';

describe('snapChallengeEndsToZoneTicks', () => {
  const opts = { intervalMs: 5000, effectiveTicks: 121, plotWidth: 600, marginLeft: 0, sessionStartMs: 1_000_000 };
  // 5px per tick at this scale (600 / 120).
  const mk = (endTick, zoneId, metUsers) => ({
    x: 0, xEnd: endTick * 5, width: endTick * 5, type: 'zone', zoneId,
    result: 'success', metUsers, endMs: 1_000_000 + endTick * 5000
  });
  it('slides xEnd right to the first tick where a met user shows the zone', () => {
    // endTick 132.75-style case scaled down: end at tick 12.75, zone appears at tick 14
    const m = mk(12.75, 'warm', ['user_2']);
    const zoneSeries = { user_2: Array(20).fill('active') };
    zoneSeries.user_2[14] = 'warm';
    const [out] = snapChallengeEndsToZoneTicks([m], zoneSeries, opts);
    expect(out.xEnd).toBeCloseTo(14 * 5, 5);
    expect(out.width).toBeCloseTo(out.xEnd - out.x, 5);
  });
  it('accepts a HIGHER zone than the target (hot counts for warm)', () => {
    const m = mk(10.2, 'warm', ['kc']);
    const zoneSeries = { kc: Array(20).fill('active') };
    zoneSeries.kc[11] = 'hot';
    const [out] = snapChallengeEndsToZoneTicks([m], zoneSeries, opts);
    expect(out.xEnd).toBeCloseTo(55, 5);
  });
  it('leaves xEnd unchanged when the zone never appears within the cap', () => {
    const m = mk(10.2, 'warm', ['kc']);
    const zoneSeries = { kc: Array(20).fill('active') }; // never warm
    const [out] = snapChallengeEndsToZoneTicks([m], zoneSeries, opts);
    expect(out.xEnd).toBeCloseTo(51, 5);
  });
  it('leaves cycle challenges and markers already inside the zone untouched', () => {
    const cyc = { ...mk(8, null, []), type: 'cycle', zoneId: null };
    const inZone = mk(6.0, 'warm', ['kc']);
    const zoneSeries = { kc: Array(20).fill('warm') };
    const out = snapChallengeEndsToZoneTicks([cyc, inZone], zoneSeries, opts);
    expect(out[0].xEnd).toBeCloseTo(40, 5);
    expect(out[1].xEnd).toBeCloseTo(30, 5); // tick 6 already warm -> snap to floor tick = 6
  });
});
