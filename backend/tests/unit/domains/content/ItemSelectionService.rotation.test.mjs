// backend/tests/unit/domains/content/ItemSelectionService.rotation.test.mjs
//
// New `rotation` strategy: pick a random unwatched item from the pool.
// Fits the office-program poetry slot — shuffle through unread poems,
// don't repeat until the cycle exhausts.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ItemSelectionService } from '../../../../src/2_domains/content/services/ItemSelectionService.mjs';

describe('ItemSelectionService.STRATEGIES.rotation', () => {
  it('exposes rotation as a known strategy', () => {
    const s = ItemSelectionService.getStrategy('rotation');
    assert.deepStrictEqual(s, {
      filter: ['watched'],
      sort: 'random',
      pick: 'first',
    });
  });

  it('select() with strategy:rotation returns one item drawn from unwatched pool', () => {
    const items = [
      { id: 'p1', duration: 28, percent: 100 },     // watched (filtered)
      { id: 'p2', duration: 28, percent: 71 },      // watched per duration-aware rule
      { id: 'p3', duration: 28, percent: 0 },       // candidate
      { id: 'p4', duration: 28, percent: 5 },       // candidate
      { id: 'p5', duration: 28, percent: 0 },       // candidate
    ];
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      const result = ItemSelectionService.select(
        items,
        { now: new Date('2026-04-23T16:00:00Z') },
        { strategy: 'rotation' }
      );
      assert.strictEqual(result.length, 1, 'pick: first must return exactly one item');
      const picked = result[0].id;
      assert.ok(['p3', 'p4', 'p5'].includes(picked),
        `picked must be unwatched (got ${picked})`);
      seen.add(picked);
    }
    // Over 50 trials of random picking from 3 candidates, we should see at least 2 distinct picks.
    assert.ok(seen.size >= 2,
      `random pick should explore unwatched pool, only saw: ${[...seen].join(',')}`);
  });

  it('select() with strategy:rotation + allowFallback recovers when all watched', () => {
    const allWatched = [
      { id: 'p1', duration: 28, percent: 100 },
      { id: 'p2', duration: 28, percent: 95 },
    ];
    const result = ItemSelectionService.select(
      allWatched,
      { now: new Date('2026-04-23T16:00:00Z') },
      { strategy: 'rotation', allowFallback: true }
    );
    assert.strictEqual(result.length, 1,
      'with allowFallback, rotation should return one item even when pool exhausted');
  });

  it('select() with strategy:rotation returns empty when all watched and no fallback', () => {
    const allWatched = [
      { id: 'p1', duration: 28, percent: 100 },
      { id: 'p2', duration: 28, percent: 95 },
    ];
    const result = ItemSelectionService.select(
      allWatched,
      { now: new Date('2026-04-23T16:00:00Z') },
      { strategy: 'rotation' }
    );
    assert.deepStrictEqual(result, [],
      'without allowFallback, rotation returns empty when nothing unwatched');
  });
});
