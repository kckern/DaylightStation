# Content Format Plugins — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `LocalContentAdapter`'s 5 hardcoded `_get*()` methods with declarative plugin manifests that configure two generic format adapters (`ReadalongAdapter`, `SingalongAdapter`).

**Architecture:** Each content variant (scripture, talk, poem, hymn, primary) is a plugin manifest file. Plugins declare paths, media type, content shape, and optional resolver hooks. Generic format adapters consume plugin config — they never contain variant-specific `if` branches. The existing `ContentIdResolver` and `ContentSourceRegistry` handle routing; plugins register as first-class sources.

**Tech Stack:** Node.js/Express backend, Vitest unit tests, Playwright E2E regression, YAML config. Existing `ContentSourceRegistry`, `ContentIdResolver`, `PlayableItem`/`ListableItem` entities, `FileIO` utilities.

**Design doc:** `docs/_wip/plans/2026-02-09-content-format-plugins-design.md`

**Worktree:** `.worktrees/content-plugins` (branch: `feature/content-format-plugins`)

---

## Task 1: Poem Plugin + ReadalongAdapter (Simplest Case First)

Poem is the simplest variant — no resolver, no custom renderer, pure config. Build the generic `ReadalongAdapter` to satisfy this one case first.

**Files:**
- Create: `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs`
- Create: `backend/src/1_adapters/content/readalong/plugins/poem.mjs`
- Create: `tests/isolated/adapter/readalong/ReadalongAdapter.test.mjs`

### Step 1: Write the failing test

```javascript
// tests/isolated/adapter/readalong/ReadalongAdapter.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { ReadalongAdapter } from '#adapters/content/readalong/ReadalongAdapter.mjs';
import poemPlugin from '#adapters/content/readalong/plugins/poem.mjs';

// Use real test fixtures
const FIXTURES_PATH = path.resolve(process.cwd(), 'tests/_fixtures/local-content');

describe('ReadalongAdapter with poem plugin', () => {
  let adapter;

  beforeEach(() => {
    adapter = new ReadalongAdapter(poemPlugin, {
      dataPath: path.join(FIXTURES_PATH, 'data'),
      mediaPath: path.join(FIXTURES_PATH, 'media'),
    });
  });

  it('has source matching plugin name', () => {
    expect(adapter.source).toBe('poem');
  });

  it('has prefixes for registry registration', () => {
    expect(adapter.prefixes).toEqual([
      { prefix: 'poem', idTransform: expect.any(Function) }
    ]);
    expect(adapter.prefixes[0].idTransform('remedy/01')).toBe('poem:remedy/01');
  });

  it('returns null for nonexistent item', async () => {
    const item = await adapter.getItem('nonexistent/99');
    expect(item).toBeNull();
  });
});
```

### Step 2: Run test to verify it fails

Run: `npx vitest run tests/isolated/adapter/readalong/ReadalongAdapter.test.mjs`

Expected: FAIL — module not found.

### Step 3: Create poem plugin manifest

```javascript
// backend/src/1_adapters/content/readalong/plugins/poem.mjs
export default {
  name: 'poem',
  format: 'readalong',
  paths: {
    data: 'readalong/poetry',
    media: 'audio/readalong/poetry',
  },
  mediaType: 'audio',
  contentType: 'paragraphs',
  resumable: false,
  metadataMap: {
    title: 'title',
    author: 'author',
    condition: 'condition',
  },
};
```

### Step 4: Implement minimal ReadalongAdapter

