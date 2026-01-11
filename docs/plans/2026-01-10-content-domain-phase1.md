# Content Domain Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the Content domain foundation - core types, adapter registry, filesystem adapter, and one unified API endpoint.

**Architecture:** Domain-Driven Design with hexagonal/ports-and-adapters pattern. Domain entities are pure (no I/O), adapters implement ports and talk to external systems. Registry wires everything together.

**Tech Stack:** JavaScript (ES Modules), Express.js, Jest for testing. JSDoc for type hints.

**Reference Docs:**
- `docs/_wip/plans/2026-01-10-backend-ddd-architecture.md` - Overall DDD structure
- `docs/_wip/plans/2026-01-10-unified-domain-backend-design.md` - Content domain details
- `docs/_wip/plans/2026-01-10-api-consumer-inventory.md` - Frontend API usage

---

## Phase 1a: Core Domain Types (Foundation)

### Task 1: Create Item base entity

**Files:**
- Create: `backend/src/domains/content/entities/Item.mjs`
- Test: `tests/unit/content/entities/Item.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/content/entities/Item.test.mjs
import { Item } from '../../../../backend/src/domains/content/entities/Item.mjs';

describe('Item entity', () => {
  test('creates item with required fields', () => {
    const item = new Item({
      id: 'plex:12345',
      source: 'plex',
      title: 'Test Movie'
    });

    expect(item.id).toBe('plex:12345');
    expect(item.source).toBe('plex');
    expect(item.title).toBe('Test Movie');
  });

  test('includes optional fields when provided', () => {
    const item = new Item({
      id: 'filesystem:audio/song.mp3',
      source: 'filesystem',
      title: 'My Song',
      thumbnail: '/proxy/filesystem/thumb/audio/song.mp3',
      description: 'A great song',
      metadata: { artist: 'Artist Name' }
    });

    expect(item.thumbnail).toBe('/proxy/filesystem/thumb/audio/song.mp3');
    expect(item.description).toBe('A great song');
    expect(item.metadata.artist).toBe('Artist Name');
  });

  test('throws on missing required fields', () => {
    expect(() => new Item({ id: 'test' })).toThrow();
    expect(() => new Item({ source: 'plex' })).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/entities/Item.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/domains/content/entities/Item.mjs

/**
 * @typedef {Object} ItemProps
 * @property {string} id - Compound ID: "source:localId"
 * @property {string} source - Adapter source name
 * @property {string} title - Display title
 * @property {string} [thumbnail] - Proxied thumbnail URL
 * @property {string} [description] - Item description
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * Base entity for all content items in the system.
 * Every object inherits from Item.
 */
export class Item {
  /**
   * @param {ItemProps} props
   */
  constructor(props) {
    if (!props.id) throw new Error('Item requires id');
    if (!props.source) throw new Error('Item requires source');
    if (!props.title) throw new Error('Item requires title');

    this.id = props.id;
    this.source = props.source;
    this.title = props.title;
    this.thumbnail = props.thumbnail ?? null;
    this.description = props.description ?? null;
    this.metadata = props.metadata ?? {};
  }

  /**
   * Extract local ID from compound ID
   * @returns {string}
   */
  getLocalId() {
    const colonIndex = this.id.indexOf(':');
    return colonIndex > -1 ? this.id.substring(colonIndex + 1) : this.id;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/entities/Item.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/domains/content/entities/Item.mjs tests/unit/content/entities/Item.test.mjs
git commit -m "feat(content): add Item base entity"
```

---

### Task 2: Create Listable capability

