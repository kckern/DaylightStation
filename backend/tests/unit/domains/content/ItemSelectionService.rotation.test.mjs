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
        { strategy: 'rotation', random: Math.random }
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
      { strategy: 'rotation', random: Math.random }
    );
    assert.deepStrictEqual(result, [],
      'without allowFallback, rotation returns empty when nothing unwatched');
  });
});

// 2026-10-02: once every poem had been heard, the fallback dropped the watched
// filter and picked uniformly at random from the whole pool, so yesterday's
// poem could come straight back. An exhausted rotation now plays the least
// recently played item (never-played first), keeping it a rotation forever.
describe('rotation after the cycle exhausts', () => {
  const now = { now: new Date('2026-10-02T16:00:00Z') };
  const allHeard = [
    { id: 'yesterday', duration: 20, percent: 100, lastPlayed: '2026-10-01 07:40:00' },
    { id: 'july', duration: 20, percent: 100, lastPlayed: '2026-07-12 11:38:35' },
    { id: 'august', duration: 20, percent: 100, lastPlayed: '2026-08-16 07:41:26' },
  ];

  it('picks the least recently played item, every time', () => {
    for (let i = 0; i < 30; i++) {
      const [picked] = ItemSelectionService.select(allHeard, now, { strategy: 'rotation', allowFallback: true, random: Math.random });
      assert.strictEqual(picked.id, 'july');
    }
  });

  it('prefers an item with no lastPlayed at all', () => {
    const pool = [...allHeard, { id: 'unknown', duration: 20, percent: 100 }];
    const [picked] = ItemSelectionService.select(pool, now, { strategy: 'rotation', allowFallback: true });
    assert.strictEqual(picked.id, 'unknown');
  });

  it('still picks randomly among unheard items while the cycle lasts', () => {
    const pool = [...allHeard, { id: 'a', duration: 20, percent: 0 }, { id: 'b', duration: 20, percent: 0 }];
    const seen = new Set();
    for (let i = 0; i < 40; i++) seen.add(ItemSelectionService.select(pool, now, { strategy: 'rotation', allowFallback: true, random: Math.random })[0].id);
    assert.deepStrictEqual([...seen].sort(), ['a', 'b']);
  });
});

describe('least_recent ordering', () => {
  it('orders mixed local and ISO timestamps as instants', () => {
    const items = [
      { id: 'local-today', lastPlayed: '2026-10-02 07:40:00' },
      { id: 'iso-yesterday-evening', lastPlayed: '2026-10-02T03:00:00.000Z' },
    ];
    const sorted = ItemSelectionService.applySort(items, 'least_recent', () => 0.5);
    assert.deepStrictEqual(sorted.map((i) => i.id), ['iso-yesterday-evening', 'local-today']);
  });

  it('breaks ties randomly instead of always returning source order', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const firsts = new Set();
    for (let i = 0; i < 40; i++) firsts.add(ItemSelectionService.applySort(items, 'least_recent', Math.random)[0].id);
    assert.ok(firsts.size > 1);
  });
});