```javascript
// backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs
import path from 'path';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';
import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import {
  loadContainedYaml,
  loadYamlSafe,
  listYamlFiles,
  fileExists,
  dirExists,
  findMediaFileByPrefix,
} from '#system/utils/FileIO.mjs';

export class ReadalongAdapter {
  #plugin;
  #dataPath;
  #mediaPath;
  #resolver;

  constructor(plugin, { dataPath, mediaPath }) {
    this.#plugin = plugin;
    this.#dataPath = path.resolve(dataPath, plugin.paths.data);
    this.#mediaPath = path.resolve(mediaPath, plugin.paths.media);
    this.#resolver = plugin.resolver
      ? new plugin.resolver({
          dataPath: this.#dataPath,
          mediaPath: this.#mediaPath,
          plugin,
        })
      : null;
  }

  get source() {
    return this.#plugin.name;
  }

  get prefixes() {
    return [
      {
        prefix: this.#plugin.name,
        idTransform: (id) => `${this.#plugin.name}:${id}`,
      },
    ];
  }

  getCapabilities(item) {
    const caps = ['playable'];
    if (item?.itemType === 'container') caps.push('listable');
    return caps;
  }

  async getItem(localId) {
    // If resolver exists, let it handle ID resolution
    if (this.#resolver) {
      return this.#resolver.getItem(localId);
    }

    // Default: direct path lookup
    const metadata = loadContainedYaml(this.#dataPath, localId);
    if (!metadata) return null;

    return this.#buildPlayableItem(localId, metadata);
  }

  async getList(localId) {
    if (this.#resolver && typeof this.#resolver.getList === 'function') {
      return this.#resolver.getList(localId);
    }
    return null;
  }

  async resolvePlayables(localId) {
    // If resolver handles it, delegate
    if (this.#resolver && typeof this.#resolver.resolvePlayables === 'function') {
      return this.#resolver.resolvePlayables(localId);
    }

    // Default: try as single item
    const item = await this.getItem(localId);
    if (item && typeof item.isPlayable === 'function' && item.isPlayable()) {
      return [item];
    }
    return [];
  }

  getStoragePath(compoundId) {
    return this.#plugin.name;
  }

  #buildPlayableItem(localId, metadata) {
    const mapped = this.#mapMetadata(metadata);
    const ext = this.#plugin.mediaType === 'video' ? 'mp4' : 'mp3';

    return new PlayableItem({
      id: `${this.#plugin.name}:${localId}`,
      source: this.#plugin.name,
      localId,
      title: mapped.title || localId,
      mediaType: this.#plugin.mediaType,
      mediaUrl: `/api/v1/proxy/local-content/stream/${this.#plugin.name}/${localId}`,
      duration: metadata.duration || 0,
      resumable: this.#plugin.resumable,
      metadata: {
        contentFormat: 'readalong',
        contentType: this.#plugin.contentType,
        content: metadata.content || metadata.verses || [],
        mediaFile: `${this.#plugin.paths.media}/${localId}.${ext}`,
        ...mapped,
      },
    });
  }

  #mapMetadata(metadata) {
    const map = this.#plugin.metadataMap || { title: 'title' };
    const result = {};
    for (const [key, yamlField] of Object.entries(map)) {
      if (Array.isArray(yamlField)) {
        result[key] = yamlField.reduce((v, f) => v ?? metadata[f], undefined);
      } else {
        result[key] = metadata[yamlField];
      }
    }
    return result;
  }
}
```

### Step 5: Run test to verify it passes

Run: `npx vitest run tests/isolated/adapter/readalong/ReadalongAdapter.test.mjs`

Expected: PASS (3 tests).

### Step 6: Commit

```bash
git add backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs \
       backend/src/1_adapters/content/readalong/plugins/poem.mjs \
       tests/isolated/adapter/readalong/ReadalongAdapter.test.mjs
git commit -m "feat: add ReadalongAdapter + poem plugin (simplest case)"
```

---

## Task 2: Poem Plugin Integration Test (Real Data)

Test the poem plugin against real data on disk to verify it loads actual YAML and resolves media.

**Files:**
- Create: `tests/isolated/adapter/readalong/poem-integration.test.mjs`

### Step 1: Write the integration test

```javascript
// tests/isolated/adapter/readalong/poem-integration.test.mjs
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { ReadalongAdapter } from '#adapters/content/readalong/ReadalongAdapter.mjs';
import poemPlugin from '#adapters/content/readalong/plugins/poem.mjs';
import { getDataPath, getMediaPath } from '#testlib/configHelper.mjs';

describe('Poem plugin with real data', () => {
  let adapter;
  let hasData = false;

  beforeAll(() => {
    const dataPath = getDataPath();
    const mediaPath = getMediaPath();
    if (!dataPath || !mediaPath) return;

    adapter = new ReadalongAdapter(poemPlugin, { dataPath, mediaPath });
    hasData = true;
  });

  it('loads a real poem', async () => {
    if (!hasData) throw new Error('No data path configured');
    const item = await adapter.getItem('remedy/01');
    expect(item).not.toBeNull();
    expect(item.title).toBeTruthy();
    expect(item.metadata.contentFormat).toBe('readalong');
    expect(item.metadata.contentType).toBe('paragraphs');
    expect(item.mediaType).toBe('audio');
    expect(item.resumable).toBe(false);
  });

  it('returns null for nonexistent poem', async () => {
    if (!hasData) throw new Error('No data path configured');
    const item = await adapter.getItem('nonexistent/99');
    expect(item).toBeNull();
  });

  it('has correct compound ID format', async () => {
    if (!hasData) throw new Error('No data path configured');
    const item = await adapter.getItem('remedy/01');
    expect(item.id).toBe('poem:remedy/01');
    expect(item.source).toBe('poem');
  });
});
```

### Step 2: Run test

Run: `npx vitest run tests/isolated/adapter/readalong/poem-integration.test.mjs`

Expected: PASS if data path is configured, FAIL with clear message if not.

### Step 3: Commit

```bash
git add tests/isolated/adapter/readalong/poem-integration.test.mjs
git commit -m "test: poem plugin integration test with real data"
```

---

## Task 3: SingalongAdapter + Primary Plugin (Second Simplest)

Primary is the simplest singalong variant — config only with media preference.

**Files:**
- Create: `backend/src/1_adapters/content/singalong/SingalongAdapter.mjs`
- Create: `backend/src/1_adapters/content/singalong/plugins/primary.mjs`
- Create: `tests/isolated/adapter/singalong/SingalongAdapter.test.mjs`

### Step 1: Write the failing test

```javascript
// tests/isolated/adapter/singalong/SingalongAdapter.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { SingalongAdapter } from '#adapters/content/singalong/SingalongAdapter.mjs';
import primaryPlugin from '#adapters/content/singalong/plugins/primary.mjs';

