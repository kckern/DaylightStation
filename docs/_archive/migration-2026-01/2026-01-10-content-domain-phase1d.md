# Content Domain Phase 1d Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate the Content API into the main backend and implement PlexAdapter.

**Architecture:** Mount the new content router alongside legacy routes, configure mediaBasePath from environment, add PlexAdapter for Plex media server integration.

**Tech Stack:** JavaScript (ES Modules), Express.js, Jest for testing. JSDoc for type hints.

**Reference Docs:**
- `docs/plans/2026-01-10-content-domain-phase1.md` - Phase 1 completed tasks
- `docs/_wip/plans/2026-01-10-backend-ddd-architecture.md` - Overall DDD structure
- `docs/_wip/plans/2026-01-10-unified-domain-backend-design.md` - Content domain details

---

## Task 1: Integrate Content API into main backend

**Files:**
- Modify: `backend/_legacy/index.js`
- Test: Manual smoke test

**Step 1: Add content router import and mounting**

In `backend/_legacy/index.js`, after the existing router imports (around line 200-210), add:

```javascript
// Content domain (new DDD structure)
const { createContentRegistry } = await import('../src/infrastructure/bootstrap.mjs');
const { createContentRouter } = await import('../src/api/routers/content.mjs');
```

**Step 2: Initialize registry in initializeApp()**

After the config is loaded (around line 280-300), add:

```javascript
// Initialize content registry
const mediaBasePath = config.media?.filesystem?.mediaBasePath || process.env.MEDIA_PATH || '/data/media';
const contentRegistry = createContentRegistry({ mediaBasePath });

// Mount content router
app.use('/api/content', createContentRouter(contentRegistry));
console.log(`[content] Mounted /api/content with mediaBasePath: ${mediaBasePath}`);
```

**Step 3: Verify with dev server**

Run: `npm run dev` and test:
- `curl http://localhost:3112/api/content/list/filesystem/`
- Should return `{"source":"filesystem","path":"","items":[...]}`

**Step 4: Commit**

```bash
git add backend/_legacy/index.js
git commit -m "feat(backend): integrate content API router"
```

---

## Task 2: Create PlexAdapter skeleton

**Files:**
- Create: `backend/src/adapters/content/media/plex/PlexAdapter.mjs`
- Create: `backend/src/adapters/content/media/plex/PlexClient.mjs`
- Test: `tests/unit/adapters/content/PlexAdapter.test.mjs`

**Step 1: Create PlexClient for API communication**

```javascript
// backend/src/adapters/content/media/plex/PlexClient.mjs

/**
 * Low-level Plex API client
 */
export class PlexClient {
  /**
   * @param {Object} config
   * @param {string} config.host - Plex server URL (e.g., http://10.0.0.10:32400)
   * @param {string} config.token - Plex auth token
   */
  constructor(config) {
    if (!config.host) throw new Error('PlexClient requires host');
    this.host = config.host.replace(/\/$/, '');
    this.token = config.token || '';
  }

  /**
   * Make authenticated request to Plex API
   * @param {string} path
   * @returns {Promise<Object>}
   */
  async request(path) {
    const url = `${this.host}${path}`;
    const headers = {
      'Accept': 'application/json',
      'X-Plex-Token': this.token
    };

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Plex API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get library sections
   * @returns {Promise<Object>}
   */
  async getLibrarySections() {
    return this.request('/library/sections');
  }

  /**
   * Get items in a section/container
   * @param {string} key - e.g., "/library/sections/1/all"
   * @returns {Promise<Object>}
   */
  async getContainer(key) {
    return this.request(key);
  }

  /**
   * Get metadata for a specific item
   * @param {string} ratingKey
   * @returns {Promise<Object>}
   */
  async getMetadata(ratingKey) {
    return this.request(`/library/metadata/${ratingKey}`);
  }
}
```

**Step 2: Write PlexAdapter test**

```javascript
// tests/unit/adapters/content/PlexAdapter.test.mjs
import { PlexAdapter } from '../../../../backend/src/adapters/content/media/plex/PlexAdapter.mjs';

describe('PlexAdapter', () => {
  test('has correct source and prefixes', () => {
    const adapter = new PlexAdapter({
      host: 'http://localhost:32400',
      token: 'test-token'
    });

    expect(adapter.source).toBe('plex');
    expect(adapter.prefixes).toContainEqual({ prefix: 'plex' });
  });

  test('throws error when host is missing', () => {
    expect(() => new PlexAdapter({})).toThrow('PlexAdapter requires host');
  });

  // Note: Full integration tests require a running Plex server
  // These unit tests verify the adapter structure
});
```