**Files:**
- Create: `backend/src/domains/content/capabilities/Listable.mjs`
- Test: `tests/unit/content/capabilities/Listable.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/content/capabilities/Listable.test.mjs
import { ListableItem } from '../../../../backend/src/domains/content/capabilities/Listable.mjs';

describe('Listable capability', () => {
  test('creates listable item with itemType', () => {
    const item = new ListableItem({
      id: 'plex:12345',
      source: 'plex',
      title: 'TV Show',
      itemType: 'container',
      childCount: 5
    });

    expect(item.itemType).toBe('container');
    expect(item.childCount).toBe(5);
    expect(item.isContainer()).toBe(true);
  });

  test('leaf items have no children', () => {
    const item = new ListableItem({
      id: 'plex:67890',
      source: 'plex',
      title: 'Episode',
      itemType: 'leaf'
    });

    expect(item.itemType).toBe('leaf');
    expect(item.isContainer()).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/capabilities/Listable.test.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

```javascript
// backend/src/domains/content/capabilities/Listable.mjs
import { Item } from '../entities/Item.mjs';

/**
 * @typedef {'container' | 'leaf'} ItemType
 */

/**
 * Listable capability - items that can appear in lists and be browsed.
 * Containers have children, leaves are terminal nodes.
 */
export class ListableItem extends Item {
  /**
   * @param {Object} props
   * @param {ItemType} props.itemType
   * @param {number} [props.childCount]
   * @param {number} [props.sortOrder]
   */
  constructor(props) {
    super(props);
    this.itemType = props.itemType;
    this.childCount = props.childCount ?? 0;
    this.sortOrder = props.sortOrder ?? 0;
  }