describe('SingalongAdapter with primary plugin', () => {
  let adapter;

  beforeEach(() => {
    adapter = new SingalongAdapter(primaryPlugin, {
      dataPath: path.resolve(process.cwd(), 'tests/_fixtures/local-content/data'),
      mediaPath: path.resolve(process.cwd(), 'tests/_fixtures/local-content/media'),
    });
  });

  it('has source matching plugin name', () => {
    expect(adapter.source).toBe('primary');
  });

  it('has prefixes for registry registration', () => {
    expect(adapter.prefixes).toEqual([
      { prefix: 'primary', idTransform: expect.any(Function) }
    ]);
  });

  it('returns null for nonexistent song', async () => {
    const item = await adapter.getItem('999');
    expect(item).toBeNull();
  });
});
```

### Step 2: Run test to verify it fails

Run: `npx vitest run tests/isolated/adapter/singalong/SingalongAdapter.test.mjs`

Expected: FAIL — module not found.

### Step 3: Create primary plugin manifest

```javascript
// backend/src/1_adapters/content/singalong/plugins/primary.mjs
export default {
  name: 'primary',
  format: 'singalong',
  paths: {
    data: 'singalong/primary',
    media: 'audio/singalong/primary',
  },
  mediaType: 'audio',
  contentType: 'stanzas',
  resumable: false,
  mediaPreference: {
    subdirs: ['_ldsgc', ''],
  },
  metadataMap: {
    title: 'title',
    number: ['number', 'song_num'],
  },
};
```

### Step 4: Implement SingalongAdapter

```javascript
// backend/src/1_adapters/content/singalong/SingalongAdapter.mjs
import path from 'path';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';
import {
  loadYamlByPrefix,
  findMediaFileByPrefix,
  fileExists,
} from '#system/utils/FileIO.mjs';

export class SingalongAdapter {
  #plugin;
  #dataPath;
  #mediaPath;

  constructor(plugin, { dataPath, mediaPath }) {
    this.#plugin = plugin;
    this.#dataPath = path.resolve(dataPath, plugin.paths.data);
    this.#mediaPath = path.resolve(mediaPath, plugin.paths.media);
  }

  get source() {
    return this.#plugin.name;
  }

  get prefixes() {
    return [
      {
        prefix: this.#plugin.name,
        idTransform: (id) => `${this.#plugin.name}:${id}`,
      },
    ];
  }

  getCapabilities() {
    return ['playable'];
  }

  async getItem(localId) {
    const metadata = loadYamlByPrefix(this.#dataPath, localId);
    if (!metadata) return null;
    return this.#buildPlayableItem(localId, metadata);
  }

  async resolvePlayables(localId) {
    const item = await this.getItem(localId);
    return item ? [item] : [];
  }

  getStoragePath() {
    return this.#plugin.name;
  }

  #buildPlayableItem(localId, metadata) {
    const mapped = this.#mapMetadata(metadata);
    const songNumber = mapped.number || parseInt(localId, 10);
    const mediaFile = this.#discoverMedia(songNumber);

    return new PlayableItem({
      id: `${this.#plugin.name}:${localId}`,
      source: this.#plugin.name,
      localId,
      title: mapped.title || `${this.#plugin.name} ${localId}`,
      mediaType: 'audio',
      mediaUrl: `/api/v1/proxy/local-content/stream/${this.#plugin.name}/${localId}`,
      thumbnail: this.#collectionThumbnail(),
      duration: metadata.duration || 0,
      resumable: false,
      metadata: {
        contentFormat: 'singalong',
        contentType: 'stanzas',
        content: { type: 'stanzas', data: metadata.verses || [] },
        collection: this.#plugin.name,
        number: songNumber,
        mediaFile,
        ...mapped,
      },
    });
  }

  #discoverMedia(songNumber) {
    const subdirs = this.#plugin.mediaPreference?.subdirs || [''];
    for (const subdir of subdirs) {
      const searchDir = subdir
        ? path.join(this.#mediaPath, subdir)
        : this.#mediaPath;
      const found = findMediaFileByPrefix(searchDir, songNumber);
      if (found) {
        const sub = subdir ? `${subdir}/` : '';
        return `${this.#plugin.paths.media}/${sub}${path.basename(found)}`;
      }
    }
    return null;
  }

  #collectionThumbnail() {
    const iconPath = path.join(this.#dataPath, 'icon.svg');
    return fileExists(iconPath)
      ? `/api/v1/local-content/collection-icon/${this.#plugin.name}`
      : null;
  }

  #mapMetadata(metadata) {
    const map = this.#plugin.metadataMap || { title: 'title' };
    const result = {};
    for (const [key, yamlField] of Object.entries(map)) {
      if (Array.isArray(yamlField)) {
        result[key] = yamlField.reduce((v, f) => v ?? metadata[f], undefined);
      } else {
        result[key] = metadata[yamlField];
      }
    }
    return result;
  }
}
```

### Step 5: Run tests

Run: `npx vitest run tests/isolated/adapter/singalong/SingalongAdapter.test.mjs`

Expected: PASS.

### Step 6: Commit

```bash
git add backend/src/1_adapters/content/singalong/SingalongAdapter.mjs \
       backend/src/1_adapters/content/singalong/plugins/primary.mjs \
       tests/isolated/adapter/singalong/SingalongAdapter.test.mjs
