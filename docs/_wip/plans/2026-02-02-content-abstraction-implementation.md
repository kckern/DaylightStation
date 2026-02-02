# Content Abstraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Abstract content into two UI-behavior categories (`singing`, `narrated`) so code has no domain knowledge of hymns, scriptures, talks, etc.

**Architecture:** Two generic adapters (SingingAdapter, ReadingAdapter) replace LocalContentAdapter. Frontend uses two scroller components instead of five. Legacy IDs resolved via config-driven mapping.

**Tech Stack:** Node.js/Express backend, React frontend, YAML config, Jest tests, Playwright runtime tests

**Design Document:** `docs/plans/2026-02-02-content-abstraction-design.md`

---

## Task 1: Create Legacy Prefix Config

**Files:**
- Create: `data/config/content-prefixes.yml`

**Step 1: Create the config file**

```yaml
# data/config/content-prefixes.yml
# Maps legacy content prefixes to canonical singing/narrated format
# Used by both backend (ContentQueryService) and frontend (query param resolver)

legacy:
  hymn: singing:hymn
  primary: singing:primary
  scripture: narrated:scripture
  talk: narrated:talks
  poem: narrated:poetry
```

**Step 2: Verify file exists**

Run: `cat data/config/content-prefixes.yml`
Expected: File contents displayed

**Step 3: Commit**

```bash
git add data/config/content-prefixes.yml
git commit -m "config: add content-prefixes.yml for legacy ID mapping"
```

---

## Task 2: Create SingingAdapter - Test Setup

**Files:**
- Create: `backend/src/1_adapters/content/singing/SingingAdapter.mjs`
- Create: `backend/src/1_adapters/content/singing/manifest.mjs`
- Create: `tests/unit/adapters/content/singing/SingingAdapter.test.mjs`

**Step 1: Create test file with first failing test**

```javascript
// tests/unit/adapters/content/singing/SingingAdapter.test.mjs
import { describe, test, expect, beforeEach } from '@jest/globals';
import { SingingAdapter } from '#adapters/content/singing/SingingAdapter.mjs';

describe('SingingAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new SingingAdapter({
      dataPath: '/mock/data/content/singing',
      mediaPath: '/mock/media/singing'
    });
  });

  describe('source and prefixes', () => {
    test('source returns "singing"', () => {
      expect(adapter.source).toBe('singing');
    });

    test('prefixes returns singing prefix', () => {
      expect(adapter.prefixes).toEqual([{ prefix: 'singing' }]);
    });

    test('canResolve returns true for singing: IDs', () => {
      expect(adapter.canResolve('singing:hymn/123')).toBe(true);
      expect(adapter.canResolve('singing:primary/1')).toBe(true);
    });

    test('canResolve returns false for other IDs', () => {
      expect(adapter.canResolve('narrated:scripture/bom')).toBe(false);
      expect(adapter.canResolve('plex:12345')).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/adapters/content/singing/SingingAdapter.test.mjs`
Expected: FAIL - Cannot find module

**Step 3: Create minimal adapter to pass tests**

```javascript
// backend/src/1_adapters/content/singing/SingingAdapter.mjs
import path from 'path';

export class SingingAdapter {
  constructor({ dataPath, mediaPath, mediaProgressMemory }) {
    this.dataPath = dataPath;
    this.mediaPath = mediaPath;
    this.mediaProgressMemory = mediaProgressMemory || null;
  }

  get source() {
    return 'singing';
  }

  get prefixes() {
    return [{ prefix: 'singing' }];
  }

  canResolve(id) {
    return id.startsWith('singing:');
  }
}

export default SingingAdapter;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/adapters/content/singing/SingingAdapter.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/singing/SingingAdapter.mjs tests/unit/adapters/content/singing/SingingAdapter.test.mjs
git commit -m "feat(singing): add SingingAdapter with source/prefix tests"
```

---

## Task 3: SingingAdapter - getItem with Prefix Matching

**Files:**
- Modify: `backend/src/1_adapters/content/singing/SingingAdapter.mjs`
- Modify: `tests/unit/adapters/content/singing/SingingAdapter.test.mjs`

**Step 1: Add failing test for getItem**

```javascript
// Add to tests/unit/adapters/content/singing/SingingAdapter.test.mjs

import { jest } from '@jest/globals';

// Mock FileIO at top of file
jest.unstable_mockModule('#system/utils/FileIO.mjs', () => ({
  loadYamlByPrefix: jest.fn(),
  loadContainedYaml: jest.fn(),
  findMediaFileByPrefix: jest.fn(),
  dirExists: jest.fn(() => true),
  listDirs: jest.fn(() => [])
}));

const { loadYamlByPrefix, loadContainedYaml, findMediaFileByPrefix } = await import('#system/utils/FileIO.mjs');

describe('getItem', () => {
  test('uses prefix matching for numeric IDs', async () => {
    loadYamlByPrefix.mockReturnValue({
      title: 'The Spirit of God',
      number: 2,
      verses: [['Verse 1 line 1', 'Verse 1 line 2']]
    });
    findMediaFileByPrefix.mockReturnValue('/mock/media/singing/hymn/0002-the-spirit-of-god.mp3');

    const item = await adapter.getItem('hymn/2');

    expect(loadYamlByPrefix).toHaveBeenCalledWith(
      '/mock/data/content/singing/hymn',
      '2'
    );
    expect(item.id).toBe('singing:hymn/2');
    expect(item.title).toBe('The Spirit of God');
    expect(item.category).toBe('singing');
    expect(item.collection).toBe('hymn');
  });

  test('uses direct path for non-numeric IDs', async () => {
    loadContainedYaml.mockReturnValue({
      title: 'Custom Song',
      verses: [['Line 1']]
    });

    const item = await adapter.getItem('hymn/custom-song');

    expect(loadContainedYaml).toHaveBeenCalled();
    expect(item.id).toBe('singing:hymn/custom-song');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/adapters/content/singing/SingingAdapter.test.mjs`
Expected: FAIL - getItem is not a function or returns undefined

**Step 3: Implement getItem**

