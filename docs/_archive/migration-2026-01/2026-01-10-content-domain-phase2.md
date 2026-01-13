# Content Domain Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement QueueService with watch state persistence, progress tracking API, and proxy endpoints for streaming.

**Architecture:** QueueService uses watch state to determine "next up" items. WatchStateStore persists progress to YAML files. Proxy endpoints handle streaming and thumbnails.

**Tech Stack:** JavaScript (ES Modules), Express.js, Jest for testing. JSDoc for type hints.

**Reference Docs:**
- `docs/plans/2026-01-10-content-domain-phase1.md` - Phase 1 completed
- `docs/_wip/plans/2026-01-10-unified-domain-backend-design.md` - Full design

---

## Task 1: Create Queueable capability

**Files:**
- Create: `backend/src/domains/content/capabilities/Queueable.mjs`
- Test: `tests/unit/content/capabilities/Queueable.test.mjs`

**Step 1: Write the test**

```javascript
// tests/unit/content/capabilities/Queueable.test.mjs
import { QueueableItem } from '../../../../backend/src/domains/content/capabilities/Queueable.mjs';

describe('Queueable capability', () => {
  test('creates queueable item with traversal mode', () => {
    const item = new QueueableItem({
      id: 'folder:morning-program',
      source: 'folder',
      title: 'Morning Program',
      traversalMode: 'sequential',
      isQueueContainer: true
    });

    expect(item.traversalMode).toBe('sequential');
    expect(item.isQueueContainer).toBe(true);
  });

  test('defaults traversalMode to sequential', () => {
    const item = new QueueableItem({
      id: 'plex:12345',
      source: 'plex',
      title: 'TV Show',
      isQueueContainer: true
    });

    expect(item.traversalMode).toBe('sequential');
  });

  test('supports shuffle mode', () => {
    const item = new QueueableItem({
      id: 'filesystem:music/playlist',
      source: 'filesystem',
      title: 'Playlist',
      traversalMode: 'shuffle',
      isQueueContainer: true
    });

    expect(item.traversalMode).toBe('shuffle');
  });

  test('supports heuristic mode for smart selection', () => {
    const item = new QueueableItem({
      id: 'folder:daily-programming',
      source: 'folder',
      title: 'Daily Programming',
      traversalMode: 'heuristic',
      isQueueContainer: true
    });

    expect(item.traversalMode).toBe('heuristic');
  });
});
```

**Step 2: Write the implementation**

```javascript
// backend/src/domains/content/capabilities/Queueable.mjs
import { Item } from '../entities/Item.mjs';

/**
 * @typedef {'sequential' | 'shuffle' | 'heuristic'} TraversalMode
 */

/**
 * Queueable capability - items that can resolve to a queue of playables.
 *
 * Key distinction:
 * - play() → returns SINGLE next-up item (respects watch state)
 * - queue() → returns ALL items in order (for binge watching)
 */
export class QueueableItem extends Item {
  /**
   * @param {Object} props
   * @param {TraversalMode} [props.traversalMode='sequential']
   * @param {boolean} props.isQueueContainer - true if this contains children to resolve
   */
  constructor(props) {
    super(props);
    this.traversalMode = props.traversalMode ?? 'sequential';
    this.isQueueContainer = props.isQueueContainer ?? false;
  }
}
```

**Step 3: Update domain index exports**

Add to `backend/src/domains/content/index.mjs`:
```javascript
export { QueueableItem } from './capabilities/Queueable.mjs';
```

**Step 4: Run tests and commit**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/capabilities/Queueable.test.mjs
git add backend/src/domains/content/capabilities/Queueable.mjs tests/unit/content/capabilities/Queueable.test.mjs backend/src/domains/content/index.mjs
git commit -m "feat(content): add Queueable capability"
```

---

## Task 2: Create WatchState entity

**Files:**
- Create: `backend/src/domains/content/entities/WatchState.mjs`
- Test: `tests/unit/content/entities/WatchState.test.mjs`

**Step 1: Write the test**

```javascript
// tests/unit/content/entities/WatchState.test.mjs
import { WatchState } from '../../../../backend/src/domains/content/entities/WatchState.mjs';