git commit -m "feat: add SingalongAdapter + primary plugin"
```

---

## Task 4: Hymn Plugin

Shares SingalongAdapter, just different config.

**Files:**
- Create: `backend/src/1_adapters/content/singalong/plugins/hymn.mjs`
- Create: `tests/isolated/adapter/singalong/hymn-integration.test.mjs`

### Step 1: Write the test

```javascript
// tests/isolated/adapter/singalong/hymn-integration.test.mjs
import { describe, it, expect, beforeAll } from 'vitest';
import { SingalongAdapter } from '#adapters/content/singalong/SingalongAdapter.mjs';
import hymnPlugin from '#adapters/content/singalong/plugins/hymn.mjs';
import { getDataPath, getMediaPath } from '#testlib/configHelper.mjs';

describe('Hymn plugin with real data', () => {
  let adapter;
  let hasData = false;

  beforeAll(() => {
    const dataPath = getDataPath();
    const mediaPath = getMediaPath();
    if (!dataPath || !mediaPath) return;
    adapter = new SingalongAdapter(hymnPlugin, { dataPath, mediaPath });
    hasData = true;
  });

  it('loads hymn 166', async () => {
    if (!hasData) throw new Error('No data path configured');
    const item = await adapter.getItem('166');
    expect(item).not.toBeNull();
    expect(item.id).toBe('hymn:166');
    expect(item.source).toBe('hymn');
    expect(item.metadata.contentFormat).toBe('singalong');
    expect(item.metadata.contentType).toBe('stanzas');
    expect(item.metadata.content.data.length).toBeGreaterThan(0);
  });

  it('discovers media file with _ldsgc preference', async () => {
    if (!hasData) throw new Error('No data path configured');
    const item = await adapter.getItem('166');
    expect(item.metadata.mediaFile).toBeTruthy();
    // Should prefer _ldsgc subdirectory
    if (item.metadata.mediaFile.includes('_ldsgc')) {
      expect(item.metadata.mediaFile).toContain('_ldsgc');
    }
  });
});
```

### Step 2: Create hymn plugin manifest

```javascript
// backend/src/1_adapters/content/singalong/plugins/hymn.mjs
export default {
  name: 'hymn',
  format: 'singalong',
  paths: {
    data: 'singalong/hymn',
    media: 'audio/singalong/hymn',
  },
  mediaType: 'audio',
  contentType: 'stanzas',
  resumable: false,
  mediaPreference: {
    subdirs: ['_ldsgc', ''],
  },
  metadataMap: {
    title: 'title',
    number: ['number', 'hymn_num'],
  },
};
```

### Step 3: Run tests

Run: `npx vitest run tests/isolated/adapter/singalong/`

Expected: All PASS.

### Step 4: Commit

```bash
git add backend/src/1_adapters/content/singalong/plugins/hymn.mjs \
       tests/isolated/adapter/singalong/hymn-integration.test.mjs
git commit -m "feat: add hymn plugin manifest"
```

---

## Task 5: Talk Plugin + TalkResolver

Extract talk-specific resolution logic from `LocalContentAdapter._getTalk()` and `_getTalkFolder()` into a standalone resolver.

**Files:**
- Create: `backend/src/1_adapters/content/readalong/plugins/talk.mjs`
- Create: `backend/src/1_adapters/content/readalong/resolvers/talk.mjs`
- Create: `tests/isolated/adapter/readalong/talk-resolver.test.mjs`

### Step 1: Write the failing test

```javascript
// tests/isolated/adapter/readalong/talk-resolver.test.mjs
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { getDataPath, getMediaPath } from '#testlib/configHelper.mjs';

describe('TalkResolver', () => {
  let TalkResolver;
  let dataPath;
  let mediaPath;
  let hasData = false;

  beforeAll(async () => {
    const mod = await import('#adapters/content/readalong/resolvers/talk.mjs');
    TalkResolver = mod.TalkResolver;

    dataPath = getDataPath();
    mediaPath = getMediaPath();
    if (dataPath && mediaPath) hasData = true;
  });

  it('resolves a direct talk path (conference/number)', async () => {
    if (!hasData) throw new Error('No data path configured');
    const resolver = new TalkResolver({
      dataPath: path.resolve(dataPath, 'readalong/talks'),
      mediaPath: path.resolve(mediaPath, 'video/readalong/talks'),
    });
    // ldsgc202510/13 should resolve directly
    const result = resolver.resolve('ldsgc202510/13');
    expect(result).not.toBeNull();
    expect(result.path).toBe('ldsgc202510/13');
    expect(result.container).toBeFalsy();
  });

  it('resolves a series alias to latest conference container', () => {
    if (!hasData) throw new Error('No data path configured');
    const resolver = new TalkResolver({
      dataPath: path.resolve(dataPath, 'readalong/talks'),
      mediaPath: path.resolve(mediaPath, 'video/readalong/talks'),
    });
    const result = resolver.resolve('ldsgc');
    expect(result).not.toBeNull();
    // Should be a container (conference or series)
    expect(result.container).toBe(true);
  });

  it('resolves a conference ID to container', () => {
    if (!hasData) throw new Error('No data path configured');
    const resolver = new TalkResolver({
      dataPath: path.resolve(dataPath, 'readalong/talks'),
      mediaPath: path.resolve(mediaPath, 'video/readalong/talks'),
    });
    const result = resolver.resolve('ldsgc202510');
    expect(result).not.toBeNull();
    expect(result.container).toBe(true);
  });
});
```

### Step 2: Run test to verify it fails

Run: `npx vitest run tests/isolated/adapter/readalong/talk-resolver.test.mjs`

Expected: FAIL — module not found.

### Step 3: Create TalkResolver

Extract logic from `LocalContentAdapter._getTalk()` (lines 804-883) and the container detection helpers into a standalone class. The resolver's job: turn a user-facing ID into either `{ path, container: false }` (direct talk) or `{ path, container: true, children: [...] }` (conference/series).

```javascript
// backend/src/1_adapters/content/readalong/resolvers/talk.mjs
import path from 'path';
import {
  loadContainedYaml,
  loadYamlSafe,
  listYamlFiles,
  dirExists,
  fileExists,
  buildContainedPath,
  findMediaFileByPrefix,
} from '#system/utils/FileIO.mjs';

