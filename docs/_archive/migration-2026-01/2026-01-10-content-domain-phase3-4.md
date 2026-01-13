# Content Domain Phase 3-4 - LocalContent, Folders & Legacy Compatibility

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add LocalContentAdapter for talks/scriptures, FolderAdapter for watchlists, and legacy API compatibility shims.

**Architecture:** LocalContentAdapter reads YAML metadata + local media files. FolderAdapter manages heterogeneous content folders (can reference items from any adapter). Legacy shims translate old API responses to new format for gradual frontend migration.

**Tech Stack:** JavaScript ES Modules (.mjs), JSDoc types, Jest tests, Express.js routing

**Folder Structure (NEW):**
- `backend/src/0_infrastructure/` - Bootstrap, config, scheduling
- `backend/src/1_domains/` - Domain entities, ports, services
- `backend/src/2_adapters/` - Adapters (content, persistence, etc.)
- `backend/src/3_applications/` - Application layer (bots, jobs)
- `backend/src/4_api/` - API routers, middleware

---

## Task 1: LocalContentAdapter - Core Implementation ✅ COMPLETED

**Files:**
- Create: `backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs`
- Create: `tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs`

Tests: 9/9 passing

---

## Task 2: LocalContentAdapter - getItem for Talks

**Files:**
- Modify: `backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs`
- Modify: `tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs`
- Create: `tests/_fixtures/local-content/talks/general/test-talk.yaml`

**Step 1: Create test fixture**

```yaml
# tests/_fixtures/local-content/talks/general/test-talk.yaml
title: "Test Talk Title"
speaker: "Elder Test"
date: "2024-04-06"
duration: 1200
description: "A test talk for unit testing"
```

**Step 2: Write the failing test**

```javascript
// Add to LocalContentAdapter.test.mjs
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('getItem', () => {
  it('returns PlayableItem for talk', async () => {
    const fixtureAdapter = new LocalContentAdapter({
      dataPath: path.resolve(__dirname, '../../../../_fixtures/local-content'),
      mediaPath: '/media'
    });

    const item = await fixtureAdapter.getItem('talk:general/test-talk');

    expect(item).not.toBeNull();
    expect(item.id).toBe('talk:general/test-talk');
    expect(item.title).toBe('Test Talk Title');
    expect(item.duration).toBe(1200);
    expect(item.isPlayable()).toBe(true);
  });

  it('returns null for nonexistent talk', async () => {
    const item = await adapter.getItem('talk:general/nonexistent');
    expect(item).toBeNull();
  });
});
```

**Step 3: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs --verbose`
Expected: FAIL with "getItem is not a function" or undefined

**Step 4: Implement getItem**

```javascript
// Add to LocalContentAdapter.mjs
/**
 * Get item by compound ID
 * @param {string} id - e.g., "talk:general/test-talk"
 * @returns {Promise<PlayableItem|ListableItem|null>}
 */
async getItem(id) {
  const [prefix, localId] = id.split(':');
  if (!localId) return null;

  if (prefix === 'talk') {
    return this._getTalk(localId);
  }

  // scripture handling in next task
  return null;
}

/**
 * @private
 */
async _getTalk(localId) {
  const yamlPath = path.join(this.dataPath, 'talks', `${localId}.yaml`);

  try {
    if (!fs.existsSync(yamlPath)) return null;
    const content = fs.readFileSync(yamlPath, 'utf8');
    const metadata = yaml.load(content);

    const compoundId = `talk:${localId}`;
    const mediaUrl = `/proxy/local-content/stream/talk/${localId}`;

    return new PlayableItem({
      id: compoundId,
      title: metadata.title || localId,
      type: 'talk',
      duration: metadata.duration || 0,
      mediaUrl,
      metadata: {
        speaker: metadata.speaker,
        date: metadata.date,
        description: metadata.description
      }
    });
  } catch (err) {
    return null;
  }
}
```

**Step 5: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs --verbose`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs tests/_fixtures/local-content/
git commit -m "feat(adapters): add LocalContentAdapter getItem for talks"
```

---

## Task 3: LocalContentAdapter - getList for Talk Folders

**Files:**
- Modify: `backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs`
- Modify: `tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs`
- Create: `tests/_fixtures/local-content/talks/april2024/talk1.yaml`
- Create: `tests/_fixtures/local-content/talks/april2024/talk2.yaml`

**Step 1: Create test fixtures**

```yaml
# tests/_fixtures/local-content/talks/april2024/talk1.yaml
title: "First Talk"
speaker: "Speaker One"
duration: 600