describe('WatchState entity', () => {
  test('creates watch state with required fields', () => {
    const state = new WatchState({
      itemId: 'plex:12345',
      playhead: 3600,
      duration: 7200
    });

    expect(state.itemId).toBe('plex:12345');
    expect(state.playhead).toBe(3600);
    expect(state.duration).toBe(7200);
    expect(state.percent).toBe(50);
  });

  test('calculates percent from playhead and duration', () => {
    const state = new WatchState({
      itemId: 'plex:12345',
      playhead: 1800,
      duration: 7200
    });

    expect(state.percent).toBe(25);
  });

  test('tracks play count and timestamps', () => {
    const now = new Date().toISOString();
    const state = new WatchState({
      itemId: 'plex:12345',
      playhead: 0,
      duration: 7200,
      playCount: 3,
      lastPlayed: now
    });

    expect(state.playCount).toBe(3);
    expect(state.lastPlayed).toBe(now);
  });

  test('isWatched returns true when percent >= 90', () => {
    const watched = new WatchState({
      itemId: 'plex:12345',
      playhead: 6600,
      duration: 7200
    });

    expect(watched.isWatched()).toBe(true);
  });

  test('isWatched returns false when percent < 90', () => {
    const inProgress = new WatchState({
      itemId: 'plex:12345',
      playhead: 3600,
      duration: 7200
    });

    expect(inProgress.isWatched()).toBe(false);
  });

  test('isInProgress returns true when playhead > 0 and not watched', () => {
    const inProgress = new WatchState({
      itemId: 'plex:12345',
      playhead: 3600,
      duration: 7200
    });

    expect(inProgress.isInProgress()).toBe(true);
  });
});
```

**Step 2: Write the implementation**

```javascript
// backend/src/domains/content/entities/WatchState.mjs

/**
 * @typedef {Object} WatchStateProps
 * @property {string} itemId - Compound ID of the item
 * @property {number} playhead - Current position in seconds
 * @property {number} duration - Total duration in seconds
 * @property {number} [playCount=0] - Number of times started
 * @property {string} [lastPlayed] - ISO timestamp of last play
 * @property {number} [watchTime=0] - Total seconds spent watching
 */

/**
 * Watch state tracks playback progress for an item.
 */
export class WatchState {
  /**
   * @param {WatchStateProps} props
   */
  constructor(props) {
    if (!props.itemId) throw new Error('WatchState requires itemId');

    this.itemId = props.itemId;
    this.playhead = props.playhead ?? 0;
    this.duration = props.duration ?? 0;
    this.playCount = props.playCount ?? 0;
    this.lastPlayed = props.lastPlayed ?? null;
    this.watchTime = props.watchTime ?? 0;
  }

  /**
   * Calculate percentage watched (0-100)
   * @returns {number}
   */
  get percent() {
    if (!this.duration) return 0;
    return Math.round((this.playhead / this.duration) * 100);
  }

  /**
   * Check if item is considered fully watched (>= 90%)
   * @returns {boolean}
   */
  isWatched() {
    return this.percent >= 90;
  }

  /**
   * Check if item is in progress (started but not finished)
   * @returns {boolean}
   */
  isInProgress() {
    return this.playhead > 0 && !this.isWatched();
  }

  /**
   * Convert to plain object for persistence
   * @returns {Object}
   */
  toJSON() {
    return {
      itemId: this.itemId,
      playhead: this.playhead,
      duration: this.duration,
      percent: this.percent,
      playCount: this.playCount,
      lastPlayed: this.lastPlayed,
      watchTime: this.watchTime
    };
  }

  /**
   * Create WatchState from persisted data
   * @param {Object} data
   * @returns {WatchState}
   */
  static fromJSON(data) {
    return new WatchState(data);
  }
}
```

**Step 3: Update domain index exports**

Add to `backend/src/domains/content/index.mjs`:
```javascript
export { WatchState } from './entities/WatchState.mjs';
```

**Step 4: Run tests and commit**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/entities/WatchState.test.mjs
git add backend/src/domains/content/entities/WatchState.mjs tests/unit/content/entities/WatchState.test.mjs backend/src/domains/content/index.mjs
git commit -m "feat(content): add WatchState entity"
```

---

## Task 3: Create IWatchStateStore port