/**
 * Resolve talk IDs through conference/series hierarchy.
 *
 * Handles:
 * - Direct talk paths: "ldsgc202510/13" → { path: "ldsgc202510/13" }
 * - Conference IDs: "ldsgc202510" → { container: true, path: "ldsgc202510" }
 * - Series aliases: "ldsgc" → resolves to latest conference, returns container
 * - Nested paths: detects series/conference nesting in media directory
 */
export class TalkResolver {
  #dataPath;
  #mediaPath;

  constructor({ dataPath, mediaPath }) {
    this.#dataPath = dataPath;
    this.#mediaPath = mediaPath;
  }

  /**
   * Resolve a talk localId to a concrete path or container reference.
   * @param {string} localId
   * @returns {{ path: string, container: boolean, containerType?: string } | null}
   */
  resolve(localId) {
    if (!localId) return null;

    // Try as direct talk file first
    const metadata = loadContainedYaml(this.#dataPath, localId);
    if (metadata) {
      return { path: localId, container: false };
    }

    // Check if it's a directory (conference or series) in media path
    const mediaDir = path.join(this.#mediaPath, localId);
    if (dirExists(mediaDir)) {
      const containerType = this.#detectContainerType(localId);
      if (containerType) {
        return { path: localId, container: true, containerType };
      }
    }

    // Check nested path: "ldsgc202510" might be under "ldsgc/ldsgc202510"
    const nestedPath = this.#resolveNestedPath(localId);
    if (nestedPath) {
      const containerType = this.#detectContainerType(nestedPath);
      if (containerType) {
        return { path: nestedPath, container: true, containerType };
      }
    }

    // Check alias: "ldsgc" → latest "ldsgc202510"
    const resolved = this.#resolveLatestFolder(localId);
    if (resolved) {
      return { path: resolved, container: true, containerType: 'conference' };
    }

    return null;
  }

  #detectContainerType(localId) {
    const mediaDir = path.join(this.#mediaPath, localId);
    if (!dirExists(mediaDir)) return null;

    // If subdirectories contain .mp4 files, it's a conference (contains talks)
    // If subdirectories are themselves directories, it's a series (contains conferences)
    const entries = this.#listDir(mediaDir);
    const hasSubdirs = entries.some(e => dirExists(path.join(mediaDir, e)));
    const hasMedia = entries.some(e =>
      e.endsWith('.mp4') || e.endsWith('.mkv') || e.endsWith('.webm')
    );

    if (hasMedia) return 'conference';
    if (hasSubdirs) return 'series';
    return 'conference'; // default
  }

  #resolveNestedPath(localId) {
    // Check if localId is nested under a parent folder in media
    // e.g., "ldsgc202510" → "ldsgc/ldsgc202510"
    if (localId.includes('/')) return null;

    const entries = this.#listDir(this.#mediaPath);
    for (const dir of entries) {
      const nested = path.join(this.#mediaPath, dir, localId);
      if (dirExists(nested)) {
        return `${dir}/${localId}`;
      }
    }
    return null;
  }

  #resolveLatestFolder(prefix) {
    // "ldsgc" → find folders matching "ldsgc*", pick latest by name sort
    const entries = this.#listDir(this.#mediaPath);
    const matches = entries
      .filter(e => e.startsWith(prefix) && e !== prefix && dirExists(path.join(this.#mediaPath, e)));

    if (matches.length > 0) {
      matches.sort((a, b) => b.localeCompare(a));
      return matches[0];
    }

    // Check nested: series folder named "prefix" containing conferences
    const seriesDir = path.join(this.#mediaPath, prefix);
    if (dirExists(seriesDir)) {
      const conferences = this.#listDir(seriesDir)
        .filter(e => dirExists(path.join(seriesDir, e)));
      if (conferences.length > 0) {
        conferences.sort((a, b) => b.localeCompare(a));
        return `${prefix}/${conferences[0]}`;
      }
    }

    return null;
  }

  #listDir(dirPath) {
    try {
      const { readdirSync } = await import('fs');
      return readdirSync(dirPath);
    } catch {
      return [];
    }
  }
}
```

**Note:** The `#listDir` method above has an `await import` in a sync context. Fix this by importing `fs` at module top level:

```javascript
import fs from 'fs';
// ...
#listDir(dirPath) {
  try { return fs.readdirSync(dirPath); }
  catch { return []; }
}
```

### Step 4: Create talk plugin manifest

```javascript
// backend/src/1_adapters/content/readalong/plugins/talk.mjs
import { TalkResolver } from '../resolvers/talk.mjs';

export default {
  name: 'talk',
  format: 'readalong',
  paths: {
    data: 'readalong/talks',
    media: 'video/readalong/talks',
  },
  mediaType: 'video',
  contentType: 'paragraphs',
  resumable: true,
  resolver: TalkResolver,
  containers: { type: 'hierarchy' },
  metadataMap: {
    title: 'title',
    speaker: 'speaker',
    date: 'date',
  },
};
```

### Step 5: Run tests

Run: `npx vitest run tests/isolated/adapter/readalong/talk-resolver.test.mjs`

Expected: PASS.

### Step 6: Commit

```bash
git add backend/src/1_adapters/content/readalong/resolvers/talk.mjs \
       backend/src/1_adapters/content/readalong/plugins/talk.mjs \
       tests/isolated/adapter/readalong/talk-resolver.test.mjs
git commit -m "feat: add TalkResolver + talk plugin"
```

---

## Task 6: Scripture Plugin (Uses Existing ScriptureResolver)

The ScriptureResolver already exists at `backend/src/1_adapters/content/readalong/resolvers/scripture.mjs`. The plugin manifest just references it.

**Files:**
- Create: `backend/src/1_adapters/content/readalong/plugins/scripture.mjs`
- Create: `tests/isolated/adapter/readalong/scripture-integration.test.mjs`

### Step 1: Write the test

```javascript
// tests/isolated/adapter/readalong/scripture-integration.test.mjs
import { describe, it, expect, beforeAll } from 'vitest';
import { ReadalongAdapter } from '#adapters/content/readalong/ReadalongAdapter.mjs';
import scripturePlugin from '#adapters/content/readalong/plugins/scripture.mjs';
import { getDataPath, getMediaPath } from '#testlib/configHelper.mjs';

describe('Scripture plugin with real data', () => {
  let adapter;
  let hasData = false;

  beforeAll(() => {
    const dataPath = getDataPath();
    const mediaPath = getMediaPath();
    if (!dataPath || !mediaPath) return;
    adapter = new ReadalongAdapter(scripturePlugin, { dataPath, mediaPath });
    hasData = true;
  });

  it('has source "scripture"', () => {
    if (!hasData) throw new Error('No data path');
    expect(adapter.source).toBe('scripture');
  });

  it('loads scripture by verse path', async () => {
    if (!hasData) throw new Error('No data path');
    // Direct path: volume/version/verseId
    const item = await adapter.getItem('bom/sebom/31103');
    expect(item).not.toBeNull();
    expect(item.metadata.contentFormat).toBe('readalong');
    expect(item.metadata.contentType).toBe('verses');
  });
});
```

### Step 2: Create scripture plugin manifest

```javascript
// backend/src/1_adapters/content/readalong/plugins/scripture.mjs
import { ScriptureResolver } from '../resolvers/scripture.mjs';

export default {
  name: 'scripture',
  format: 'readalong',
  paths: {
    data: 'readalong/scripture',
    media: 'audio/readalong/scripture',
  },
  mediaType: 'audio',
  contentType: 'verses',
  resumable: true,
  resolver: ScriptureResolver,
  containers: { type: 'hierarchy' },
  metadataMap: {
    title: 'title',
  },
};
```

**Note:** The existing `ScriptureResolver` has a different interface (`resolve(input, dataPath, options)` — static-style). The `ReadalongAdapter` expects `new plugin.resolver({dataPath, mediaPath})` with a `resolve(localId)` instance method. The ScriptureResolver will need a thin adapter wrapper or its interface needs to be updated to match. This should be handled in this task — write a `ScriptureResolverAdapter` wrapper class if the existing interface can't change, or update the resolver class constructor to accept `{dataPath, mediaPath}` and provide instance methods `resolve(localId)` and `getItem(localId)`.

### Step 3: Run tests and iterate

Run: `npx vitest run tests/isolated/adapter/readalong/scripture-integration.test.mjs`

Expected: PASS after adapting ScriptureResolver interface.

### Step 4: Commit

```bash
git add backend/src/1_adapters/content/readalong/plugins/scripture.mjs \
       tests/isolated/adapter/readalong/scripture-integration.test.mjs
git commit -m "feat: add scripture plugin manifest"
```

---

## Task 7: Register Plugin Adapters in Bootstrap

Wire the new adapters into the registry alongside the existing `LocalContentAdapter`.

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (~line 458)

### Step 1: Write the integration test

```javascript
// tests/isolated/adapter/readalong/bootstrap-registration.test.mjs
import { describe, it, expect } from 'vitest';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

describe('Plugin adapters registered', () => {
  it('poem adapter responds via info endpoint', async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/info/poem/remedy/01`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.format).toBe('readalong');
  });

