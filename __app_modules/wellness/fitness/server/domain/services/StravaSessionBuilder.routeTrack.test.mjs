import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRouteTrack } from './StravaSessionBuilder.mjs';

test('downsamples to one point per step, keeps the last, rounds to ~1 m', () => {
  const time = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13];
  const latlng = time.map((s) => [47.5 + s * 0.0000123, -122.1]);
  const track = buildRouteTrack(latlng, time, 5);
  assert.deepEqual(track.t, [0, 5, 10, 13]);
  assert.equal(track.points.length, 4);
  assert.equal(track.points[1][0], Math.round((47.5 + 5 * 0.0000123) * 1e5) / 1e5);
  assert.equal(track.stepSeconds, 5);
});

test('rejects mismatched or empty streams', () => {
  assert.equal(buildRouteTrack([[1, 1], [2, 2]], [0]), null);
  assert.equal(buildRouteTrack(null, null), null);
  assert.equal(buildRouteTrack([[1, 1]], [0]), null);
});
