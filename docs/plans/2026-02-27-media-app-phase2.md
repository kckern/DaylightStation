# MediaApp Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** PlexAmp-style queue management with YAML persistence, content search with source filters, and external triggers via WebSocket commands.

**Architecture:** Backend DDD stack (entity → port → YAML adapter → service → Express router) with WebSocket broadcast after every mutation. Frontend React hook (`useMediaQueue`) with optimistic updates, WebSocket sync, and self-echo suppression. Content search via existing SSE streaming infrastructure.

**Tech Stack:** Express, `ws` WebSocket, YAML persistence (FileIO.mjs), React hooks, Mantine notifications, SSE streaming search

**Requirements covered:** 0.1.1–0.1.4, 0.2.1–0.2.6, 0.3.1, 0.4.1–0.4.2, 0.5.1, 0.6.1, 0.7.1, 0.8.1–0.8.2, 1.2.2, 2.1.1–2.1.15, 2.2.1–2.2.6, 3.1.1–3.1.13, 3.2.1–3.2.3, 6.1.1–6.1.13, 6.2.1–6.2.2, 7.1.1–7.1.11

---

## Context for Implementer

### Import Aliases (from root package.json)

```
#system/*    → backend/src/0_system/*
#domains/*   → backend/src/2_domains/*
#adapters/*  → backend/src/1_adapters/*
#apps/*      → backend/src/3_applications/*
#api/*       → backend/src/4_api/*
#frontend/*  → frontend/src/*
```

### Key Patterns

- **Entities**: Constructor with destructured defaults, `toJSON()` / `static fromJSON()` / `static empty()`, mutable methods
- **Ports**: Abstract class with methods that throw `'must be implemented'`
- **YAML Adapters**: Extend port, use `loadYamlSafe()` / `saveYaml()` from `#system/utils/FileIO.mjs`
- **Services**: Constructor injection with `#private` fields, async methods, structured logging
- **Routers**: Factory `createXxxRouter(config)` → `express.Router()`, wrap all async handlers with `asyncHandler()`
- **Error mapping**: `DomainInvariantError` → 422, `EntityNotFoundError` → 404, `ValidationError` → 400 (handled by `errorHandlerMiddleware`)
- **Tests**: Jest with `import { describe, test, expect } from '@jest/globals'`

---

## Task 1: MediaQueue Entity + QueueFullError

**Requirements:** 0.2.1–0.2.6, 0.3.1, 0.7.1

**Files:**
- Create: `backend/src/2_domains/media/entities/MediaQueue.mjs`
- Modify: `backend/src/2_domains/media/errors.mjs`
- Test: `tests/isolated/domain/media/MediaQueue.test.mjs`

### Step 1: Write failing tests

```javascript
// tests/isolated/domain/media/MediaQueue.test.mjs
import { describe, test, expect, beforeEach } from '@jest/globals';
import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';
import { QueueFullError } from '#domains/media/errors.mjs';

describe('MediaQueue', () => {
  let queue;

  beforeEach(() => {
    queue = MediaQueue.empty();
  });

  describe('construction', () => {
    test('empty() creates queue with defaults', () => {
      expect(queue.position).toBe(0);
      expect(queue.shuffle).toBe(false);
      expect(queue.repeat).toBe('off');
      expect(queue.volume).toBe(1.0);
      expect(queue.items).toEqual([]);
      expect(queue.shuffleOrder).toEqual([]);
    });

    test('constructor accepts initial state', () => {
      const q = new MediaQueue({
        position: 2,
        shuffle: true,
        repeat: 'all',
        volume: 0.5,
        items: [{ contentId: 'plex:1', title: 'A' }],
        shuffleOrder: [0],
      });
      expect(q.position).toBe(2);
      expect(q.repeat).toBe('all');
    });
  });

  describe('serialization', () => {
    test('toJSON roundtrips through fromJSON', () => {
      queue.addItems([
        { contentId: 'plex:1', title: 'Song A' },
        { contentId: 'hymn:198', title: 'Song B' },
      ]);
      const json = queue.toJSON();
      const restored = MediaQueue.fromJSON(json);
      expect(restored.items.length).toBe(2);
      expect(restored.items[0].contentId).toBe('plex:1');
      expect(restored.items[0].queueId).toBe(queue.items[0].queueId);
    });
  });

  describe('accessors', () => {
    test('currentItem returns null when empty', () => {
      expect(queue.currentItem).toBeNull();
    });

    test('currentItem returns item at position', () => {
      queue.addItems([{ contentId: 'plex:1' }, { contentId: 'plex:2' }]);
      expect(queue.currentItem.contentId).toBe('plex:1');
      queue.position = 1;
      expect(queue.currentItem.contentId).toBe('plex:2');
    });

    test('isEmpty / length', () => {
      expect(queue.isEmpty).toBe(true);
      expect(queue.length).toBe(0);
      queue.addItems([{ contentId: 'plex:1' }]);
      expect(queue.isEmpty).toBe(false);
      expect(queue.length).toBe(1);
    });

    test('findByQueueId returns item or null', () => {
      queue.addItems([{ contentId: 'plex:1' }]);
      const id = queue.items[0].queueId;
      expect(queue.findByQueueId(id).contentId).toBe('plex:1');
      expect(queue.findByQueueId('nonexistent')).toBeNull();
    });
  });

  describe('addItems', () => {
    test('appends to end by default', () => {
      queue.addItems([{ contentId: 'plex:1' }]);
      queue.addItems([{ contentId: 'plex:2' }]);
      expect(queue.items.map(i => i.contentId)).toEqual(['plex:1', 'plex:2']);
    });

    test('inserts after current with placement=next', () => {
      queue.addItems([{ contentId: 'plex:1' }, { contentId: 'plex:3' }]);
      queue.addItems([{ contentId: 'plex:2' }], 'next');
      expect(queue.items.map(i => i.contentId)).toEqual(['plex:1', 'plex:2', 'plex:3']);
    });

    test('assigns 8-char hex queueId to each item', () => {
      queue.addItems([{ contentId: 'plex:1' }]);
      expect(queue.items[0].queueId).toMatch(/^[0-9a-f]{8}$/);
    });

    test('throws QueueFullError at 500 items', () => {
      const items = Array.from({ length: 500 }, (_, i) => ({ contentId: `plex:${i}` }));
      queue.addItems(items);
      expect(() => queue.addItems([{ contentId: 'plex:overflow' }])).toThrow(QueueFullError);
    });

    test('returns the newly added items with queueIds', () => {
      const added = queue.addItems([{ contentId: 'plex:1' }, { contentId: 'plex:2' }]);
      expect(added).toHaveLength(2);
      expect(added[0].queueId).toBeDefined();
    });
  });

  describe('removeByQueueId', () => {
    test('removes item and adjusts position if before current', () => {
      queue.addItems([{ contentId: 'a' }, { contentId: 'b' }, { contentId: 'c' }]);
      queue.position = 2;
      const idToRemove = queue.items[0].queueId;
      queue.removeByQueueId(idToRemove);
      expect(queue.items).toHaveLength(2);
      expect(queue.position).toBe(1); // adjusted
      expect(queue.currentItem.contentId).toBe('c');
    });

    test('does not adjust position if after current', () => {
      queue.addItems([{ contentId: 'a' }, { contentId: 'b' }, { contentId: 'c' }]);
      queue.position = 0;
      queue.removeByQueueId(queue.items[2].queueId);
      expect(queue.position).toBe(0);
    });

    test('clamps position when removing last item at end', () => {
      queue.addItems([{ contentId: 'a' }, { contentId: 'b' }]);
      queue.position = 1;
      queue.removeByQueueId(queue.items[1].queueId);
      expect(queue.position).toBe(0);
    });
  });

  describe('reorder', () => {
    test('moves item to new index', () => {
      queue.addItems([{ contentId: 'a' }, { contentId: 'b' }, { contentId: 'c' }]);
      const id = queue.items[2].queueId; // 'c'
      queue.reorder(id, 0);
      expect(queue.items.map(i => i.contentId)).toEqual(['c', 'a', 'b']);
    });

    test('adjusts position to keep current item stable', () => {
      queue.addItems([{ contentId: 'a' }, { contentId: 'b' }, { contentId: 'c' }]);
      queue.position = 1; // currently 'b'
      queue.reorder(queue.items[2].queueId, 0); // move 'c' to front
      expect(queue.currentItem.contentId).toBe('b');
    });
  });

  describe('advance', () => {
    beforeEach(() => {
      queue.addItems([{ contentId: 'a' }, { contentId: 'b' }, { contentId: 'c' }]);
    });

    test('moves forward by step', () => {
      queue.advance(1);
      expect(queue.position).toBe(1);
    });

    test('moves backward', () => {
      queue.position = 2;
      queue.advance(-1);
      expect(queue.position).toBe(1);
    });

    test('repeat off + auto at end → currentItem null', () => {
      queue.position = 2;
      queue.advance(1, { auto: true });
      expect(queue.currentItem).toBeNull();
    });

    test('repeat one + auto → stays on same', () => {
      queue.repeat = 'one';
      queue.position = 1;
      queue.advance(1, { auto: true });
      expect(queue.position).toBe(1);
    });

    test('repeat one + manual → moves normally', () => {
      queue.repeat = 'one';
      queue.position = 1;
      queue.advance(1);
      expect(queue.position).toBe(2);
    });

    test('repeat all + auto at end → wraps to 0', () => {
      queue.repeat = 'all';
      queue.position = 2;
      queue.advance(1, { auto: true });
      expect(queue.position).toBe(0);
    });

    test('repeat all + backward at start → wraps to end', () => {
      queue.repeat = 'all';
      queue.position = 0;
      queue.advance(-1);
      expect(queue.position).toBe(2);
    });

    test('clamps forward at end with repeat off (manual)', () => {
      queue.position = 2;
      queue.advance(1);
      expect(queue.position).toBe(3); // past end
      expect(queue.currentItem).toBeNull();
    });

    test('clamps backward at start with repeat off', () => {
      queue.position = 0;
      queue.advance(-1);
      expect(queue.position).toBe(0);
    });
  });

  describe('clear', () => {
    test('empties everything', () => {
      queue.addItems([{ contentId: 'a' }]);
      queue.clear();
      expect(queue.items).toEqual([]);
      expect(queue.position).toBe(0);
      expect(queue.shuffleOrder).toEqual([]);
    });
  });

  describe('shuffle', () => {
    test('setShuffle(true) generates shuffleOrder with current at [0]', () => {
      queue.addItems([{ contentId: 'a' }, { contentId: 'b' }, { contentId: 'c' }]);
      queue.position = 1; // 'b' is current
      queue.setShuffle(true);
      expect(queue.shuffle).toBe(true);
      expect(queue.shuffleOrder).toHaveLength(3);
      expect(queue.shuffleOrder[0]).toBe(1); // current item's original index at [0]
      expect(queue.position).toBe(0); // position now indexes shuffleOrder
      expect(queue.currentItem.contentId).toBe('b');
    });

    test('setShuffle(false) restores original index', () => {
      queue.addItems([{ contentId: 'a' }, { contentId: 'b' }, { contentId: 'c' }]);
      queue.position = 1;
      queue.setShuffle(true);
      queue.setShuffle(false);
      expect(queue.shuffle).toBe(false);
      expect(queue.position).toBe(1); // back to original index of 'b'
      expect(queue.currentItem.contentId).toBe('b');
    });

    test('currentItem uses shuffleOrder when shuffled', () => {
      queue.addItems([{ contentId: 'a' }, { contentId: 'b' }, { contentId: 'c' }]);
      queue.setShuffle(true);
      // After shuffle, position=0, shuffleOrder[0]=0 (current was 'a')
      expect(queue.currentItem.contentId).toBe('a');
    });
  });

  describe('ADDED_FROM constants', () => {
    test('items can store addedFrom metadata', () => {
      queue.addItems([{ contentId: 'plex:1', addedFrom: 'SEARCH' }]);
      expect(queue.items[0].addedFrom).toBe('SEARCH');
    });
  });
});
```