**Step 3: Write PlexAdapter implementation**

```javascript
// backend/src/adapters/content/media/plex/PlexAdapter.mjs
import { ListableItem } from '../../../../domains/content/capabilities/Listable.mjs';
import { PlayableItem } from '../../../../domains/content/capabilities/Playable.mjs';
import { PlexClient } from './PlexClient.mjs';

/**
 * Plex content source adapter
 */
export class PlexAdapter {
  /**
   * @param {Object} config
   * @param {string} config.host - Plex server URL
   * @param {string} [config.token] - Plex auth token
   */
  constructor(config) {
    if (!config.host) throw new Error('PlexAdapter requires host');
    this.client = new PlexClient(config);
    this.host = config.host;
  }

  get source() {
    return 'plex';
  }

  get prefixes() {
    return [{ prefix: 'plex' }];
  }

  /**
   * @param {string} id - ratingKey or path like "sections/1/all"
   * @returns {Promise<import('../../../../domains/content/entities/Item.mjs').Item|null>}
   */
  async getItem(id) {
    try {
      // If it's a numeric ID, treat as ratingKey
      if (/^\d+$/.test(id)) {
        const data = await this.client.getMetadata(id);
        const item = data.MediaContainer?.Metadata?.[0];
        if (!item) return null;
        return this._toPlayableItem(item);
      }

      // Otherwise treat as container path
      const data = await this.client.getContainer(`/${id}`);
      const container = data.MediaContainer;
      if (!container) return null;

      return new ListableItem({
        id: `plex:${id}`,
        source: 'plex',
        title: container.title1 || container.title || id,
        itemType: 'container',
        childCount: container.size || 0,
        thumbnail: container.thumb ? `${this.host}${container.thumb}` : null
      });
    } catch (err) {
      console.error(`[PlexAdapter] getItem error for ${id}:`, err.message);
      return null;
    }
  }

  /**
   * @param {string} id - Container path like "library/sections" or "library/sections/1/all"
   * @returns {Promise<ListableItem[]>}
   */
  async getList(id) {
    try {
      const path = id ? `/${id}` : '/library/sections';
      const data = await this.client.getContainer(path);
      const container = data.MediaContainer;
      if (!container) return [];

      const items = container.Metadata || container.Directory || [];
      return items.map(item => this._toListableItem(item, id));
    } catch (err) {
      console.error(`[PlexAdapter] getList error for ${id}:`, err.message);
      return [];
    }
  }

  /**
   * @param {string} id
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id) {
    try {
      // If it's a ratingKey, get that single item
      if (/^\d+$/.test(id)) {
        const item = await this.getItem(id);
        if (item && item.mediaUrl) return [item];
        return [];
      }

      // Otherwise get list and flatten
      const list = await this.getList(id);
      const playables = [];

      for (const item of list) {
        if (item.itemType === 'leaf') {
          const ratingKey = item.id.replace('plex:', '');
          const playable = await this.getItem(ratingKey);
          if (playable && playable.mediaUrl) {
            playables.push(playable);
          }
        } else if (item.itemType === 'container') {
          // Recursively resolve containers
          const localId = item.id.replace('plex:', '');
          const children = await this.resolvePlayables(localId);
          playables.push(...children);
        }
      }

      return playables;
    } catch (err) {
      console.error(`[PlexAdapter] resolvePlayables error for ${id}:`, err.message);
      return [];
    }
  }

  /**
   * Convert Plex metadata to ListableItem
   * @private
   */
  _toListableItem(item, parentPath) {
    const isContainer = item.type === 'show' || item.type === 'season' ||
                       item.type === 'artist' || item.type === 'album' ||
                       !!item.key?.includes('/children');

    const id = item.ratingKey || item.key?.replace(/^\//, '').replace(/\/children$/, '');

    return new ListableItem({
      id: `plex:${id}`,
      source: 'plex',
      title: item.title,
      itemType: isContainer ? 'container' : 'leaf',
      childCount: item.leafCount || item.childCount || 0,
      thumbnail: item.thumb ? `${this.host}${item.thumb}` : null,
      metadata: {
        type: item.type,
        year: item.year,
        summary: item.summary
      }
    });
  }

  /**
   * Convert Plex metadata to PlayableItem
   * @private
   */
  _toPlayableItem(item) {
    const isVideo = ['movie', 'episode', 'clip'].includes(item.type);
    const isAudio = ['track'].includes(item.type);

    if (!isVideo && !isAudio) {
      // Not directly playable, return as listable
      return new ListableItem({
        id: `plex:${item.ratingKey}`,
        source: 'plex',
        title: item.title,
        itemType: 'container',
        childCount: item.leafCount || 0,
        thumbnail: item.thumb ? `${this.host}${item.thumb}` : null
      });
    }

    const media = item.Media?.[0];
    const part = media?.Part?.[0];

    return new PlayableItem({
      id: `plex:${item.ratingKey}`,
      source: 'plex',
      title: item.title,
      mediaType: isVideo ? 'video' : 'audio',
      mediaUrl: `/proxy/plex/stream/${item.ratingKey}`,
      duration: item.duration ? Math.floor(item.duration / 1000) : null,
      resumable: isVideo,
      resumePosition: item.viewOffset ? Math.floor(item.viewOffset / 1000) : null,
      thumbnail: item.thumb ? `${this.host}${item.thumb}` : null,
      metadata: {
        type: item.type,
        year: item.year,
        summary: item.summary,
        grandparentTitle: item.grandparentTitle,
        parentTitle: item.parentTitle,
        resolution: media?.videoResolution,
        container: part?.container
      }
    });
  }

  /**
   * @param {string} id
   * @returns {Promise<string>}
   */
  async getStoragePath(id) {
    return 'plex';
  }
}
```