```javascript
// Add to SingingAdapter class in backend/src/1_adapters/content/singing/SingingAdapter.mjs

import {
  loadYamlByPrefix,
  loadContainedYaml,
  findMediaFileByPrefix,
  dirExists,
  listDirs
} from '#system/utils/FileIO.mjs';

// Inside the class:

async getItem(localId) {
  const [collection, ...rest] = localId.split('/');
  const itemId = rest.join('/');
  const collectionPath = path.join(this.dataPath, collection);

  // Load collection manifest if exists
  const manifest = this._loadManifest(collection);

  // Load item metadata
  let metadata;
  if (/^\d+$/.test(itemId)) {
    // Numeric ID - use prefix matching
    metadata = loadYamlByPrefix(collectionPath, itemId);
  } else {
    // Non-numeric - direct path lookup
    metadata = loadContainedYaml(collectionPath, itemId);
  }

  if (!metadata) return null;

  // Find media file
  const mediaFile = findMediaFileByPrefix(
    path.join(this.mediaPath, collection),
    metadata.number || itemId
  );

  // Build response with category defaults + manifest overrides
  const style = { ...this._getDefaultStyle(), ...manifest?.style };
  const contentType = manifest?.contentType || 'stanzas';

  return {
    id: `singing:${localId}`,
    source: 'singing',
    category: 'singing',
    collection,
    title: metadata.title || `${collection} ${itemId}`,
    subtitle: metadata.subtitle || `${collection} #${metadata.number || itemId}`,
    mediaUrl: `/api/v1/stream/singing/${localId}`,
    duration: metadata.duration || 0,
    content: {
      type: contentType,
      data: metadata.verses || []
    },
    style,
    metadata: {
      number: metadata.number,
      ...metadata
    }
  };
}

_loadManifest(collection) {
  try {
    return loadContainedYaml(path.join(this.dataPath, collection), 'manifest');
  } catch {
    return null;
  }
}