### Step 2: Run tests to verify failure

```bash
npx jest tests/isolated/domain/media/MediaQueue.test.mjs --no-coverage
```

Expected: FAIL — `Cannot find module '#domains/media/entities/MediaQueue.mjs'`

### Step 3: Add QueueFullError to existing errors file

```javascript
// backend/src/2_domains/media/errors.mjs — ADD to existing file
import { DomainInvariantError } from '#domains/core/errors/index.mjs';

export class QueueFullError extends DomainInvariantError {
  constructor(currentSize, maxSize = 500) {
    super(`Queue is full (${currentSize}/${maxSize} items)`, {
      code: 'QUEUE_FULL',
      details: { currentSize, maxSize },
    });
    this.name = 'QueueFullError';
  }
}
```

### Step 4: Implement MediaQueue entity

```javascript
// backend/src/2_domains/media/entities/MediaQueue.mjs
import { randomBytes } from 'crypto';
import { QueueFullError } from '#domains/media/errors.mjs';

const MAX_QUEUE_SIZE = 500;
const randomHex = () => randomBytes(4).toString('hex');

export const ADDED_FROM = Object.freeze({
  SEARCH: 'SEARCH',
  URL: 'URL',
  CAST: 'CAST',
  WEBSOCKET: 'WEBSOCKET',
});

export class MediaQueue {
  constructor({
    position = 0,
    shuffle = false,
    repeat = 'off',
    volume = 1.0,
    items = [],
    shuffleOrder = [],
  } = {}) {
    this.position = position;
    this.shuffle = shuffle;
    this.repeat = repeat;
    this.volume = volume;
    this.items = items;
    this.shuffleOrder = shuffleOrder;
  }

  get currentItem() {
    if (this.items.length === 0) return null;
    const idx = this.shuffle && this.shuffleOrder.length > 0
      ? this.shuffleOrder[this.position]
      : this.position;
    return idx >= 0 && idx < this.items.length ? this.items[idx] : null;
  }

  get isEmpty() { return this.items.length === 0; }
  get length() { return this.items.length; }

  findByQueueId(queueId) {
    return this.items.find(i => i.queueId === queueId) || null;
  }

  addItems(newItems, placement = 'end') {
    if (this.items.length + newItems.length > MAX_QUEUE_SIZE) {
      throw new QueueFullError(this.items.length + newItems.length, MAX_QUEUE_SIZE);
    }
    const stamped = newItems.map(item => ({
      ...item,
      queueId: item.queueId || randomHex(),
    }));
    if (placement === 'next') {
      const insertAt = this.position + 1;
      this.items.splice(insertAt, 0, ...stamped);
      // Update shuffleOrder if active
      if (this.shuffle && this.shuffleOrder.length > 0) {
        // Adjust existing indices >= insertAt
        this.shuffleOrder = this.shuffleOrder.map(
          idx => idx >= insertAt ? idx + stamped.length : idx
        );
        // Append new indices after current position in shuffle
        const newIndices = stamped.map((_, i) => insertAt + i);
        this.shuffleOrder.splice(this.position + 1, 0, ...newIndices);
      }
    } else {
      const startIdx = this.items.length;
      this.items.push(...stamped);
      if (this.shuffle && this.shuffleOrder.length > 0) {
        const newIndices = stamped.map((_, i) => startIdx + i);
        // Insert randomly after current position
        for (const idx of newIndices) {
          const insertPos = 1 + Math.floor(Math.random() * (this.shuffleOrder.length));
          this.shuffleOrder.splice(insertPos, 0, idx);
        }
      }
    }
    return stamped;
  }

  removeByQueueId(queueId) {
    const idx = this.items.findIndex(i => i.queueId === queueId);
    if (idx === -1) return;
    this.items.splice(idx, 1);

    if (this.shuffle && this.shuffleOrder.length > 0) {
      const shuffleIdx = this.shuffleOrder.indexOf(idx);
      if (shuffleIdx !== -1) this.shuffleOrder.splice(shuffleIdx, 1);
      this.shuffleOrder = this.shuffleOrder.map(i => i > idx ? i - 1 : i);
      if (shuffleIdx < this.position && this.position > 0) this.position--;
    } else {
      if (idx < this.position) this.position--;
    }

    if (this.position >= this.items.length && this.items.length > 0) {
      this.position = this.items.length - 1;
    }
    if (this.items.length === 0) this.position = 0;
  }

  reorder(queueId, toIndex) {
    const fromIndex = this.items.findIndex(i => i.queueId === queueId);
    if (fromIndex === -1) return;
    toIndex = Math.max(0, Math.min(toIndex, this.items.length - 1));
    if (fromIndex === toIndex) return;

    const currentQueueId = this.currentItem?.queueId;
    const [item] = this.items.splice(fromIndex, 1);
    this.items.splice(toIndex, 0, item);

    // Restore position to keep current item stable
    if (currentQueueId) {
      const newCurrentIdx = this.items.findIndex(i => i.queueId === currentQueueId);
      if (newCurrentIdx !== -1) this.position = newCurrentIdx;
    }
  }

  advance(step = 1, { auto = false } = {}) {
    if (this.items.length === 0) return;
    if (auto && this.repeat === 'one') return; // replay same

    const effectiveLength = this.shuffle && this.shuffleOrder.length > 0
      ? this.shuffleOrder.length
      : this.items.length;
    const newPos = this.position + step;

    if (newPos >= effectiveLength) {
      this.position = this.repeat === 'all' ? 0 : effectiveLength;
    } else if (newPos < 0) {
      this.position = this.repeat === 'all' ? effectiveLength - 1 : 0;
    } else {
      this.position = newPos;
    }
  }

  clear() {
    this.items = [];
    this.shuffleOrder = [];
    this.position = 0;
  }

  setShuffle(enabled) {
    if (enabled && !this.shuffle) {
      const currentOriginalIdx = this.position;
      // Fisher-Yates with current item pinned at [0]
      const indices = Array.from({ length: this.items.length }, (_, i) => i);
      indices.splice(currentOriginalIdx, 1);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      this.shuffleOrder = [currentOriginalIdx, ...indices];
      this.position = 0;
    } else if (!enabled && this.shuffle) {
      const originalIdx = this.shuffleOrder[this.position] ?? 0;
      this.position = originalIdx;
      this.shuffleOrder = [];
    }
    this.shuffle = enabled;
  }

  toJSON() {
    return {
      position: this.position,
      shuffle: this.shuffle,
      repeat: this.repeat,
      volume: this.volume,
      items: this.items,
      shuffleOrder: this.shuffleOrder,
    };
  }

  static fromJSON(data) {
    return new MediaQueue(data);
  }

  static empty() {
    return new MediaQueue();
  }
}
```

### Step 5: Run tests to verify pass

```bash
npx jest tests/isolated/domain/media/MediaQueue.test.mjs --no-coverage
```

Expected: All tests PASS

### Step 6: Commit

```bash
git add backend/src/2_domains/media/entities/MediaQueue.mjs backend/src/2_domains/media/errors.mjs tests/isolated/domain/media/MediaQueue.test.mjs
git commit -m "feat(media): 0.2.1-0.2.6, 0.3.1, 0.7.1 add MediaQueue entity with queue manipulation"
```

---

## Task 2: Persistence Layer (Port + YAML Adapter)

**Requirements:** 0.4.1, 0.4.2

**Files:**
- Create: `backend/src/3_applications/media/ports/IMediaQueueDatastore.mjs`
- Create: `backend/src/1_adapters/persistence/yaml/YamlMediaQueueDatastore.mjs`
- Test: `tests/isolated/adapters/YamlMediaQueueDatastore.test.mjs`

### Step 1: Write port interface

