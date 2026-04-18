import { describe, it, expect } from 'vitest';
import { pickNextQueueItem } from './advancement.js';

function snap({ items = [], currentIndex = -1, upNextCount = 0, repeat = 'off', shuffle = false } = {}) {
  return {
    sessionId: 's', state: 'playing', currentItem: null, position: 0,
    queue: { items, currentIndex, upNextCount },
    config: { shuffle, repeat, shader: null, volume: 50, playbackRate: 1 },
    meta: { ownerId: 'c', updatedAt: '' },
  };
}

const mk = (id, p = 'queue') => ({ queueItemId: id, contentId: id, format: 'video', priority: p });

describe('advancement.pickNextQueueItem', () => {
  it('returns null when queue is empty', () => {
    expect(pickNextQueueItem(snap())).toBeNull();
  });

  it('advances to the next item in order', () => {
    const s = snap({ items: [mk('a'), mk('b'), mk('c')], currentIndex: 0 });
    expect(pickNextQueueItem(s).queueItemId).toBe('b');
  });

  it('returns null at end when repeat=off', () => {
    const s = snap({ items: [mk('a'), mk('b')], currentIndex: 1, repeat: 'off' });
    expect(pickNextQueueItem(s)).toBeNull();
  });

  it('wraps to index 0 when repeat=all', () => {
    const s = snap({ items: [mk('a'), mk('b')], currentIndex: 1, repeat: 'all' });
    expect(pickNextQueueItem(s).queueItemId).toBe('a');
  });

  it('returns the same item when repeat=one', () => {
    const s = snap({ items: [mk('a'), mk('b')], currentIndex: 1, repeat: 'one' });
    expect(pickNextQueueItem(s).queueItemId).toBe('b');
  });

  it('honors upNext priority even when current is in regular band', () => {
    const items = [mk('a'), mk('u1', 'upNext'), mk('b')];
    const s = snap({ items, currentIndex: 0, upNextCount: 1 });
    expect(pickNextQueueItem(s).queueItemId).toBe('u1');
  });

  it('with shuffle=true, picks a different item from the regular band', () => {
    const items = [mk('a'), mk('b'), mk('c'), mk('d')];
    const s = snap({ items, currentIndex: 0, shuffle: true });
    const picked = pickNextQueueItem(s);
    expect(['b', 'c', 'd']).toContain(picked.queueItemId);
  });
});