  isContainer() {
    return this.itemType === 'container';
  }
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/capabilities/Listable.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/domains/content/capabilities/Listable.mjs tests/unit/content/capabilities/Listable.test.mjs
git commit -m "feat(content): add Listable capability"
```

---

### Task 3: Create Playable capability

**Files:**
- Create: `backend/src/domains/content/capabilities/Playable.mjs`
- Test: `tests/unit/content/capabilities/Playable.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/content/capabilities/Playable.test.mjs
import { PlayableItem } from '../../../../backend/src/domains/content/capabilities/Playable.mjs';

describe('Playable capability', () => {
  test('creates playable video item', () => {
    const item = new PlayableItem({
      id: 'plex:12345',
      source: 'plex',
      title: 'Movie',
      mediaType: 'video',
      mediaUrl: '/proxy/plex/stream/12345',
      duration: 7200,
      resumable: true
    });

    expect(item.mediaType).toBe('video');
    expect(item.mediaUrl).toBe('/proxy/plex/stream/12345');
    expect(item.duration).toBe(7200);
    expect(item.resumable).toBe(true);
  });

  test('audio items are not resumable by default', () => {
    const item = new PlayableItem({
      id: 'filesystem:audio/song.mp3',
      source: 'filesystem',
      title: 'Song',
      mediaType: 'audio',
      mediaUrl: '/proxy/filesystem/stream/audio/song.mp3',
      duration: 180,
      resumable: false
    });

    expect(item.resumable).toBe(false);
  });

  test('supports resume position', () => {
    const item = new PlayableItem({
      id: 'plex:12345',
      source: 'plex',
      title: 'Movie',
      mediaType: 'video',
      mediaUrl: '/proxy/plex/stream/12345',
      duration: 7200,
      resumable: true,
      resumePosition: 3600
    });

    expect(item.resumePosition).toBe(3600);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/capabilities/Playable.test.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

```javascript
// backend/src/domains/content/capabilities/Playable.mjs
import { Item } from '../entities/Item.mjs';

/**
 * @typedef {'audio' | 'video' | 'live' | 'composite'} MediaType
 */

/**
 * Playable capability - items that can be played/streamed.
 */
export class PlayableItem extends Item {
  /**
   * @param {Object} props
   * @param {MediaType} props.mediaType
   * @param {string} props.mediaUrl
   * @param {number} [props.duration]
   * @param {boolean} props.resumable
   * @param {number} [props.resumePosition]
   * @param {number} [props.playbackRate]
   */
  constructor(props) {
    super(props);
    this.mediaType = props.mediaType;
    this.mediaUrl = props.mediaUrl;
    this.duration = props.duration ?? null;
    this.resumable = props.resumable;
    this.resumePosition = props.resumePosition ?? null;
    this.playbackRate = props.playbackRate ?? 1.0;
  }

  /**
   * Get progress as percentage (0-100)
   * @returns {number|null}
   */
  getProgress() {
    if (!this.resumable || !this.duration || !this.resumePosition) {
      return null;
    }
    return Math.round((this.resumePosition / this.duration) * 100);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/capabilities/Playable.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/domains/content/capabilities/Playable.mjs tests/unit/content/capabilities/Playable.test.mjs
git commit -m "feat(content): add Playable capability"
```

---

### Task 4: Create IContentSource port interface

**Files:**
- Create: `backend/src/domains/content/ports/IContentSource.mjs`
- Test: `tests/unit/content/ports/IContentSource.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/content/ports/IContentSource.test.mjs
import { IContentSource, validateAdapter } from '../../../../backend/src/domains/content/ports/IContentSource.mjs';

describe('IContentSource port', () => {
  test('validateAdapter rejects invalid adapter', () => {
    expect(() => validateAdapter({})).toThrow('must have source property');
    expect(() => validateAdapter({ source: 'test' })).toThrow('must have prefixes array');
  });

  test('validateAdapter accepts valid adapter structure', () => {
    const validAdapter = {
      source: 'test',
      prefixes: [{ prefix: 'test' }],
      getItem: async () => null,
      getList: async () => [],
      resolvePlayables: async () => []
    };

    expect(() => validateAdapter(validAdapter)).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/ports/IContentSource.test.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

```javascript
// backend/src/domains/content/ports/IContentSource.mjs

/**
 * @typedef {Object} PrefixMapping
 * @property {string} prefix - The prefix string (e.g., "plex", "hymn")
 * @property {function(string): string} [idTransform] - Optional transform function
 */

/**
 * @typedef {Object} IContentSource
 * @property {string} source - Unique source identifier
 * @property {PrefixMapping[]} prefixes - Registered prefix mappings
 * @property {function(string): Promise<import('../entities/Item.mjs').Item|null>} getItem
 * @property {function(string): Promise<import('../capabilities/Listable.mjs').ListableItem[]>} getList
 * @property {function(string): Promise<import('../capabilities/Playable.mjs').PlayableItem[]>} resolvePlayables
 * @property {function(string): Promise<string>} [getStoragePath] - Optional storage path for watch state
 */

/**
 * Validates that an object implements the IContentSource interface.
 * @param {any} adapter
 * @throws {Error} If validation fails
 */
export function validateAdapter(adapter) {
  if (!adapter.source || typeof adapter.source !== 'string') {
    throw new Error('Adapter must have source property (string)');
  }

  if (!Array.isArray(adapter.prefixes)) {
    throw new Error('Adapter must have prefixes array');
  }

  if (typeof adapter.getItem !== 'function') {
    throw new Error('Adapter must implement getItem(id): Promise<Item|null>');
  }

  if (typeof adapter.getList !== 'function') {
    throw new Error('Adapter must implement getList(id): Promise<Listable[]>');
  }

  if (typeof adapter.resolvePlayables !== 'function') {
    throw new Error('Adapter must implement resolvePlayables(id): Promise<Playable[]>');
  }
}

/**
 * Base class for content source adapters.
 * Extend this to implement concrete adapters.
 */
export class ContentSourceBase {
  constructor() {
    if (this.constructor === ContentSourceBase) {
      throw new Error('ContentSourceBase is abstract');
    }
  }

  /** @type {string} */
  get source() {
    throw new Error('source must be implemented');
  }

  /** @type {PrefixMapping[]} */
  get prefixes() {
    throw new Error('prefixes must be implemented');
  }

  /**
   * @param {string} id
   * @returns {Promise<import('../entities/Item.mjs').Item|null>}
   */
  async getItem(id) {
    throw new Error('getItem must be implemented');
  }

  /**
   * @param {string} id
   * @returns {Promise<import('../capabilities/Listable.mjs').ListableItem[]>}
   */
  async getList(id) {
    throw new Error('getList must be implemented');
  }

  /**
   * @param {string} id
   * @returns {Promise<import('../capabilities/Playable.mjs').PlayableItem[]>}
   */
  async resolvePlayables(id) {
    throw new Error('resolvePlayables must be implemented');
  }
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/ports/IContentSource.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/domains/content/ports/IContentSource.mjs tests/unit/content/ports/IContentSource.test.mjs
git commit -m "feat(content): add IContentSource port interface"
```

---

### Task 5: Create ContentSourceRegistry

**Files:**
- Create: `backend/src/domains/content/services/ContentSourceRegistry.mjs`
- Test: `tests/unit/content/services/ContentSourceRegistry.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/content/services/ContentSourceRegistry.test.mjs
import { ContentSourceRegistry } from '../../../../backend/src/domains/content/services/ContentSourceRegistry.mjs';

describe('ContentSourceRegistry', () => {
  let registry;

  const mockPlexAdapter = {
    source: 'plex',
    prefixes: [{ prefix: 'plex' }],
    getItem: async () => null,
    getList: async () => [],
    resolvePlayables: async () => []
  };

  const mockFilesystemAdapter = {
    source: 'filesystem',
    prefixes: [
      { prefix: 'media' },
      { prefix: 'file' }
    ],
    getItem: async () => null,
    getList: async () => [],
    resolvePlayables: async () => []
  };

  beforeEach(() => {
    registry = new ContentSourceRegistry();
  });

  test('registers adapter by source name', () => {
    registry.register(mockPlexAdapter);
    expect(registry.get('plex')).toBe(mockPlexAdapter);
  });

  test('resolves adapter from prefix', () => {
    registry.register(mockFilesystemAdapter);

    const result = registry.resolveFromPrefix('media', 'audio/song.mp3');
    expect(result.adapter).toBe(mockFilesystemAdapter);
    expect(result.localId).toBe('audio/song.mp3');
  });

  test('resolve handles compound ID', () => {
    registry.register(mockPlexAdapter);

    const result = registry.resolve('plex:12345');
    expect(result.adapter).toBe(mockPlexAdapter);
    expect(result.localId).toBe('12345');
  });

  test('returns null for unknown source', () => {
    expect(registry.resolve('unknown:123')).toBeNull();
  });

  test('lists registered prefixes', () => {
    registry.register(mockPlexAdapter);
    registry.register(mockFilesystemAdapter);

    const prefixes = registry.getRegisteredPrefixes();
    expect(prefixes).toContain('plex');
    expect(prefixes).toContain('media');
    expect(prefixes).toContain('file');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/services/ContentSourceRegistry.test.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

```javascript
// backend/src/domains/content/services/ContentSourceRegistry.mjs
import { validateAdapter } from '../ports/IContentSource.mjs';

/**
 * Registry for content source adapters.
 * Provides lookup by source name and prefix resolution.
 */
export class ContentSourceRegistry {
  constructor() {
    /** @type {Map<string, import('../ports/IContentSource.mjs').IContentSource>} */
    this.adapters = new Map();

    /** @type {Map<string, {adapter: any, transform?: function}>} */
    this.prefixMap = new Map();
  }

  /**
   * Register an adapter
   * @param {import('../ports/IContentSource.mjs').IContentSource} adapter
   */
  register(adapter) {
    validateAdapter(adapter);

    this.adapters.set(adapter.source, adapter);

    // Build prefix map from adapter's declared prefixes
    for (const mapping of adapter.prefixes) {
      this.prefixMap.set(mapping.prefix, {
        adapter,
        transform: mapping.idTransform
      });
    }
  }

  /**
   * Get adapter by source name
   * @param {string} source
   * @returns {import('../ports/IContentSource.mjs').IContentSource|undefined}
   */
  get(source) {
    return this.adapters.get(source);
  }

  /**
   * Resolve from prefix (e.g., "media" → FilesystemAdapter)
   * @param {string} prefix
   * @param {string} value
   * @returns {{adapter: any, localId: string}|null}
   */
  resolveFromPrefix(prefix, value) {
    const entry = this.prefixMap.get(prefix);
    if (!entry) return null;

    const localId = entry.transform ? entry.transform(value) : value;
    return { adapter: entry.adapter, localId };
  }

  /**
   * Resolve compound ID (e.g., "plex:12345")
   * @param {string} compoundId
   * @returns {{adapter: any, localId: string}|null}
   */
  resolve(compoundId) {
    const colonIndex = compoundId.indexOf(':');
    if (colonIndex === -1) {
      // No colon - treat as filesystem path (default adapter)
      const defaultAdapter = this.adapters.get('filesystem');
      return defaultAdapter ? { adapter: defaultAdapter, localId: compoundId } : null;
    }

    const source = compoundId.substring(0, colonIndex);
    const localId = compoundId.substring(colonIndex + 1);

    // First try exact source match
    const adapter = this.adapters.get(source);
    if (adapter) {
      return { adapter, localId };
    }

    // Fall back to prefix resolution
    return this.resolveFromPrefix(source, localId);
  }

  /**
   * List all registered prefixes
   * @returns {string[]}
   */
  getRegisteredPrefixes() {
    return Array.from(this.prefixMap.keys());
  }

  /**
   * Check if a compound ID can be resolved
   * @param {string} compoundId
   * @returns {boolean}
   */
  canResolve(compoundId) {
    return this.resolve(compoundId) !== null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/content/services/ContentSourceRegistry.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/domains/content/services/ContentSourceRegistry.mjs tests/unit/content/services/ContentSourceRegistry.test.mjs
git commit -m "feat(content): add ContentSourceRegistry"
```

---

### Task 6: Create index exports for content domain

**Files:**
- Create: `backend/src/domains/content/index.mjs`

**Step 1: Write the exports file**

```javascript
// backend/src/domains/content/index.mjs

// Entities
export { Item } from './entities/Item.mjs';

// Capabilities
export { ListableItem } from './capabilities/Listable.mjs';
export { PlayableItem } from './capabilities/Playable.mjs';

// Ports
export { validateAdapter, ContentSourceBase } from './ports/IContentSource.mjs';

// Services
export { ContentSourceRegistry } from './services/ContentSourceRegistry.mjs';
```

**Step 2: Verify import works**

Run: `node -e "import('./backend/src/domains/content/index.mjs').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'Item', 'ListableItem', 'PlayableItem', 'validateAdapter', 'ContentSourceBase', 'ContentSourceRegistry' ]`

**Step 3: Commit**

```bash
git add backend/src/domains/content/index.mjs
git commit -m "feat(content): add content domain index exports"
```

---

## Phase 1b: FilesystemAdapter

### Task 7: Create FilesystemAdapter

**Files:**
- Create: `backend/src/adapters/content/media/filesystem/FilesystemAdapter.mjs`
- Test: `tests/unit/adapters/content/FilesystemAdapter.test.mjs`
- Fixture: `tests/_fixtures/media/` (create test media files)

**Step 1: Create test fixtures**

```bash
mkdir -p tests/_fixtures/media/audio
mkdir -p tests/_fixtures/media/video
echo "test audio content" > tests/_fixtures/media/audio/test.mp3
echo "test video content" > tests/_fixtures/media/video/test.mp4
```

**Step 2: Write the failing test**

```javascript
// tests/unit/adapters/content/FilesystemAdapter.test.mjs
import { FilesystemAdapter } from '../../../../backend/src/adapters/content/media/filesystem/FilesystemAdapter.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../../_fixtures/media');

describe('FilesystemAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new FilesystemAdapter({ mediaBasePath: fixturesPath });
  });

  test('has correct source and prefixes', () => {
    expect(adapter.source).toBe('filesystem');
    expect(adapter.prefixes).toContainEqual({ prefix: 'media' });
    expect(adapter.prefixes).toContainEqual({ prefix: 'file' });
  });

  test('getItem returns item for existing file', async () => {
    const item = await adapter.getItem('audio/test.mp3');

    expect(item).not.toBeNull();
    expect(item.id).toBe('filesystem:audio/test.mp3');
    expect(item.source).toBe('filesystem');
    expect(item.mediaType).toBe('audio');
  });

  test('getItem returns null for missing file', async () => {
    const item = await adapter.getItem('nonexistent.mp3');
    expect(item).toBeNull();
  });

  test('getList returns directory contents', async () => {
    const list = await adapter.getList('audio');

    expect(list.length).toBeGreaterThan(0);
    expect(list[0].itemType).toBe('leaf');
  });

  test('resolvePlayables flattens directory', async () => {
    const playables = await adapter.resolvePlayables('audio');

    expect(playables.length).toBeGreaterThan(0);
    expect(playables[0].mediaUrl).toBeDefined();
  });
});
```

**Step 3: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/content/FilesystemAdapter.test.mjs`
Expected: FAIL

**Step 4: Write minimal implementation**

```javascript
// backend/src/adapters/content/media/filesystem/FilesystemAdapter.mjs
import fs from 'fs';
import path from 'path';
import { Item } from '../../../../domains/content/entities/Item.mjs';
import { ListableItem } from '../../../../domains/content/capabilities/Listable.mjs';
import { PlayableItem } from '../../../../domains/content/capabilities/Playable.mjs';

const MEDIA_PREFIXES = ['', 'audio', 'video', 'img'];

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
};

const AUDIO_EXTS = ['.mp3', '.m4a', '.wav', '.flac', '.ogg'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.avi'];

/**
 * Filesystem adapter for raw media files.
 */
export class FilesystemAdapter {
  /**
   * @param {Object} config
   * @param {string} config.mediaBasePath - Base path for media files
   */
  constructor(config) {
    this.mediaBasePath = config.mediaBasePath;
  }

  get source() {
    return 'filesystem';
  }

  get prefixes() {
    return [
      { prefix: 'media' },
      { prefix: 'file' },
      { prefix: 'fs' }
    ];
  }

  /**
   * Resolve a media key to actual path with fallback prefixes
   * @param {string} mediaKey
   * @returns {{path: string, prefix: string}|null}
   */
  resolvePath(mediaKey) {
    mediaKey = mediaKey.replace(/^\//, '');

    for (const prefix of MEDIA_PREFIXES) {
      const candidate = prefix
        ? path.join(this.mediaBasePath, prefix, mediaKey)
        : path.join(this.mediaBasePath, mediaKey);

      if (fs.existsSync(candidate)) {
        return { path: candidate, prefix };
      }
    }

    // Try adding extensions
    const exts = [...AUDIO_EXTS, ...VIDEO_EXTS];
    for (const ext of exts) {
      for (const prefix of MEDIA_PREFIXES) {
        const candidate = prefix
          ? path.join(this.mediaBasePath, prefix, mediaKey + ext)
          : path.join(this.mediaBasePath, mediaKey + ext);

        if (fs.existsSync(candidate)) {
          return { path: candidate, prefix };
        }
      }
    }

    return null;
  }

  /**
   * Get media type from extension
   * @param {string} ext
   * @returns {'audio'|'video'|'image'}
   */
  getMediaType(ext) {
    ext = ext.toLowerCase();
    if (AUDIO_EXTS.includes(ext)) return 'audio';
    if (VIDEO_EXTS.includes(ext)) return 'video';
    return 'image';
  }

  /**
   * @param {string} id
   * @returns {Promise<PlayableItem|null>}
   */
  async getItem(id) {
    const resolved = this.resolvePath(id);
    if (!resolved) return null;

    const stats = fs.statSync(resolved.path);
    if (stats.isDirectory()) {
      return new ListableItem({
        id: `filesystem:${id}`,
        source: 'filesystem',
        title: path.basename(id),
        itemType: 'container',
        childCount: fs.readdirSync(resolved.path).length
      });
    }

    const ext = path.extname(resolved.path).toLowerCase();
    const mediaType = this.getMediaType(ext);

    return new PlayableItem({
      id: `filesystem:${id}`,
      source: 'filesystem',
      title: path.basename(id, ext),
      mediaType,
      mediaUrl: `/proxy/filesystem/stream/${encodeURIComponent(id)}`,
      resumable: mediaType === 'video',
      metadata: {
        filePath: resolved.path,
        fileSize: stats.size,
        mimeType: MIME_TYPES[ext] || 'application/octet-stream'
      }
    });
  }

  /**
   * @param {string} id
   * @returns {Promise<ListableItem[]>}
   */
  async getList(id) {
    const resolved = this.resolvePath(id);
    if (!resolved) return [];

    const stats = fs.statSync(resolved.path);
    if (!stats.isDirectory()) return [];

    const entries = fs.readdirSync(resolved.path);
    const items = [];

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;

      const entryPath = path.join(resolved.path, entry);
      const entryStats = fs.statSync(entryPath);
      const entryId = id ? `${id}/${entry}` : entry;

      if (entryStats.isDirectory()) {
        items.push(new ListableItem({
          id: `filesystem:${entryId}`,
          source: 'filesystem',
          title: entry,
          itemType: 'container',
          childCount: fs.readdirSync(entryPath).length
        }));
      } else {
        const ext = path.extname(entry).toLowerCase();
        if (AUDIO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext)) {
          items.push(new ListableItem({
            id: `filesystem:${entryId}`,
            source: 'filesystem',
            title: path.basename(entry, ext),
            itemType: 'leaf'
          }));
        }
      }
    }

    return items;
  }

  /**
   * @param {string} id
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id) {
    const list = await this.getList(id);
    const playables = [];

    for (const item of list) {
      if (item.itemType === 'leaf') {
        const localId = item.id.replace('filesystem:', '');
        const playable = await this.getItem(localId);
        if (playable) playables.push(playable);
      } else if (item.itemType === 'container') {
        const localId = item.id.replace('filesystem:', '');
        const children = await this.resolvePlayables(localId);
        playables.push(...children);
      }
    }

    return playables;
  }

  /**
   * @param {string} id
   * @returns {Promise<string>}
   */
  async getStoragePath(id) {
    return 'media';
  }
}
```

**Step 5: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/content/FilesystemAdapter.test.mjs`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/adapters/content/media/filesystem/FilesystemAdapter.mjs tests/unit/adapters/content/FilesystemAdapter.test.mjs tests/_fixtures/media/
git commit -m "feat(adapters): add FilesystemAdapter for content domain"
```

---

## Phase 1c: Integration Wiring

### Task 8: Update infrastructure bootstrap

**Files:**
- Modify: `backend/src/infrastructure/bootstrap.ts` → rename to `.mjs`
- Test: Manual smoke test

**Step 1: Rename and implement bootstrap**

```bash
mv backend/src/infrastructure/bootstrap.ts backend/src/infrastructure/bootstrap.mjs
```

```javascript
// backend/src/infrastructure/bootstrap.mjs
import { ContentSourceRegistry } from '../domains/content/services/ContentSourceRegistry.mjs';
import { FilesystemAdapter } from '../adapters/content/media/filesystem/FilesystemAdapter.mjs';

/**
 * Create and configure the adapter registry
 * @param {Object} config
 * @param {string} config.mediaBasePath
 * @returns {ContentSourceRegistry}
 */
export function createContentRegistry(config) {
  const registry = new ContentSourceRegistry();

  // Register filesystem adapter
  registry.register(new FilesystemAdapter({
    mediaBasePath: config.mediaBasePath
  }));

  // TODO: Register PlexAdapter when implemented
  // registry.register(new PlexAdapter(config.plex));

  return registry;
}
```

**Step 2: Commit**

```bash
git add backend/src/infrastructure/bootstrap.mjs
git rm backend/src/infrastructure/bootstrap.ts 2>/dev/null || true
git commit -m "feat(infrastructure): add bootstrap with content registry"
```

---

### Task 9: Create API router for content

**Files:**
- Create: `backend/src/api/routers/content.mjs`
- Test: `tests/integration/api/content.test.mjs`

**Step 1: Write the integration test**

```javascript
// tests/integration/api/content.test.mjs
import express from 'express';
import request from 'supertest';
import { createContentRouter } from '../../../../backend/src/api/routers/content.mjs';
import { ContentSourceRegistry } from '../../../../backend/src/domains/content/services/ContentSourceRegistry.mjs';
import { FilesystemAdapter } from '../../../../backend/src/adapters/content/media/filesystem/FilesystemAdapter.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../_fixtures/media');

describe('Content API Router', () => {
  let app;
  let registry;

  beforeAll(() => {
    registry = new ContentSourceRegistry();
    registry.register(new FilesystemAdapter({ mediaBasePath: fixturesPath }));

    app = express();
    app.use('/api/content', createContentRouter(registry));
  });

  test('GET /api/content/list/filesystem/:path returns directory listing', async () => {
    const res = await request(app).get('/api/content/list/filesystem/audio');

    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  test('GET /api/content/item/filesystem/:path returns item info', async () => {
    const res = await request(app).get('/api/content/item/filesystem/audio/test.mp3');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('filesystem:audio/test.mp3');
    expect(res.body.source).toBe('filesystem');
  });

  test('GET /api/content/item returns 404 for missing', async () => {
    const res = await request(app).get('/api/content/item/filesystem/nonexistent.mp3');

    expect(res.status).toBe(404);
  });
});
```

**Step 2: Install test dependency if needed**

Run: `npm install --save-dev supertest` (in backend directory if not present)

**Step 3: Write the router implementation**

```javascript
// backend/src/api/routers/content.mjs
import express from 'express';

/**
 * Create content API router
 * @param {import('../../domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} registry
 * @returns {express.Router}
 */
export function createContentRouter(registry) {
  const router = express.Router();

  /**
   * GET /api/content/list/:source/*
   * List items from a content source
   */
  router.get('/list/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      const localId = req.params[0] || '';

      const adapter = registry.get(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      const items = await adapter.getList(localId);
      res.json({
        source,
        path: localId,
        items: items.map(item => ({
          id: item.id,
          title: item.title,
          itemType: item.itemType,
          childCount: item.childCount,
          thumbnail: item.thumbnail
        }))
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/content/item/:source/*
   * Get single item info
   */
  router.get('/item/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      const localId = req.params[0] || '';

      const adapter = registry.get(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      const item = await adapter.getItem(localId);
      if (!item) {
        return res.status(404).json({ error: 'Item not found', source, localId });
      }

      res.json(item);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/content/playables/:source/*
   * Resolve to playable items
   */
  router.get('/playables/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      const localId = req.params[0] || '';

      const adapter = registry.get(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      const playables = await adapter.resolvePlayables(localId);
      res.json({
        source,
        path: localId,
        items: playables
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/api/content.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/api/routers/content.mjs tests/integration/api/content.test.mjs
git commit -m "feat(api): add content router with list/item/playables endpoints"
```

---

## Summary

**Tasks completed in this plan:**

1. ✅ Task 1: Item base entity
2. ✅ Task 2: Listable capability
3. ✅ Task 3: Playable capability
4. ✅ Task 4: IContentSource port interface
5. ✅ Task 5: ContentSourceRegistry
6. ✅ Task 6: Content domain index exports
7. ✅ Task 7: FilesystemAdapter
8. ✅ Task 8: Infrastructure bootstrap
9. ✅ Task 9: Content API router

**Next steps (Phase 1d - separate plan):**
- PlexAdapter implementation
- Queueable capability
- QueueService with heuristics
- Legacy API compatibility shim
- Integration with main backend

**Dependencies:**
- Express.js (already in project)
- Jest with ES modules support (already configured)
- supertest for API testing (may need to install)