```javascript
// backend/src/3_applications/media/ports/IMediaQueueDatastore.mjs
export class IMediaQueueDatastore {
  async load(householdId) {
    throw new Error('IMediaQueueDatastore.load must be implemented');
  }
  async save(mediaQueue, householdId) {
    throw new Error('IMediaQueueDatastore.save must be implemented');
  }
}
```

### Step 2: Write failing adapter tests

```javascript
// tests/isolated/adapters/YamlMediaQueueDatastore.test.mjs
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { YamlMediaQueueDatastore } from '#adapters/persistence/yaml/YamlMediaQueueDatastore.mjs';
import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('YamlMediaQueueDatastore', () => {
  let tmpDir;
  let store;
  const hid = 'test-household';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-queue-'));
    const mockConfigService = {
      getHouseholdPath: (subpath, householdId) =>
        path.join(tmpDir, householdId || 'default', subpath),
    };
    store = new YamlMediaQueueDatastore({ configService: mockConfigService });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('load returns null when no queue file exists', async () => {
    const result = await store.load(hid);
    expect(result).toBeNull();
  });

  test('save then load roundtrips a queue', async () => {
    const queue = MediaQueue.empty();
    queue.addItems([{ contentId: 'plex:1', title: 'Song' }]);
    await store.save(queue, hid);

    const loaded = await store.load(hid);
    expect(loaded).toBeInstanceOf(MediaQueue);
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0].contentId).toBe('plex:1');
  });

  test('save overwrites previous queue', async () => {
    const q1 = MediaQueue.empty();
    q1.addItems([{ contentId: 'plex:1' }]);
    await store.save(q1, hid);

    const q2 = MediaQueue.empty();
    q2.addItems([{ contentId: 'plex:2' }, { contentId: 'plex:3' }]);
    await store.save(q2, hid);

    const loaded = await store.load(hid);
    expect(loaded.items).toHaveLength(2);
    expect(loaded.items[0].contentId).toBe('plex:2');
  });
});
```

### Step 3: Run tests to verify failure

```bash
npx jest tests/isolated/adapters/YamlMediaQueueDatastore.test.mjs --no-coverage
```

### Step 4: Implement adapter

```javascript
// backend/src/1_adapters/persistence/yaml/YamlMediaQueueDatastore.mjs
import path from 'path';
import { IMediaQueueDatastore } from '#apps/media/ports/IMediaQueueDatastore.mjs';
import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';

export class YamlMediaQueueDatastore extends IMediaQueueDatastore {
  #configService;

  constructor({ configService }) {
    super();
    if (!configService) throw new Error('YamlMediaQueueDatastore requires configService');
    this.#configService = configService;
  }

  #queueDir(householdId) {
    return this.#configService.getHouseholdPath('apps/media', householdId);
  }

  async load(householdId) {
    const dir = this.#queueDir(householdId);
    const data = loadYamlSafe(path.join(dir, 'queue'));
    if (!data) return null;
    return MediaQueue.fromJSON(data);
  }

  async save(mediaQueue, householdId) {
    const dir = this.#queueDir(householdId);
    ensureDir(dir);
    const data = typeof mediaQueue.toJSON === 'function' ? mediaQueue.toJSON() : mediaQueue;
    saveYaml(path.join(dir, 'queue'), data);
  }
}
```

### Step 5: Run tests to verify pass

```bash
npx jest tests/isolated/adapters/YamlMediaQueueDatastore.test.mjs --no-coverage
```

### Step 6: Commit

```bash
git add backend/src/3_applications/media/ports/IMediaQueueDatastore.mjs backend/src/1_adapters/persistence/yaml/YamlMediaQueueDatastore.mjs tests/isolated/adapters/YamlMediaQueueDatastore.test.mjs
git commit -m "feat(media): 0.4.1, 0.4.2 add IMediaQueueDatastore port and YAML adapter"
```

---

## Task 3: MediaQueueService

**Requirements:** 0.5.1, 0.8.1

**Files:**
- Create: `backend/src/3_applications/media/MediaQueueService.mjs`
- Test: `tests/isolated/services/MediaQueueService.test.mjs`

### Step 1: Write failing tests

```javascript
// tests/isolated/services/MediaQueueService.test.mjs
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { MediaQueueService } from '#apps/media/MediaQueueService.mjs';
import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';

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

describe('MediaQueueService', () => {
  let service;
  let store;
  let logger;

  beforeEach(() => {
    store = mockStore();
    logger = mockLogger();
    service = new MediaQueueService({
      queueStore: store,
      defaultHouseholdId: 'default',
      logger,
    });
  });

  test('load returns empty queue when store has nothing', async () => {
    const queue = await service.load();
    expect(queue).toBeInstanceOf(MediaQueue);
    expect(queue.isEmpty).toBe(true);
    expect(store.load).toHaveBeenCalledWith('default');
  });

  test('load returns stored queue', async () => {
    const existing = MediaQueue.empty();
    existing.addItems([{ contentId: 'plex:1' }]);
    store.load.mockResolvedValue(existing);
    const queue = await service.load();
    expect(queue.length).toBe(1);
  });

  test('addItems loads, mutates, saves, returns added', async () => {
    const result = await service.addItems([{ contentId: 'plex:1' }]);
    expect(result).toHaveLength(1);
    expect(result[0].queueId).toBeDefined();
    expect(store.save).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('media-queue.items-added', expect.any(Object));
  });

  test('addItems with placement=next', async () => {
    const existing = MediaQueue.empty();
    existing.addItems([{ contentId: 'a' }, { contentId: 'c' }]);
    store.load.mockResolvedValue(existing);
    await service.addItems([{ contentId: 'b' }], 'next');
    const savedQueue = store.save.mock.calls[0][0];
    expect(savedQueue.items[1].contentId).toBe('b');
  });

  test('removeItem loads, removes, saves', async () => {
    const existing = MediaQueue.empty();
    existing.addItems([{ contentId: 'a' }]);
    const queueId = existing.items[0].queueId;
    store.load.mockResolvedValue(existing);
    await service.removeItem(queueId);
    const savedQueue = store.save.mock.calls[0][0];
    expect(savedQueue.items).toHaveLength(0);
  });

  test('setPosition updates position and saves', async () => {
    const existing = MediaQueue.empty();
    existing.addItems([{ contentId: 'a' }, { contentId: 'b' }]);
    store.load.mockResolvedValue(existing);
    await service.setPosition(1);
    const saved = store.save.mock.calls[0][0];
    expect(saved.position).toBe(1);
  });

  test('updateState updates shuffle/repeat/volume', async () => {
    await service.updateState({ shuffle: true, repeat: 'all', volume: 0.5 });
    const saved = store.save.mock.calls[0][0];
    expect(saved.repeat).toBe('all');
    expect(saved.volume).toBe(0.5);
  });

  test('clear empties queue and saves', async () => {
    const existing = MediaQueue.empty();
    existing.addItems([{ contentId: 'a' }]);
    store.load.mockResolvedValue(existing);
    await service.clear();
    const saved = store.save.mock.calls[0][0];
    expect(saved.items).toHaveLength(0);
  });

  test('replace replaces entire queue and saves', async () => {
    const newQueue = MediaQueue.empty();
    newQueue.addItems([{ contentId: 'x' }]);
    await service.replace(newQueue);
    expect(store.save).toHaveBeenCalledWith(newQueue, 'default');
  });
});
```

### Step 2: Run to verify failure

```bash
npx jest tests/isolated/services/MediaQueueService.test.mjs --no-coverage
```

### Step 3: Implement

```javascript
// backend/src/3_applications/media/MediaQueueService.mjs
import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';

export class MediaQueueService {
  #queueStore;
  #defaultHouseholdId;
  #logger;

  constructor({ queueStore, defaultHouseholdId, logger = console }) {
    if (!queueStore) throw new Error('MediaQueueService requires queueStore');
    this.#queueStore = queueStore;
    this.#defaultHouseholdId = defaultHouseholdId;
    this.#logger = logger;
  }

  #hid(householdId) {
    return householdId || this.#defaultHouseholdId;
  }

  async load(householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.#queueStore.load(hid);
    this.#logger.info?.('media-queue.loaded', { hid, items: queue?.length ?? 0 });
    return queue || MediaQueue.empty();
  }

  async replace(queue, householdId) {
    const hid = this.#hid(householdId);
    await this.#queueStore.save(queue, hid);
    this.#logger.info?.('media-queue.saved', { hid, items: queue.length });
    return queue;
  }

  async addItems(items, placement = 'end', householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.#queueStore.load(hid) || MediaQueue.empty();
    const added = queue.addItems(items, placement);
    await this.#queueStore.save(queue, hid);
    this.#logger.info?.('media-queue.items-added', { hid, count: added.length, placement });
    return added;
  }

  async removeItem(queueId, householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.#queueStore.load(hid) || MediaQueue.empty();
    queue.removeByQueueId(queueId);
    await this.#queueStore.save(queue, hid);
    this.#logger.info?.('media-queue.item-removed', { hid, queueId });
    return queue;
  }

  async reorder(queueId, toIndex, householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.#queueStore.load(hid) || MediaQueue.empty();
    queue.reorder(queueId, toIndex);
    await this.#queueStore.save(queue, hid);
    this.#logger.info?.('media-queue.reordered', { hid, queueId, toIndex });
    return queue;
  }

  async setPosition(position, householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.#queueStore.load(hid) || MediaQueue.empty();
    queue.position = position;
    await this.#queueStore.save(queue, hid);
    this.#logger.info?.('media-queue.position-changed', { hid, position });
    return queue;
  }

  async updateState(state, householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.#queueStore.load(hid) || MediaQueue.empty();
    if (state.shuffle !== undefined) queue.setShuffle(state.shuffle);
    if (state.repeat !== undefined) queue.repeat = state.repeat;
    if (state.volume !== undefined) queue.volume = state.volume;
    await this.#queueStore.save(queue, hid);
    this.#logger.info?.('media-queue.state-updated', { hid, ...state });
    return queue;
  }

  async clear(householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.#queueStore.load(hid) || MediaQueue.empty();
    queue.clear();
    await this.#queueStore.save(queue, hid);
    this.#logger.info?.('media-queue.cleared', { hid });
    return queue;
  }

  async advance(step = 1, { auto = false } = {}, householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.#queueStore.load(hid) || MediaQueue.empty();
    queue.advance(step, { auto });
    await this.#queueStore.save(queue, hid);
    this.#logger.info?.('media-queue.advanced', { hid, step, auto, position: queue.position });
    return queue;
  }
}
```