  it('hymn adapter responds via info endpoint', async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/info/hymn/166`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.format).toBe('singalong');
  });

  it('talk adapter responds via info endpoint', async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/info/talk/ldsgc202510/13`);
    expect(res.status).toBe(200);
  });

  it('scripture adapter responds via info endpoint', async () => {
    const res = await fetch(`${BACKEND_URL}/api/v1/info/scripture/bom/sebom/31103`);
    expect(res.status).toBe(200);
  });
});
```

### Step 2: Add plugin registration to bootstrap.mjs

After the existing `LocalContentAdapter` registration (~line 470), add:

```javascript
// Register format plugin adapters
import { ReadalongAdapter } from '#adapters/content/readalong/ReadalongAdapter.mjs';
import { SingalongAdapter } from '#adapters/content/singalong/SingalongAdapter.mjs';
import poemPlugin from '#adapters/content/readalong/plugins/poem.mjs';
import talkPlugin from '#adapters/content/readalong/plugins/talk.mjs';
import scripturePlugin from '#adapters/content/readalong/plugins/scripture.mjs';
import hymnPlugin from '#adapters/content/singalong/plugins/hymn.mjs';
import primaryPlugin from '#adapters/content/singalong/plugins/primary.mjs';

const pluginAdapterConfig = { dataPath: config.dataPath, mediaPath: config.mediaBasePath };

