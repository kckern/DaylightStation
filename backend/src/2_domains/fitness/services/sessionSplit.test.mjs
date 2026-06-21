import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCumulativeKey, zoneToColor, splitDecodedSeries, computeSplitTick, recomputeSummaryForPart,
  allocateBucketsRedistribute
} from './sessionSplit.mjs';

const COLORS = ['blue', 'green', 'yellow', 'orange', 'red'];
const sum = (o) => COLORS.reduce((s, c) => s + (o[c] || 0), 0);

test('isCumulativeKey: cumulative suffixes only', () => {
  assert.equal(isCumulativeKey('milo:beats'), true);
  assert.equal(isCumulativeKey('milo:coins'), true);
  assert.equal(isCumulativeKey('bike:7138:rotations'), true);
  assert.equal(isCumulativeKey('vib:step-platform:impacts'), true);
  assert.equal(isCumulativeKey('global:coins'), true);
  assert.equal(isCumulativeKey('milo:hr'), false);
  assert.equal(isCumulativeKey('milo:zone'), false);
  assert.equal(isCumulativeKey('bike:7138:rpm'), false);
  assert.equal(isCumulativeKey('device:28688:heart-rate'), false);
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
    'milo:hr':    [100, 110, 120, 130, 140],   // instantaneous
    'milo:coins': [10, 20, 30, 40, 50],         // cumulative
  };
  const { part1, part2 } = splitDecodedSeries(decoded, 2); // split at tick 2

  assert.deepEqual(part1['milo:hr'], [100, 110]);
  assert.deepEqual(part2['milo:hr'], [120, 130, 140]);

  assert.deepEqual(part1['milo:coins'], [10, 20]);
  // baseline = part1 last = 20 → part2 re-zeroed
  assert.deepEqual(part2['milo:coins'], [10, 20, 30]);
});

test('splitDecodedSeries: cumulative re-zero carries nulls forward for baseline', () => {
  const decoded = { 'x:beats': [5, null, 9, 12, 15] };
  const { part2 } = splitDecodedSeries(decoded, 3); // baseline = value at idx 2 = 9
  assert.deepEqual(part2['x:beats'], [3, 6]); // 12-9, 15-9
});

test('recomputeSummaryForPart maps zone SYMBOLS (a/w/h) to color buckets + full-name minutes', () => {
  // zones stored as single-char symbols (ZONE_SYMBOL_MAP); coins cumulative.
  const series = {
    'milo:hr': [120, 130, 140],
    'milo:zone': ['a', 'w', 'h'],   // active, warm, hot
    'milo:coins': [10, 25, 40],     // deltas: 10, 15, 15
  };
  const { summary } = recomputeSummaryForPart({
    series, slugs: ['milo'], events: [], intervalMs: 5000, coinTimeUnitMs: 5000,
  });
  assert.equal(summary.coins.total, 40);
  assert.equal(summary.coins.buckets.green, 10);   // active tick delta
  assert.equal(summary.coins.buckets.yellow, 15);  // warm tick delta
  assert.equal(summary.coins.buckets.orange, 15);  // hot tick delta
  assert.deepEqual(Object.keys(summary.participants.milo.zone_minutes).sort(), ['active', 'hot', 'warm']);
});

test('allocateBucketsRedistribute: preserves per-color totals AND per-part coin totals exactly', () => {
  const orig = { blue: 0, green: 1060, yellow: 1578, orange: 435, red: 30 };
  const est1 = { blue: 100, green: 600, yellow: 200, orange: 50, red: 0 };
  const est2 = { blue: 244, green: 1310, yellow: 473, orange: 126, red: 0 };
  const total1 = 558, total2 = 2545; // exact per-user coin sums (558+2545=3103=sum(orig))

  const { part1, part2 } = allocateBucketsRedistribute(orig, est1, est2, total1, total2);

  // Per-color totals reconcile to the original EXACTLY.
  for (const c of COLORS) {
    assert.equal((part1[c] || 0) + (part2[c] || 0), orig[c], `color ${c} reconciles`);
  }
  // Per-part bucket sums equal each part's exact coin total.
  assert.equal(sum(part1), total1);
  assert.equal(sum(part2), total2);
  // A color with zero original stays zero in both parts.
  assert.equal(part1.blue, 0);
  assert.equal(part2.blue, 0);
});

test('recomputeSummaryForPart marks the longest media as primary (so the part stands alone)', () => {
  const series = { 'milo:hr': [120, 130], 'milo:zone': ['a', 'w'], 'milo:coins': [5, 10] };
  const events = [
    { type: 'media', timestamp: 1, data: { contentId: 'plex:1', grandparentTitle: 'Short Show', start: 0, end: 60000 } },
    { type: 'media', timestamp: 2, data: { contentId: 'plex:2', grandparentTitle: 'Long Show', start: 60000, end: 600000 } },
  ];
  const { summary } = recomputeSummaryForPart({ series, slugs: ['milo'], events, intervalMs: 5000, coinTimeUnitMs: 5000 });
  const primaries = summary.media.filter(m => m.primary === true);
  assert.equal(primaries.length, 1, 'exactly one primary');
  assert.equal(primaries[0].contentId, 'plex:2', 'longest-duration media is primary');
});

test('allocateBucketsRedistribute: zero-weight color falls back to coin-share', () => {
  const orig = { blue: 0, green: 0, yellow: 0, orange: 0, red: 30 };
  const est1 = { red: 0 }, est2 = { red: 0 }; // no activity signal for red
  const { part1, part2 } = allocateBucketsRedistribute(orig, est1, est2, 10, 20);
  assert.equal(part1.red + part2.red, 30);   // total preserved
  assert.equal(sum(part1), 10);              // part totals exact
  assert.equal(sum(part2), 20);
});