### Step 4: Run tests to verify pass

```bash
npx jest tests/isolated/services/MediaQueueService.test.mjs --no-coverage
```

### Step 5: Commit

```bash
git add backend/src/3_applications/media/MediaQueueService.mjs tests/isolated/services/MediaQueueService.test.mjs
git commit -m "feat(media): 0.5.1, 0.8.1 add MediaQueueService with structured logging"
```

---

## Task 4: Media Queue Router

**Requirements:** 0.6.1

**Files:**
- Create: `backend/src/4_api/v1/routers/media.mjs`
- Test: `tests/isolated/api/mediaRouter.test.mjs`

### Step 1: Write failing tests

```javascript
// tests/isolated/api/mediaRouter.test.mjs
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createMediaRouter } from '#api/v1/routers/media.mjs';
import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';

const mockService = () => ({
  load: jest.fn().mockResolvedValue(MediaQueue.empty()),
  replace: jest.fn().mockImplementation(q => Promise.resolve(q)),
  addItems: jest.fn().mockResolvedValue([{ contentId: 'plex:1', queueId: 'abc12345' }]),
  removeItem: jest.fn().mockResolvedValue(MediaQueue.empty()),
  reorder: jest.fn().mockResolvedValue(MediaQueue.empty()),
  setPosition: jest.fn().mockResolvedValue(MediaQueue.empty()),
  updateState: jest.fn().mockResolvedValue(MediaQueue.empty()),
  clear: jest.fn().mockResolvedValue(MediaQueue.empty()),
});

function createApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  const service = overrides.mediaQueueService || mockService();
  const router = createMediaRouter({
    mediaQueueService: service,
    contentIdResolver: { resolve: jest.fn().mockReturnValue({ source: 'plex', localId: '1' }) },
    broadcastEvent: overrides.broadcastEvent || jest.fn(),
    logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
  app.use('/media', router);
  return { app, service };
}

describe('Media Queue Router', () => {
  test('GET /media/queue returns queue JSON', async () => {
    const { app } = createApp();
    const res = await request(app).get('/media/queue');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('position');
  });

  test('POST /media/queue/items adds items', async () => {
    const { app, service } = createApp();
    const res = await request(app)
      .post('/media/queue/items')
      .send({ items: [{ contentId: 'plex:1' }] });
    expect(res.status).toBe(200);
    expect(service.addItems).toHaveBeenCalled();
  });

  test('POST /media/queue/items with placement=next', async () => {
    const { app, service } = createApp();
    await request(app)
      .post('/media/queue/items')
      .send({ items: [{ contentId: 'plex:1' }], placement: 'next' });
    expect(service.addItems).toHaveBeenCalledWith(
      expect.any(Array), 'next', expect.anything()
    );
  });

  test('DELETE /media/queue/items/:queueId removes item', async () => {
    const { app, service } = createApp();
    const res = await request(app).delete('/media/queue/items/abc12345');
    expect(res.status).toBe(200);
    expect(service.removeItem).toHaveBeenCalledWith('abc12345', expect.anything());
  });

  test('PATCH /media/queue/items/reorder reorders item', async () => {
    const { app, service } = createApp();
    const res = await request(app)
      .patch('/media/queue/items/reorder')
      .send({ queueId: 'abc', toIndex: 2 });
    expect(res.status).toBe(200);
    expect(service.reorder).toHaveBeenCalledWith('abc', 2, expect.anything());
  });

  test('PATCH /media/queue/position sets position', async () => {
    const { app, service } = createApp();
    const res = await request(app)
      .patch('/media/queue/position')
      .send({ position: 3 });
    expect(res.status).toBe(200);
    expect(service.setPosition).toHaveBeenCalledWith(3, expect.anything());
  });

  test('PATCH /media/queue/state updates state', async () => {
    const { app, service } = createApp();
    const res = await request(app)
      .patch('/media/queue/state')
      .send({ shuffle: true, repeat: 'all' });
    expect(res.status).toBe(200);
    expect(service.updateState).toHaveBeenCalledWith(
      { shuffle: true, repeat: 'all' }, expect.anything()
    );
  });

  test('DELETE /media/queue clears queue', async () => {
    const { app, service } = createApp();
    const res = await request(app).delete('/media/queue');
    expect(res.status).toBe(200);
    expect(service.clear).toHaveBeenCalled();
  });

  test('PUT /media/queue replaces entire queue', async () => {
    const { app, service } = createApp();
    const res = await request(app)
      .put('/media/queue')
      .send({ items: [{ contentId: 'plex:1' }], position: 0 });
    expect(res.status).toBe(200);
    expect(service.replace).toHaveBeenCalled();
  });

  test('mutations broadcast media:queue event', async () => {
    const broadcastEvent = jest.fn();
    const { app } = createApp({ broadcastEvent });
    await request(app)
      .post('/media/queue/items')
      .send({ items: [{ contentId: 'plex:1' }] });
    expect(broadcastEvent).toHaveBeenCalledWith('media:queue', expect.any(Object));
  });
});
```

### Step 2: Run to verify failure

```bash
npx jest tests/isolated/api/mediaRouter.test.mjs --no-coverage
```

**Note:** If `supertest` isn't installed, run `npm install --save-dev supertest` first.

### Step 3: Implement router

```javascript
// backend/src/4_api/v1/routers/media.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';

export function createMediaRouter(config) {
  const {
    mediaQueueService,
    contentIdResolver,
    broadcastEvent,
    logger = console,
  } = config;

  const router = express.Router();

  const resolveHid = (req) => req.query.household || undefined;

  const broadcast = (queue, mutationId) => {
    broadcastEvent('media:queue', { ...queue.toJSON(), mutationId });
  };

  // GET /queue — full queue state
  router.get('/queue', asyncHandler(async (req, res) => {
    const queue = await mediaQueueService.load(resolveHid(req));
    res.json(queue.toJSON());
  }));

  // PUT /queue — replace entire queue
  router.put('/queue', asyncHandler(async (req, res) => {
    const { items = [], position = 0, shuffle, repeat, volume } = req.body;
    const queue = new MediaQueue({ items, position, shuffle, repeat, volume });
    const saved = await mediaQueueService.replace(queue, resolveHid(req));
    broadcast(saved, req.body.mutationId);
    res.json(saved.toJSON());
  }));

  // POST /queue/items — add items
  router.post('/queue/items', asyncHandler(async (req, res) => {
    const { items, placement } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'items array required' });
    }
    const added = await mediaQueueService.addItems(items, placement, resolveHid(req));
    const queue = await mediaQueueService.load(resolveHid(req));
    broadcast(queue, req.body.mutationId);
    res.json({ added, queue: queue.toJSON() });
  }));

  // DELETE /queue/items/:queueId — remove item
  router.delete('/queue/items/:queueId', asyncHandler(async (req, res) => {
    const queue = await mediaQueueService.removeItem(req.params.queueId, resolveHid(req));
    broadcast(queue, req.body?.mutationId || req.query.mutationId);
    res.json(queue.toJSON());
  }));

  // PATCH /queue/items/reorder — reorder item
  router.patch('/queue/items/reorder', asyncHandler(async (req, res) => {
    const { queueId, toIndex } = req.body;
    const queue = await mediaQueueService.reorder(queueId, toIndex, resolveHid(req));
    broadcast(queue, req.body.mutationId);
    res.json(queue.toJSON());
  }));

  // PATCH /queue/position — jump to position
  router.patch('/queue/position', asyncHandler(async (req, res) => {
    const { position } = req.body;
    const queue = await mediaQueueService.setPosition(position, resolveHid(req));
    broadcast(queue, req.body.mutationId);
    res.json(queue.toJSON());
  }));

  // PATCH /queue/state — update shuffle/repeat/volume
  router.patch('/queue/state', asyncHandler(async (req, res) => {
    const { shuffle, repeat, volume } = req.body;
    const state = {};
    if (shuffle !== undefined) state.shuffle = shuffle;
    if (repeat !== undefined) state.repeat = repeat;
    if (volume !== undefined) state.volume = volume;
    const queue = await mediaQueueService.updateState(state, resolveHid(req));
    broadcast(queue, req.body.mutationId);
    res.json(queue.toJSON());
  }));

  // DELETE /queue — clear queue
  router.delete('/queue', asyncHandler(async (req, res) => {
    const queue = await mediaQueueService.clear(resolveHid(req));
    broadcast(queue, req.body?.mutationId || req.query.mutationId);
    res.json(queue.toJSON());
  }));

  return router;
}

export default createMediaRouter;
```

### Step 4: Run tests to verify pass

```bash
npx jest tests/isolated/api/mediaRouter.test.mjs --no-coverage
```

### Step 5: Commit

```bash
git add backend/src/4_api/v1/routers/media.mjs tests/isolated/api/mediaRouter.test.mjs
git commit -m "feat(media): 0.6.1 add media queue router with 8 REST endpoints"
```

---

## Task 5: Bootstrap Wiring + Route Registration

**Requirements:** 0.1.1, 0.1.2, 0.1.3, 0.1.4

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`
- Modify: `backend/src/4_api/v1/routers/api.mjs`

### Step 1: Add `createMediaServices` factory to bootstrap.mjs

Find the `createFitnessServices` function (around line 803) and add after it:

```javascript
// Add import at top of file:
import { YamlMediaQueueDatastore } from '#adapters/persistence/yaml/YamlMediaQueueDatastore.mjs';
import { MediaQueueService } from '#apps/media/MediaQueueService.mjs';
import { createMediaRouter } from '#api/v1/routers/media.mjs';