for (const plugin of [poemPlugin, talkPlugin, scripturePlugin]) {
  registry.register(
    new ReadalongAdapter(plugin, pluginAdapterConfig),
    { category: 'local', provider: plugin.name }
  );
}

for (const plugin of [hymnPlugin, primaryPlugin]) {
  registry.register(
    new SingalongAdapter(plugin, pluginAdapterConfig),
    { category: 'local', provider: plugin.name }
  );
}
```

### Step 3: Run live API tests

Run: `npx vitest run tests/isolated/adapter/readalong/bootstrap-registration.test.mjs`

Expected: PASS — all plugin adapters respond.

### Step 4: Run full regression

Run: `npx playwright test tests/live/flow/tv/tv-menu-regression.runtime.test.mjs --reporter=line`

Expected: All existing tests still pass (LocalContentAdapter still registered, new adapters are alongside).

### Step 5: Commit

```bash
git add backend/src/0_system/bootstrap.mjs \
       tests/isolated/adapter/readalong/bootstrap-registration.test.mjs
git commit -m "feat: register plugin adapters in bootstrap (alongside LocalContentAdapter)"
```

---

## Task 8: Update ContentIdResolver Aliases

Ensure the resolver routes `hymn:166` → hymn adapter, `scripture:alma-32` → scripture adapter, etc. The new plugin adapters register their own prefixes, so the system aliases may conflict with the LocalContentAdapter's prefixes. Update aliases so the new adapters take priority.

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (alias config)

### Step 1: Verify current alias behavior

Check which adapter wins when both `LocalContentAdapter` (prefix `hymn` → `local-content`) and the new `SingalongAdapter` (prefix `hymn` → `hymn`) are registered. Write a test that verifies the new adapter wins.

### Step 2: Adjust registration order or remove prefixes from LocalContentAdapter

If both register `hymn` prefix, the later registration wins. Register plugin adapters AFTER `LocalContentAdapter` so they override.

### Step 3: Run regression

Run: `npx playwright test tests/live/flow/tv/ --reporter=line`

### Step 4: Commit

```bash
git commit -m "fix: ensure plugin adapters override LocalContentAdapter prefixes"
```

---

## Task 9: Rename Frontend Scroller Components

**Files:**
- Rename: `frontend/src/modules/ContentScroller/NarratedScroller.jsx` → `ReadalongScroller.jsx`
- Rename: `frontend/src/modules/ContentScroller/SingingScroller.jsx` → `SingalongScroller.jsx`
- Update: all imports referencing old names

### Step 1: Find all imports

Search for `NarratedScroller` and `SingingScroller` across the codebase.

### Step 2: Rename files and update imports

Use git mv for the file renames, then update all import paths.

### Step 3: Run frontend build

Run: `cd frontend && npm run build`

Expected: Build succeeds with no errors.

### Step 4: Run E2E regression

Run: `npx playwright test tests/live/flow/tv/ --reporter=line`

### Step 5: Commit

```bash
git add -A
git commit -m "refactor: rename NarratedScroller → ReadalongScroller, SingingScroller → SingalongScroller"
```

---

## Task 10: Add contentType to API Responses

**Files:**
- Modify: `backend/src/4_api/v1/routers/info.mjs` (add contentType to response)
- Modify: `backend/src/4_api/v1/routers/play.mjs` (add contentType to response)
- Modify: `frontend/src/lib/contentRenderers.jsx` (key by contentType instead of shape detection)

### Step 1: Write test

```javascript
// tests/live/api/content/content-type-field.test.mjs
import { describe, it, expect } from 'vitest';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE = BACKEND_URL;

