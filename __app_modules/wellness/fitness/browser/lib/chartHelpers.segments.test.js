import { describe, expect, it } from 'vitest';
import { buildSegments } from './chartHelpers.js';

describe('buildSegments recorded ring totals', () => {
  it('keeps unawarded rings flat through earning-zone transitions', () => {
    const beats = [0, 0, 0, 0, 0, 0];
    const segments = buildSegments(
      beats,
      ['active', 'active', 'warm', 'warm', 'hot', 'hot'],
      beats.map(() => true),
    );

    expect(segments.flatMap(segment => segment.points.map(point => point.v))).toEqual(
      [0, 0, 0, 0, 0, 0, 0, 0],
    );
  });

  it('preserves every recorded total across zero-rate and earning zones', () => {
    const beats = [0, 1, 1, 4, 4, 4, 9, 9];
    const segments = buildSegments(
      beats,
      ['active', 'active', 'cool', 'cool', 'warm', 'warm', 'rest', 'rest'],
      beats.map(() => true),
      { zoneConfig: [{ id: 'warm', rings: 20 }] },
    );

    for (const segment of segments) {
      for (const point of segment.points) expect(point.v).toBe(beats[point.i]);
    }
    const values = segments.flatMap(segment => segment.points.map(point => point.v));
    expect(values.every((value, index) => index === 0 || value >= values[index - 1])).toBe(true);
  });

  it('keeps dropout gaps horizontal and resumes at the recorded total', () => {
    const segments = buildSegments(
      [0, 2, 2, 2, 7, 7],
      ['active', 'active', 'active', 'active', 'warm', 'warm'],
      [true, true, false, false, true, true],
    );
    const gap = segments.find(segment => segment.isGap);
    expect(gap.points).toEqual([{ i: 1, v: 2 }, { i: 4, v: 2 }]);
    expect(gap.gapDurationMs).toBe(15000);
    expect(segments.at(-1).points).toEqual([{ i: 4, v: 2 }, { i: 4, v: 7 }, { i: 5, v: 7 }]);
  });

  it('ends a permanent dropout at the last active recorded total', () => {
    const segments = buildSegments(
      [0, 2, 2, 2],
      ['active', 'active', 'active', 'active'],
      [true, true, false, false],
    );

    expect(segments).toHaveLength(1);
    expect(segments[0].isGap).toBe(false);
    expect(segments[0].points).toEqual([{ i: 0, v: 0 }, { i: 1, v: 2 }]);
  });

  it('extends a horizontal gap when the roster rejoins before the timeline', () => {
    const segments = buildSegments(
      [0, 2, 2, 2],
      ['active', 'active', 'active', 'active'],
      [true, true, false, false],
      { isCurrentlyActive: true, currentTick: 5 },
    );

    expect(segments.at(-1).isGap).toBe(true);
    expect(segments.at(-1).points).toEqual([{ i: 1, v: 2 }, { i: 5, v: 2 }]);
  });

});