**Files:**
- Create: `backend/src/domains/content/ports/IWatchStateStore.mjs`
- Test: `tests/unit/content/ports/IWatchStateStore.test.mjs`

**Step 1: Write the test**

```javascript
// tests/unit/content/ports/IWatchStateStore.test.mjs
import { validateWatchStateStore } from '../../../../backend/src/domains/content/ports/IWatchStateStore.mjs';

describe('IWatchStateStore port', () => {
  test('validates store has required methods', () => {
    const validStore = {
      get: async () => null,
      set: async () => {},
      getAll: async () => [],
      clear: async () => {}
    };

    expect(() => validateWatchStateStore(validStore)).not.toThrow();
  });

  test('rejects store missing get method', () => {
    expect(() => validateWatchStateStore({})).toThrow('must implement get');
  });

  test('rejects store missing set method', () => {
    expect(() => validateWatchStateStore({ get: async () => {} })).toThrow('must implement set');
  });
});
```

**Step 2: Write the implementation**

```javascript
// backend/src/domains/content/ports/IWatchStateStore.mjs

/**
 * @typedef {Object} IWatchStateStore
 * @property {function(string): Promise<import('../entities/WatchState.mjs').WatchState|null>} get
 * @property {function(import('../entities/WatchState.mjs').WatchState): Promise<void>} set
 * @property {function(string): Promise<import('../entities/WatchState.mjs').WatchState[]>} getAll - Get all states for a storage path
 * @property {function(string): Promise<void>} clear - Clear all states for a storage path
 */

/**
 * Validates that an object implements the IWatchStateStore interface
 * @param {any} store
 * @throws {Error} If validation fails
 */
export function validateWatchStateStore(store) {
  if (typeof store.get !== 'function') {
    throw new Error('WatchStateStore must implement get(itemId): Promise<WatchState|null>');
  }
  if (typeof store.set !== 'function') {
    throw new Error('WatchStateStore must implement set(watchState): Promise<void>');
  }
  if (typeof store.getAll !== 'function') {
    throw new Error('WatchStateStore must implement getAll(storagePath): Promise<WatchState[]>');
  }
  if (typeof store.clear !== 'function') {
    throw new Error('WatchStateStore must implement clear(storagePath): Promise<void>');
  }
}
```

**Step 3: Run tests and commit**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/ports/IWatchStateStore.test.mjs
git add backend/src/domains/content/ports/IWatchStateStore.mjs tests/unit/content/ports/IWatchStateStore.test.mjs
git commit -m "feat(content): add IWatchStateStore port"
```

---

## Task 4: Create YamlWatchStateStore adapter

**Files:**
- Create: `backend/src/adapters/persistence/yaml/YamlWatchStateStore.mjs`
- Test: `tests/unit/adapters/persistence/YamlWatchStateStore.test.mjs`

**Step 1: Write the test**

```javascript
// tests/unit/adapters/persistence/YamlWatchStateStore.test.mjs
import { YamlWatchStateStore } from '../../../../backend/src/adapters/persistence/yaml/YamlWatchStateStore.mjs';
import { WatchState } from '../../../../backend/src/domains/content/entities/WatchState.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataPath = path.resolve(__dirname, '../../../_fixtures/watch-state');

describe('YamlWatchStateStore', () => {
  let store;

  beforeAll(() => {
    fs.mkdirSync(testDataPath, { recursive: true });
  });

  beforeEach(() => {
    store = new YamlWatchStateStore({ basePath: testDataPath });
  });

  afterEach(() => {
    // Clean up test files
    const files = fs.readdirSync(testDataPath);
    for (const file of files) {
      fs.unlinkSync(path.join(testDataPath, file));
    }
  });

  test('set and get watch state', async () => {
    const state = new WatchState({
      itemId: 'plex:12345',
      playhead: 3600,
      duration: 7200
    });

    await store.set(state, 'plex');
    const retrieved = await store.get('plex:12345', 'plex');

    expect(retrieved).not.toBeNull();
    expect(retrieved.itemId).toBe('plex:12345');
    expect(retrieved.playhead).toBe(3600);
  });

  test('get returns null for missing item', async () => {
    const result = await store.get('nonexistent:123', 'test');
    expect(result).toBeNull();
  });

  test('getAll returns all states for storage path', async () => {
    await store.set(new WatchState({ itemId: 'plex:1', playhead: 100, duration: 1000 }), 'plex');
    await store.set(new WatchState({ itemId: 'plex:2', playhead: 200, duration: 2000 }), 'plex');

    const all = await store.getAll('plex');
    expect(all.length).toBe(2);
  });

  test('clear removes all states for storage path', async () => {
    await store.set(new WatchState({ itemId: 'plex:1', playhead: 100, duration: 1000 }), 'plex');
    await store.clear('plex');

    const all = await store.getAll('plex');
    expect(all.length).toBe(0);
  });
});
```

**Step 2: Write the implementation**

```javascript
// backend/src/adapters/persistence/yaml/YamlWatchStateStore.mjs
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { WatchState } from '../../../domains/content/entities/WatchState.mjs';