// Add factory function after createFitnessServices:
export function createMediaServices(config) {
  const { configService, defaultHouseholdId, logger = console } = config;

  const queueStore = new YamlMediaQueueDatastore({ configService });

  const mediaQueueService = new MediaQueueService({
    queueStore,
    defaultHouseholdId,
    logger,
  });

  return { queueStore, mediaQueueService };
}
```

### Step 2: Wire services and router in the main bootstrap flow

Find where routers are created (look for `queue: createQueueRouter(` around line 768). Add nearby:

```javascript
// Create media services
const mediaServices = createMediaServices({
  configService,
  defaultHouseholdId,
  logger,
});

// Create media router — add to the routers object passed to createApiRouter
media: createMediaRouter({
  mediaQueueService: mediaServices.mediaQueueService,
  contentIdResolver,
  broadcastEvent: (topic, payload) => eventBus.broadcast(topic, payload),
  logger,
}),
```

### Step 3: Add route to api.mjs routeMap

In `backend/src/4_api/v1/routers/api.mjs`, add to the routeMap object (around line 80, after `/fitness`):

```javascript
'/media': 'media',
```

### Step 4: Verify backend starts

```bash
cd backend && node -e "import('#system/bootstrap.mjs').then(m => console.log('bootstrap imports OK'))" 2>&1 | head -5
```

### Step 5: Commit

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/4_api/v1/routers/api.mjs
git commit -m "feat(media): 0.1.1-0.1.4 wire media services and router in bootstrap"
```

---

## Task 6: media:command WebSocket Handler

**Requirements:** 6.2.1, 6.2.2, 6.1.1–6.1.7

**Files:**
- Modify: `backend/src/app.mjs`

### Step 1: Add media command handler in eventBus.onClientMessage

In `backend/src/app.mjs`, find the `eventBus.onClientMessage` block (around line 327). Add a new handler block after the fitness block:

```javascript
// Media commands — backend-only processing (6.1.6)
if (message.topic === 'media:command') {
  const { action, contentId, householdId } = message;
  rootLogger.info?.('eventbus.media.command', { clientId, action, contentId });

  (async () => {
    try {
      const mediaQueueService = mediaServices.mediaQueueService;

      if (action === 'play') {
        // Insert after current, advance to it
        const added = await mediaQueueService.addItems(
          [{ contentId, addedFrom: 'WEBSOCKET' }], 'next', householdId
        );
        const queue = await mediaQueueService.load(householdId);
        const insertedIdx = queue.items.findIndex(i => i.queueId === added[0].queueId);
        if (insertedIdx >= 0) await mediaQueueService.setPosition(insertedIdx, householdId);
        const updated = await mediaQueueService.load(householdId);
        eventBus.broadcast('media:queue', updated.toJSON());
      } else if (action === 'add') {
        await mediaQueueService.addItems(
          [{ contentId, addedFrom: 'WEBSOCKET' }], 'end', householdId
        );
        const queue = await mediaQueueService.load(householdId);
        eventBus.broadcast('media:queue', queue.toJSON());
      } else if (action === 'next') {
        await mediaQueueService.addItems(
          [{ contentId, addedFrom: 'WEBSOCKET' }], 'next', householdId
        );
        const queue = await mediaQueueService.load(householdId);
        eventBus.broadcast('media:queue', queue.toJSON());
      } else if (action === 'queue') {
        // Resolve container, replace entire queue
        const resolved = contentIdResolver.resolve(contentId);
        if (resolved?.adapter?.resolvePlayables) {
          const playables = await resolved.adapter.resolvePlayables(resolved.localId);
          const items = playables.map(p => ({ ...p, addedFrom: 'WEBSOCKET' }));
          const { MediaQueue } = await import('#domains/media/entities/MediaQueue.mjs');
          const queue = new MediaQueue({ items, position: 0 });
          await mediaQueueService.replace(queue, householdId);
          eventBus.broadcast('media:queue', queue.toJSON());
        }
      } else if (action === 'clear') {
        const queue = await mediaQueueService.clear(householdId);
        eventBus.broadcast('media:queue', queue.toJSON());
      } else {
        rootLogger.warn?.('eventbus.media.unknown-action', { action });
      }
    } catch (err) {
      rootLogger.error?.('eventbus.media.command.error', { action, error: err.message });
    }
  })();
  return;
}
```

**Important:** `mediaServices` must be in scope where `onClientMessage` is registered. If it's defined in bootstrap, pass it to the app setup function or store it in a module-level variable.

### Step 2: Verify no syntax errors

```bash
cd backend && node -c src/app.mjs
```

### Step 3: Commit

```bash
git add backend/src/app.mjs
git commit -m "feat(media): 6.2.1, 6.2.2 add media:command WebSocket handler"
```

---

## Task 7: useMediaQueue Hook

**Requirements:** 2.2.1, 2.2.2, 2.2.6, 0.8.2

**Files:**
- Create: `frontend/src/hooks/media/useMediaQueue.js`
- Test: `tests/unit/hooks/useMediaQueue.test.jsx`

### Step 1: Write failing tests

```javascript
// tests/unit/hooks/useMediaQueue.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock WebSocket subscription
const mockUnsubscribe = vi.fn();
vi.mock('../../frontend/src/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: vi.fn(),
  useWebSocketSend: () => vi.fn(),
}));

vi.mock('../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({
    child: () => ({
      info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
    }),
  }),
}));

describe('useMediaQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        items: [], position: 0, shuffle: false, repeat: 'off', volume: 1.0,
      }),
    });
  });

  it('fetches queue on mount', async () => {
    const { useMediaQueue } = await import('../../frontend/src/hooks/media/useMediaQueue.js');
    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/media/queue'));
    });
  });

  it('exposes queue state', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        items: [{ contentId: 'plex:1', queueId: 'abc', title: 'Song' }],
        position: 0, shuffle: false, repeat: 'off', volume: 0.8,
      }),
    });
    const { useMediaQueue } = await import('../../frontend/src/hooks/media/useMediaQueue.js');
    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
      expect(result.current.position).toBe(0);
      expect(result.current.volume).toBe(0.8);
    });
  });

  it('addItems sends POST and updates local state optimistically', async () => {
    const { useMediaQueue } = await import('../../frontend/src/hooks/media/useMediaQueue.js');
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ items: [], position: 0, shuffle: false, repeat: 'off', volume: 1 }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ added: [{ contentId: 'plex:1', queueId: 'x' }], queue: { items: [{ contentId: 'plex:1', queueId: 'x' }], position: 0, shuffle: false, repeat: 'off', volume: 1 } }) });

    const { result } = renderHook(() => useMediaQueue());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.addItems([{ contentId: 'plex:1' }]);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/media/queue/items'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});
```

### Step 2: Run to verify failure

```bash
npx vitest run tests/unit/hooks/useMediaQueue.test.jsx
```

### Step 3: Implement

```javascript
// frontend/src/hooks/media/useMediaQueue.js
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useWebSocketSubscription } from '../useWebSocket.js';
import { notifications } from '@mantine/notifications';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaQueue' });
  return _logger;
}

const randomHex = () => Math.random().toString(16).slice(2, 10);

const API_BASE = '/api/v1/media/queue';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export function useMediaQueue() {
  const [queue, setQueue] = useState({
    items: [], position: 0, shuffle: false, repeat: 'off', volume: 1.0,
  });
  const [loading, setLoading] = useState(true);
  const lastMutationId = useRef(null);
  const rollbackState = useRef(null);

  // Fetch on mount
  useEffect(() => {
    apiFetch('')
      .then(data => setQueue(data))
      .catch(err => logger().error('media-queue.fetch-failed', { error: err.message }))
      .finally(() => setLoading(false));
  }, []);

  // WebSocket sync — replace local state on broadcast (suppress self-echo)
  useWebSocketSubscription(
    'media:queue',
    useCallback((data) => {
      if (data.mutationId && data.mutationId === lastMutationId.current) {
        logger().debug('media-queue.self-echo-suppressed', { mutationId: data.mutationId });
        return;
      }
      logger().info('media-queue.sync-received', { items: data.items?.length });
      setQueue(prev => ({
        items: data.items ?? prev.items,
        position: data.position ?? prev.position,
        shuffle: data.shuffle ?? prev.shuffle,
        repeat: data.repeat ?? prev.repeat,
        volume: data.volume ?? prev.volume,
      }));
    }, []),
    []
  );

  // Optimistic mutation helper
  const mutate = useCallback(async (optimisticUpdate, apiCall) => {
    const mutationId = randomHex();
    lastMutationId.current = mutationId;
    rollbackState.current = { ...queue, items: [...queue.items] };

    if (optimisticUpdate) setQueue(optimisticUpdate);

    try {
      return await apiCall(mutationId);
    } catch (err) {
      logger().warn('media-queue.optimistic-rollback', { error: err.message });
      setQueue(rollbackState.current);
      notifications.show({ title: "Couldn't save queue", message: 'Retrying...', color: 'orange' });
      // Retry once after 2s
      try {
        await new Promise(r => setTimeout(r, 2000));
        return await apiCall(mutationId);
      } catch (retryErr) {
        logger().error('media-queue.backend-unreachable', { error: retryErr.message });
        notifications.show({ title: 'Queue sync failed', message: 'Changes may not persist', color: 'red' });
      }
    }
  }, [queue]);

  // Mutation methods
  const addItems = useCallback(async (items, placement = 'end') => {
    const optimistic = {
      ...queue,
      items: placement === 'next'
        ? [...queue.items.slice(0, queue.position + 1), ...items, ...queue.items.slice(queue.position + 1)]
        : [...queue.items, ...items],
    };
    return mutate(optimistic, (mid) =>
      apiFetch('/items', { method: 'POST', body: { items, placement, mutationId: mid } })
        .then(res => { setQueue(res.queue); return res.added; })
    );
  }, [queue, mutate]);

  const removeItem = useCallback(async (queueId) => {
    const optimistic = {
      ...queue,
      items: queue.items.filter(i => i.queueId !== queueId),
    };
    return mutate(optimistic, (mid) =>
      apiFetch(`/items/${queueId}?mutationId=${mid}`, { method: 'DELETE' })
        .then(res => setQueue(res))
    );
  }, [queue, mutate]);

  const reorder = useCallback(async (queueId, toIndex) => {
    return mutate(null, (mid) =>
      apiFetch('/items/reorder', { method: 'PATCH', body: { queueId, toIndex, mutationId: mid } })
        .then(res => setQueue(res))
    );
  }, [mutate]);

  const setPosition = useCallback(async (position) => {
    setQueue(prev => ({ ...prev, position }));
    return mutate(null, (mid) =>
      apiFetch('/position', { method: 'PATCH', body: { position, mutationId: mid } })
        .then(res => setQueue(res))
    );
  }, [mutate]);

  const advance = useCallback(async (step = 1, { auto = false } = {}) => {
    return mutate(null, (mid) =>
      apiFetch('/position', { method: 'PATCH', body: { position: queue.position + step, mutationId: mid } })
        .then(res => setQueue(res))
    );
  }, [queue.position, mutate]);

  const setShuffle = useCallback(async (enabled) => {
    return mutate(null, (mid) =>
      apiFetch('/state', { method: 'PATCH', body: { shuffle: enabled, mutationId: mid } })
        .then(res => setQueue(res))
    );
  }, [mutate]);

  const setRepeat = useCallback(async (mode) => {
    return mutate(null, (mid) =>
      apiFetch('/state', { method: 'PATCH', body: { repeat: mode, mutationId: mid } })
        .then(res => setQueue(res))
    );
  }, [mutate]);

  const setVolume = useCallback(async (vol) => {
    setQueue(prev => ({ ...prev, volume: vol }));
    return mutate(null, (mid) =>
      apiFetch('/state', { method: 'PATCH', body: { volume: vol, mutationId: mid } })
    );
  }, [mutate]);

  const clear = useCallback(async () => {
    setQueue({ items: [], position: 0, shuffle: false, repeat: 'off', volume: queue.volume });
    return mutate(null, (mid) =>
      apiFetch('', { method: 'DELETE' }).then(res => setQueue(res))
    );
  }, [queue.volume, mutate]);

  const currentItem = useMemo(() => {
    if (queue.items.length === 0) return null;
    return queue.items[queue.position] ?? null;
  }, [queue.items, queue.position]);

  return {
    items: queue.items,
    position: queue.position,
    shuffle: queue.shuffle,
    repeat: queue.repeat,
    volume: queue.volume,
    currentItem,
    loading,
    addItems,
    removeItem,
    reorder,
    setPosition,
    advance,
    setShuffle,
    setRepeat,
    setVolume,
    clear,
  };
}
```

### Step 4: Run tests

```bash
npx vitest run tests/unit/hooks/useMediaQueue.test.jsx
```

### Step 5: Commit

```bash
git add frontend/src/hooks/media/useMediaQueue.js tests/unit/hooks/useMediaQueue.test.jsx
git commit -m "feat(media): 2.2.1, 2.2.2, 2.2.6, 0.8.2 add useMediaQueue hook with optimistic updates"
```

---

## Task 8: MediaAppProvider Context

**Requirements:** 1.2.2 (completion from Phase 1)

**Files:**
- Create: `frontend/src/contexts/MediaAppContext.jsx`
- Modify: `frontend/src/Apps/MediaApp.jsx`

### Step 1: Create context

```javascript
// frontend/src/contexts/MediaAppContext.jsx
import React, { createContext, useContext, useRef } from 'react';
import { useMediaQueue } from '../hooks/media/useMediaQueue.js';

const MediaAppContext = createContext(null);

export function MediaAppProvider({ children }) {
  const queue = useMediaQueue();
  const playerRef = useRef(null);

  return (
    <MediaAppContext.Provider value={{ queue, playerRef }}>
      {children}
    </MediaAppContext.Provider>
  );
}

export function useMediaApp() {
  const ctx = useContext(MediaAppContext);
  if (!ctx) throw new Error('useMediaApp must be used within MediaAppProvider');
  return ctx;
}
```

### Step 2: Wrap MediaApp with provider

Modify `frontend/src/Apps/MediaApp.jsx`:

```javascript
// Add import
import { MediaAppProvider } from '../contexts/MediaAppContext.jsx';

// Wrap the component
const MediaApp = () => {
  return (
    <MediaAppProvider>
      <MediaAppInner />
    </MediaAppProvider>
  );
};

// Rename existing component to MediaAppInner, replace prop drilling with context:
const MediaAppInner = () => {
  const { queue, playerRef } = useMediaApp();
  const logger = useMemo(() => getLogger().child({ app: 'media' }), []);
  const urlCommand = useMediaUrlParams();
  const [view, setView] = useState('now-playing');
  const [playbackState, setPlaybackState] = useState({ currentTime: 0, duration: 0, paused: true });

  // URL command processing now uses queue.addItems
  useEffect(() => {
    if (!urlCommand) return;
    const playCommand = urlCommand.play || urlCommand.queue;
    if (!playCommand?.contentId) return;

    const { contentId, ...config } = playCommand;
    if (urlCommand.play) {
      queue.clear().then(() =>
        queue.addItems([{ contentId, title: contentId, config }])
      );
    } else {
      queue.addItems([{ contentId, title: contentId, config }]);
    }
  }, [urlCommand]); // eslint-disable-line react-hooks/exhaustive-deps

  // ... rest of component uses queue.currentItem, queue.advance, etc.
};
```

### Step 3: Verify build

```bash
cd frontend && npx vite build 2>&1 | tail -5
```

### Step 4: Commit

```bash
git add frontend/src/contexts/MediaAppContext.jsx frontend/src/Apps/MediaApp.jsx
git commit -m "feat(media): 1.2.2 add MediaAppProvider context, replace prop drilling"
```

---

## Task 9: QueueDrawer + QueueItem Components

**Requirements:** 2.2.3, 2.2.4

**Files:**
- Create: `frontend/src/modules/Media/QueueItem.jsx`
- Create: `frontend/src/modules/Media/QueueDrawer.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss`

### Step 1: Create QueueItem

```javascript
// frontend/src/modules/Media/QueueItem.jsx
import React, { useCallback, useMemo } from 'react';
import { ContentDisplayUrl } from '../../lib/api.mjs';

const QueueItem = ({ item, isCurrent, onPlay, onRemove, onPlayNext }) => {
  const thumbnailUrl = useMemo(
    () => item.contentId ? ContentDisplayUrl(item.contentId) : null,
    [item.contentId]
  );

  const handleSwipeRemove = useCallback((e) => {
    // Simple swipe detection for mobile
    const startX = e.touches?.[0]?.clientX;
    const handler = (moveEvent) => {
      const dx = moveEvent.touches[0].clientX - startX;
      if (dx < -80) {
        document.removeEventListener('touchmove', handler);
        onRemove(item.queueId);
      }
    };
    document.addEventListener('touchmove', handler, { passive: true });
    document.addEventListener('touchend', () => {
      document.removeEventListener('touchmove', handler);
    }, { once: true });
  }, [item.queueId, onRemove]);

  return (
    <div
      className={`queue-item ${isCurrent ? 'queue-item--current' : ''}`}
      onClick={() => onPlay(item.queueId)}
      onTouchStart={handleSwipeRemove}
    >
      <div className="queue-item-thumbnail">
        {thumbnailUrl && <img src={thumbnailUrl} alt="" />}
      </div>
      <div className="queue-item-info">
        <div className="queue-item-title">{item.title || item.contentId}</div>
        {item.source && <div className="queue-item-source">{item.source}</div>}
      </div>
      {item.format && <span className="queue-item-badge">{item.format}</span>}
      <button
        className="queue-item-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(item.queueId); }}
        aria-label="Remove"
      >
        ×
      </button>
    </div>
  );
};

export default QueueItem;
```

### Step 2: Create QueueDrawer

```javascript
// frontend/src/modules/Media/QueueDrawer.jsx
import React, { useMemo } from 'react';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import QueueItem from './QueueItem.jsx';
import getLogger from '../../lib/logging/Logger.js';

const QueueDrawer = ({ open, onClose }) => {
  const { queue } = useMediaApp();
  const logger = useMemo(() => getLogger().child({ component: 'QueueDrawer' }), []);

  const handlePlay = (queueId) => {
    const idx = queue.items.findIndex(i => i.queueId === queueId);
    if (idx >= 0) queue.setPosition(idx);
  };

  const handleRemove = (queueId) => {
    queue.removeItem(queueId);
  };

  const handleClear = () => {
    queue.clear();
  };

  const cycleRepeat = () => {
    const modes = ['off', 'one', 'all'];
    const next = modes[(modes.indexOf(queue.repeat) + 1) % modes.length];
    queue.setRepeat(next);
  };

  if (!open) return null;

  return (
    <div className="queue-drawer">
      <div className="queue-drawer-header">
        <h3>Queue ({queue.items.length})</h3>
        <div className="queue-drawer-actions">
          <button
            className={`queue-action-btn ${queue.shuffle ? 'active' : ''}`}
            onClick={() => queue.setShuffle(!queue.shuffle)}
            aria-label="Shuffle"
          >
            ⇌
          </button>
          <button
            className={`queue-action-btn ${queue.repeat !== 'off' ? 'active' : ''}`}
            onClick={cycleRepeat}
            aria-label={`Repeat: ${queue.repeat}`}
          >
            {queue.repeat === 'one' ? '↻1' : '↻'}
          </button>
          <button className="queue-action-btn" onClick={handleClear} aria-label="Clear">
            ✕
          </button>
          <button className="queue-action-btn" onClick={onClose} aria-label="Close">
            ▼
          </button>
        </div>
      </div>
      <div className="queue-drawer-list">
        {queue.items.length === 0 && (
          <div className="queue-empty">Queue is empty</div>
        )}
        {queue.items.map((item, idx) => (
          <QueueItem
            key={item.queueId}
            item={item}
            isCurrent={idx === queue.position}
            onPlay={handlePlay}
            onRemove={handleRemove}
          />
        ))}
      </div>
    </div>
  );
};

export default QueueDrawer;
```

### Step 3: Add SCSS

Append to `frontend/src/Apps/MediaApp.scss`:

```scss
/* Queue Drawer */
.queue-drawer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 70vh;
  background: #111;
  border-top: 1px solid #333;
  border-radius: 12px 12px 0 0;
  display: flex;
  flex-direction: column;
  z-index: 900;
  animation: slideUp 0.2s ease-out;

  @media (min-width: 768px) {
    position: static;
    max-height: none;
    width: 320px;
    border-radius: 0;
    border-left: 1px solid #333;
    border-top: none;
    animation: none;
  }
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.queue-drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #222;

  h3 { margin: 0; font-size: 14px; color: #e0e0e0; }
}

.queue-drawer-actions {
  display: flex;
  gap: 8px;
}

.queue-action-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;

  &:hover { color: #e0e0e0; }
  &.active { color: #1db954; }
}

.queue-drawer-list {
  overflow-y: auto;
  flex: 1;
  padding: 4px 0;
}

.queue-empty {
  padding: 32px 16px;
  text-align: center;
  color: #666;
  font-size: 14px;
}

/* Queue Item */
.queue-item {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  gap: 12px;
  cursor: pointer;

  &:hover { background: #1a1a1a; }
  &--current { background: #1a2a1a; border-left: 3px solid #1db954; }
}

.queue-item-thumbnail {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  overflow: hidden;
  background: #222;
  flex-shrink: 0;

  img { width: 100%; height: 100%; object-fit: cover; }
}

.queue-item-info {
  flex: 1;
  min-width: 0;
}

.queue-item-title {
  font-size: 13px;
  color: #e0e0e0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-item-source {
  font-size: 11px;
  color: #666;
}

.queue-item-badge {
  font-size: 10px;
  color: #888;
  background: #222;
  padding: 2px 6px;
  border-radius: 3px;
  text-transform: uppercase;
}

.queue-item-remove {
  background: none;
  border: none;
  color: #555;
  font-size: 18px;
  cursor: pointer;
  padding: 4px;

  &:hover { color: #e0e0e0; }
}
```

### Step 4: Verify build

```bash
cd frontend && npx vite build 2>&1 | tail -5
```

### Step 5: Commit

```bash
git add frontend/src/modules/Media/QueueItem.jsx frontend/src/modules/Media/QueueDrawer.jsx frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): 2.2.3, 2.2.4 add QueueDrawer and QueueItem components"
```

---

## Task 10: Wire Queue into MediaApp

**Requirements:** 2.1.1–2.1.15, 2.2.5, 6.1.8–6.1.13

**Files:**
- Modify: `frontend/src/Apps/MediaApp.jsx`
- Modify: `frontend/src/modules/Media/NowPlaying.jsx`
- Modify: `frontend/src/modules/Media/MiniPlayer.jsx`
- Modify: `frontend/src/hooks/media/useMediaUrlParams.js`

### Step 1: Update MediaApp to use queue

Replace the Phase 1 `MediaAppInner` with queue-driven logic:

```javascript
// In MediaApp.jsx — MediaAppInner updated
const MediaAppInner = () => {
  const { queue, playerRef } = useMediaApp();
  const logger = useMemo(() => getLogger().child({ app: 'media' }), []);
  const urlCommand = useMediaUrlParams();
  const [view, setView] = useState('now-playing'); // 'now-playing' | 'queue'
  const [playbackState, setPlaybackState] = useState({ currentTime: 0, duration: 0, paused: true });
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false);

  // URL command → queue mutation on mount
  useEffect(() => {
    if (!urlCommand || queue.loading) return;
    const playCommand = urlCommand.play || urlCommand.queue;
    if (!playCommand?.contentId) return;

    const { contentId, volume, ...config } = playCommand;
    logger.info('media-app.url-command', { action: urlCommand.play ? 'play' : 'queue', contentId });

    if (urlCommand.play) {
      queue.clear().then(() =>
        queue.addItems([{ contentId, title: contentId, config: Object.keys(config).length > 0 ? config : undefined }])
      );
    }
    if (volume) queue.setVolume(Number(volume) / 100);
  }, [urlCommand, queue.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance when item ends
  const handleItemEnd = useCallback(() => {
    logger.info('media-app.item-ended', { contentId: queue.currentItem?.contentId });
    queue.advance(1, { auto: true });
  }, [queue, logger]);

  const handleNext = useCallback(() => {
    queue.advance(1);
  }, [queue]);

  const handlePrev = useCallback(() => {
    if (playbackState.currentTime > 3) {
      playerRef.current?.seek?.(0);
    } else {
      queue.advance(-1);
    }
  }, [queue, playbackState.currentTime, playerRef]);

  if (queue.loading) {
    return (
      <div className="App media-app">
        <div className="media-app-container">
          <div className="media-loading">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="App media-app">
      <div className="media-app-container">
        <NowPlaying
          currentItem={queue.currentItem}
          onItemEnd={handleItemEnd}
          onNext={handleNext}
          onPrev={handlePrev}
          onPlaybackState={setPlaybackState}
          onQueueToggle={() => setQueueDrawerOpen(o => !o)}
          queueLength={queue.items.length}
        />

        <QueueDrawer
          open={queueDrawerOpen}
          onClose={() => setQueueDrawerOpen(false)}
        />

        {view !== 'now-playing' && queue.currentItem && (
          <MiniPlayer
            currentItem={queue.currentItem}
            playbackState={playbackState}
            onToggle={() => playerRef.current?.toggle?.()}
            onExpand={() => setView('now-playing')}
          />
        )}
      </div>
    </div>
  );
};
```

### Step 2: Update NowPlaying to accept new props

In `NowPlaying.jsx`, add `onPlaybackState` callback prop and a queue toggle button:

```javascript
// Add to NowPlaying props:
// onPlaybackState - reports playback state up to MediaApp
// onQueueToggle - opens/closes queue drawer
// queueLength - shows count on queue button

// In the onProgress handler:
const handleProgress = useCallback((data) => {
  setPlaybackState(data);
  onPlaybackState?.(data); // propagate up
}, [onPlaybackState]);

// Add queue button to transport controls:
<button className="media-transport-btn" onClick={onQueueToggle}>
  ☰ {queueLength > 0 && <span className="queue-badge">{queueLength}</span>}
</button>
```

### Step 3: Update MiniPlayer to use context playerRef

```javascript
// MiniPlayer now uses useMediaApp() for toggle instead of prop
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';

const MiniPlayer = ({ currentItem, playbackState, onExpand }) => {
  const { playerRef } = useMediaApp();
  const handleToggle = () => playerRef.current?.toggle?.();
  // ... rest unchanged
};
```

### Step 4: Verify build

```bash
cd frontend && npx vite build 2>&1 | tail -5
```

### Step 5: Commit

```bash
git add frontend/src/Apps/MediaApp.jsx frontend/src/modules/Media/NowPlaying.jsx frontend/src/modules/Media/MiniPlayer.jsx
git commit -m "feat(media): 2.1.1-2.1.15, 2.2.5 wire queue into MediaApp with auto-advance and prev/next"
```

---

## Task 11: Backend mediaType Filter

**Requirements:** 3.2.3

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs`
- Modify: `backend/src/1_adapters/plex/PlexClientAdapter.mjs`

### Step 1: Add mediaType pass-through in ContentQueryService

In `ContentQueryService.mjs`, find `#translateQuery()` method and add `mediaType` to the passed fields:

```javascript
// In #translateQuery or searchStream:
// Pass query.mediaType through to adapters
if (query.mediaType) {
  adapterQuery.mediaType = query.mediaType;
}
```

### Step 2: Filter by mediaType in PlexClientAdapter

In `PlexClientAdapter.mjs`, find the search method and add mediaType filtering:

```javascript
// After getting search results from Plex:
if (query.mediaType === 'audio') {
  results = results.filter(r => ['artist', 'album', 'track'].includes(r.type));
} else if (query.mediaType === 'video') {
  results = results.filter(r => ['movie', 'show', 'episode'].includes(r.type));
}
```

### Step 3: Verify existing tests still pass

```bash
npx jest tests/isolated/assembly/player/parseAutoplayParams.test.mjs --no-coverage
```

### Step 4: Commit

```bash
git add backend/src/3_applications/content/ContentQueryService.mjs backend/src/1_adapters/plex/PlexClientAdapter.mjs
git commit -m "feat(media): 3.2.3 add mediaType pass-through for search source filtering"
```

---

## Task 12: ContentBrowser + Search Integration

**Requirements:** 3.2.1, 3.2.2, 3.1.1–3.1.13

**Files:**
- Create: `frontend/src/hooks/media/useContentBrowse.js`
- Create: `frontend/src/modules/Media/ContentBrowser.jsx`
- Modify: `frontend/src/Apps/MediaApp.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss`

### Step 1: Create useContentBrowse hook

```javascript
// frontend/src/hooks/media/useContentBrowse.js
import { useState, useCallback } from 'react';

export function useContentBrowse() {
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [browseResults, setBrowseResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const browse = useCallback(async (source, localId, title) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/list/${source}/${localId}`);
      if (!res.ok) throw new Error(`Browse failed: ${res.status}`);
      const data = await res.json();
      setBrowseResults(data.items || data.children || []);
      setBreadcrumbs(prev => [...prev, { source, localId, title }]);
    } catch (err) {
      setBrowseResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const goBack = useCallback(() => {
    setBreadcrumbs(prev => {
      const next = prev.slice(0, -1);
      if (next.length === 0) {
        setBrowseResults([]);
        return [];
      }
      const last = next[next.length - 1];
      browse(last.source, last.localId, last.title);
      return next.slice(0, -1); // browse will re-push
    });
  }, [browse]);

  const exitBrowse = useCallback(() => {
    setBreadcrumbs([]);
    setBrowseResults([]);
  }, []);

  return {
    breadcrumbs,
    browseResults,
    browsing: breadcrumbs.length > 0,
    loading,
    browse,
    goBack,
    exitBrowse,
  };
}
```

### Step 2: Create ContentBrowser

```javascript
// frontend/src/modules/Media/ContentBrowser.jsx
import React, { useState, useMemo, useCallback } from 'react';
import { useStreamingSearch } from '../../hooks/useStreamingSearch.js';
import { useContentBrowse } from '../../hooks/media/useContentBrowse.js';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const FILTERS = [
  { label: 'All', params: '' },
  { label: 'Music', params: 'source=plex&mediaType=audio' },
  { label: 'Video', params: 'source=plex&mediaType=video' },
  { label: 'Hymns', params: 'source=singalong' },
  { label: 'Audiobooks', params: 'source=readable' },
];