# tests/_fixtures/local-content/talks/april2024/talk2.yaml
title: "Second Talk"
speaker: "Speaker Two"
duration: 900
```

**Step 2: Write the failing test**

```javascript
// Add to LocalContentAdapter.test.mjs
describe('getList', () => {
  it('returns ListableItem with children for talk folder', async () => {
    const fixtureAdapter = new LocalContentAdapter({
      dataPath: path.resolve(__dirname, '../../../../_fixtures/local-content'),
      mediaPath: '/media'
    });

    const list = await fixtureAdapter.getList('talk:april2024');

    expect(list).not.toBeNull();
    expect(list.id).toBe('talk:april2024');
    expect(list.isContainer()).toBe(true);
    expect(list.children.length).toBe(2);
    expect(list.children[0].title).toBe('First Talk');
  });

  it('returns null for nonexistent folder', async () => {
    const list = await adapter.getList('talk:nonexistent');
    expect(list).toBeNull();
  });
});
```

**Step 3: Implement getList**

```javascript
// Add to LocalContentAdapter.mjs
/**
 * Get list of items in a container
 * @param {string} id - e.g., "talk:april2024"
 * @returns {Promise<ListableItem|null>}
 */
async getList(id) {
  const [prefix, localId] = id.split(':');
  if (!localId) return null;

  if (prefix === 'talk') {
    return this._getTalkFolder(localId);
  }

  return null;
}

/**
 * @private
 */
async _getTalkFolder(folderId) {
  const folderPath = path.join(this.dataPath, 'talks', folderId);

  try {
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      return null;
    }

    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.yaml'));
    const children = [];

    for (const file of files) {
      const talkId = file.replace('.yaml', '');
      const item = await this._getTalk(`${folderId}/${talkId}`);
      if (item) children.push(item);
    }

    return new ListableItem({
      id: `talk:${folderId}`,
      title: folderId,
      type: 'folder',
      children
    });
  } catch (err) {
    return null;
  }
}
```

**Step 4: Commit**

```bash
git add backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs tests/_fixtures/local-content/
git commit -m "feat(adapters): add LocalContentAdapter getList for talk folders"
```

---

## Task 4: LocalContentAdapter - resolvePlayables

**Files:**
- Modify: `backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs`
- Modify: `tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to LocalContentAdapter.test.mjs
describe('resolvePlayables', () => {
  it('returns single item for talk', async () => {
    const fixtureAdapter = new LocalContentAdapter({
      dataPath: path.resolve(__dirname, '../../../../_fixtures/local-content'),
      mediaPath: '/media'
    });

    const playables = await fixtureAdapter.resolvePlayables('talk:general/test-talk');

    expect(playables.length).toBe(1);
    expect(playables[0].id).toBe('talk:general/test-talk');
  });

  it('returns all talks for folder', async () => {
    const fixtureAdapter = new LocalContentAdapter({
      dataPath: path.resolve(__dirname, '../../../../_fixtures/local-content'),
      mediaPath: '/media'
    });

    const playables = await fixtureAdapter.resolvePlayables('talk:april2024');

    expect(playables.length).toBe(2);
    expect(playables.every(p => p.isPlayable())).toBe(true);
  });
});
```

**Step 2: Implement resolvePlayables**

```javascript
// Add to LocalContentAdapter.mjs
/**
 * Resolve ID to playable items
 * @param {string} id
 * @returns {Promise<PlayableItem[]>}
 */
