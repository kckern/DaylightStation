import { describe, it, expect } from 'vitest';
import { shuffleExecutionOrder } from './shuffleExecutionOrder.js';

const mk = (ids, currentIndex, upNext = []) => ({
  currentIndex,
  items: ids.map((queueItemId) => ({ queueItemId, priority: upNext.includes(queueItemId) ? 'upNext' : 'queue' })),
});

describe('shuffleExecutionOrder', () => {
  it('keeps the current item and the Up Next band in front, shuffles the rest, never changes the listing', () => {
    const q = mk(['a', 'b', 'c', 'd', 'e'], 0, ['b']);
    const out = shuffleExecutionOrder(q, true, () => 0);
    expect(out.executionOrder.slice(0, 2)).toEqual(['a', 'b']);
    expect([...out.executionOrder].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(out.executionOrder).not.toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(out.items).toBe(q.items);
  });
  it('turning it off restores the listed order from the current item on', () => {
    const q = mk(['a', 'b', 'c', 'd'], 1);
    expect(shuffleExecutionOrder(q, false).executionOrder).toEqual(['b', 'c', 'd']);
  });
  it('is a no-op when nothing is playing from the queue', () => {
    const q = mk(['a', 'b'], -1);
    expect(shuffleExecutionOrder(q, true)).toBe(q);
  });
});