/**
 * YAML-based watch state persistence
 */
export class YamlWatchStateStore {
  /**
   * @param {Object} config
   * @param {string} config.basePath - Base path for watch state files
   */
  constructor(config) {
    if (!config.basePath) throw new Error('YamlWatchStateStore requires basePath');
    this.basePath = config.basePath;
  }

  /**
   * Get file path for a storage path
   * @param {string} storagePath
   * @returns {string}
   */
  _getFilePath(storagePath) {
    const safePath = storagePath.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.basePath, `${safePath}.yml`);
  }

  /**
   * Read all states from a file
   * @param {string} storagePath
   * @returns {Object}
   */
  _readFile(storagePath) {
    const filePath = this._getFilePath(storagePath);
    try {
      if (!fs.existsSync(filePath)) return {};
      const content = fs.readFileSync(filePath, 'utf8');
      return yaml.load(content) || {};
    } catch (err) {
      return {};
    }
  }

  /**
   * Write all states to a file
   * @param {string} storagePath
   * @param {Object} data
   */
  _writeFile(storagePath, data) {
    const filePath = this._getFilePath(storagePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, yaml.dump(data), 'utf8');
  }

  /**
   * Get watch state for an item
   * @param {string} itemId
   * @param {string} storagePath
   * @returns {Promise<WatchState|null>}
   */
  async get(itemId, storagePath) {
    const data = this._readFile(storagePath);
    const stateData = data[itemId];
    if (!stateData) return null;
    return WatchState.fromJSON({ itemId, ...stateData });
  }

  /**
   * Set watch state for an item
   * @param {WatchState} state
   * @param {string} storagePath
   * @returns {Promise<void>}
   */
  async set(state, storagePath) {
    const data = this._readFile(storagePath);
    const { itemId, ...rest } = state.toJSON();
    data[itemId] = rest;
    this._writeFile(storagePath, data);
  }

  /**
   * Get all watch states for a storage path
   * @param {string} storagePath
   * @returns {Promise<WatchState[]>}
   */
  async getAll(storagePath) {
    const data = this._readFile(storagePath);
    return Object.entries(data).map(([itemId, stateData]) =>
      WatchState.fromJSON({ itemId, ...stateData })
    );
  }

  /**
   * Clear all watch states for a storage path
   * @param {string} storagePath
   * @returns {Promise<void>}
   */
  async clear(storagePath) {
    const filePath = this._getFilePath(storagePath);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      // Ignore errors
    }
  }
}
```

**Step 3: Run tests and commit**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/persistence/YamlWatchStateStore.test.mjs
git add backend/src/adapters/persistence/yaml/YamlWatchStateStore.mjs tests/unit/adapters/persistence/YamlWatchStateStore.test.mjs
git commit -m "feat(adapters): add YamlWatchStateStore for watch state persistence"
```

---

## Task 5: Create QueueService

**Files:**
- Create: `backend/src/domains/content/services/QueueService.mjs`
- Test: `tests/unit/content/services/QueueService.test.mjs`

**Step 1: Write the test**