async resolvePlayables(id) {
  // Try as single item first
  const item = await this.getItem(id);
  if (item && item.isPlayable && item.isPlayable()) {
    return [item];
  }

  // Try as container
  const list = await this.getList(id);
  if (list && list.children) {
    return list.children.filter(c => c.isPlayable && c.isPlayable());
  }

  return [];
}
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs
git commit -m "feat(adapters): add LocalContentAdapter resolvePlayables"
```

---

## Task 5: FolderAdapter - Core Implementation

**Files:**
- Create: `backend/src/2_adapters/content/folder/FolderAdapter.mjs`
- Create: `tests/unit/adapters/content/folder/FolderAdapter.test.mjs`
- Create: `tests/_fixtures/folder/watchlist.yaml`

**Step 1: Create test fixture**

```yaml
# tests/_fixtures/folder/watchlist.yaml
- folder: "Morning Shows"
  items:
    - source: plex
      id: "12345"
      title: "Show One"
    - source: plex
      id: "67890"
      title: "Show Two"
- folder: "Evening Talks"
  items:
    - source: local-content
      id: "talk:general/talk1"
      title: "Talk One"
```

**Step 2: Write the failing test**

```javascript
// tests/unit/adapters/content/folder/FolderAdapter.test.mjs
import { FolderAdapter } from '../../../../../backend/src/2_adapters/content/folder/FolderAdapter.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('FolderAdapter', () => {
  let adapter;
  const mockRegistry = {
    getAdapter: jest.fn(),
    resolveItem: jest.fn()
  };

  beforeEach(() => {
    adapter = new FolderAdapter({
      watchlistPath: path.resolve(__dirname, '../../../../_fixtures/folder/watchlist.yaml'),
      registry: mockRegistry
    });
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('requires watchlistPath', () => {
      expect(() => new FolderAdapter({ registry: mockRegistry }))
        .toThrow('requires watchlistPath');
    });
  });

  describe('name', () => {
    it('returns folder', () => {
      expect(adapter.name).toBe('folder');
    });
  });

  describe('prefixes', () => {
    it('returns folder prefix', () => {
      expect(adapter.prefixes).toEqual(['folder']);
    });
  });

  describe('canResolve', () => {
    it('returns true for folder: prefix', () => {
      expect(adapter.canResolve('folder:Morning Shows')).toBe(true);
    });

    it('returns false for other prefixes', () => {
      expect(adapter.canResolve('plex:12345')).toBe(false);
    });
  });

  describe('getList', () => {
    it('returns folder contents', async () => {
      const list = await adapter.getList('folder:Morning Shows');

      expect(list).not.toBeNull();
      expect(list.id).toBe('folder:Morning Shows');
      expect(list.children.length).toBe(2);
    });

    it('returns null for nonexistent folder', async () => {
      const list = await adapter.getList('folder:Nonexistent');
      expect(list).toBeNull();
    });
  });
});
```

**Step 3: Write implementation**

```javascript
// backend/src/2_adapters/content/folder/FolderAdapter.mjs
import fs from 'fs';
import yaml from 'js-yaml';
import { ListableItem } from '../../../1_domains/content/capabilities/Listable.mjs';
import { Item } from '../../../1_domains/content/entities/Item.mjs';

/**
 * Adapter for custom folders/watchlists containing mixed-source items
 */
export class FolderAdapter {
  /**
   * @param {Object} config
   * @param {string} config.watchlistPath - Path to watchlist YAML file
   * @param {Object} [config.registry] - ContentSourceRegistry for resolving items
   */
  constructor(config) {
    if (!config.watchlistPath) throw new Error('FolderAdapter requires watchlistPath');
    this.watchlistPath = config.watchlistPath;
    this.registry = config.registry || null;
    this._watchlistCache = null;
  }