_getDefaultStyle() {
  return {
    fontFamily: 'serif',
    fontSize: '1.4rem',
    textAlign: 'center'
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/adapters/content/singing/SingingAdapter.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/singing/SingingAdapter.mjs tests/unit/adapters/content/singing/SingingAdapter.test.mjs
git commit -m "feat(singing): implement getItem with prefix matching"
```

---

## Task 4: SingingAdapter - getList and resolvePlayables

**Files:**
- Modify: `backend/src/1_adapters/content/singing/SingingAdapter.mjs`
- Modify: `tests/unit/adapters/content/singing/SingingAdapter.test.mjs`

**Step 1: Add failing tests**

```javascript
// Add to tests/unit/adapters/content/singing/SingingAdapter.test.mjs

describe('getList', () => {
  test('lists collections when no localId', async () => {
    const { listDirs } = await import('#system/utils/FileIO.mjs');
    listDirs.mockReturnValue(['hymn', 'primary']);

    const result = await adapter.getList('');

    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe('singing:hymn');
    expect(result.items[0].itemType).toBe('container');
  });

  test('lists items in collection', async () => {
    const { listYamlFiles } = await import('#system/utils/FileIO.mjs');
    listYamlFiles.mockReturnValue(['0001-song.yml', '0002-song.yml']);

    const result = await adapter.getList('hymn');

    expect(result.items).toHaveLength(2);
  });
});

describe('resolvePlayables', () => {
  test('returns single item as array', async () => {
    loadYamlByPrefix.mockReturnValue({
      title: 'Test Song',
      number: 1,
      verses: []
    });

    const items = await adapter.resolvePlayables('hymn/1');

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('singing:hymn/1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/adapters/content/singing/SingingAdapter.test.mjs`
Expected: FAIL

**Step 3: Implement getList and resolvePlayables**

```javascript
// Add to SingingAdapter class

async getList(localId) {
  if (!localId) {
    // List all collections
    const collections = listDirs(this.dataPath);
    return {
      id: 'singing:',
      source: 'singing',
      category: 'singing',
      itemType: 'container',
      items: collections.map(name => ({
        id: `singing:${name}`,
        source: 'singing',
        title: name,
        itemType: 'container'
      }))
    };
  }

  const [collection, ...rest] = localId.split('/');
  const subPath = rest.join('/');

  if (!subPath) {
    // List items in collection
    const collectionPath = path.join(this.dataPath, collection);
    const files = listYamlFiles(collectionPath);

    const items = [];
    for (const file of files) {
      const match = file.match(/^0*(\d+)/);
      if (match) {
        const item = await this.getItem(`${collection}/${match[1]}`);
        if (item) items.push(item);
      }
    }

    return {
      id: `singing:${collection}`,
      source: 'singing',
      category: 'singing',
      collection,
      itemType: 'container',
      items
    };
  }

  // Subfolder listing
  return this.getItem(localId);
}

async resolvePlayables(localId) {
  const item = await this.getItem(localId);
  if (item) return [item];

  const list = await this.getList(localId);
  return list?.items || [];
}

getStoragePath() {
  return 'singing';
}
```

Also add to imports:
```javascript
import { listYamlFiles } from '#system/utils/FileIO.mjs';
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/adapters/content/singing/SingingAdapter.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/singing/SingingAdapter.mjs tests/unit/adapters/content/singing/SingingAdapter.test.mjs
git commit -m "feat(singing): implement getList and resolvePlayables"
```

---

## Task 5: SingingAdapter - Manifest File

**Files:**
- Create: `backend/src/1_adapters/content/singing/manifest.mjs`

**Step 1: Create manifest for registry**

```javascript
// backend/src/1_adapters/content/singing/manifest.mjs
export default {
  provider: 'singing',
  capability: 'singing',
  displayName: 'Singing Content (Hymns, Primary Songs)',
  implicit: true,
  adapter: () => import('./SingingAdapter.mjs'),
  configSchema: {}
};
```

**Step 2: Verify file exists**

Run: `cat backend/src/1_adapters/content/singing/manifest.mjs`
Expected: File contents displayed

**Step 3: Commit**

```bash
git add backend/src/1_adapters/content/singing/manifest.mjs
git commit -m "feat(singing): add adapter manifest for registry"
```

---

## Task 6: Create ScriptureResolver

**Files:**
- Create: `backend/src/1_adapters/content/narrated/resolvers/scripture.mjs`
- Create: `tests/unit/adapters/content/narrated/resolvers/scripture.test.mjs`

**Step 1: Create failing test**

```javascript
// tests/unit/adapters/content/narrated/resolvers/scripture.test.mjs
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Mock scripture-guide
jest.unstable_mockModule('scripture-guide', () => ({
  lookupReference: jest.fn(),
  generateReference: jest.fn()
}));

const { ScriptureResolver } = await import('#adapters/content/narrated/resolvers/scripture.mjs');
const { lookupReference } = await import('scripture-guide');

describe('ScriptureResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('passes through full path unchanged', () => {
    const result = ScriptureResolver.resolve('bom/sebom/31103', '/data');
    expect(result).toBe('bom/sebom/31103');
  });

  test('resolves reference string to path', () => {
    lookupReference.mockReturnValue({ verse_ids: [34541] });

    const result = ScriptureResolver.resolve('alma-32', '/data');

    expect(lookupReference).toHaveBeenCalledWith('alma-32');
    expect(result).toMatch(/bom\/.*\/34541/);
  });

  test('resolves numeric verse_id to path', () => {
    const result = ScriptureResolver.resolve('37707', '/data');
    expect(result).toMatch(/dc\/.*\/37707/);
  });

  test('resolves volume name to first verse', () => {
    const result = ScriptureResolver.resolve('bom', '/data');
    expect(result).toMatch(/bom\/.*\/31103/);
  });

  test('returns null for invalid input', () => {
    lookupReference.mockImplementation(() => { throw new Error('Invalid'); });
    const result = ScriptureResolver.resolve('invalid-ref', '/data');
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/adapters/content/narrated/resolvers/scripture.test.mjs`
Expected: FAIL - Cannot find module

**Step 3: Create ScriptureResolver**

```javascript
// backend/src/1_adapters/content/narrated/resolvers/scripture.mjs
import { lookupReference, generateReference } from 'scripture-guide';
import { listDirs } from '#system/utils/FileIO.mjs';
import path from 'path';

const VOLUME_RANGES = {
  ot: { start: 1, end: 23145 },
  nt: { start: 23146, end: 31102 },
  bom: { start: 31103, end: 37706 },
  dc: { start: 37707, end: 41994 },
  pgp: { start: 41995, end: 42663 }
};

function getVolumeFromVerseId(verseId) {
  const id = parseInt(verseId, 10);
  for (const [volume, range] of Object.entries(VOLUME_RANGES)) {
    if (id >= range.start && id <= range.end) {
      return volume;
    }
  }
  return null;
}

function getDefaultVersion(dataPath, volume) {
  try {
    const volumePath = path.join(dataPath, volume);
    const dirs = listDirs(volumePath);
    return dirs[0] || 'default';
  } catch {
    return 'default';
  }
}

export const ScriptureResolver = {
  /**
   * Resolve scripture input to normalized path
   * Supports: "alma-32", "37707", "bom", "bom/sebom/31103"
   * @param {string} input - Scripture reference
   * @param {string} dataPath - Base path to scripture data
   * @returns {string|null} Normalized path like "bom/sebom/34541"
   */
  resolve(input, dataPath) {
    // Full path passthrough
    if (input.includes('/') && input.split('/').length === 3) {
      return input;
    }

    // Reference string (e.g., "alma-32")
    try {
      const ref = lookupReference(input);
      const verseId = ref?.verse_ids?.[0];
      if (verseId) {
        const volume = getVolumeFromVerseId(verseId);
        const version = getDefaultVersion(dataPath, volume);
        return `${volume}/${version}/${verseId}`;
      }
    } catch {
      // Continue to next resolution method
    }

    // Numeric verse_id
    const asNumber = parseInt(input, 10);
    if (!isNaN(asNumber) && asNumber > 0) {
      const volume = getVolumeFromVerseId(asNumber);
      if (volume) {
        const version = getDefaultVersion(dataPath, volume);
        return `${volume}/${version}/${asNumber}`;
      }
    }

    // Volume name (return first verse)
    if (VOLUME_RANGES[input]) {
      const version = getDefaultVersion(dataPath, input);
      return `${input}/${version}/${VOLUME_RANGES[input].start}`;
    }

    return null;
  },

  generateReference
};

export default ScriptureResolver;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/adapters/content/narrated/resolvers/scripture.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/narrated/resolvers/scripture.mjs tests/unit/adapters/content/narrated/resolvers/scripture.test.mjs
git commit -m "feat(narrated): add ScriptureResolver for reference resolution"
```

---

## Task 7: Create ReadingAdapter - Basic Structure

**Files:**
- Create: `backend/src/1_adapters/content/narrated/ReadingAdapter.mjs`
- Create: `backend/src/1_adapters/content/narrated/manifest.mjs`
- Create: `tests/unit/adapters/content/narrated/ReadingAdapter.test.mjs`

**Step 1: Create failing test**

```javascript
// tests/unit/adapters/content/narrated/ReadingAdapter.test.mjs
import { describe, test, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('#system/utils/FileIO.mjs', () => ({
  loadYamlByPrefix: jest.fn(),
  loadContainedYaml: jest.fn(),
  findMediaFileByPrefix: jest.fn(),
  dirExists: jest.fn(() => true),
  listDirs: jest.fn(() => []),
  listYamlFiles: jest.fn(() => [])
}));

const { ReadingAdapter } = await import('#adapters/content/narrated/ReadingAdapter.mjs');

describe('ReadingAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new ReadingAdapter({
      dataPath: '/mock/data/content/narrated',
      mediaPath: '/mock/media/narrated'
    });
  });

  describe('source and prefixes', () => {
    test('source returns "narrated"', () => {
      expect(adapter.source).toBe('narrated');
    });

    test('prefixes returns narrated prefix', () => {
      expect(adapter.prefixes).toEqual([{ prefix: 'narrated' }]);
    });

    test('canResolve returns true for narrated: IDs', () => {
      expect(adapter.canResolve('narrated:scripture/bom')).toBe(true);
      expect(adapter.canResolve('narrated:talks/ldsgc')).toBe(true);
    });

    test('canResolve returns false for other IDs', () => {
      expect(adapter.canResolve('singing:hymn/1')).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/adapters/content/narrated/ReadingAdapter.test.mjs`
Expected: FAIL

**Step 3: Create minimal ReadingAdapter**

```javascript
// backend/src/1_adapters/content/narrated/ReadingAdapter.mjs
import path from 'path';
import {
  loadYamlByPrefix,
  loadContainedYaml,
  findMediaFileByPrefix,
  dirExists,
  listDirs,
  listYamlFiles
} from '#system/utils/FileIO.mjs';

export class ReadingAdapter {
  constructor({ dataPath, mediaPath, mediaProgressMemory }) {
    this.dataPath = dataPath;
    this.mediaPath = mediaPath;
    this.mediaProgressMemory = mediaProgressMemory || null;
    this.resolvers = {};
  }

  get source() {
    return 'narrated';
  }

  get prefixes() {
    return [{ prefix: 'narrated' }];
  }

  canResolve(id) {
    return id.startsWith('narrated:');
  }

  getStoragePath() {
    return 'narrated';
  }

  _getDefaultStyle() {
    return {
      fontFamily: 'sans-serif',
      fontSize: '1.2rem',
      textAlign: 'left'
    };
  }
}

export default ReadingAdapter;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/adapters/content/narrated/ReadingAdapter.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/narrated/ReadingAdapter.mjs tests/unit/adapters/content/narrated/ReadingAdapter.test.mjs
git commit -m "feat(narrated): add ReadingAdapter basic structure"
```

---

## Task 8: ReadingAdapter - getItem with Resolver Support

**Files:**
- Modify: `backend/src/1_adapters/content/narrated/ReadingAdapter.mjs`
- Modify: `tests/unit/adapters/content/narrated/ReadingAdapter.test.mjs`

**Step 1: Add failing test**

```javascript
// Add to tests/unit/adapters/content/narrated/ReadingAdapter.test.mjs

const { loadContainedYaml } = await import('#system/utils/FileIO.mjs');

describe('getItem', () => {
  test('applies resolver when manifest declares one', async () => {
    // Mock manifest with resolver
    loadContainedYaml.mockImplementation((basePath, name) => {
      if (name === 'manifest') {
        return { resolver: 'scripture' };
      }
      return {
        title: 'Alma 32',
        verses: [{ verse_id: 34541, text: 'And now...' }]
      };
    });

    // The adapter should use ScriptureResolver to resolve 'alma-32'
    const item = await adapter.getItem('scripture/alma-32');

    expect(item.category).toBe('narrated');
    expect(item.collection).toBe('scripture');
  });

  test('loads item directly when no resolver', async () => {
    loadContainedYaml.mockImplementation((basePath, name) => {
      if (name === 'manifest') return null;
      return {
        title: 'Test Talk',
        speaker: 'Elder Smith',
        content: ['Paragraph 1', 'Paragraph 2']
      };
    });

    const item = await adapter.getItem('talks/ldsgc202410/smith');

    expect(item.id).toBe('narrated:talks/ldsgc202410/smith');
    expect(item.content.type).toBe('paragraphs');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/adapters/content/narrated/ReadingAdapter.test.mjs`
Expected: FAIL

**Step 3: Implement getItem**

```javascript
// Add to ReadingAdapter class

async getItem(localId) {
  const [collection, ...rest] = localId.split('/');
  let itemPath = rest.join('/');
  const collectionPath = path.join(this.dataPath, collection);

  // Load collection manifest
  const manifest = this._loadManifest(collection);

  // Apply resolver if specified
  if (manifest?.resolver && itemPath) {
    const resolver = await this._loadResolver(manifest.resolver);
    if (resolver) {
      const resolved = resolver.resolve(itemPath, collectionPath);
      if (resolved) {
        itemPath = resolved;
      }
    }
  }

  // Load item metadata
  const metadata = loadContainedYaml(collectionPath, itemPath);
  if (!metadata) return null;

  // Determine content type
  const contentType = manifest?.contentType || 'paragraphs';
  const contentData = metadata.verses || metadata.content || metadata.paragraphs || [];

  // Find media files
  const mediaFile = this._findMediaFile(collection, itemPath, metadata);
  const videoFile = metadata.videoFile ? this._findVideoFile(collection, itemPath) : null;

  // Resolve ambient if enabled
  const ambientUrl = manifest?.ambient ? this._resolveAmbientUrl() : null;

  // Build style
  const style = { ...this._getDefaultStyle(), ...manifest?.style };

  return {
    id: `narrated:${collection}/${itemPath}`,
    source: 'narrated',
    category: 'narrated',
    collection,
    title: metadata.title || itemPath,
    subtitle: metadata.speaker || metadata.author || null,
    mediaUrl: `/api/v1/stream/narrated/${collection}/${itemPath}`,
    videoUrl: videoFile ? `/api/v1/stream/narrated/${collection}/${itemPath}/video` : null,
    ambientUrl,
    duration: metadata.duration || 0,
    content: {
      type: contentType,
      data: contentData
    },
    style,
    metadata
  };
}

_loadManifest(collection) {
  try {
    return loadContainedYaml(path.join(this.dataPath, collection), 'manifest');
  } catch {
    return null;
  }
}

async _loadResolver(name) {
  if (!this.resolvers[name]) {
    try {
      const module = await import(`./resolvers/${name}.mjs`);
      this.resolvers[name] = module.default || module[`${name.charAt(0).toUpperCase() + name.slice(1)}Resolver`];
    } catch {
      return null;
    }
  }
  return this.resolvers[name];
}

_findMediaFile(collection, itemPath, metadata) {
  const searchPath = path.join(this.mediaPath, collection);
  return findMediaFileByPrefix(searchPath, metadata.number || itemPath);
}

_findVideoFile(collection, itemPath) {
  const searchPath = path.join(this.mediaPath, collection);
  // Video files would be in same location
  return findMediaFileByPrefix(searchPath, itemPath);
}

_resolveAmbientUrl() {
  // Pick random ambient track
  const trackNum = String(Math.floor(Math.random() * 115) + 1).padStart(3, '0');
  return `/api/v1/stream/ambient/${trackNum}`;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/adapters/content/narrated/ReadingAdapter.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/narrated/ReadingAdapter.mjs tests/unit/adapters/content/narrated/ReadingAdapter.test.mjs
git commit -m "feat(narrated): implement getItem with resolver support"
```

---

## Task 9: ReadingAdapter - getList and manifest

**Files:**
- Modify: `backend/src/1_adapters/content/narrated/ReadingAdapter.mjs`
- Create: `backend/src/1_adapters/content/narrated/manifest.mjs`

**Step 1: Add getList implementation**

```javascript
// Add to ReadingAdapter class

async getList(localId) {
  if (!localId) {
    // List all collections
    const collections = listDirs(this.dataPath);
    return {
      id: 'narrated:',
      source: 'narrated',
      category: 'narrated',
      itemType: 'container',
      items: collections.map(name => ({
        id: `narrated:${name}`,
        source: 'narrated',
        title: name,
        itemType: 'container'
      }))
    };
  }

  const [collection, ...rest] = localId.split('/');
  const subPath = rest.join('/');
  const collectionPath = path.join(this.dataPath, collection);

  if (!subPath) {
    // List items in collection (may have subfolders)
    const dirs = listDirs(collectionPath);
    const files = listYamlFiles(collectionPath);

    const items = [];

    // Add subfolders as containers
    for (const dir of dirs) {
      if (dir !== 'manifest') {
        items.push({
          id: `narrated:${collection}/${dir}`,
          source: 'narrated',
          title: dir,
          itemType: 'container'
        });
      }
    }

    // Add files as items
    for (const file of files) {
      if (file !== 'manifest.yml') {
        const item = await this.getItem(`${collection}/${file.replace('.yml', '')}`);
        if (item) items.push(item);
      }
    }

    return {
      id: `narrated:${collection}`,
      source: 'narrated',
      category: 'narrated',
      collection,
      itemType: 'container',
      items
    };
  }

  // Subfolder listing
  const subfolderPath = path.join(collectionPath, subPath);
  const files = listYamlFiles(subfolderPath);
  const items = [];

  for (const file of files) {
    const item = await this.getItem(`${collection}/${subPath}/${file.replace('.yml', '')}`);
    if (item) items.push(item);
  }

  return {
    id: `narrated:${localId}`,
    source: 'narrated',
    category: 'narrated',
    collection,
    itemType: 'container',
    items
  };
}

async resolvePlayables(localId) {
  const item = await this.getItem(localId);
  if (item && item.mediaUrl) return [item];

  const list = await this.getList(localId);
  return list?.items?.filter(i => i.mediaUrl) || [];
}
```

**Step 2: Create manifest**

```javascript
// backend/src/1_adapters/content/narrated/manifest.mjs
export default {
  provider: 'narrated',
  capability: 'narrated',
  displayName: 'Reading Content (Scripture, Talks, Poetry)',
  implicit: true,
  adapter: () => import('./ReadingAdapter.mjs'),
  configSchema: {}
};
```

**Step 3: Run tests**

Run: `npm test -- tests/unit/adapters/content/narrated/`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/1_adapters/content/narrated/ReadingAdapter.mjs backend/src/1_adapters/content/narrated/manifest.mjs
git commit -m "feat(narrated): implement getList and add manifest"
```

---

## Task 10: Update ContentQueryService for Legacy Mapping

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs`
- Modify: `tests/unit/applications/content/ContentQueryService.test.mjs`

**Step 1: Add failing test for legacy mapping**

```javascript
// Add to tests for ContentQueryService

describe('legacy prefix mapping', () => {
  test('maps hymn:123 to singing:hymn/123', () => {
    const service = new ContentQueryService({
      registry: mockRegistry,
      legacyPrefixMap: {
        hymn: 'singing:hymn',
        scripture: 'narrated:scripture'
      }
    });

    const result = service._parseIdFromTextPublic('hymn:123');
    expect(result).toEqual({ source: 'singing', id: 'hymn/123' });
  });

  test('maps scripture:alma-32 to narrated:scripture/alma-32', () => {
    const service = new ContentQueryService({
      registry: mockRegistry,
      legacyPrefixMap: {
        scripture: 'narrated:scripture'
      }
    });

    const result = service._parseIdFromTextPublic('scripture:alma-32');
    expect(result).toEqual({ source: 'narrated', id: 'scripture/alma-32' });
  });

  test('passes through canonical IDs unchanged', () => {
    const service = new ContentQueryService({
      registry: mockRegistry,
      legacyPrefixMap: {}
    });

    const result = service._parseIdFromTextPublic('singing:hymn/123');
    expect(result).toEqual({ source: 'singing', id: 'hymn/123' });
  });
});
```

**Step 2: Update ContentQueryService constructor**

```javascript
// Modify constructor in ContentQueryService.mjs

constructor({ registry, mediaProgressMemory = null, legacyPrefixMap = null }) {
  this.#registry = registry;
  this.#mediaProgressMemory = mediaProgressMemory;
  this.#legacyPrefixMap = legacyPrefixMap || {};
}
```

**Step 3: Update #parseIdFromText**

```javascript
// Update #parseIdFromText method

#parseIdFromText(text) {
  if (!text || typeof text !== 'string') return null;

  const trimmed = text.trim();

  // Explicit source:id format
  const explicitMatch = trimmed.match(/^([a-z-]+):(.+)$/i);
  if (explicitMatch) {
    const prefix = explicitMatch[1].toLowerCase();
    const value = explicitMatch[2];

    // Check legacy mapping from config
    const legacyTarget = this.#legacyPrefixMap[prefix];
    if (legacyTarget) {
      // hymn:123 → singing:hymn/123
      const [targetSource, targetCollection] = legacyTarget.split(':');
      return { source: targetSource, id: `${targetCollection}/${value}` };
    }

    return { source: prefix, id: value };
  }

  // ... rest of existing logic unchanged
}
```

**Step 4: Run tests**

Run: `npm test -- tests/unit/applications/content/ContentQueryService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/ContentQueryService.mjs tests/unit/applications/content/ContentQueryService.test.mjs
git commit -m "feat(content): add legacy prefix mapping to ContentQueryService"
```

---

## Task 11: Register Adapters in Bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Import new adapters**

```javascript
// Add imports to bootstrap.mjs
import SingingAdapter from '#adapters/content/singing/SingingAdapter.mjs';
import ReadingAdapter from '#adapters/content/narrated/ReadingAdapter.mjs';
```

**Step 2: Register adapters in createContentRegistry**

```javascript
// In createContentRegistry function, add:

// Register singing adapter
const singingAdapter = new SingingAdapter({
  dataPath: path.join(dataPath, 'content', 'singing'),
  mediaPath: path.join(mediaPath, 'singing'),
  mediaProgressMemory
});
registry.register('singing', singingAdapter);

// Register narrated adapter
const narratedAdapter = new ReadingAdapter({
  dataPath: path.join(dataPath, 'content', 'narrated'),
  mediaPath: path.join(mediaPath, 'narrated'),
  mediaProgressMemory
});
registry.register('narrated', narratedAdapter);
```

**Step 3: Load legacy prefix config**

```javascript
// Load content-prefixes.yml and pass to ContentQueryService
import { loadYaml } from '#system/utils/FileIO.mjs';

const contentPrefixes = loadYaml(path.join(dataPath, 'config', 'content-prefixes'));
const legacyPrefixMap = contentPrefixes?.legacy || {};

// Pass to ContentQueryService constructor
const queryService = new ContentQueryService({
  registry,
  mediaProgressMemory,
  legacyPrefixMap
});
```

**Step 4: Verify server starts**

Run: `node backend/index.js`
Expected: Server starts without errors, logs show singing/narrated adapters registered

**Step 5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(bootstrap): register SingingAdapter and ReadingAdapter"
```

---

## Task 12: Create API Routes for singing/narrated

**Files:**
- Modify: `backend/src/4_api/v1/routers/item.mjs`

**Step 1: Verify item router handles new sources**

The item router should already handle any registered source. Test with curl:

```bash
curl http://localhost:3112/api/v1/item/singing/hymn/2 | jq
curl http://localhost:3112/api/v1/item/narrated/scripture/bom/sebom/31103 | jq
```

**Step 2: If needed, add explicit route handling**

The existing item router pattern `/item/:source/*` should work. Verify routes are mounted.

**Step 3: Test legacy resolution**

```bash
curl "http://localhost:3112/api/v1/content/resolve?id=hymn:2" | jq
curl "http://localhost:3112/api/v1/content/resolve?id=scripture:alma-32" | jq
```

**Step 4: Commit if changes made**

```bash
git add backend/src/4_api/v1/routers/item.mjs
git commit -m "feat(api): ensure item router handles singing/narrated sources"
```

---

## Task 13: Create Frontend SingingScroller

**Files:**
- Create: `frontend/src/modules/ContentScroller/SingingScroller.jsx`

**Step 1: Create SingingScroller component**

```jsx
// frontend/src/modules/ContentScroller/SingingScroller.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ContentScroller from './ContentScroller.jsx';
import { DaylightAPI } from '../../lib/api.mjs';
import { useCenterByWidest } from '../../lib/Player/useCenterByWidest.js';

export function SingingScroller({
  contentId,
  advance,
  clear,
  volume,
  playbackKeys,
  ignoreKeys,
  queuePosition,
  onPlaybackMetrics,
  onRegisterMediaAccess,
  seekToIntentSeconds,
  onSeekRequestConsumed,
  remountDiagnostics
}) {
  const [data, setData] = useState(null);
  const textRef = useRef(null);

  useEffect(() => {
    if (!contentId) return;

    // Extract path from contentId (singing:hymn/123 → hymn/123)
    const path = contentId.replace(/^singing:/, '');

    DaylightAPI(`api/v1/item/singing/${path}`).then(response => {
      setData(response);
    });
  }, [contentId]);

  // Center text by widest line
  useCenterByWidest(textRef, [data?.content?.data]);

  const parseContent = useCallback((contentData) => {
    if (!contentData?.data) return null;

    return (
      <div className="singing-text" ref={textRef}>
        {contentData.data.map((stanza, sIdx) => (
          <div key={`stanza-${sIdx}`} className="stanza">
            {stanza.map((line, lIdx) => (
              <p key={`line-${sIdx}-${lIdx}`} className="line">{line}</p>
            ))}
          </div>
        ))}
      </div>
    );
  }, []);

  if (!data) return null;

  // Apply style as CSS variables
  const cssVars = {
    '--font-family': data.style?.fontFamily || 'serif',
    '--font-size': data.style?.fontSize || '1.4rem',
    '--text-align': data.style?.textAlign || 'center',
    '--background': data.style?.background || 'transparent',
    '--color': data.style?.color || 'inherit'
  };

  // Calculate yStartTime based on duration and verse count
  const verseCount = data.content?.data?.length || 1;
  const yStartTime = (data.duration / verseCount) / 1.8;

  return (
    <div style={cssVars}>
      <ContentScroller
        key={`singing-${contentId}`}
        type="singing"
        title={data.title}
        assetId={contentId}
        subtitle={data.subtitle}
        mainMediaUrl={data.mediaUrl}
        mainVolume={volume || 1}
        contentData={data.content}
        parseContent={parseContent}
        onAdvance={advance}
        onClear={clear}
        playbackKeys={playbackKeys}
        ignoreKeys={ignoreKeys}
        queuePosition={queuePosition}
        yStartTime={yStartTime}
        onPlaybackMetrics={onPlaybackMetrics}
        onRegisterMediaAccess={onRegisterMediaAccess}
        seekToIntentSeconds={seekToIntentSeconds}
        onSeekRequestConsumed={onSeekRequestConsumed}
        remountDiagnostics={remountDiagnostics}
      />
    </div>
  );
}

export default SingingScroller;
```

**Step 2: Verify file compiles**

Run: `npm run build --prefix frontend`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/modules/ContentScroller/SingingScroller.jsx
git commit -m "feat(frontend): add SingingScroller component"
```

---

## Task 14: Create Frontend ReadingScroller

**Files:**
- Create: `frontend/src/modules/ContentScroller/ReadingScroller.jsx`

**Step 1: Create ReadingScroller component**

```jsx
// frontend/src/modules/ContentScroller/ReadingScroller.jsx
import React, { useState, useEffect, useCallback } from 'react';
import ContentScroller from './ContentScroller.jsx';
import { DaylightAPI } from '../../lib/api.mjs';

export function ReadingScroller({
  contentId,
  advance,
  clear,
  volume,
  playbackKeys,
  ignoreKeys,
  queuePosition,
  onPlaybackMetrics,
  onRegisterMediaAccess,
  seekToIntentSeconds,
  onSeekRequestConsumed,
  remountDiagnostics
}) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!contentId) return;

    // Extract path from contentId (narrated:scripture/bom/... → scripture/bom/...)
    const path = contentId.replace(/^narrated:/, '');

    DaylightAPI(`api/v1/item/narrated/${path}`).then(response => {
      setData(response);
    });
  }, [contentId]);

  const parseContent = useCallback((contentData) => {
    if (!contentData?.data) return null;

    if (contentData.type === 'verses') {
      // Scripture-style verses
      return (
        <div className="narrated-text verses">
          {contentData.data.map((verse, idx) => (
            <p key={idx} className="verse">
              <span className="verse-num">{verse.verse}</span>
              <span className="verse-text">{verse.text}</span>
            </p>
          ))}
        </div>
      );
    }

    // Paragraphs (talks, poetry, etc.)
    return (
      <div className="narrated-text paragraphs">
        {contentData.data.map((para, idx) => {
          if (para.startsWith('##')) {
            return <h4 key={idx}>{para.slice(2).trim()}</h4>;
          }
          return <p key={idx}>{para}</p>;
        })}
      </div>
    );
  }, []);

  if (!data) return null;

  // Apply style as CSS variables
  const cssVars = {
    '--font-family': data.style?.fontFamily || 'sans-serif',
    '--font-size': data.style?.fontSize || '1.2rem',
    '--text-align': data.style?.textAlign || 'left',
    '--background': data.style?.background || 'transparent',
    '--color': data.style?.color || 'inherit'
  };

  const isVideo = !!data.videoUrl;

  return (
    <div style={cssVars}>
      <ContentScroller
        key={`narrated-${contentId}`}
        type="narrated"
        title={data.title}
        assetId={contentId}
        subtitle={data.subtitle}
        mainMediaUrl={isVideo ? data.videoUrl : data.mediaUrl}
        isVideo={isVideo}
        mainVolume={volume || 1}
        ambientMediaUrl={data.ambientUrl}
        ambientConfig={{
          fadeOutStep: 0.01,
          fadeOutInterval: 400,
          fadeInDelay: 750,
          ambientVolume: (volume || 1) * 0.1
        }}
        contentData={data.content}
        parseContent={parseContent}
        onAdvance={advance}
        onClear={clear}
        playbackKeys={playbackKeys}
        ignoreKeys={ignoreKeys}
        queuePosition={queuePosition}
        yStartTime={isVideo ? 30 : 15}
        onPlaybackMetrics={onPlaybackMetrics}
        onRegisterMediaAccess={onRegisterMediaAccess}
        seekToIntentSeconds={seekToIntentSeconds}
        onSeekRequestConsumed={onSeekRequestConsumed}
        remountDiagnostics={remountDiagnostics}
      />
    </div>
  );
}

export default ReadingScroller;
```

**Step 2: Verify file compiles**

Run: `npm run build --prefix frontend`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/modules/ContentScroller/ReadingScroller.jsx
git commit -m "feat(frontend): add ReadingScroller component"
```

---

## Task 15: Create Query Param Resolver

**Files:**
- Create: `frontend/src/lib/queryParamResolver.js`

**Step 1: Create resolver**

```javascript
// frontend/src/lib/queryParamResolver.js
import { DaylightAPI } from './api.mjs';

let legacyPrefixMap = null;

/**
 * Load legacy prefix mapping from backend config
 */
async function loadPrefixMap() {
  if (legacyPrefixMap) return legacyPrefixMap;

  try {
    const config = await DaylightAPI('api/v1/config/content-prefixes');
    legacyPrefixMap = config?.legacy || {};
  } catch {
    // Fallback to hardcoded if config unavailable
    legacyPrefixMap = {
      hymn: 'singing:hymn',
      primary: 'singing:primary',
      scripture: 'narrated:scripture',
      talk: 'narrated:talks',
      poem: 'narrated:poetry'
    };
  }
  return legacyPrefixMap;
}

/**
 * Resolve legacy query params to canonical contentId
 * @param {Object} params - URL query params
 * @returns {Promise<{contentId: string, queue?: boolean} | null>}
 */
export async function resolvePlayParams(params) {
  const prefixMap = await loadPrefixMap();

  // Check legacy params
  for (const [legacyKey, canonicalPrefix] of Object.entries(prefixMap)) {
    if (params[legacyKey]) {
      return {
        contentId: `${canonicalPrefix}/${params[legacyKey]}`
      };
    }
  }

  // New canonical format
  if (params.play) {
    return { contentId: params.play };
  }
  if (params.queue) {
    return { contentId: params.queue, queue: true };
  }

  return null;
}

/**
 * Get category from contentId
 * @param {string} contentId
 * @returns {string|null}
 */
export function getCategoryFromId(contentId) {
  if (!contentId) return null;
  const match = contentId.match(/^(singing|narrated):/);
  return match ? match[1] : null;
}

export default { resolvePlayParams, getCategoryFromId };
```

**Step 2: Commit**

```bash
git add frontend/src/lib/queryParamResolver.js
git commit -m "feat(frontend): add query param resolver for legacy support"
```

---

## Task 16: Update SinglePlayer Routing

**Files:**
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx`

**Step 1: Add imports for new components**

```javascript
// Add at top of SinglePlayer.jsx
import { SingingScroller } from '../../ContentScroller/SingingScroller.jsx';
import { ReadingScroller } from '../../ContentScroller/ReadingScroller.jsx';
import { getCategoryFromId } from '../../../lib/queryParamResolver.js';
```

**Step 2: Update routing logic**

```javascript
// Replace the existing hardcoded checks with category-based routing

// OLD:
// if (!!scripture) return <Scriptures {...contentProps} {...contentScrollerBridge} />;
// if (!!hymn) return <Hymns {...contentProps} {...contentScrollerBridge} />;
// etc.

// NEW:
// First check for new canonical contentId
const { contentId } = play || {};
if (contentId) {
  const category = getCategoryFromId(contentId);

  if (category === 'singing') {
    return <SingingScroller contentId={contentId} {...contentProps} {...contentScrollerBridge} />;
  }
  if (category === 'narrated') {
    return <ReadingScroller contentId={contentId} {...contentProps} {...contentScrollerBridge} />;
  }
}

// Legacy fallback (keep for backwards compatibility during migration)
if (!!scripture) return <Scriptures {...contentProps} {...contentScrollerBridge} />;
if (!!hymn) return <Hymns {...contentProps} {...contentScrollerBridge} />;
if (!!primary) return <Hymns {...contentProps} {...contentScrollerBridge} hymn={primary} subfolder="primary" />;
if (!!talk) return <Talk {...contentProps} {...contentScrollerBridge} />;
if (!!poem) return <Poetry {...contentProps} {...contentScrollerBridge} />;
```

**Step 3: Verify build**

Run: `npm run build --prefix frontend`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/components/SinglePlayer.jsx
git commit -m "feat(frontend): add category-based routing in SinglePlayer"
```

---

## Task 17: Add Config Endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/api.mjs` or create new router

**Step 1: Add config endpoint for frontend**

```javascript
// Add to appropriate router or create config router

router.get('/config/content-prefixes', asyncHandler(async (req, res) => {
  const configPath = path.join(dataPath, 'config', 'content-prefixes');
  const config = loadYaml(configPath);
  res.json(config || { legacy: {} });
}));
```

**Step 2: Test endpoint**

Run: `curl http://localhost:3112/api/v1/config/content-prefixes | jq`
Expected: Returns the legacy prefix mapping

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/
git commit -m "feat(api): add config endpoint for content-prefixes"
```

---

## Task 18: Create Runtime Tests

**Files:**
- Create: `tests/runtime/content-migration/legacy-params.test.mjs`

**Step 1: Create test file**

```javascript
// tests/runtime/content-migration/legacy-params.test.mjs
import { test, expect } from '@playwright/test';

test.describe('Legacy query params', () => {
  test('tv?hymn=2 plays singing:hymn/2', async ({ page }) => {
    await page.goto('/tv?hymn=2');

    // Wait for content to load
    await page.waitForSelector('.singing-scroller, .content-scroller.hymn', { timeout: 10000 });

    // Verify title contains hymn info
    const title = await page.textContent('h2');
    expect(title).toBeTruthy();
  });

  test('tv?scripture=alma-32 resolves and plays', async ({ page }) => {
    await page.goto('/tv?scripture=alma-32');

    await page.waitForSelector('.narrated-scroller, .content-scroller.scriptures', { timeout: 10000 });

    const title = await page.textContent('h2');
    expect(title).toContain('Alma');
  });

  test('tv?play=singing:hymn/2 works with canonical ID', async ({ page }) => {
    await page.goto('/tv?play=singing:hymn/2');

    await page.waitForSelector('.singing-scroller', { timeout: 10000 });
  });
});

test.describe('API resolution', () => {
  test('hymn:2 resolves to singing:hymn/2', async ({ request }) => {
    const response = await request.get('/api/v1/content/resolve?id=hymn:2');
    const data = await response.json();

    expect(data.id).toBe('singing:hymn/2');
    expect(data.category).toBe('singing');
  });

  test('scripture:alma-32 resolves correctly', async ({ request }) => {
    const response = await request.get('/api/v1/content/resolve?id=scripture:alma-32');
    const data = await response.json();

    expect(data.category).toBe('narrated');
    expect(data.collection).toBe('scripture');
  });
});
```

**Step 2: Run tests**

Run: `npx playwright test tests/runtime/content-migration/`
Expected: Tests run (may fail until data migration complete)

**Step 3: Commit**

```bash
git add tests/runtime/content-migration/
git commit -m "test: add runtime tests for content migration"
```

---

## Task 19: Data Migration Script

**Files:**
- Create: `scripts/migrate-content-structure.sh`

**Step 1: Create migration script**

```bash
#!/bin/bash
# scripts/migrate-content-structure.sh
# Migrates content from old structure to new singing/narrated structure

set -e

DATA_PATH="${1:-/path/to/data}"
MEDIA_PATH="${2:-/path/to/media}"

echo "Migrating content structure..."
echo "DATA_PATH: $DATA_PATH"
echo "MEDIA_PATH: $MEDIA_PATH"

# Create new directories
mkdir -p "$DATA_PATH/content/singing"
mkdir -p "$DATA_PATH/content/narrated"
mkdir -p "$MEDIA_PATH/singing"
mkdir -p "$MEDIA_PATH/narrated"

# Move data files
echo "Moving data files..."

# songs → singing
if [ -d "$DATA_PATH/content/songs" ]; then
  mv "$DATA_PATH/content/songs/hymn" "$DATA_PATH/content/singing/" 2>/dev/null || true
  mv "$DATA_PATH/content/songs/primary" "$DATA_PATH/content/singing/" 2>/dev/null || true
fi

# scripture, poetry, talks → narrated
mv "$DATA_PATH/content/scripture" "$DATA_PATH/content/narrated/" 2>/dev/null || true
mv "$DATA_PATH/content/poetry" "$DATA_PATH/content/narrated/" 2>/dev/null || true
mv "$DATA_PATH/content/talks" "$DATA_PATH/content/narrated/" 2>/dev/null || true

# Move media files
echo "Moving media files..."

# audio/songs → singing
if [ -d "$MEDIA_PATH/audio/songs" ]; then
  mv "$MEDIA_PATH/audio/songs/hymn" "$MEDIA_PATH/singing/" 2>/dev/null || true
  mv "$MEDIA_PATH/audio/songs/primary" "$MEDIA_PATH/singing/" 2>/dev/null || true
fi

# audio/scripture, audio/poetry, video/talks → narrated
mv "$MEDIA_PATH/audio/scripture" "$MEDIA_PATH/narrated/" 2>/dev/null || true
mv "$MEDIA_PATH/audio/poetry" "$MEDIA_PATH/narrated/" 2>/dev/null || true
mv "$MEDIA_PATH/video/talks" "$MEDIA_PATH/narrated/" 2>/dev/null || true

echo "Migration complete!"
echo ""
echo "Old directories can be removed after verification:"
echo "  $DATA_PATH/content/songs"
echo "  $DATA_PATH/content/scripture"
echo "  $DATA_PATH/content/poetry"
echo "  $DATA_PATH/content/talks"
```

**Step 2: Make executable**

Run: `chmod +x scripts/migrate-content-structure.sh`

**Step 3: Commit**

```bash
git add scripts/migrate-content-structure.sh
git commit -m "scripts: add content structure migration script"
```

---

## Task 20: Watch State Migration Script

**Files:**
- Create: `scripts/migrate-watch-state.mjs`

**Step 1: Create migration script**

```javascript
// scripts/migrate-watch-state.mjs
import fs from 'fs';
import path from 'path';

const KEY_MAPPING = {
  'songs': 'singing',
  'talks': 'narrated',
  'scripture': 'narrated',
  'poetry': 'narrated'
};

async function migrateWatchState(dataPath) {
  const watchStatePath = path.join(dataPath, 'system', 'watch-state');

  if (!fs.existsSync(watchStatePath)) {
    console.log('No watch state directory found, skipping migration');
    return;
  }

  for (const [oldKey, newKey] of Object.entries(KEY_MAPPING)) {
    const oldPath = path.join(watchStatePath, `${oldKey}.json`);
    const newPath = path.join(watchStatePath, `${newKey}.json`);

    if (fs.existsSync(oldPath)) {
      console.log(`Migrating ${oldKey} → ${newKey}`);

      const oldData = JSON.parse(fs.readFileSync(oldPath, 'utf-8'));

      // Merge with existing new data if any
      let newData = {};
      if (fs.existsSync(newPath)) {
        newData = JSON.parse(fs.readFileSync(newPath, 'utf-8'));
      }

      // Merge entries
      Object.assign(newData, oldData);

      // Write merged data
      fs.writeFileSync(newPath, JSON.stringify(newData, null, 2));

      // Backup old file
      fs.renameSync(oldPath, `${oldPath}.bak`);
    }
  }

  console.log('Watch state migration complete');
}

// Run
const dataPath = process.argv[2] || process.env.DATA_PATH;
if (!dataPath) {
  console.error('Usage: node migrate-watch-state.mjs <data-path>');
  process.exit(1);
}

migrateWatchState(dataPath);
```

**Step 2: Commit**

```bash
git add scripts/migrate-watch-state.mjs
git commit -m "scripts: add watch state migration script"
```

---

## Task 21: Create Collection Manifests

**Files:**
- Create: `data/content/singing/hymn/manifest.yml`
- Create: `data/content/singing/primary/manifest.yml`
- Create: `data/content/narrated/scripture/manifest.yml`
- Create: `data/content/narrated/talks/manifest.yml`
- Create: `data/content/narrated/poetry/manifest.yml`

**Step 1: Create hymn manifest**

```yaml
# data/content/singing/hymn/manifest.yml
containerType: album
contentType: stanzas
style:
  fontFamily: serif
  fontSize: 1.4rem
  textAlign: center
```

**Step 2: Create scripture manifest**

```yaml
# data/content/narrated/scripture/manifest.yml
resolver: scripture
containerType: watchlist
contentType: verses
ambient: true
style:
  fontFamily: serif
  fontSize: 1.3rem
  textAlign: left
```

**Step 3: Create talks manifest**

```yaml
# data/content/narrated/talks/manifest.yml
containerType: watchlist
contentType: paragraphs
ambient: true
style:
  fontFamily: sans-serif
  fontSize: 1.2rem
  textAlign: left
```

**Step 4: Create remaining manifests similarly**

**Step 5: Commit**

```bash
git add data/content/*/manifest.yml
git commit -m "config: add collection manifests for singing/narrated"
```

---

## Task 22: Final Integration Test

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Run runtime tests**

Run: `npx playwright test tests/runtime/content-migration/`
Expected: All tests pass

**Step 3: Manual verification**

```bash
# Test legacy URLs
curl "http://localhost:3112/api/v1/content/resolve?id=hymn:2" | jq
curl "http://localhost:3112/api/v1/content/resolve?id=scripture:alma-32" | jq

# Test canonical URLs
curl "http://localhost:3112/api/v1/item/singing/hymn/2" | jq
curl "http://localhost:3112/api/v1/item/narrated/scripture/bom/sebom/34541" | jq
```

**Step 4: Browser test**

Open: `http://localhost:3111/tv?hymn=2`
Expected: Hymn plays with new SingingScroller

Open: `http://localhost:3111/tv?scripture=alma-32`
Expected: Scripture plays with new ReadingScroller

**Step 5: Commit final changes**

```bash
git add -A
git commit -m "feat: complete content abstraction migration"
```

---

## Summary

| Phase | Tasks | Commits |
|-------|-------|---------|
| Config | 1 | 1 |
| SingingAdapter | 2-5 | 4 |
| ScriptureResolver | 6 | 1 |
| ReadingAdapter | 7-9 | 3 |
| ContentQueryService | 10 | 1 |
| Bootstrap | 11 | 1 |
| API Routes | 12, 17 | 2 |
| Frontend Components | 13-14 | 2 |
| Frontend Routing | 15-16 | 2 |
| Tests | 18 | 1 |
| Migration Scripts | 19-20 | 2 |
| Manifests | 21 | 1 |
| Integration | 22 | 1 |

**Total: 22 tasks, ~22 commits**