```javascript
// tests/unit/content/services/QueueService.test.mjs
import { QueueService } from '../../../../backend/src/domains/content/services/QueueService.mjs';
import { PlayableItem } from '../../../../backend/src/domains/content/capabilities/Playable.mjs';
import { WatchState } from '../../../../backend/src/domains/content/entities/WatchState.mjs';

describe('QueueService', () => {
  let service;
  let mockWatchStore;

  const createPlayable = (id, title) => new PlayableItem({
    id: `test:${id}`,
    source: 'test',
    title,
    mediaType: 'video',
    mediaUrl: `/stream/${id}`,
    resumable: true
  });

  beforeEach(() => {
    mockWatchStore = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      getAll: jest.fn().mockResolvedValue([]),
      clear: jest.fn().mockResolvedValue(undefined)
    };
    service = new QueueService({ watchStore: mockWatchStore });
  });

  describe('getNextPlayable', () => {
    test('returns first unwatched item', async () => {
      const items = [
        createPlayable('1', 'Episode 1'),
        createPlayable('2', 'Episode 2'),
        createPlayable('3', 'Episode 3')
      ];

      const next = await service.getNextPlayable(items, 'test');
      expect(next.id).toBe('test:1');
    });

    test('returns in-progress item over unwatched', async () => {
      const items = [
        createPlayable('1', 'Episode 1'),
        createPlayable('2', 'Episode 2')
      ];

      mockWatchStore.get.mockImplementation(async (id) => {
        if (id === 'test:2') {
          return new WatchState({ itemId: 'test:2', playhead: 1800, duration: 3600 });
        }
        return null;
      });

      const next = await service.getNextPlayable(items, 'test');
      expect(next.id).toBe('test:2');
    });

    test('skips watched items', async () => {
      const items = [
        createPlayable('1', 'Episode 1'),
        createPlayable('2', 'Episode 2')
      ];

      mockWatchStore.get.mockImplementation(async (id) => {
        if (id === 'test:1') {
          return new WatchState({ itemId: 'test:1', playhead: 3500, duration: 3600 }); // 97% watched
        }
        return null;
      });

      const next = await service.getNextPlayable(items, 'test');
      expect(next.id).toBe('test:2');
    });

    test('returns null when all items watched', async () => {
      const items = [createPlayable('1', 'Episode 1')];

      mockWatchStore.get.mockResolvedValue(
        new WatchState({ itemId: 'test:1', playhead: 3500, duration: 3600 })
      );

      const next = await service.getNextPlayable(items, 'test');
      expect(next).toBeNull();
    });
  });

  describe('getAllPlayables', () => {
    test('returns all items in order', async () => {
      const items = [
        createPlayable('1', 'Episode 1'),
        createPlayable('2', 'Episode 2')
      ];

      const all = await service.getAllPlayables(items);
      expect(all.length).toBe(2);
      expect(all[0].id).toBe('test:1');
      expect(all[1].id).toBe('test:2');
    });
  });
});
```

**Step 2: Write the implementation**

```javascript
// backend/src/domains/content/services/QueueService.mjs

/**
 * QueueService handles play vs queue logic with watch state awareness.
 *
 * Key distinction:
 * - getNextPlayable() → SINGLE item (respects watch state, for daily programming)
 * - getAllPlayables() → ALL items (for queue/binge watching)
 */
export class QueueService {
  /**
   * @param {Object} config
   * @param {import('../ports/IWatchStateStore.mjs').IWatchStateStore} config.watchStore
   */
  constructor(config) {
    this.watchStore = config.watchStore;
  }

  /**
   * Get the next playable item based on watch state.
   * Priority: in-progress > unwatched > null (all watched)
   *
   * @param {import('../capabilities/Playable.mjs').PlayableItem[]} items
   * @param {string} storagePath - Storage path for watch state
   * @returns {Promise<import('../capabilities/Playable.mjs').PlayableItem|null>}
   */
  async getNextPlayable(items, storagePath) {
    if (!items.length) return null;

    // First pass: find any in-progress items
    for (const item of items) {
      const state = await this.watchStore.get(item.id, storagePath);
      if (state?.isInProgress()) {
        return this._withResumePosition(item, state);
      }
    }

    // Second pass: find first unwatched item
    for (const item of items) {
      const state = await this.watchStore.get(item.id, storagePath);
      if (!state || !state.isWatched()) {
        return item;
      }
    }

    // All items watched
    return null;
  }

  /**
   * Get all playable items in order (for queue loading).
   *
   * @param {import('../capabilities/Playable.mjs').PlayableItem[]} items
   * @returns {Promise<import('../capabilities/Playable.mjs').PlayableItem[]>}
   */
  async getAllPlayables(items) {
    return items;
  }

  /**
   * Apply resume position to a playable item
   * @private
   */
  _withResumePosition(item, state) {
    // Create a copy with resume position
    return new item.constructor({
      ...item,
      resumePosition: state.playhead
    });
  }
}
```

