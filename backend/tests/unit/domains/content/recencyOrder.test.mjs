// backend/tests/unit/domains/content/recencyOrder.test.mjs
//
// Guards the recency-aware ordering of a queue's watched pool (2026-07-14
// Bluey repeat bug): once every episode is watched the partition collapses to
// one bucket, and without recency the queue replays recently-seen episodes.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { orderWatchedByRecency } from '../../../../src/2_domains/content/utils/recencyOrder.mjs';

// Deterministic "shuffle": reverse, so we can assert ordering without randomness.
const reverse = (arr) => arr.reverse();

describe('orderWatchedByRecency — non-shuffle (lastPlayed ascending)', () => {
  it('orders least-recently-seen first', () => {
    const items = [
      { id: 'a' }, { id: 'b' }, { id: 'c' },
    ];
    const recency = new Map([
      ['a', '2026-07-14 20:00:00'], // most recent
      ['b', '2026-07-10 08:00:00'],
      ['c', '2026-01-01 08:00:00'], // oldest
    ]);
    const out = orderWatchedByRecency(items, recency, { shuffle: false }).map(i => i.id);
    assert.deepStrictEqual(out, ['c', 'b', 'a']);
  });

  it('puts never-played (no lastPlayed) items first', () => {
    const items = [{ id: 'seen' }, { id: 'never' }];
    const recency = new Map([['seen', '2026-07-14 20:00:00']]);
    const out = orderWatchedByRecency(items, recency, { shuffle: false }).map(i => i.id);
    assert.deepStrictEqual(out, ['never', 'seen']);
  });

  it('does not mutate the input array', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    const recency = new Map([['a', '2026-07-14'], ['b', '2026-01-01']]);
    orderWatchedByRecency(items, recency, { shuffle: false });
    assert.deepStrictEqual(items.map(i => i.id), ['a', 'b']);
  });
});

describe('orderWatchedByRecency — shuffle (bench most-recent fraction)', () => {
  it('benches the most-recently-played fraction to the back', () => {
    // 4 items, fraction 0.5 => bench the 2 most-recent (d, c).
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const recency = new Map([
      ['a', '2026-01-01'], // oldest  -> eligible
      ['b', '2026-02-01'], //         -> eligible
      ['c', '2026-06-01'], // recent  -> benched
      ['d', '2026-07-01'], // newest  -> benched
    ]);
    const out = orderWatchedByRecency(items, recency, { shuffle: true, fraction: 0.5, shuffleFn: reverse });
    // eligible {a,b} reversed then benched {c,d} reversed
    assert.deepStrictEqual(out.map(i => i.id), ['b', 'a', 'd', 'c']);
    // membership preserved
    assert.deepStrictEqual([...out.map(i => i.id)].sort(), ['a', 'b', 'c', 'd']);
  });

  it('never-played items are always eligible (never benched)', () => {
    const items = [{ id: 'fresh' }, { id: 'r1' }, { id: 'r2' }];
    const recency = new Map([['r1', '2026-06-01'], ['r2', '2026-07-01']]);
    const out = orderWatchedByRecency(items, recency, { shuffle: true, fraction: 0.9, shuffleFn: (a) => a });
    // window = min(2, floor(0.9*3)=2) = 2 => bench the 2 most-recent (r2, r1)
    // 'fresh' (null) stays eligible/front
    assert.strictEqual(out[0].id, 'fresh');
    assert.deepStrictEqual([...out.map(i => i.id)].sort(), ['fresh', 'r1', 'r2']);
  });

  it('returns a singleton/empty pool unchanged', () => {
    assert.deepStrictEqual(orderWatchedByRecency([], new Map(), { shuffle: true }), []);
    assert.deepStrictEqual(
      orderWatchedByRecency([{ id: 'x' }], new Map(), { shuffle: true }).map(i => i.id),
      ['x']
    );
  });
});
