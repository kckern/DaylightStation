import { describe, test, expect, beforeEach } from '@jest/globals';
import { MediaQueue, ADDED_FROM } from '#domains/media/entities/MediaQueue.mjs';
import { QueueFullError } from '#domains/media/errors.mjs';

describe('MediaQueue', () => {
  let queue;

  beforeEach(() => {
    queue = MediaQueue.empty();
  });

  // ---------- 1. Construction ----------
  describe('construction', () => {
    test('empty() returns sensible defaults', () => {
      expect(queue.position).toBe(0);
      expect(queue.shuffle).toBe(false);
      expect(queue.repeat).toBe('off');
      expect(queue.volume).toBe(1.0);
      expect(queue.items).toEqual([]);
      expect(queue.shuffleOrder).toEqual([]);
    });

    test('constructor accepts initial state', () => {
      const q = new MediaQueue({
        position: 3,
        shuffle: true,
        repeat: 'all',
        volume: 0.5,
        items: [{ mediaKey: 'plex:abc' }],
        shuffleOrder: [0],
      });
      expect(q.position).toBe(3);
      expect(q.shuffle).toBe(true);
      expect(q.repeat).toBe('all');
      expect(q.volume).toBe(0.5);
      expect(q.items).toHaveLength(1);
      expect(q.shuffleOrder).toEqual([0]);
    });
  });

  // ---------- 2. Serialization ----------
  describe('serialization', () => {
    test('toJSON roundtrips through fromJSON', () => {
      queue.addItems([{ mediaKey: 'plex:1' }, { mediaKey: 'plex:2' }]);
      queue.position = 1;
      queue.repeat = 'all';
      queue.volume = 0.7;

      const json = queue.toJSON();
      const restored = MediaQueue.fromJSON(json);

      expect(restored.position).toBe(1);
      expect(restored.repeat).toBe('all');
      expect(restored.volume).toBe(0.7);
      expect(restored.items).toHaveLength(2);
      expect(restored.items[0].queueId).toBe(queue.items[0].queueId);
      expect(restored.items[1].mediaKey).toBe('plex:2');
    });

    test('toJSON produces plain object (no class instances)', () => {
      const json = queue.toJSON();
      expect(json.constructor).toBe(Object);
    });
  });

  // ---------- 3. Accessors ----------
  describe('accessors', () => {
    test('currentItem is null when queue is empty', () => {
      expect(queue.currentItem).toBeNull();
    });

    test('currentItem returns item at position', () => {
      queue.addItems([{ mediaKey: 'a' }, { mediaKey: 'b' }, { mediaKey: 'c' }]);
      queue.position = 1;
      expect(queue.currentItem.mediaKey).toBe('b');
    });

    test('isEmpty is true when no items', () => {
      expect(queue.isEmpty).toBe(true);
    });

    test('isEmpty is false when items exist', () => {
      queue.addItems([{ mediaKey: 'x' }]);
      expect(queue.isEmpty).toBe(false);
    });

    test('length reflects item count', () => {
      expect(queue.length).toBe(0);
      queue.addItems([{ mediaKey: 'a' }, { mediaKey: 'b' }]);
      expect(queue.length).toBe(2);
    });

    test('findByQueueId returns the correct item', () => {
      const added = queue.addItems([{ mediaKey: 'a' }, { mediaKey: 'b' }]);
      const found = queue.findByQueueId(added[1].queueId);
      expect(found.mediaKey).toBe('b');
    });

    test('findByQueueId returns null for unknown id', () => {
      queue.addItems([{ mediaKey: 'a' }]);
      expect(queue.findByQueueId('nonexistent')).toBeNull();
    });
  });

  // ---------- 4. addItems ----------
  describe('addItems', () => {
    test('appends items to end by default', () => {
      queue.addItems([{ mediaKey: 'a' }]);
      queue.addItems([{ mediaKey: 'b' }]);
      expect(queue.items[0].mediaKey).toBe('a');
      expect(queue.items[1].mediaKey).toBe('b');
    });

    test('inserts at position+1 with placement "next"', () => {
      queue.addItems([{ mediaKey: 'a' }, { mediaKey: 'c' }]);
      queue.position = 0; // current = a
      queue.addItems([{ mediaKey: 'b' }], 'next');
      expect(queue.items[1].mediaKey).toBe('b');
      expect(queue.items[2].mediaKey).toBe('c');
    });

    test('assigns 8-char hex queueId to each item', () => {
      const added = queue.addItems([{ mediaKey: 'x' }, { mediaKey: 'y' }]);
      for (const item of added) {
        expect(item.queueId).toMatch(/^[0-9a-f]{8}$/);
      }
      // queueIds should be unique
      expect(added[0].queueId).not.toBe(added[1].queueId);
    });

    test('throws QueueFullError at 500 items', () => {
      const bulk = Array.from({ length: 500 }, (_, i) => ({ mediaKey: `k${i}` }));
      queue.addItems(bulk);
      expect(queue.length).toBe(500);

      expect(() => queue.addItems([{ mediaKey: 'overflow' }])).toThrow(QueueFullError);
    });

    test('QueueFullError has correct properties', () => {
      const bulk = Array.from({ length: 500 }, (_, i) => ({ mediaKey: `k${i}` }));
      queue.addItems(bulk);

      try {
        queue.addItems([{ mediaKey: 'overflow' }]);
        expect(true).toBe(false); // should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(QueueFullError);
        expect(err.code).toBe('QUEUE_FULL');
        expect(err.currentSize).toBe(500);
        expect(err.maxSize).toBe(500);
      }
    });

    test('returns the stamped items', () => {
      const added = queue.addItems([{ mediaKey: 'z', title: 'Title Z' }]);
      expect(added).toHaveLength(1);
      expect(added[0].mediaKey).toBe('z');
      expect(added[0].title).toBe('Title Z');
      expect(added[0].queueId).toBeDefined();
    });
  });

  // ---------- 5. removeByQueueId ----------
  describe('removeByQueueId', () => {
    let ids;

    beforeEach(() => {
      const added = queue.addItems([
        { mediaKey: 'a' },
        { mediaKey: 'b' },
        { mediaKey: 'c' },
        { mediaKey: 'd' },
      ]);
      ids = added.map((i) => i.queueId);
      queue.position = 2; // current = c
    });

    test('adjusts position when removing before current', () => {
      queue.removeByQueueId(ids[0]); // remove a (index 0)
      expect(queue.position).toBe(1); // c is now at index 1
      expect(queue.currentItem.mediaKey).toBe('c');
    });

    test('does not adjust position when removing after current', () => {
      queue.removeByQueueId(ids[3]); // remove d (index 3)
      expect(queue.position).toBe(2);
      expect(queue.currentItem.mediaKey).toBe('c');
    });

    test('clamps position when removing the last item by index', () => {
      queue.position = 3; // current = d (last item)
      queue.removeByQueueId(ids[3]); // remove d
      expect(queue.position).toBe(2); // clamped to new last index
    });

    test('removing current item keeps position stable (next item becomes current)', () => {
      queue.removeByQueueId(ids[2]); // remove c (current)
      // position stays at 2, d slides into index 2
      expect(queue.position).toBe(2);
      expect(queue.currentItem.mediaKey).toBe('d');
    });
  });

  // ---------- 6. reorder ----------
  describe('reorder', () => {
    let ids;

    beforeEach(() => {
      const added = queue.addItems([
        { mediaKey: 'a' },
        { mediaKey: 'b' },
        { mediaKey: 'c' },
        { mediaKey: 'd' },
      ]);
      ids = added.map((i) => i.queueId);
    });

    test('moves item to a new index', () => {
      queue.position = 0; // current = a
      queue.reorder(ids[3], 1); // move d to index 1
      expect(queue.items[1].mediaKey).toBe('d');
    });

    test('keeps current item stable when reordering', () => {
      queue.position = 2; // current = c
      queue.reorder(ids[0], 3); // move a to end
      // c should still be current
      expect(queue.currentItem.mediaKey).toBe('c');
    });

    test('keeps current item stable when moving current item', () => {
      queue.position = 1; // current = b
      queue.reorder(ids[1], 3); // move b to index 3
      expect(queue.currentItem.mediaKey).toBe('b');
      expect(queue.position).toBe(3);
    });
  });

  // ---------- 7. advance ----------
  describe('advance', () => {
    beforeEach(() => {
      queue.addItems([
        { mediaKey: 'a' },
        { mediaKey: 'b' },
        { mediaKey: 'c' },
      ]);
    });

    test('advance forward by 1', () => {
      queue.position = 0;
      queue.advance(1);
      expect(queue.position).toBe(1);
    });

    test('advance backward by 1', () => {
      queue.position = 2;
      queue.advance(-1);
      expect(queue.position).toBe(1);
    });

    test('repeat-off auto at end -> position past end (currentItem null)', () => {
      queue.repeat = 'off';
      queue.position = 2; // last item
      queue.advance(1, { auto: true });
      expect(queue.position).toBe(3); // past end
      expect(queue.currentItem).toBeNull();
    });

    test('repeat-one auto -> stays at same position', () => {
      queue.repeat = 'one';
      queue.position = 1;
      queue.advance(1, { auto: true });
      expect(queue.position).toBe(1);
    });

    test('repeat-one manual -> moves forward (escapes repeat-one)', () => {
      queue.repeat = 'one';
      queue.position = 1;
      queue.advance(1); // manual (auto defaults to false)
      expect(queue.position).toBe(2);
    });

    test('repeat-all auto at end -> wraps to 0', () => {
      queue.repeat = 'all';
      queue.position = 2;
      queue.advance(1, { auto: true });
      expect(queue.position).toBe(0);
    });

    test('repeat-all backward at start -> wraps to end', () => {
      queue.repeat = 'all';
      queue.position = 0;
      queue.advance(-1, { auto: true });
      expect(queue.position).toBe(2);
    });

    test('clamp forward at end (manual, repeat off)', () => {
      queue.repeat = 'off';
      queue.position = 2;
      queue.advance(1); // manual
      expect(queue.position).toBe(3); // past end
      expect(queue.currentItem).toBeNull();
    });

    test('clamp backward at start', () => {
      queue.position = 0;
      queue.advance(-1);
      expect(queue.position).toBe(0);
    });
  });

  // ---------- 8. clear ----------
  describe('clear', () => {
    test('empties items, shuffleOrder, resets position', () => {
      queue.addItems([{ mediaKey: 'a' }, { mediaKey: 'b' }]);
      queue.position = 1;
      queue.shuffleOrder = [1, 0];
      queue.clear();
      expect(queue.items).toEqual([]);
      expect(queue.shuffleOrder).toEqual([]);
      expect(queue.position).toBe(0);
    });
  });

  // ---------- 9. shuffle ----------
  describe('shuffle', () => {
    beforeEach(() => {
      queue.addItems([
        { mediaKey: 'a' },
        { mediaKey: 'b' },
        { mediaKey: 'c' },
        { mediaKey: 'd' },
        { mediaKey: 'e' },
      ]);
    });

    test('setShuffle(true) generates shuffleOrder with current at [0]', () => {
      queue.position = 2; // current = c
      queue.setShuffle(true);

      expect(queue.shuffle).toBe(true);
      expect(queue.shuffleOrder).toHaveLength(5);
      expect(queue.shuffleOrder[0]).toBe(2); // original index of c
      expect(queue.position).toBe(0); // position resets to 0 in shuffle mode
      expect(queue.currentItem.mediaKey).toBe('c'); // still playing c
    });

    test('setShuffle(true) shuffleOrder contains all indices', () => {
      queue.position = 0;
      queue.setShuffle(true);

      const sorted = [...queue.shuffleOrder].sort((a, b) => a - b);
      expect(sorted).toEqual([0, 1, 2, 3, 4]);
    });

    test('setShuffle(false) restores original index', () => {
      queue.position = 2; // current = c (index 2)
      queue.setShuffle(true);
      // Now position=0, shuffleOrder[0]=2
      expect(queue.currentItem.mediaKey).toBe('c');

      queue.setShuffle(false);
      expect(queue.shuffle).toBe(false);
      expect(queue.position).toBe(2); // back to original index of c
      expect(queue.currentItem.mediaKey).toBe('c');
      expect(queue.shuffleOrder).toEqual([]);
    });

    test('currentItem uses shuffleOrder when shuffled', () => {
      queue.position = 0; // current = a
      queue.setShuffle(true);
      // position is now 0, shuffleOrder[0] = 0 (original index of a)
      expect(queue.currentItem.mediaKey).toBe('a');

      // Advance in shuffle mode
      queue.advance(1);
      // position is now 1, currentItem = items[shuffleOrder[1]]
      const expectedKey = queue.items[queue.shuffleOrder[1]].mediaKey;
      expect(queue.currentItem.mediaKey).toBe(expectedKey);
    });
  });

  // ---------- 10. ADDED_FROM ----------
  describe('ADDED_FROM', () => {
    test('enum has expected values', () => {
      expect(ADDED_FROM.SEARCH).toBe('SEARCH');
      expect(ADDED_FROM.URL).toBe('URL');
      expect(ADDED_FROM.CAST).toBe('CAST');
      expect(ADDED_FROM.WEBSOCKET).toBe('WEBSOCKET');
    });

    test('items can store addedFrom metadata', () => {
      const added = queue.addItems([
        { mediaKey: 'plex:123', addedFrom: ADDED_FROM.SEARCH },
      ]);
      expect(added[0].addedFrom).toBe('SEARCH');
      expect(queue.items[0].addedFrom).toBe('SEARCH');
    });
  });
});
