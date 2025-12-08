import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBeatsSeries,
  buildSegments,
  createPaths,
  ZONE_COLOR_MAP,
  MIN_VISIBLE_TICKS
} from '../FitnessChart.helpers.js';

const mockGetSeries = (data) => (id, metric) => {
  const key = `${id}:${metric}`;
  return data[key];
};

const rosterEntry = { name: 'Alice' };

const timebase = { intervalMs: 5000 };

test('buildBeatsSeries uses heart_beats when available', () => {
  const beats = [1, 2, 3];
  const getSeries = mockGetSeries({ 'Alice:heart_beats': beats, 'Alice:zone_id': ['cool', 'cool', 'warm'] });
  const result = buildBeatsSeries(rosterEntry, getSeries, timebase);
  assert.deepEqual(result.beats, beats);
  assert.deepEqual(result.zones, ['cool', 'cool', 'warm']);
});

test('buildBeatsSeries integrates heart_rate when beats missing', () => {
  const getSeries = mockGetSeries({ 'Alice:heart_rate': [120, 120], 'Alice:zone_id': ['warm', 'warm'] });
  const result = buildBeatsSeries(rosterEntry, getSeries, timebase);
  // 120 bpm over 5s → 10 beats per tick, cumulative 10,20
  assert.deepEqual(result.beats.map((v) => Number(v.toFixed(3))), [10, 20]);
});

test('buildSegments splits on zone changes and nulls', () => {
  const beats = [1, 2, null, 3, 4];
  const zones = ['cool', 'cool', 'cool', 'warm', 'warm'];
  const segments = buildSegments(beats, zones);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].zone, 'cool');
  assert.equal(segments[1].zone, 'warm');
});

test('createPaths respects minVisibleTicks and colors', () => {
  const segments = [{ zone: 'cool', color: ZONE_COLOR_MAP.cool, points: [{ i: 0, v: 0 }, { i: 1, v: 10 }] }];
  const paths = createPaths(segments, { width: 300, height: 100, minVisibleTicks: 4 });
  assert.equal(paths.length, 1);
  assert.equal(paths[0].color, ZONE_COLOR_MAP.cool);
  // With minVisibleTicks=4 and two points at i=0 and i=1, x for i=1 should be width/3
  assert.ok(paths[0].d.includes('L100.00')); // 300/3 = 100
});

test('createPaths returns empty when no data or maxValue <= 0', () => {
  const paths = createPaths([], { width: 300, height: 100 });
  assert.deepEqual(paths, []);
});

// Keep constants reachable
assert.ok(MIN_VISIBLE_TICKS > 0);
