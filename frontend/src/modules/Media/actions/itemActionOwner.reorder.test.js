import { describe, it, expect } from 'vitest';
import { createItemActionOwner } from './itemActionOwner.js';

const snap = () => ({
  state: 'playing', position: 5, config: { shuffle: false, repeat: 'off' },
  currentItem: { queueItemId: 'a', contentId: 'plex:1' },
  queue: {
    currentIndex: 0,
    items: ['a', 'b', 'c'].map((queueItemId, i) => ({ queueItemId, contentId: `plex:${i + 1}`, priority: 'queue' })),
  },
});

function makeOwner() {
  let current = snap();
  let revision = 1;
  const applied = [];
  const owner = createItemActionOwner({
    targetId: 'screen',
    capture: () => structuredClone(current),
    revision: () => ({ queueRevision: revision }),
    apply: (next, opts) => { applied.push({ next, opts }); current = structuredClone(next); revision += 1; return { ok: true }; },
  });
  return { owner, applied, order: () => current.queue.items.map((i) => i.queueItemId) };
}

describe('item action owner: reorder', () => {
  it('moves one item and the change is undoable like remove/clear, with playback left alone', async () => {
    const { owner, applied, order } = makeOwner();
    const result = await owner.execute({ kind: 'reorder', from: 'c', to: 'b', collectionItems: [], operationId: 'op1', tappedAt: Date.now() });
    expect(result.ok).toBe(true);
    expect(order()).toEqual(['a', 'c', 'b']);
    expect(applied[0].opts.playbackChanged).toBe(false);
    const undone = await owner.undo('op1');
    expect(undone.ok).toBe(true);
    expect(order()).toEqual(['a', 'b', 'c']);
  });

  it('replaces the ordering by id list', async () => {
    const { owner, order } = makeOwner();
    await owner.execute({ kind: 'reorder', items: ['c', 'a', 'b'], collectionItems: [], operationId: 'op2', tappedAt: Date.now() });
    expect(order()).toEqual(['c', 'a', 'b']);
  });
});
