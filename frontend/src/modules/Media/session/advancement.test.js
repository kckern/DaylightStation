// Spec-semantics suite for advancement (C3.3, J2). Pins the audit's P0#1
// (upNext infinite loop) and P1#7 (repeat-one traps explicit Skip).
import { describe, it, expect } from 'vitest';
import { pickNextQueueItem } from './advancement.js';

function item(id, priority = 'queue') {
  return { queueItemId: id, contentId: `c:${id}`, priority };
}

function snap({ items = [], currentIndex = -1, repeat = 'off', shuffle = false } = {}) {
  return {
    sessionId: 's', state: 'playing', currentItem: null, position: 0,
    queue: { items, currentIndex, upNextCount: items.filter((i) => i.priority === 'upNext').length },
    config: { shuffle, repeat, shader: null, volume: 50, playbackRate: 1 },
    meta: { ownerId: 'c', updatedAt: '' },
  };
}

describe('sequential advancement', () => {
  it('advances to the next item; null at the end with repeat=off', () => {
    const s = snap({ items: [item('a'), item('b')], currentIndex: 0 });
    expect(pickNextQueueItem(s).queueItemId).toBe('b');
    expect(pickNextQueueItem(snap({ items: [item('a'), item('b')], currentIndex: 1 }))).toBeNull();
  });

  it('wraps to the first item with repeat=all', () => {
    const s = snap({ items: [item('a'), item('b')], currentIndex: 1, repeat: 'all' });
    expect(pickNextQueueItem(s).queueItemId).toBe('a');
  });

  it('empty queue → null', () => {
    expect(pickNextQueueItem(snap())).toBeNull();
  });
});

describe('Up Next band (positional — audit P0#1)', () => {
  it('plays the band head directly after the current item', () => {
    const s = snap({ items: [item('a'), item('u1', 'upNext'), item('b')], currentIndex: 0 });
    expect(pickNextQueueItem(s).queueItemId).toBe('u1');
  });

  it('two upNext items play in order then the queue continues — NO infinite loop', () => {
    const items = [item('a'), item('u1', 'upNext'), item('u2', 'upNext'), item('b')];
    expect(pickNextQueueItem(snap({ items, currentIndex: 0 })).queueItemId).toBe('u1');
    expect(pickNextQueueItem(snap({ items, currentIndex: 1 })).queueItemId).toBe('u2');
    expect(pickNextQueueItem(snap({ items, currentIndex: 2 })).queueItemId).toBe('b');
    expect(pickNextQueueItem(snap({ items, currentIndex: 3 }))).toBeNull(); // terminates
  });

  it('spent upNext items BEHIND the cursor are never revisited', () => {
    const items = [item('u-old', 'upNext'), item('a'), item('b')];
    expect(pickNextQueueItem(snap({ items, currentIndex: 1 })).queueItemId).toBe('b');
  });
});

describe('repeat=one (audit P1#7)', () => {
  const items = [item('a'), item('b')];

  it('natural end repeats the current item', () => {
    const s = snap({ items, currentIndex: 0, repeat: 'one' });
    expect(pickNextQueueItem(s, { reason: 'item-ended' }).queueItemId).toBe('a');
  });

  it('explicit Skip moves on — the user is not trapped', () => {
    const s = snap({ items, currentIndex: 0, repeat: 'one' });
    expect(pickNextQueueItem(s, { reason: 'skip-next' }).queueItemId).toBe('b');
  });
});

describe('shuffle', () => {
  it('with repeat=off draws only from unplayed items ahead, then terminates', () => {
    const items = [item('a'), item('b'), item('c')];
    const s = snap({ items, currentIndex: 1, shuffle: true });
    expect(pickNextQueueItem(s, { randomFn: () => 0 }).queueItemId).toBe('c');
    expect(pickNextQueueItem(snap({ items, currentIndex: 2, shuffle: true }))).toBeNull();
  });

  it('with repeat=all draws from every other item', () => {
    const items = [item('a'), item('b'), item('c')];
    const s = snap({ items, currentIndex: 2, shuffle: true, repeat: 'all' });
    const picked = pickNextQueueItem(s, { randomFn: () => 0 });
    expect(['a', 'b']).toContain(picked.queueItemId);
  });

  it('single-item queue with repeat=all wraps; with repeat=off ends', () => {
    const items = [item('a')];
    expect(pickNextQueueItem(snap({ items, currentIndex: 0, shuffle: true, repeat: 'all' })).queueItemId).toBe('a');
    expect(pickNextQueueItem(snap({ items, currentIndex: 0, shuffle: true }))).toBeNull();
  });
});