**Step 4: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/content/PlexAdapter.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/adapters/content/media/plex/
git add tests/unit/adapters/content/PlexAdapter.test.mjs
git commit -m "feat(adapters): add PlexAdapter for content domain"
```

---

## Task 3: Register PlexAdapter in bootstrap

**Files:**
- Modify: `backend/src/infrastructure/bootstrap.mjs`

**Step 1: Update bootstrap to conditionally register PlexAdapter**

```javascript
// backend/src/infrastructure/bootstrap.mjs
import { ContentSourceRegistry } from '../domains/content/services/ContentSourceRegistry.mjs';
import { FilesystemAdapter } from '../adapters/content/media/filesystem/FilesystemAdapter.mjs';
import { PlexAdapter } from '../adapters/content/media/plex/PlexAdapter.mjs';

/**
 * Create and configure the content registry
 * @param {Object} config
 * @param {string} config.mediaBasePath
 * @param {Object} [config.plex] - Plex configuration
 * @param {string} [config.plex.host] - Plex server URL
 * @param {string} [config.plex.token] - Plex auth token
 * @returns {ContentSourceRegistry}
 */
export function createContentRegistry(config) {
  const registry = new ContentSourceRegistry();

  // Register filesystem adapter
  if (config.mediaBasePath) {
    registry.register(new FilesystemAdapter({
      mediaBasePath: config.mediaBasePath
    }));
  }

  // Register Plex adapter if configured
  if (config.plex?.host) {
    registry.register(new PlexAdapter({
      host: config.plex.host,
      token: config.plex.token
    }));
  }

  return registry;
}
```

**Step 2: Update backend integration to pass Plex config**

In `backend/_legacy/index.js`, update the registry initialization:

```javascript
// Initialize content registry with all adapters
const contentRegistry = createContentRegistry({
  mediaBasePath: config.media?.filesystem?.mediaBasePath || process.env.MEDIA_PATH || '/data/media',
  plex: config.media?.plex ? {
    host: config.media.plex.host,
    token: config.media.plex.token
  } : null
});
```

**Step 3: Commit**

```bash
git add backend/src/infrastructure/bootstrap.mjs backend/_legacy/index.js
git commit -m "feat(infrastructure): register PlexAdapter in bootstrap"
```

---

## Summary

**Tasks in this plan:**

1. ✅ Task 1: Integrate Content API into main backend
2. ✅ Task 2: Create PlexAdapter skeleton
3. ✅ Task 3: Register PlexAdapter in bootstrap

**Next steps (Phase 2):**
- Queueable capability and QueueService
- Watch state persistence
- Legacy API compatibility shim for frontend migration
- Plex proxy endpoint for streaming
