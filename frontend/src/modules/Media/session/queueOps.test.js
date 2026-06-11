// Spec-semantics suite for the queue model (C3 / §4.4) — written against the
// requirements, not the previous implementation. The defect classes pinned
// here were found by the 2026-06-10 carry-over audit: index-tracked current
// vs identity-based ops, permanent upNext priority, prepend-instead-of-
// replace playNow, silent drops in reorder-by-list.
import { describe, it, expect } from 'vitest';
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import * as q from './queueOps.js';

function seed(...specs) {
  // spec: 'a' (queue priority), ['u1','upNext'], current marked 'b*'.
  const base = createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'c1' });
  const items = [];
  let currentIndex = -1;
  for (const spec of specs) {
    const [name, priority = 'queue'] = Array.isArray(spec) ? spec : [spec];
    const isCurrent = name.endsWith('*');
    const id = isCurrent ? name.slice(0, -1) : name;
    items.push({
      queueItemId: id, contentId: `c:${id}`, title: id.toUpperCase(),
      format: 'video', duration: 60, thumbnail: null, addedAt: '', priority,
    });
    if (isCurrent) currentIndex = items.length - 1;
  }
  return {
    ...base,
    queue: { items, currentIndex, upNextCount: items.filter((i) => i.priority === 'upNext').length },
    currentItem: currentIndex >= 0 ? { contentId: items[currentIndex].contentId } : null,
  };
}

const ids = (snap) => snap.queue.items.map((i) => i.queueItemId);
const currentId = (snap) => snap.queue.items[snap.queue.currentIndex]?.queueItemId ?? null;

describe('playNow', () => {
  it('REPLACES the current item in place, preserving the rest (§4.4)', () => {
    const next = q.playNow(seed('a', 'b*', 'c'), { contentId: 'c:x', title: 'X' });
    expect(ids(next)).toHaveLength(3);
    expect(next.queue.items[1].contentId).toBe('c:x'); // b replaced at its slot
    expect(next.queue.currentIndex).toBe(1);
    expect(next.currentItem.contentId).toBe('c:x');
    expect(ids(next)[0]).toBe('a'); // played prefix stays behind, never ahead
    expect(ids(next)[2]).toBe('c');
  });

  it('clearRest leaves only the new item', () => {
    const next = q.playNow(seed('a', 'b*', 'c'), { contentId: 'c:x' }, { clearRest: true });
    expect(ids(next)).toHaveLength(1);
    expect(next.currentItem.contentId).toBe('c:x');
  });

  it('with no current item, becomes the front of the queue and current', () => {
    const next = q.playNow(seed('a', 'b'), { contentId: 'c:x' });
    expect(next.queue.items[0].contentId).toBe('c:x');
    expect(next.queue.currentIndex).toBe(0);
  });
});

describe('playNext', () => {
  it('inserts at the FRONT of the Up Next band with upNext priority', () => {
    const next = q.playNext(seed('a*', ['u1', 'upNext'], 'b'), { contentId: 'c:n' });
    expect(next.queue.items[1].contentId).toBe('c:n'); // directly after current
    expect(next.queue.items[1].priority).toBe('upNext'); // wins advancement
    expect(next.queue.items[2].queueItemId).toBe('u1'); // existing band pushed back
    expect(currentId(next)).toBe('a');
  });
});

describe('addUpNext', () => {
  it('appends to the END of the band (after current + existing band)', () => {
    const next = q.addUpNext(seed('a*', ['u1', 'upNext'], 'b'), { contentId: 'c:u2' });
    expect(next.queue.items[2].contentId).toBe('c:u2'); // after u1, before b
    expect(next.queue.items[2].priority).toBe('upNext');
  });

  it('ignores spent upNext items BEHIND the current position (audit P1#6)', () => {
    const next = q.addUpNext(seed('a', ['u-old', 'upNext'], 'b*', 'c'), { contentId: 'c:u2' });
    expect(next.queue.items[3].contentId).toBe('c:u2'); // right after b
    expect(next.queue.items[4].queueItemId).toBe('c');
  });
});

describe('reorder — identity-stable current (audit P0#2)', () => {
  it('moving the CURRENT item does not change what is playing', () => {
    const next = q.reorder(seed('a', 'b*', 'c'), { from: 'b', to: 'a' });
    expect(ids(next)).toEqual(['b', 'a', 'c']);
    expect(currentId(next)).toBe('b'); // still b, at its new index
    expect(next.currentItem.contentId).toBe('c:b');
  });

  it('moving a NEIGHBOR past the current item does not change what is playing', () => {
    const next = q.reorder(seed('a', 'b*', 'c'), { from: 'a', to: 'c' });
    expect(ids(next)).toEqual(['b', 'c', 'a']);
    expect(currentId(next)).toBe('b');
  });

  it('reorder by id-list keeps unlisted items (appended, never dropped — audit P2#10)', () => {
    const next = q.reorder(seed('a*', 'b', 'c'), { items: ['c', 'b'] });
    expect(ids(next)).toEqual(['c', 'b', 'a']);
    expect(currentId(next)).toBe('a');
  });
});

describe('remove', () => {
  it('removing a non-current item keeps the current item current', () => {
    const next = q.remove(seed('a', 'b*', 'c'), 'a');
    expect(ids(next)).toEqual(['b', 'c']);
    expect(currentId(next)).toBe('b');
  });

  it('removing the CURRENT item promotes its successor and resets position', () => {
    const snap = { ...seed('a', 'b*', 'c'), position: 42 };
    const next = q.remove(snap, 'b');
    expect(ids(next)).toEqual(['a', 'c']);
    expect(currentId(next)).toBe('c');
    expect(next.position).toBe(0); // the old position belonged to b
  });

  it('removing the ONLY item clears currentItem (state-table idle shape)', () => {
    const next = q.remove(seed('a*'), 'a');
    expect(ids(next)).toEqual([]);
    expect(next.queue.currentIndex).toBe(-1);
    expect(next.currentItem).toBeNull();
  });
});

describe('jump', () => {
  it('jumps to the item by id', () => {
    const next = q.jump(seed('a*', 'b', 'c'), 'c');
    expect(currentId(next)).toBe('c');
    expect(next.currentItem.contentId).toBe('c:c');
  });

  it('unknown id is a no-op', () => {
    const snap = seed('a*', 'b');
    expect(q.jump(snap, 'ghost')).toBe(snap);
  });
});

describe('demote', () => {
  it('flips a spent upNext item to regular priority', () => {
    const next = q.demote(seed('a*', ['u1', 'upNext']), 'u1');
    expect(next.queue.items[1].priority).toBe('queue');
    expect(next.queue.upNextCount).toBe(0);
  });
});

describe('clear', () => {
  it('empties the queue but does not stop the current item', () => {
    const snap = seed('a*', 'b');
    const next = q.clear(snap);
    expect(ids(next)).toEqual([]);
    expect(next.currentItem).toEqual(snap.currentItem); // keeps playing
  });
});

describe('add', () => {
  it('appends; first-into-empty becomes current', () => {
    const first = q.add(seed(), { contentId: 'c:a' });
    expect(first.queue.currentIndex).toBe(0);
    const second = q.add(first, { contentId: 'c:b' });
    expect(ids(second)).toHaveLength(2);
    expect(second.queue.currentIndex).toBe(0);
  });
});
