import { describe, it, expect } from 'vitest';
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { playNow, playNext, addUpNext, add, clear, remove, jump, reorder } from './queueOps.js';

function emptySnap() {
  return createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'c1' });
}

describe('queueOps — insertion ops', () => {
  it('playNow replaces current item and clears rest when clearRest=true', () => {
    const seed = playNow(emptySnap(), { contentId: 'a' }, { clearRest: true });
    expect(seed.queue.items).toHaveLength(1);
    expect(seed.queue.items[0].contentId).toBe('a');
    expect(seed.queue.currentIndex).toBe(0);
    expect(seed.currentItem?.contentId).toBe('a');
  });

  it('playNow with clearRest=false inserts-and-plays, keeping tail', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    s = playNow(s, { contentId: 'c' }, { clearRest: false });
    expect(s.queue.items.map(i => i.contentId)).toEqual(['c', 'a', 'b']);
    expect(s.queue.currentIndex).toBe(0);
  });

  it('playNext inserts after the current item', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    s = jump(s, s.queue.items[0].queueItemId);
    s = playNext(s, { contentId: 'x' });
    expect(s.queue.items.map(i => i.contentId)).toEqual(['a', 'x', 'b']);
    expect(s.queue.currentIndex).toBe(0);
  });

  it('addUpNext appends to Up Next sub-queue, before regular queue', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = addUpNext(s, { contentId: 'u1' });
    s = addUpNext(s, { contentId: 'u2' });
    expect(s.queue.items.map(i => i.contentId)).toEqual(['a', 'u1', 'u2']);
    expect(s.queue.upNextCount).toBe(2);
    expect(s.queue.items[1].priority).toBe('upNext');
  });

  it('add appends to the end', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    expect(s.queue.items.map(i => i.contentId)).toEqual(['a', 'b']);
    expect(s.queue.upNextCount).toBe(0);
  });
});

describe('queueOps — mutation ops', () => {
  it('clear empties queue and resets currentIndex', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    s = clear(s);
    expect(s.queue.items).toEqual([]);
    expect(s.queue.currentIndex).toBe(-1);
    expect(s.queue.upNextCount).toBe(0);
  });

  it('remove drops by queueItemId and adjusts currentIndex', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    s = jump(s, s.queue.items[1].queueItemId);
    const bId = s.queue.items[1].queueItemId;
    s = remove(s, s.queue.items[0].queueItemId);
    expect(s.queue.items.map(i => i.contentId)).toEqual(['b']);
    expect(s.queue.currentIndex).toBe(0);
    expect(s.queue.items[0].queueItemId).toBe(bId);
  });

  it('jump sets currentIndex + currentItem by queueItemId', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    const bId = s.queue.items[1].queueItemId;
    s = jump(s, bId);
    expect(s.queue.currentIndex).toBe(1);
    expect(s.currentItem?.contentId).toBe('b');
  });

  it('reorder({from, to}) swaps positions', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    s = add(s, { contentId: 'c' });
    s = reorder(s, { from: s.queue.items[0].queueItemId, to: s.queue.items[2].queueItemId });
    expect(s.queue.items.map(i => i.contentId)).toEqual(['b', 'c', 'a']);
  });
});