  get name() {
    return 'folder';
  }

  get prefixes() {
    return ['folder'];
  }

  canResolve(id) {
    return id.startsWith('folder:');
  }

  getStoragePath(id) {
    const folderName = id.replace('folder:', '');
    return `folder_${folderName.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  /**
   * Load and cache watchlist
   * @private
   */
  _loadWatchlist() {
    if (this._watchlistCache) return this._watchlistCache;

    try {
      if (!fs.existsSync(this.watchlistPath)) return [];
      const content = fs.readFileSync(this.watchlistPath, 'utf8');
      this._watchlistCache = yaml.load(content) || [];
      return this._watchlistCache;
    } catch (err) {
      return [];
    }
  }

  /**
   * Get list of items in folder
   * @param {string} id - e.g., "folder:Morning Shows"
   * @returns {Promise<ListableItem|null>}
   */
  async getList(id) {
    const folderName = id.replace('folder:', '');
    const watchlist = this._loadWatchlist();

    const folder = watchlist.find(f => f.folder === folderName);
    if (!folder) return null;

    const children = (folder.items || []).map(item => {
      const compoundId = item.source === 'local-content'
        ? item.id
        : `${item.source}:${item.id}`;

      return new Item({
        id: compoundId,
        title: item.title || item.id,
        type: 'reference'
      });
    });

    return new ListableItem({
      id,
      title: folderName,
      type: 'folder',
      children
    });
  }

  /**
   * Get folder metadata
   * @param {string} id
   * @returns {Promise<Item|null>}
   */
  async getItem(id) {
    const list = await this.getList(id);
    if (!list) return null;

    return new Item({
      id,
      title: list.title,
      type: 'folder',
      metadata: { itemCount: list.children.length }
    });
  }

  /**
   * Resolve folder to playable items (delegates to registry)
   * @param {string} id
   * @returns {Promise<Array>}
   */
  async resolvePlayables(id) {
    const list = await this.getList(id);
    if (!list || !this.registry) return [];

    const playables = [];
    for (const child of list.children) {
      const adapter = this.registry.getAdapter(child.id);
      if (adapter && adapter.resolvePlayables) {
        const resolved = await adapter.resolvePlayables(child.id);
        playables.push(...resolved);
      }
    }

    return playables;
  }
}
```

**Step 4: Commit**

```bash
git add backend/src/2_adapters/content/folder/ tests/unit/adapters/content/folder/ tests/_fixtures/folder/
git commit -m "feat(adapters): add FolderAdapter for custom watchlists"
```

---

## Task 6: Register Adapters in Bootstrap

**Files:**
- Modify: `backend/src/0_infrastructure/bootstrap.mjs`
- Create: `tests/unit/infrastructure/bootstrap.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/infrastructure/bootstrap.test.mjs
import { createContentRegistry } from '../../../backend/src/0_infrastructure/bootstrap.mjs';

describe('bootstrap', () => {
  describe('createContentRegistry', () => {
    it('registers LocalContentAdapter', () => {
      const registry = createContentRegistry({
        mediaBasePath: '/media',
        plexHost: 'http://localhost:32400',
        plexToken: 'test',
        dataPath: '/data',
        watchlistPath: '/data/state/watchlist'
      });

      const adapter = registry.getAdapter('local-content');
      expect(adapter).not.toBeNull();
      expect(adapter.name).toBe('local-content');
    });

    it('registers FolderAdapter', () => {
      const registry = createContentRegistry({
        mediaBasePath: '/media',
        plexHost: 'http://localhost:32400',
        plexToken: 'test',
        dataPath: '/data',
        watchlistPath: '/data/state/watchlist'
      });

      const adapter = registry.getAdapter('folder');
      expect(adapter).not.toBeNull();
      expect(adapter.name).toBe('folder');
    });
  });
});
```

**Step 2: Update bootstrap**

```javascript
// backend/src/0_infrastructure/bootstrap.mjs
import { ContentSourceRegistry } from '../1_domains/content/services/ContentSourceRegistry.mjs';
import { FilesystemAdapter } from '../2_adapters/content/media/filesystem/FilesystemAdapter.mjs';
import { PlexAdapter } from '../2_adapters/content/media/plex/PlexAdapter.mjs';
import { LocalContentAdapter } from '../2_adapters/content/local-content/LocalContentAdapter.mjs';
import { FolderAdapter } from '../2_adapters/content/folder/FolderAdapter.mjs';
import { YamlWatchStateStore } from '../2_adapters/persistence/yaml/YamlWatchStateStore.mjs';

/**
 * Create and configure the content source registry
 * @param {Object} config
 * @returns {ContentSourceRegistry}
 */
export function createContentRegistry(config) {
  const registry = new ContentSourceRegistry();

  // Register filesystem adapter
  registry.register(new FilesystemAdapter({
    mediaBasePath: config.mediaBasePath
  }));

  // Register Plex adapter
  registry.register(new PlexAdapter({
    host: config.plexHost,
    token: config.plexToken
  }));

  // Register local content adapter
  if (config.dataPath) {
    registry.register(new LocalContentAdapter({
      dataPath: config.dataPath,
      mediaPath: config.mediaBasePath
    }));
  }

  // Register folder adapter
  if (config.watchlistPath) {
    registry.register(new FolderAdapter({
      watchlistPath: config.watchlistPath,
      registry
    }));
  }

  return registry;
}

/**
 * Create watch state store
 * @param {Object} config
 * @returns {YamlWatchStateStore}
 */
export function createWatchStore(config) {
  return new YamlWatchStateStore({
    basePath: config.watchStatePath
  });
}
```

**Step 3: Commit**

```bash
git add backend/src/0_infrastructure/bootstrap.mjs tests/unit/infrastructure/bootstrap.test.mjs
git commit -m "feat(bootstrap): register LocalContentAdapter and FolderAdapter"
```

---

## Task 7: Legacy Compatibility - Media Log Shim

**Files:**
- Create: `backend/src/4_api/middleware/legacyCompat.mjs`
- Create: `tests/unit/api/middleware/legacyCompat.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/api/middleware/legacyCompat.test.mjs
import { translateMediaLogRequest, translateMediaLogResponse } from '../../../../backend/src/4_api/middleware/legacyCompat.mjs';

describe('legacyCompat', () => {
  describe('translateMediaLogRequest', () => {
    it('translates plex log to new format', () => {
      const legacyBody = {
        type: 'plex',
        library: '12345',
        playhead: 600,
        mediaDuration: 1200
      };

      const result = translateMediaLogRequest(legacyBody);

      expect(result.source).toBe('plex');
      expect(result.itemId).toBe('plex:12345');
      expect(result.playhead).toBe(600);
      expect(result.duration).toBe(1200);
    });

    it('translates talk log to new format', () => {
      const legacyBody = {
        type: 'talk',
        library: 'general/talk1',
        playhead: 300,
        mediaDuration: 600
      };

      const result = translateMediaLogRequest(legacyBody);

      expect(result.source).toBe('local-content');
      expect(result.itemId).toBe('talk:general/talk1');
    });
  });

  describe('translateMediaLogResponse', () => {
    it('translates new response to legacy format', () => {
      const newResponse = {
        itemId: 'plex:12345',
        playhead: 600,
        duration: 1200,
        percent: 50
      };

      const result = translateMediaLogResponse(newResponse, 'plex');

      expect(result.type).toBe('plex');
      expect(result.library).toBe('12345');
      expect(result.playhead).toBe(600);
      expect(result.mediaDuration).toBe(1200);
    });
  });
});
```

**Step 2: Implement translation functions**

```javascript
// backend/src/4_api/middleware/legacyCompat.mjs

/**
 * Map legacy type to new source name
 */
const TYPE_TO_SOURCE = {
  plex: 'plex',
  talk: 'local-content',
  scripture: 'local-content',
  hymn: 'local-content',
  audio: 'filesystem',
  video: 'filesystem'
};

/**
 * Map legacy type to compound ID prefix
 */
const TYPE_TO_PREFIX = {
  plex: 'plex',
  talk: 'talk',
  scripture: 'scripture',
  hymn: 'hymn',
  audio: 'filesystem',
  video: 'filesystem'
};

/**
 * Translate legacy POST /media/log body to new format
 * @param {Object} body - Legacy request body
 * @returns {Object} New format { source, itemId, playhead, duration }
 */
export function translateMediaLogRequest(body) {
  const { type, library, playhead, mediaDuration } = body;

  const source = TYPE_TO_SOURCE[type] || 'filesystem';
  const prefix = TYPE_TO_PREFIX[type] || 'filesystem';
  const itemId = `${prefix}:${library}`;

  return {
    source,
    itemId,
    playhead: playhead || 0,
    duration: mediaDuration || 0
  };
}

/**
 * Translate new response to legacy format
 * @param {Object} response - New format response
 * @param {string} legacyType - Original legacy type
 * @returns {Object} Legacy format
 */
export function translateMediaLogResponse(response, legacyType) {
  const localId = response.itemId.includes(':')
    ? response.itemId.split(':').slice(1).join(':')
    : response.itemId;

  return {
    type: legacyType,
    library: localId,
    playhead: response.playhead,
    mediaDuration: response.duration,
    watchProgress: response.percent
  };
}

/**
 * Express middleware that wraps legacy /media/log endpoint
 */
export function legacyMediaLogMiddleware(watchStore) {
  return async (req, res, next) => {
    try {
      const translated = translateMediaLogRequest(req.body);
      const { WatchState } = await import('../../1_domains/content/entities/WatchState.mjs');

      const state = new WatchState({
        itemId: translated.itemId,
        playhead: translated.playhead,
        duration: translated.duration,
        lastPlayed: new Date().toISOString()
      });

      const storagePath = req.body.type || 'default';
      await watchStore.set(state, storagePath);

      const legacyResponse = translateMediaLogResponse(state.toJSON(), req.body.type);
      res.json(legacyResponse);
    } catch (err) {
      next(err);
    }
  };
}
```

**Step 3: Commit**

```bash
git add backend/src/4_api/middleware/legacyCompat.mjs tests/unit/api/middleware/legacyCompat.test.mjs
git commit -m "feat(api): add legacy compatibility shim for media log"
```

---

## Task 8: Wire Legacy Shim in Backend

**Files:**
- Modify: `backend/_legacy/index.js`

**Step 1: Update legacy index to use shim**

```javascript
// Add to backend/_legacy/index.js after existing imports
const { legacyMediaLogMiddleware } = await import('../src/4_api/middleware/legacyCompat.mjs');

// Replace or wrap existing /media/log endpoint
// Find existing media log handler and add shim
app.post('/media/log', legacyMediaLogMiddleware(watchStore));
```

**Step 2: Verify backend starts**

Run: `npm run dev` and check logs for errors

**Step 3: Commit**

```bash
git add backend/_legacy/index.js
git commit -m "feat(backend): wire legacy media log shim"
```

---

## Summary

Phase 3 implements:

1. **LocalContentAdapter** - Handles talks and scriptures with YAML metadata
2. **FolderAdapter** - Manages custom watchlists with mixed-source items
3. **Bootstrap registration** - Both adapters wired into the system
4. **Legacy compatibility shim** - Translates old `/media/log` to new format

After Phase 3, the system supports:
- `talk:folder/talkid` - Local talks with YAML metadata
- `scripture:volume/version/verse` - Scripture references
- `folder:FolderName` - Custom playlists from watchlist.yaml
- Legacy `/media/log` endpoint continues working

**Next Phase (4):** Frontend migration to use new content API endpoints.
