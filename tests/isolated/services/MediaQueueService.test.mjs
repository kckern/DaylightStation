// tests/isolated/services/MediaQueueService.test.mjs
import { jest } from '@jest/globals';
import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';

// --- Helpers ---

const mockStore = () => ({
  load: jest.fn().mockResolvedValue(null),
  save: jest.fn().mockResolvedValue(undefined),
});

const mockLogger = () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

/**
 * Build a queue with pre-stamped items for deterministic testing.
 * Returns a MediaQueue with items already added (so queueIds are set).
 */
function buildQueue(items = [], overrides = {}) {
  const queue = MediaQueue.empty();
  if (items.length > 0) {
    queue.addItems(items);
  }
  Object.assign(queue, overrides);
  return queue;
}

// Lazy import so the test file parses even before the service exists
let MediaQueueService;
beforeAll(async () => {
  const mod = await import('#apps/media/MediaQueueService.mjs');
  MediaQueueService = mod.MediaQueueService;
});

describe('MediaQueueService', () => {
  let store;
  let logger;
  let service;

  beforeEach(() => {
    store = mockStore();
    logger = mockLogger();
    service = new MediaQueueService({
      queueStore: store,
      defaultHouseholdId: 'hh-default',
      logger,
    });
  });

  // ---------- Construction ----------
  describe('constructor', () => {
    test('throws if queueStore is not provided', () => {
      expect(
        () => new MediaQueueService({ defaultHouseholdId: 'x', logger })
      ).toThrow();
    });

    test('accepts valid dependencies', () => {
      expect(service).toBeDefined();
    });
  });

  // ---------- 1. load returns empty queue when store has nothing ----------
  describe('load', () => {
    test('returns empty queue when store has nothing', async () => {
      store.load.mockResolvedValue(null);

      const queue = await service.load();

      expect(store.load).toHaveBeenCalledWith('hh-default');
      expect(queue).toBeInstanceOf(MediaQueue);
      expect(queue.isEmpty).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        'media-queue.loaded',
        expect.objectContaining({ householdId: 'hh-default' })
      );
    });

    // ---------- 2. load returns stored queue ----------
    test('returns stored queue when data exists', async () => {
      const existing = buildQueue([{ mediaKey: 'plex:1' }, { mediaKey: 'plex:2' }]);
      store.load.mockResolvedValue(existing);

      const queue = await service.load();

      expect(queue).toBeInstanceOf(MediaQueue);
      expect(queue.length).toBe(2);
      expect(queue.items[0].mediaKey).toBe('plex:1');
    });

    test('uses explicit householdId over default', async () => {
      await service.load('hh-other');
      expect(store.load).toHaveBeenCalledWith('hh-other');
    });
  });

  // ---------- 3. addItems loads, mutates, saves, returns added items with queueIds ----------
  describe('addItems', () => {
    test('loads, mutates, saves, returns added items with queueIds', async () => {
      store.load.mockResolvedValue(MediaQueue.empty());

      const newItems = [{ mediaKey: 'plex:abc' }, { mediaKey: 'plex:def' }];
      const added = await service.addItems(newItems);

      // Should have loaded from store
      expect(store.load).toHaveBeenCalledWith('hh-default');

      // Should have saved
      expect(store.save).toHaveBeenCalledWith(
        expect.any(MediaQueue),
        'hh-default'
      );

      // Returned items should have queueIds
      expect(added).toHaveLength(2);
      expect(added[0].queueId).toMatch(/^[0-9a-f]{8}$/);
      expect(added[1].queueId).toMatch(/^[0-9a-f]{8}$/);
      expect(added[0].mediaKey).toBe('plex:abc');

      // Should have logged
      expect(logger.info).toHaveBeenCalledWith(
        'media-queue.items-added',
        expect.objectContaining({ count: 2 })
      );
    });

    // ---------- 4. addItems with placement=next inserts correctly ----------
    test('with placement=next inserts after current position', async () => {
      const existing = buildQueue([{ mediaKey: 'a' }, { mediaKey: 'c' }]);
      existing.position = 0;
      store.load.mockResolvedValue(existing);

      const added = await service.addItems([{ mediaKey: 'b' }], 'next');

      // Verify the saved queue has the item in the right place
      const savedQueue = store.save.mock.calls[0][0];
      expect(savedQueue.items[1].mediaKey).toBe('b');
      expect(savedQueue.items[2].mediaKey).toBe('c');

      expect(added).toHaveLength(1);
      expect(added[0].mediaKey).toBe('b');
    });
  });

  // ---------- 5. removeItem loads, removes, saves ----------
  describe('removeItem', () => {
    test('loads, removes, saves', async () => {
      const existing = buildQueue([{ mediaKey: 'a' }, { mediaKey: 'b' }, { mediaKey: 'c' }]);
      const queueIdToRemove = existing.items[1].queueId;
      store.load.mockResolvedValue(existing);

      const queue = await service.removeItem(queueIdToRemove);

      expect(store.load).toHaveBeenCalled();
      expect(store.save).toHaveBeenCalled();
      expect(queue.length).toBe(2);
      expect(queue.items.find(i => i.queueId === queueIdToRemove)).toBeUndefined();

      expect(logger.info).toHaveBeenCalledWith(
        'media-queue.item-removed',
        expect.objectContaining({ queueId: queueIdToRemove })
      );
    });
  });

  // ---------- 6. setPosition updates and saves ----------
  describe('setPosition', () => {
    test('updates position and saves', async () => {
      const existing = buildQueue([{ mediaKey: 'a' }, { mediaKey: 'b' }, { mediaKey: 'c' }]);
      store.load.mockResolvedValue(existing);

      const queue = await service.setPosition(2);

      expect(store.save).toHaveBeenCalled();
      expect(queue.position).toBe(2);
      expect(logger.info).toHaveBeenCalledWith(
        'media-queue.position-changed',
        expect.objectContaining({ position: 2 })
      );
    });
  });

  // ---------- 7. updateState updates shuffle/repeat/volume ----------
  describe('updateState', () => {
    test('updates shuffle/repeat/volume', async () => {
      const existing = buildQueue([{ mediaKey: 'a' }, { mediaKey: 'b' }]);
      store.load.mockResolvedValue(existing);

      const queue = await service.updateState({
        repeat: 'all',
        volume: 0.5,
      });

      expect(store.save).toHaveBeenCalled();
      expect(queue.repeat).toBe('all');
      expect(queue.volume).toBe(0.5);
      expect(logger.info).toHaveBeenCalledWith(
        'media-queue.state-updated',
        expect.any(Object)
      );
    });

    test('applies shuffle via setShuffle when shuffle is in state', async () => {
      const existing = buildQueue([{ mediaKey: 'a' }, { mediaKey: 'b' }, { mediaKey: 'c' }]);
      store.load.mockResolvedValue(existing);

      const queue = await service.updateState({ shuffle: true });

      expect(queue.shuffle).toBe(true);
      expect(queue.shuffleOrder).toHaveLength(3);
      expect(store.save).toHaveBeenCalled();
    });
  });

  // ---------- 8. clear empties and saves ----------
  describe('clear', () => {
    test('empties queue and saves', async () => {
      const existing = buildQueue([{ mediaKey: 'a' }, { mediaKey: 'b' }]);
      existing.position = 1;
      store.load.mockResolvedValue(existing);

      const queue = await service.clear();

      expect(store.save).toHaveBeenCalled();
      expect(queue.isEmpty).toBe(true);
      expect(queue.position).toBe(0);
      expect(logger.info).toHaveBeenCalledWith(
        'media-queue.cleared',
        expect.any(Object)
      );
    });
  });

  // ---------- 9. replace replaces entire queue ----------
  describe('replace', () => {
    test('replaces entire queue and saves', async () => {
      const newQueue = buildQueue([{ mediaKey: 'x' }, { mediaKey: 'y' }]);

      const result = await service.replace(newQueue);

      // Should save without loading first
      expect(store.save).toHaveBeenCalledWith(newQueue, 'hh-default');
      expect(logger.info).toHaveBeenCalledWith(
        'media-queue.saved',
        expect.any(Object)
      );
    });
  });

  // ---------- reorder ----------
  describe('reorder', () => {
    test('loads, reorders, saves', async () => {
      const existing = buildQueue([
        { mediaKey: 'a' },
        { mediaKey: 'b' },
        { mediaKey: 'c' },
      ]);
      const queueId = existing.items[2].queueId; // 'c'
      store.load.mockResolvedValue(existing);

      const queue = await service.reorder(queueId, 0);

      expect(store.save).toHaveBeenCalled();
      expect(queue.items[0].mediaKey).toBe('c');
      expect(logger.info).toHaveBeenCalledWith(
        'media-queue.reordered',
        expect.objectContaining({ queueId, toIndex: 0 })
      );
    });
  });

  // ---------- advance ----------
  describe('advance', () => {
    test('loads, advances, saves', async () => {
      const existing = buildQueue([
        { mediaKey: 'a' },
        { mediaKey: 'b' },
        { mediaKey: 'c' },
      ]);
      existing.position = 0;
      store.load.mockResolvedValue(existing);

      const queue = await service.advance(1, { auto: false });

      expect(store.save).toHaveBeenCalled();
      expect(queue.position).toBe(1);
      expect(logger.info).toHaveBeenCalledWith(
        'media-queue.advanced',
        expect.objectContaining({ step: 1 })
      );
    });

    test('defaults to step=1 and auto=false', async () => {
      const existing = buildQueue([{ mediaKey: 'a' }, { mediaKey: 'b' }]);
      existing.position = 0;
      store.load.mockResolvedValue(existing);

      const queue = await service.advance();

      expect(queue.position).toBe(1);
    });
  });
});