**Step 3: Run tests and commit**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/services/QueueService.test.mjs
git add backend/src/domains/content/services/QueueService.mjs tests/unit/content/services/QueueService.test.mjs
git commit -m "feat(content): add QueueService for play vs queue logic"
```

---

## Task 6: Add progress API endpoint

**Files:**
- Modify: `backend/src/api/routers/content.mjs`
- Test: Update `tests/integration/api/content.test.mjs`

**Step 1: Add progress endpoint to router**

```javascript
// Add to backend/src/api/routers/content.mjs

/**
 * POST /api/content/progress/:source/*
 * Update watch progress for an item
 */
router.post('/progress/:source/*', express.json(), async (req, res) => {
  try {
    const { source } = req.params;
    const localId = req.params[0] || '';
    const { seconds, duration } = req.body;

    if (typeof seconds !== 'number' || typeof duration !== 'number') {
      return res.status(400).json({ error: 'seconds and duration are required numbers' });
    }

    const adapter = registry.get(source);
    if (!adapter) {
      return res.status(404).json({ error: `Unknown source: ${source}` });
    }

    const itemId = `${source}:${localId}`;
    const storagePath = await adapter.getStoragePath?.(localId) || source;

    // Get or create watch state
    const existing = await watchStore.get(itemId, storagePath);
    const state = new WatchState({
      itemId,
      playhead: seconds,
      duration,
      playCount: (existing?.playCount || 0) + (seconds === 0 ? 1 : 0),
      lastPlayed: new Date().toISOString(),
      watchTime: (existing?.watchTime || 0) + (seconds - (existing?.playhead || 0))
    });

    await watchStore.set(state, storagePath);

    res.json({
      itemId,
      playhead: state.playhead,
      duration: state.duration,
      percent: state.percent,
      watched: state.isWatched()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Update router factory to accept watchStore**

The `createContentRouter` function needs to accept a `watchStore` parameter.

**Step 3: Add integration test**

```javascript
// Add to tests/integration/api/content.test.mjs

test('POST /api/content/progress/:source/* updates watch state', async () => {
  const res = await request(app)
    .post('/api/content/progress/filesystem/audio/test.mp3')
    .send({ seconds: 90, duration: 180 });

  expect(res.status).toBe(200);
  expect(res.body.itemId).toBe('filesystem:audio/test.mp3');
  expect(res.body.percent).toBe(50);
});
```

**Step 4: Run tests and commit**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/api/content.test.mjs
git add backend/src/api/routers/content.mjs tests/integration/api/content.test.mjs
git commit -m "feat(api): add progress endpoint for watch state updates"
```

---

## Task 7: Add proxy endpoints for streaming

**Files:**
- Create: `backend/src/api/routers/proxy.mjs`
- Test: `tests/integration/api/proxy.test.mjs`

**Step 1: Write the proxy router**

```javascript
// backend/src/api/routers/proxy.mjs
import express from 'express';
import fs from 'fs';
import path from 'path';

/**
 * Create proxy router for streaming and thumbnails
 * @param {Object} config
 * @param {import('../../domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} config.registry
 * @returns {express.Router}
 */
export function createProxyRouter(config) {
  const router = express.Router();
  const { registry } = config;

  /**
   * GET /proxy/filesystem/stream/*
   * Stream a file from filesystem
   */
  router.get('/filesystem/stream/*', async (req, res) => {
    try {
      const filePath = decodeURIComponent(req.params[0] || '');
      const adapter = registry.get('filesystem');
      if (!adapter) {
        return res.status(404).json({ error: 'Filesystem adapter not configured' });
      }

      const item = await adapter.getItem(filePath);
      if (!item || !item.metadata?.filePath) {
        return res.status(404).json({ error: 'File not found' });
      }

      const fullPath = item.metadata.filePath;
      const stat = fs.statSync(fullPath);
      const mimeType = item.metadata.mimeType || 'application/octet-stream';

      // Handle range requests for video seeking
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType
        });

        fs.createReadStream(fullPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': mimeType
        });
        fs.createReadStream(fullPath).pipe(res);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /proxy/plex/stream/:ratingKey
   * Proxy stream from Plex server
   */
  router.get('/plex/stream/:ratingKey', async (req, res) => {
    try {
      const { ratingKey } = req.params;
      const adapter = registry.get('plex');
      if (!adapter) {
        return res.status(404).json({ error: 'Plex adapter not configured' });
      }

      // For now, redirect to Plex direct play
      // Full transcode support would require more complex session handling
      const plexUrl = `${adapter.host}/library/metadata/${ratingKey}?X-Plex-Token=${adapter.client.token}`;
      res.redirect(plexUrl);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

**Step 2: Add integration test**

```javascript
// tests/integration/api/proxy.test.mjs
import express from 'express';
import request from 'supertest';
import { createProxyRouter } from '../../../backend/src/api/routers/proxy.mjs';
import { ContentSourceRegistry } from '../../../backend/src/domains/content/services/ContentSourceRegistry.mjs';
import { FilesystemAdapter } from '../../../backend/src/adapters/content/media/filesystem/FilesystemAdapter.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../_fixtures/media');

describe('Proxy Router', () => {
  let app;

  beforeAll(() => {
    const registry = new ContentSourceRegistry();
    registry.register(new FilesystemAdapter({ mediaBasePath: fixturesPath }));

    app = express();
    app.use('/proxy', createProxyRouter({ registry }));
  });

  test('GET /proxy/filesystem/stream/* streams file', async () => {
    const res = await request(app)
      .get('/proxy/filesystem/stream/audio/test.mp3');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
  });

  test('GET /proxy/filesystem/stream/* handles range requests', async () => {
    const res = await request(app)
      .get('/proxy/filesystem/stream/audio/test.mp3')
      .set('Range', 'bytes=0-10');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toMatch(/^bytes 0-10\//);
  });

  test('GET /proxy/filesystem/stream/* returns 404 for missing file', async () => {
    const res = await request(app)
      .get('/proxy/filesystem/stream/nonexistent.mp3');

    expect(res.status).toBe(404);
  });
});
```

**Step 3: Run tests and commit**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/api/proxy.test.mjs
git add backend/src/api/routers/proxy.mjs tests/integration/api/proxy.test.mjs
git commit -m "feat(api): add proxy router for streaming and thumbnails"
```

---

## Task 8: Wire everything in backend

**Files:**
- Modify: `backend/_legacy/index.js`
- Modify: `backend/src/infrastructure/bootstrap.mjs`

**Step 1: Update bootstrap to create watch store**

```javascript
// Update backend/src/infrastructure/bootstrap.mjs to export createWatchStore
import { YamlWatchStateStore } from '../adapters/persistence/yaml/YamlWatchStateStore.mjs';

export function createWatchStore(config) {
  return new YamlWatchStateStore({
    basePath: config.watchStatePath
  });
}
```

**Step 2: Update backend to mount proxy router**

In `backend/_legacy/index.js`, add:

```javascript
const { createProxyRouter } = await import('../src/api/routers/proxy.mjs');

// Mount proxy router
app.use('/proxy', createProxyRouter({ registry: contentRegistry }));
```

**Step 3: Commit**

```bash
git add backend/_legacy/index.js backend/src/infrastructure/bootstrap.mjs
git commit -m "feat(backend): wire watch store and proxy router"
```

---

## Summary

**Tasks in this plan:**

1. ✅ Task 1: Queueable capability
2. ✅ Task 2: WatchState entity
3. ✅ Task 3: IWatchStateStore port
4. ✅ Task 4: YamlWatchStateStore adapter
5. ✅ Task 5: QueueService
6. ✅ Task 6: Progress API endpoint
7. ✅ Task 7: Proxy endpoints
8. ✅ Task 8: Wire everything in backend

**Next steps (Phase 3):**
- LocalContentAdapter for hymns, talks, scripture
- FolderAdapter for custom playlists
- Legacy API compatibility shims
- Frontend migration to new endpoints
