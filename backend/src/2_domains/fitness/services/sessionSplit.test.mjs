import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCumulativeKey, zoneToColor, splitDecodedSeries, computeSplitTick
} from './sessionSplit.mjs';

test('isCumulativeKey: cumulative suffixes only', () => {
  assert.equal(isCumulativeKey('user_3:beats'), true);
  assert.equal(isCumulativeKey('user_3:coins'), true);
  assert.equal(isCumulativeKey('bike:7138:rotations'), true);
  assert.equal(isCumulativeKey('vib:step-platform:impacts'), true);
  assert.equal(isCumulativeKey('global:coins'), true);
  assert.equal(isCumulativeKey('user_3:hr'), false);
  assert.equal(isCumulativeKey('user_3:zone'), false);
  assert.equal(isCumulativeKey('bike:7138:rpm'), false);
  assert.equal(isCumulativeKey('device:90001:heart-rate'), false);
});

test('zoneToColor: standard mapping', () => {
  assert.equal(zoneToColor('cool'), 'blue');
  assert.equal(zoneToColor('active'), 'green');
  assert.equal(zoneToColor('warm'), 'yellow');
  assert.equal(zoneToColor('hot'), 'orange');
  assert.equal(zoneToColor('fire'), 'red');
  assert.equal(zoneToColor('bogus'), null);
});

test('computeSplitTick rounds (splitTs - startAbs)/intervalMs', () => {
  assert.equal(computeSplitTick({ splitTs: 1000 + 233 * 5000, startAbsMs: 1000, intervalMs: 5000 }), 233);
});

test('splitDecodedSeries: instantaneous sliced, cumulative re-zeroed in part2', () => {
  const decoded = {
    'user_3:hr':    [100, 110, 120, 130, 140],   // instantaneous
    'user_3:coins': [10, 20, 30, 40, 50],         // cumulative
  };
  const { part1, part2 } = splitDecodedSeries(decoded, 2); // split at tick 2

  assert.deepEqual(part1['user_3:hr'], [100, 110]);
  assert.deepEqual(part2['user_3:hr'], [120, 130, 140]);

  assert.deepEqual(part1['user_3:coins'], [10, 20]);
  // baseline = part1 last = 20 → part2 re-zeroed
  assert.deepEqual(part2['user_3:coins'], [10, 20, 30]);
});

test('splitDecodedSeries: cumulative re-zero carries nulls forward for baseline', () => {
  const decoded = { 'x:beats': [5, null, 9, 12, 15] };
  const { part2 } = splitDecodedSeries(decoded, 3); // baseline = value at idx 2 = 9
  assert.deepEqual(part2['x:beats'], [3, 6]); // 12-9, 15-9
});