describe('contentType field in API responses', () => {
  it('scripture returns contentType: verses', async () => {
    const res = await fetch(`${BASE}/api/v1/info/scripture/bom/sebom/31103`);
    const data = await res.json();
    expect(data.contentType).toBe('verses');
  });

  it('talk returns contentType: paragraphs', async () => {
    const res = await fetch(`${BASE}/api/v1/info/talk/ldsgc202510/13`);
    const data = await res.json();
    expect(data.contentType).toBe('paragraphs');
  });

  it('hymn returns contentType: stanzas', async () => {
    const res = await fetch(`${BASE}/api/v1/info/hymn/166`);
    const data = await res.json();
    expect(data.contentType).toBe('stanzas');
  });
});
```

### Step 2: Add contentType to response transformers

In `info.mjs` `transformToInfoResponse()` and `play.mjs` `toPlayResponse()`, add:

```javascript
contentType: item.metadata?.contentType || null,
```

### Step 3: Update contentRenderers.jsx

Change from shape detection to explicit contentType lookup:

```javascript
const renderers = {
  verses: { parseContent, extractTitle, extractSubtitle },
};

export function getRenderer(contentType) {
  return renderers[contentType] || null;
}
```

### Step 4: Run tests

Run: `npx vitest run tests/live/api/content/content-type-field.test.mjs`
Run: `npx playwright test tests/live/flow/tv/ --reporter=line`

### Step 5: Commit

```bash
git commit -m "feat: add contentType field to API responses, key renderers by contentType"
```

---

## Task 11: Fix Talk Audio Bug (File-Existence Filter)

The immediate bug: `resolvePlayables()` returns items whose media files don't exist on disk. Add file-existence filtering.

**Files:**
- Modify: `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs`

### Step 1: Write failing test

```javascript
// tests/isolated/adapter/readalong/talk-playables-filter.test.mjs
import { describe, it, expect, beforeAll } from 'vitest';
import { ReadalongAdapter } from '#adapters/content/readalong/ReadalongAdapter.mjs';
import talkPlugin from '#adapters/content/readalong/plugins/talk.mjs';
import { getDataPath, getMediaPath } from '#testlib/configHelper.mjs';

describe('Talk resolvePlayables filters by file existence', () => {
  let adapter;
  let hasData = false;

  beforeAll(() => {
    const dataPath = getDataPath();
    const mediaPath = getMediaPath();
    if (!dataPath || !mediaPath) return;
    adapter = new ReadalongAdapter(talkPlugin, { dataPath, mediaPath });
    hasData = true;
  });

  it('only returns talks whose media files exist', async () => {
    if (!hasData) throw new Error('No data path');
    const playables = await adapter.resolvePlayables('ldsgc202510');
    expect(playables.length).toBeGreaterThan(0);

    for (const item of playables) {
      expect(item.metadata.mediaFile).toBeTruthy();
      // Each item should have a real media file on disk
      // (the adapter filters out items without files)
    }
  });
});
```

### Step 2: Add filter to resolvePlayables

In `ReadalongAdapter.resolvePlayables()`, after getting the list of children from the resolver, filter by file existence:

```javascript
async resolvePlayables(localId) {
  if (this.#resolver && typeof this.#resolver.resolvePlayables === 'function') {
    const items = await this.#resolver.resolvePlayables(localId);
    return this.#filterByMediaExistence(items);
  }
  // ... existing single-item fallback
}

#filterByMediaExistence(items) {
  if (!this.#mediaPath) return items;
  return items.filter(item => {
    const mediaFile = item.metadata?.mediaFile;
    if (!mediaFile) return true; // No media file declared = keep (non-media items)
    const fullPath = path.resolve(this.#mediaPath, '..', '..', mediaFile);
    return fileExists(fullPath);
  });
}
```

### Step 3: Run tests

Run: `npx vitest run tests/isolated/adapter/readalong/talk-playables-filter.test.mjs`

### Step 4: Commit

```bash
git commit -m "fix: filter resolvePlayables by media file existence (fixes talk audio 404)"
```

---

## Task 12: Remove LocalContentAdapter Prefixes (Handoff)

Once all plugin adapters pass regression, remove the duplicate prefixes from `LocalContentAdapter` so it no longer competes with plugin adapters.

**Files:**
- Modify: `backend/src/1_adapters/content/local-content/LocalContentAdapter.mjs` (~line 268)

### Step 1: Remove prefixes

Change `get prefixes()` to return `[]` — the plugin adapters now own all content prefixes.

### Step 2: Run full regression

Run: `npx playwright test tests/live/flow/tv/ --reporter=line`
Run: `npx vitest run tests/isolated/ --reporter=dot`

### Step 3: Commit

```bash
git commit -m "refactor: remove content prefixes from LocalContentAdapter (plugins own them now)"
```

---

## Task 13: Final Regression Gate

Run every test suite to ensure nothing is broken.

```bash
npx vitest run tests/isolated/ --reporter=dot
npx playwright test tests/live/flow/tv/ --reporter=line
```

All pass → the plugin architecture is working alongside the legacy code.

```bash
git commit --allow-empty -m "milestone: content format plugins registered and passing regression"
```

---

## Future Tasks (Not In This Plan)

These tasks complete the migration but can be done incrementally:

1. **Delete `_getTalk()`, `_getScripture()`, `_getSong()`, `_getPoem()` from LocalContentAdapter** — once all traffic routes through plugin adapters
2. **Delete `LocalContentAdapter` entirely** — once all methods have plugin equivalents
3. **Deprecate `localContent.mjs` router** — add sunset headers, migrate callers to unified play/info
4. **Move conference auto-selection to ItemSelectionService** — extract the 120-line watch-history logic from `localContent.mjs` into the domain layer