const ContentBrowser = ({ open, onClose }) => {
  const { queue } = useMediaApp();
  const logger = useMemo(() => getLogger().child({ component: 'ContentBrowser' }), []);
  const [activeFilter, setActiveFilter] = useState(0);
  const [searchText, setSearchText] = useState('');

  const filterParams = FILTERS[activeFilter].params;
  const { results, pending, isSearching, search } = useStreamingSearch(
    '/api/v1/content/query/search/stream',
    filterParams
  );
  const { breadcrumbs, browseResults, browsing, loading: browseLoading, browse, goBack, exitBrowse } = useContentBrowse();

  const handleSearch = useCallback((e) => {
    const val = e.target.value;
    setSearchText(val);
    exitBrowse();
    search(val);
  }, [search, exitBrowse]);

  const handlePlayNow = useCallback((item) => {
    queue.addItems([{ contentId: item.contentId, title: item.title, format: item.format }], 'next')
      .then(() => {
        // Advance to the just-added item
        const idx = queue.items.length; // will be at position+1
        queue.setPosition(queue.position + 1);
      });
  }, [queue]);

  const handleAddToQueue = useCallback((item) => {
    queue.addItems([{ contentId: item.contentId, title: item.title, format: item.format }]);
  }, [queue]);

  const handlePlayNext = useCallback((item) => {
    queue.addItems([{ contentId: item.contentId, title: item.title, format: item.format }], 'next');
  }, [queue]);

  const handleDrillDown = useCallback((item) => {
    if (item.contentId) {
      const [source, ...rest] = item.contentId.split(':');
      browse(source, rest.join(':'), item.title);
    }
  }, [browse]);

  const displayResults = browsing ? browseResults : results;

  if (!open) return null;

  return (
    <div className="content-browser">
      <div className="content-browser-header">
        <input
          type="text"
          className="content-browser-search"
          placeholder="Search..."
          value={searchText}
          onChange={handleSearch}
        />
        <button className="content-browser-close" onClick={onClose}>✕</button>
      </div>

      <div className="content-browser-filters">
        {FILTERS.map((f, i) => (
          <button
            key={f.label}
            className={`filter-chip ${i === activeFilter ? 'active' : ''}`}
            onClick={() => { setActiveFilter(i); search(searchText); }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {browsing && (
        <div className="content-browser-breadcrumbs">
          <button onClick={goBack}>← Back</button>
          {breadcrumbs.map((b, i) => (
            <span key={i} className="breadcrumb">{b.title}</span>
          ))}
        </div>
      )}

      <div className="content-browser-results">
        {(isSearching || browseLoading) && <div className="search-loading">Searching...</div>}
        {pending.length > 0 && (
          <div className="search-pending">Loading from: {pending.join(', ')}</div>
        )}
        {displayResults.map((item, i) => (
          <div key={item.contentId || i} className="search-result-item">
            <div className="search-result-thumb">
              {item.contentId && <img src={ContentDisplayUrl(item.contentId)} alt="" />}
            </div>
            <div className="search-result-info" onClick={() => item.isContainer ? handleDrillDown(item) : handlePlayNow(item)}>
              <div className="search-result-title">{item.title}</div>
              <div className="search-result-meta">
                {item.source && <span className="source-badge">{item.source}</span>}
                {item.duration && <span>{Math.round(item.duration / 60)}m</span>}
              </div>
            </div>
            <div className="search-result-actions">
              <button onClick={() => handlePlayNow(item)} title="Play Now">▶</button>
              <button onClick={() => handlePlayNext(item)} title="Play Next">⤵</button>
              <button onClick={() => handleAddToQueue(item)} title="Add to Queue">+</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ContentBrowser;
```

### Step 3: Wire into MediaApp

In `MediaApp.jsx`, add search view toggle:

```javascript
import ContentBrowser from '../modules/Media/ContentBrowser.jsx';

// In MediaAppInner, add state:
const [searchOpen, setSearchOpen] = useState(false);

// Add search button to transport area or header:
<button onClick={() => setSearchOpen(o => !o)}>🔍</button>

// Add ContentBrowser to JSX:
<ContentBrowser open={searchOpen} onClose={() => setSearchOpen(false)} />
```

### Step 4: Add SCSS for ContentBrowser

Append to `MediaApp.scss`:

```scss
/* Content Browser */
.content-browser {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #0a0a0a;
  z-index: 800;
  display: flex;
  flex-direction: column;

  @media (min-width: 768px) {
    position: static;
    width: 400px;
    border-left: 1px solid #333;
  }
}

.content-browser-header {
  display: flex;
  padding: 12px;
  gap: 8px;
  border-bottom: 1px solid #222;
}

.content-browser-search {
  flex: 1;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 8px 12px;
  color: #e0e0e0;
  font-size: 14px;

  &::placeholder { color: #666; }
  &:focus { outline: none; border-color: #1db954; }
}

.content-browser-close {
  background: none;
  border: none;
  color: #888;
  font-size: 18px;
  cursor: pointer;
}

.content-browser-filters {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  overflow-x: auto;
}

.filter-chip {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 16px;
  padding: 4px 12px;
  color: #888;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;

  &.active { background: #1db954; color: #000; border-color: #1db954; }
  &:hover:not(.active) { border-color: #555; }
}

.content-browser-breadcrumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: #888;

  button {
    background: none;
    border: none;
    color: #1db954;
    cursor: pointer;
    font-size: 12px;
  }
}

.content-browser-results {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.search-loading, .search-pending {
  padding: 8px 16px;
  color: #666;
  font-size: 12px;
}

.search-result-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  gap: 10px;

  &:hover { background: #1a1a1a; }
}

.search-result-thumb {
  width: 44px;
  height: 44px;
  border-radius: 4px;
  overflow: hidden;
  background: #222;
  flex-shrink: 0;

  img { width: 100%; height: 100%; object-fit: cover; }
}

.search-result-info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.search-result-title {
  font-size: 13px;
  color: #e0e0e0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-result-meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: #666;
}

.source-badge {
  background: #222;
  padding: 1px 5px;
  border-radius: 3px;
  text-transform: uppercase;
  font-size: 10px;
}

.search-result-actions {
  display: flex;
  gap: 4px;

  button {
    background: none;
    border: none;
    color: #888;
    font-size: 14px;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;

    &:hover { color: #1db954; background: #1a1a1a; }
  }
}
```

### Step 5: Verify build

```bash
cd frontend && npx vite build 2>&1 | tail -5
```

### Step 6: Commit

```bash
git add frontend/src/hooks/media/useContentBrowse.js frontend/src/modules/Media/ContentBrowser.jsx frontend/src/Apps/MediaApp.jsx frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): 3.2.1-3.2.2, 3.1.1-3.1.13 add ContentBrowser with search and drill-down"
```

---

## Dependency Graph

```
Task 1 (Entity) ──→ Task 2 (Persistence) ──→ Task 3 (Service) ──→ Task 4 (Router) ──→ Task 5 (Bootstrap)
                                                                                           ↓
Task 6 (WS Handler) ←─────────────────────────────────────────────────────────────────────┘
                                                                                           ↓
Task 7 (useMediaQueue) ──→ Task 8 (Context) ──→ Task 9 (Queue UI) ──→ Task 10 (Wire Queue)
                                                                           ↓
Task 11 (mediaType) ──→ Task 12 (ContentBrowser)  ←──────────────────────┘
```

Tasks 1-6 are backend (sequential). Tasks 7-10 are frontend queue (sequential). Task 11 is an independent backend change. Task 12 depends on Task 8 (context) and Task 11 (mediaType filter).

---

## Verification Checklist

After all tasks:

1. `npx jest tests/isolated/domain/media/MediaQueue.test.mjs --no-coverage` — entity tests pass
2. `npx jest tests/isolated/adapters/YamlMediaQueueDatastore.test.mjs --no-coverage` — adapter tests pass
3. `npx jest tests/isolated/services/MediaQueueService.test.mjs --no-coverage` — service tests pass
4. `npx jest tests/isolated/api/mediaRouter.test.mjs --no-coverage` — router tests pass
5. `npx jest tests/isolated/assembly/player/parseAutoplayParams.test.mjs --no-coverage` — Phase 1 tests still pass
6. `cd frontend && npx vite build` — builds without errors
7. Start dev server, open `/media?play=hymn:198` — plays content, queue shows 1 item
8. Open queue drawer — item visible, highlighted as current
9. Search for content — results appear, "Add to Queue" works
10. Open second tab to `/media` — queue syncs via WebSocket
