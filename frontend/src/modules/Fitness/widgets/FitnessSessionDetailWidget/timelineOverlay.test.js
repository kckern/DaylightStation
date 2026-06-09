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
      { axisStartMs: 15000, axisEndMs: 20000, meta: { winnerId: 'milo', raceId: 'r1' } },
    ] }];
    const bands = computeRaceBands(activities, OPTS);
    expect(bands).toEqual([{ x: 75, width: 25, winnerId: 'milo', raceId: 'r1' }]);
  });
  it('falls back to a 0-width-safe band and skips items without axis fields', () => {
    const activities = [{ type: 'cycle-game', items: [ { meta: {} } ] }];
    expect(computeRaceBands(activities, OPTS)).toEqual([]);
  });
  it('returns [] for no activities', () => {
    expect(computeRaceBands(undefined, OPTS)).toEqual([]);
    expect(computeRaceBands([], OPTS)).toEqual([]);
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
