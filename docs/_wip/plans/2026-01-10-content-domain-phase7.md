# Content Domain Phase 4 - Frontend Migration (Play/Info Endpoints)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate frontend to use new Content API endpoints for playback. Add legacy compatibility shims so old endpoints continue working during migration.

**Architecture:** Frontend gradually adopts new `/api/content/*` endpoints while legacy endpoints (`/media/plex/info`, `/media/info`, `/media/log`) forward to new handlers. Uses backward-compatible response shapes.

**Tech Stack:** JavaScript ES Modules (.mjs), JSDoc types, Jest tests, Express.js routing

**Reference Docs:**
- `docs/plans/2026-01-10-content-domain-phase3.md` - Phase 3 completed
- `docs/_wip/plans/2026-01-10-api-consumer-inventory.md` - Frontend files affected

---

## Task 1: Create Play API Router

**Files:**
- Create: `backend/src/4_api/routers/play.mjs`
- Create: `tests/unit/api/routers/play.test.mjs`

**Step 1: Write the test**

```javascript
// tests/unit/api/routers/play.test.mjs
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from '../../../../backend/src/4_api/routers/play.mjs';

describe('Play API Router', () => {
  let app;
  let mockRegistry;
  let mockWatchStore;

  const mockFilesystemAdapter = {
    name: 'filesystem',
    getItem: jest.fn().mockResolvedValue({
      id: 'filesystem:audio/test.mp3',
      title: 'Test Song',
      mediaType: 'audio',
      mediaUrl: '/proxy/filesystem/stream/audio/test.mp3',
      duration: 180,
      resumable: false
    }),
    getStoragePath: jest.fn().mockResolvedValue('media')
  };

  const mockPlexAdapter = {
    name: 'plex',
    getItem: jest.fn().mockResolvedValue({
      id: 'plex:12345',
      title: 'Test Movie',
      mediaType: 'video',
      mediaUrl: '/proxy/plex/stream/12345',
      duration: 7200,
      resumable: true
    }),
    getStoragePath: jest.fn().mockResolvedValue('plex')
  };

  beforeEach(() => {
    mockRegistry = {
      getAdapter: jest.fn((name) => {
        if (name === 'filesystem') return mockFilesystemAdapter;
        if (name === 'plex') return mockPlexAdapter;
        return null;
      })
    };

    mockWatchStore = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined)
    };

    app = express();
    app.use('/api/play', createPlayRouter({ registry: mockRegistry, watchStore: mockWatchStore }));

    jest.clearAllMocks();
  });

  describe('GET /api/play/:source/*', () => {
    it('returns playable item from filesystem', async () => {
      const res = await request(app).get('/api/play/filesystem/audio/test.mp3');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('filesystem:audio/test.mp3');
      expect(res.body.media_url).toBe('/proxy/filesystem/stream/audio/test.mp3');
      expect(res.body.media_type).toBe('audio');
    });

    it('returns playable item from plex', async () => {
      const res = await request(app).get('/api/play/plex/12345');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('plex:12345');
      expect(res.body.media_url).toBe('/proxy/plex/stream/12345');
      expect(res.body.media_type).toBe('video');
    });

    it('returns 404 for unknown source', async () => {
      const res = await request(app).get('/api/play/unknown/12345');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Unknown source');
    });

    it('returns 404 for missing item', async () => {
      mockFilesystemAdapter.getItem.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/play/filesystem/nonexistent.mp3');

      expect(res.status).toBe(404);
    });

    it('includes resume position when item is in progress', async () => {
      mockWatchStore.get.mockResolvedValueOnce({
        itemId: 'plex:12345',
        playhead: 3600,
        duration: 7200,
        isInProgress: () => true,
        isWatched: () => false
      });

      const res = await request(app).get('/api/play/plex/12345');

      expect(res.status).toBe(200);
      expect(res.body.resume_position).toBe(3600);
    });
  });

  describe('GET /api/play/:source/*/shuffle', () => {
    it('handles shuffle modifier in path', async () => {
      mockFilesystemAdapter.resolvePlayables = jest.fn().mockResolvedValue([
        { id: 'filesystem:audio/song1.mp3', title: 'Song 1' },
        { id: 'filesystem:audio/song2.mp3', title: 'Song 2' }
      ]);

      const res = await request(app).get('/api/play/filesystem/audio/shuffle');

      expect(res.status).toBe(200);
      expect(mockFilesystemAdapter.resolvePlayables).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Write the implementation**

```javascript
// backend/src/4_api/routers/play.mjs
import express from 'express';

/**
 * Create play API router for retrieving playable media info
 *
 * Endpoints:
 * - GET /api/play/:source/*        - Get playable item info
 * - GET /api/play/:source/*/shuffle - Get random item from container
 *
 * @param {Object} config
 * @param {Object} config.registry - ContentSourceRegistry
 * @param {Object} config.watchStore - WatchStateStore
 * @returns {express.Router}
 */
export function createPlayRouter(config) {
  const { registry, watchStore } = config;
  const router = express.Router();

  /**
   * Parse path modifiers (shuffle, etc.)
   */
  function parseModifiers(pathParts) {
    const modifiers = { shuffle: false };
    const cleanParts = [];

    for (const part of pathParts) {
      if (part === 'shuffle') {
        modifiers.shuffle = true;
      } else if (part.includes(',')) {
        // Handle comma-separated modifiers like "playable,shuffle"
        const mods = part.split(',');
        for (const mod of mods) {
          if (mod === 'shuffle') modifiers.shuffle = true;
        }
      } else {
        cleanParts.push(part);
      }
    }

    return { modifiers, localId: cleanParts.join('/') };
  }

  /**
   * Transform internal item to legacy-compatible response
   */
  function toPlayResponse(item, watchState = null) {
    const response = {
      id: item.id,
      media_key: item.id,
      media_url: item.mediaUrl,
      media_type: item.mediaType,
      title: item.title,
      duration: item.duration,
      resumable: item.resumable ?? false,
      thumbnail: item.thumbnail,
      metadata: item.metadata
    };

    // Add resume position if in progress
    if (watchState?.isInProgress?.()) {
      response.resume_position = watchState.playhead;
      response.resume_percent = watchState.percent;
    }

    // Legacy field mapping for Plex items
    if (item.metadata) {
      if (item.metadata.grandparentTitle) response.show = item.metadata.grandparentTitle;
      if (item.metadata.parentTitle) response.season = item.metadata.parentTitle;
      if (item.metadata.type === 'episode') response.episode = item.title;
    }

    // Legacy field for source identification
    if (item.id.startsWith('plex:')) {
      response.plex = item.id.replace('plex:', '');
    }

    return response;
  }

  /**
   * Shuffle array in place (Fisher-Yates)
   */
  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * GET /api/play/:source/*
   */
  router.get('/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      const rawPath = req.params[0] || '';
      const { modifiers, localId } = parseModifiers(rawPath.split('/'));

      const adapter = registry.getAdapter(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      // If shuffle modifier, resolve to playables and return random one
      if (modifiers.shuffle && adapter.resolvePlayables) {
        const playables = await adapter.resolvePlayables(localId);
        if (!playables.length) {
          return res.status(404).json({ error: 'No playable items found' });
        }

        const randomItem = playables[Math.floor(Math.random() * playables.length)];
        const storagePath = await adapter.getStoragePath?.(localId) || source;
        const watchState = await watchStore.get(randomItem.id, storagePath);

        return res.json(toPlayResponse(randomItem, watchState));
      }

      // Get single item
      const item = await adapter.getItem(localId);
      if (!item) {
        return res.status(404).json({ error: 'Item not found', source, localId });
      }

      // Check if it's a container (needs resolution to playable)
      if (item.isContainer?.() || item.itemType === 'container') {
        // Resolve to first playable
        const playables = await adapter.resolvePlayables(localId);
        if (!playables.length) {
          return res.status(404).json({ error: 'No playable items in container' });
        }

        const firstPlayable = playables[0];
        const storagePath = await adapter.getStoragePath?.(localId) || source;
        const watchState = await watchStore.get(firstPlayable.id, storagePath);

        return res.json(toPlayResponse(firstPlayable, watchState));
      }

      // Return playable item
      const storagePath = await adapter.getStoragePath?.(localId) || source;
      const watchState = await watchStore.get(item.id, storagePath);

      res.json(toPlayResponse(item, watchState));
    } catch (err) {
      console.error('[play] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

**Step 3: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/api/routers/play.test.mjs --verbose
```

**Step 4: Commit**

```bash
git add backend/src/4_api/routers/play.mjs tests/unit/api/routers/play.test.mjs
git commit -m "feat(api): add play router for media info endpoints"
```

---

## Task 2: Create Legacy Play Shim

**Files:**
- Create: `backend/src/4_api/middleware/legacyPlayShim.mjs`
- Create: `tests/unit/api/middleware/legacyPlayShim.test.mjs`

**Step 1: Write the test**

```javascript
// tests/unit/api/middleware/legacyPlayShim.test.mjs
import express from 'express';
import request from 'supertest';
import { createLegacyPlayShim } from '../../../../backend/src/4_api/middleware/legacyPlayShim.mjs';

describe('Legacy Play Shim', () => {
  let app;
  let mockPlayRouter;

  beforeEach(() => {
    mockPlayRouter = express.Router();
    mockPlayRouter.get('/plex/*', (req, res) => {
      res.json({
        id: 'plex:12345',
        media_key: 'plex:12345',
        media_url: '/proxy/plex/stream/12345',
        media_type: 'video',
        title: 'Test Movie'
      });
    });
    mockPlayRouter.get('/filesystem/*', (req, res) => {
      res.json({
        id: 'filesystem:audio/test.mp3',
        media_key: 'filesystem:audio/test.mp3',
        media_url: '/proxy/filesystem/stream/audio/test.mp3',
        media_type: 'audio',
        title: 'Test Song'
      });
    });

    app = express();
    app.use('/api/play', mockPlayRouter);
    app.use(createLegacyPlayShim());
  });

  describe('/media/plex/info/:key', () => {
    it('forwards to new play endpoint', async () => {
      const res = await request(app).get('/media/plex/info/12345');

      expect(res.status).toBe(200);
      expect(res.body.plex).toBe('12345');
      expect(res.body.media_url).toBeDefined();
    });

    it('handles shuffle modifier', async () => {
      const res = await request(app).get('/media/plex/info/12345/shuffle');

      expect(res.status).toBe(200);
    });
  });

  describe('/media/info/:key', () => {
    it('forwards to filesystem play endpoint', async () => {
      const res = await request(app).get('/media/info/audio/test.mp3');

      expect(res.status).toBe(200);
      expect(res.body.media_url).toBeDefined();
    });
  });
});
```

**Step 2: Write the implementation**

```javascript
// backend/src/4_api/middleware/legacyPlayShim.mjs
import express from 'express';

/**
 * Create middleware that handles legacy /media/plex/info and /media/info endpoints
 * by forwarding to the new /api/play endpoints.
 *
 * Legacy endpoints:
 * - GET /media/plex/info/:key/:config? -> /api/play/plex/:key/:config?
 * - GET /media/info/*                  -> /api/play/filesystem/*
 *
 * @returns {express.Router}
 */
export function createLegacyPlayShim() {
  const router = express.Router();

  /**
   * Transform new API response to legacy format
   */
  function toLegacyResponse(newResponse) {
    return {
      // Core fields (same in both)
      media_key: newResponse.media_key || newResponse.id,
      media_url: newResponse.media_url,
      media_type: newResponse.media_type,
      title: newResponse.title,
      duration: newResponse.duration,

      // Legacy fields
      plex: newResponse.plex || (newResponse.id?.startsWith('plex:')
        ? newResponse.id.replace('plex:', '')
        : undefined),

      // Show metadata for episodes
      show: newResponse.show,
      season: newResponse.season,
      episode: newResponse.episode,

      // Resume info
      resume_position: newResponse.resume_position,
      resume_percent: newResponse.resume_percent,

      // Thumbnail
      thumbnail: newResponse.thumbnail,
      image: newResponse.thumbnail
    };
  }

  /**
   * Legacy Plex info endpoint
   * GET /media/plex/info/:key/:config?
   */
  router.get('/media/plex/info/:key/:config?', async (req, res, next) => {
    const { key, config } = req.params;
    const queryString = Object.keys(req.query).length
      ? '?' + new URLSearchParams(req.query).toString()
      : '';

    // Build new endpoint path
    let newPath = `/api/play/plex/${key}`;
    if (config) newPath += `/${config}`;
    newPath += queryString;

    // Forward to new endpoint
    try {
      // Use internal redirect (more efficient than HTTP call)
      req.url = newPath;
      req.originalUrl = newPath;
      req._legacyShimmed = true;

      // Store original send to intercept response
      const originalJson = res.json.bind(res);
      res.json = function(body) {
        if (req._legacyShimmed) {
          return originalJson(toLegacyResponse(body));
        }
        return originalJson(body);
      };

      next('route'); // Skip to mounted play router
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Legacy filesystem info endpoint
   * GET /media/info/*
   */
  router.get('/media/info/*', async (req, res, next) => {
    const path = req.params[0] || '';
    const queryString = Object.keys(req.query).length
      ? '?' + new URLSearchParams(req.query).toString()
      : '';

    const newPath = `/api/play/filesystem/${path}${queryString}`;

    try {
      req.url = newPath;
      req.originalUrl = newPath;
      req._legacyShimmed = true;

      const originalJson = res.json.bind(res);
      res.json = function(body) {
        if (req._legacyShimmed) {
          return originalJson(toLegacyResponse(body));
        }
        return originalJson(body);
      };

      next('route');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

**Step 3: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/api/middleware/legacyPlayShim.test.mjs --verbose
```

**Step 4: Commit**

```bash
git add backend/src/4_api/middleware/legacyPlayShim.mjs tests/unit/api/middleware/legacyPlayShim.test.mjs
git commit -m "feat(api): add legacy play shim for backward compatibility"
```

---

## Task 3: Create List API Router

**Files:**
- Modify: `backend/src/4_api/routers/content.mjs` (add list endpoint improvements)
- Create: `tests/unit/api/routers/list.test.mjs`

**Step 1: Write the test**

```javascript
// tests/unit/api/routers/list.test.mjs
import express from 'express';
import request from 'supertest';
import { createListRouter } from '../../../../backend/src/4_api/routers/list.mjs';

describe('List API Router', () => {
  let app;
  let mockRegistry;

  const mockFolderAdapter = {
    name: 'folder',
    getList: jest.fn().mockResolvedValue({
      id: 'folder:Morning Program',
      title: 'Morning Program',
      children: [
        { id: 'plex:12345', title: 'Show One', type: 'reference' },
        { id: 'talk:general/talk1', title: 'Talk One', type: 'reference' }
      ]
    }),
    getItem: jest.fn().mockResolvedValue({
      id: 'folder:Morning Program',
      title: 'Morning Program',
      metadata: { itemCount: 2 }
    })
  };

  const mockPlexAdapter = {
    name: 'plex',
    getList: jest.fn().mockResolvedValue([
      { id: 'plex:12345', title: 'Episode 1', itemType: 'leaf' },
      { id: 'plex:12346', title: 'Episode 2', itemType: 'leaf' }
    ]),
    resolvePlayables: jest.fn().mockResolvedValue([
      { id: 'plex:12345', title: 'Episode 1', mediaUrl: '/proxy/plex/stream/12345' },
      { id: 'plex:12346', title: 'Episode 2', mediaUrl: '/proxy/plex/stream/12346' }
    ])
  };

  beforeEach(() => {
    mockRegistry = {
      getAdapter: jest.fn((name) => {
        if (name === 'folder') return mockFolderAdapter;
        if (name === 'plex') return mockPlexAdapter;
        return null;
      })
    };

    app = express();
    app.use('/api/list', createListRouter({ registry: mockRegistry }));

    jest.clearAllMocks();
  });

  describe('GET /api/list/:source/*', () => {
    it('returns folder contents', async () => {
      const res = await request(app).get('/api/list/folder/Morning%20Program');

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Morning Program');
      expect(res.body.items).toHaveLength(2);
    });

    it('returns plex container contents', async () => {
      const res = await request(app).get('/api/list/plex/library/sections/1/all');

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
    });

    it('handles playable modifier', async () => {
      const res = await request(app).get('/api/list/plex/12345/playable');

      expect(res.status).toBe(200);
      expect(mockPlexAdapter.resolvePlayables).toHaveBeenCalled();
    });

    it('handles shuffle modifier', async () => {
      const res = await request(app).get('/api/list/plex/12345/playable,shuffle');

      expect(res.status).toBe(200);
    });

    it('returns 404 for unknown source', async () => {
      const res = await request(app).get('/api/list/unknown/12345');

      expect(res.status).toBe(404);
    });
  });
});
```

**Step 2: Write the implementation**

```javascript
// backend/src/4_api/routers/list.mjs
import express from 'express';

/**
 * Create list API router for browsing content containers
 *
 * Endpoints:
 * - GET /api/list/:source/*           - List container contents
 * - GET /api/list/:source/*/playable  - List only playable items
 * - GET /api/list/:source/*/shuffle   - Shuffled list
 *
 * @param {Object} config
 * @param {Object} config.registry - ContentSourceRegistry
 * @returns {express.Router}
 */
export function createListRouter(config) {
  const { registry } = config;
  const router = express.Router();

  /**
   * Parse path modifiers (playable, shuffle, recent_on_top)
   */
  function parseModifiers(rawPath) {
    const parts = rawPath.split('/');
    const modifiers = {
      playable: false,
      shuffle: false,
      recent_on_top: false
    };
    const cleanParts = [];

    for (const part of parts) {
      if (part === 'playable') {
        modifiers.playable = true;
      } else if (part === 'shuffle') {
        modifiers.shuffle = true;
      } else if (part === 'recent_on_top') {
        modifiers.recent_on_top = true;
      } else if (part.includes(',')) {
        const mods = part.split(',');
        for (const mod of mods) {
          if (mod === 'playable') modifiers.playable = true;
          if (mod === 'shuffle') modifiers.shuffle = true;
          if (mod === 'recent_on_top') modifiers.recent_on_top = true;
        }
      } else if (part) {
        cleanParts.push(part);
      }
    }

    return { modifiers, localId: cleanParts.join('/') };
  }

  /**
   * Shuffle array in place
   */
  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Transform item to list response format
   */
  function toListItem(item) {
    return {
      id: item.id,
      title: item.title,
      itemType: item.itemType || (item.children ? 'container' : 'leaf'),
      childCount: item.childCount || item.children?.length,
      thumbnail: item.thumbnail,
      image: item.thumbnail,
      metadata: item.metadata,
      // Legacy fields
      play: item.mediaUrl ? { media: item.id } : undefined,
      queue: item.itemType === 'container' ? { playlist: item.id } : undefined
    };
  }

  /**
   * GET /api/list/:source/*
   */
  router.get('/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      const rawPath = req.params[0] || '';
      const { modifiers, localId } = parseModifiers(rawPath);

      const adapter = registry.getAdapter(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      let items;

      if (modifiers.playable) {
        // Resolve to playable items only
        if (!adapter.resolvePlayables) {
          return res.status(400).json({ error: 'Source does not support playable resolution' });
        }
        items = await adapter.resolvePlayables(localId);
      } else {
        // Get container contents
        const result = await adapter.getList(localId);

        // Handle different response shapes
        if (Array.isArray(result)) {
          items = result;
        } else if (result?.children) {
          items = result.children;
        } else {
          items = [];
        }
      }

      // Apply shuffle if requested
      if (modifiers.shuffle) {
        items = shuffleArray([...items]);
      }

      // Build response
      const containerInfo = await adapter.getItem?.(localId);

      res.json({
        source,
        path: localId,
        title: containerInfo?.title || localId,
        label: containerInfo?.title || localId,
        image: containerInfo?.thumbnail,
        items: items.map(toListItem)
      });
    } catch (err) {
      console.error('[list] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

**Step 3: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/api/routers/list.test.mjs --verbose
```

**Step 4: Commit**

```bash
git add backend/src/4_api/routers/list.mjs tests/unit/api/routers/list.test.mjs
git commit -m "feat(api): add list router for container browsing"
```

---

## Task 4: Create Legacy List Shim

**Files:**
- Create: `backend/src/4_api/middleware/legacyListShim.mjs`
- Create: `tests/unit/api/middleware/legacyListShim.test.mjs`

**Step 1: Write the test**

```javascript
// tests/unit/api/middleware/legacyListShim.test.mjs
import {
  translateDataListPath,
  translatePlexListPath,
  toLegacyListResponse
} from '../../../../backend/src/4_api/middleware/legacyListShim.mjs';

describe('Legacy List Shim', () => {
  describe('translateDataListPath', () => {
    it('translates simple folder reference', () => {
      const result = translateDataListPath('TVApp');
      expect(result.source).toBe('folder');
      expect(result.localId).toBe('TVApp');
    });

    it('handles modifiers', () => {
      const result = translateDataListPath('TVApp/recent_on_top');
      expect(result.source).toBe('folder');
      expect(result.localId).toBe('TVApp');
      expect(result.modifiers).toContain('recent_on_top');
    });

    it('handles playable,shuffle modifiers', () => {
      const result = translateDataListPath('Morning+Program/playable,shuffle');
      expect(result.source).toBe('folder');
      expect(result.localId).toBe('Morning Program');
      expect(result.modifiers).toContain('playable');
      expect(result.modifiers).toContain('shuffle');
    });
  });

  describe('translatePlexListPath', () => {
    it('translates simple plex ID', () => {
      const result = translatePlexListPath('12345');
      expect(result.source).toBe('plex');
      expect(result.localId).toBe('12345');
    });

    it('handles modifiers', () => {
      const result = translatePlexListPath('12345/playable');
      expect(result.source).toBe('plex');
      expect(result.localId).toBe('12345');
      expect(result.modifiers).toContain('playable');
    });
  });

  describe('toLegacyListResponse', () => {
    it('transforms new response to legacy format', () => {
      const newResponse = {
        source: 'plex',
        path: '12345',
        title: 'TV Show',
        image: '/thumb.jpg',
        items: [
          { id: 'plex:12345', title: 'Episode 1', itemType: 'leaf' }
        ]
      };

      const legacy = toLegacyListResponse(newResponse);

      expect(legacy.title).toBe('TV Show');
      expect(legacy.label).toBe('TV Show');
      expect(legacy.image).toBe('/thumb.jpg');
      expect(legacy.items).toHaveLength(1);
    });
  });
});
```

**Step 2: Write the implementation**

```javascript
// backend/src/4_api/middleware/legacyListShim.mjs
import express from 'express';

/**
 * Translate legacy data/list path to new format
 *
 * Examples:
 * - "TVApp" -> { source: 'folder', localId: 'TVApp' }
 * - "TVApp/recent_on_top" -> { source: 'folder', localId: 'TVApp', modifiers: ['recent_on_top'] }
 * - "Morning+Program/playable" -> { source: 'folder', localId: 'Morning Program', modifiers: ['playable'] }
 */
export function translateDataListPath(path) {
  const parts = path.split('/');
  const modifiers = [];
  const pathParts = [];

  const KNOWN_MODIFIERS = ['playable', 'shuffle', 'recent_on_top'];

  for (const part of parts) {
    if (KNOWN_MODIFIERS.includes(part)) {
      modifiers.push(part);
    } else if (part.includes(',')) {
      const mods = part.split(',');
      for (const mod of mods) {
        if (KNOWN_MODIFIERS.includes(mod)) {
          modifiers.push(mod);
        } else {
          pathParts.push(mod);
        }
      }
    } else {
      pathParts.push(part);
    }
  }

  // Handle + as space replacement (legacy folder syntax)
  const localId = pathParts.join('/').replace(/\+/g, ' ');

  return {
    source: 'folder',
    localId,
    modifiers
  };
}

/**
 * Translate legacy media/plex/list path to new format
 */
export function translatePlexListPath(path) {
  const parts = path.split('/');
  const modifiers = [];
  const pathParts = [];

  const KNOWN_MODIFIERS = ['playable', 'shuffle'];

  for (const part of parts) {
    if (KNOWN_MODIFIERS.includes(part)) {
      modifiers.push(part);
    } else if (part.includes(',')) {
      const mods = part.split(',');
      for (const mod of mods) {
        if (KNOWN_MODIFIERS.includes(mod)) {
          modifiers.push(mod);
        } else {
          pathParts.push(mod);
        }
      }
    } else {
      pathParts.push(part);
    }
  }

  return {
    source: 'plex',
    localId: pathParts.join('/'),
    modifiers
  };
}

/**
 * Transform new list response to legacy format
 */
export function toLegacyListResponse(newResponse) {
  return {
    title: newResponse.title,
    label: newResponse.title,
    image: newResponse.image,
    kind: newResponse.source,
    plex: newResponse.source === 'plex' ? newResponse.path : undefined,
    items: newResponse.items.map(item => ({
      // Core fields
      id: item.id,
      title: item.title,
      label: item.title,
      image: item.thumbnail || item.image,

      // Action fields (legacy format)
      play: item.mediaUrl ? {
        plex: item.id.replace('plex:', ''),
        media: item.id.replace('filesystem:', '')
      } : undefined,
      queue: item.itemType === 'container' ? {
        plex: item.id.replace('plex:', ''),
        playlist: item.id
      } : undefined,

      // Type info
      active: item.active !== false,
      itemType: item.itemType
    }))
  };
}

/**
 * Create middleware for legacy list endpoints
 */
export function createLegacyListShim() {
  const router = express.Router();

  /**
   * GET /data/list/:folder/:config?
   */
  router.get('/data/list/:folder/:config?', async (req, res, next) => {
    const { folder, config } = req.params;
    const path = config ? `${folder}/${config}` : folder;
    const { source, localId, modifiers } = translateDataListPath(path);

    // Build new endpoint path
    let newPath = `/api/list/${source}/${encodeURIComponent(localId)}`;
    if (modifiers.length) {
      newPath += `/${modifiers.join(',')}`;
    }

    req.url = newPath;
    req.originalUrl = newPath;
    req._legacyShimmed = 'list';

    const originalJson = res.json.bind(res);
    res.json = function(body) {
      if (req._legacyShimmed === 'list') {
        return originalJson(toLegacyListResponse(body));
      }
      return originalJson(body);
    };

    next('route');
  });

  /**
   * GET /media/plex/list/:key/:config?
   */
  router.get('/media/plex/list/:key/:config?', async (req, res, next) => {
    const { key, config } = req.params;
    const path = config ? `${key}/${config}` : key;
    const { source, localId, modifiers } = translatePlexListPath(path);

    let newPath = `/api/list/${source}/${localId}`;
    if (modifiers.length) {
      newPath += `/${modifiers.join(',')}`;
    }

    req.url = newPath;
    req.originalUrl = newPath;
    req._legacyShimmed = 'list';

    const originalJson = res.json.bind(res);
    res.json = function(body) {
      if (req._legacyShimmed === 'list') {
        return originalJson(toLegacyListResponse(body));
      }
      return originalJson(body);
    };

    next('route');
  });

  return router;
}
```

**Step 3: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/api/middleware/legacyListShim.test.mjs --verbose
```

**Step 4: Commit**

```bash
git add backend/src/4_api/middleware/legacyListShim.mjs tests/unit/api/middleware/legacyListShim.test.mjs
git commit -m "feat(api): add legacy list shim for backward compatibility"
```

---

## Task 5: Wire All Routers in Bootstrap

**Files:**
- Modify: `backend/src/0_infrastructure/bootstrap.mjs`
- Create: `tests/unit/infrastructure/bootstrap.test.mjs`

**Step 1: Write the test**

```javascript
// tests/unit/infrastructure/bootstrap.test.mjs
import { createContentRegistry, createWatchStore, createApiRouters } from '../../../backend/src/0_infrastructure/bootstrap.mjs';

describe('bootstrap', () => {
  describe('createContentRegistry', () => {
    it('registers all adapters', () => {
      const registry = createContentRegistry({
        mediaBasePath: '/media',
        plexHost: 'http://localhost:32400',
        plexToken: 'test',
        dataPath: '/data',
        watchlistPath: '/data/state/watchlist.yml'
      });

      expect(registry.getAdapter('filesystem')).toBeDefined();
      expect(registry.getAdapter('plex')).toBeDefined();
      expect(registry.getAdapter('local-content')).toBeDefined();
      expect(registry.getAdapter('folder')).toBeDefined();
    });
  });

  describe('createWatchStore', () => {
    it('creates YamlWatchStateStore', () => {
      const store = createWatchStore({ watchStatePath: '/tmp/watch-state' });
      expect(store).toBeDefined();
      expect(typeof store.get).toBe('function');
      expect(typeof store.set).toBe('function');
    });
  });

  describe('createApiRouters', () => {
    it('creates all routers', () => {
      const registry = createContentRegistry({
        mediaBasePath: '/media',
        dataPath: '/data',
        watchlistPath: '/data/state/watchlist.yml'
      });
      const watchStore = createWatchStore({ watchStatePath: '/tmp' });

      const routers = createApiRouters({ registry, watchStore });

      expect(routers.content).toBeDefined();
      expect(routers.play).toBeDefined();
      expect(routers.list).toBeDefined();
      expect(routers.proxy).toBeDefined();
      expect(routers.legacyShims).toBeDefined();
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
import { createContentRouter } from '../4_api/routers/content.mjs';
import { createPlayRouter } from '../4_api/routers/play.mjs';
import { createListRouter } from '../4_api/routers/list.mjs';
import { createProxyRouter } from '../4_api/routers/proxy.mjs';
import { createLegacyPlayShim } from '../4_api/middleware/legacyPlayShim.mjs';
import { createLegacyListShim } from '../4_api/middleware/legacyListShim.mjs';
import { legacyMediaLogMiddleware } from '../4_api/middleware/legacyCompat.mjs';

/**
 * Create and configure the content source registry
 * @param {Object} config
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

  // Register Plex adapter
  if (config.plexHost) {
    registry.register(new PlexAdapter({
      host: config.plexHost,
      token: config.plexToken
    }));
  }

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

/**
 * Create all API routers
 * @param {Object} config
 * @returns {Object} Map of router names to routers
 */
export function createApiRouters(config) {
  const { registry, watchStore } = config;

  return {
    content: createContentRouter(registry),
    play: createPlayRouter({ registry, watchStore }),
    list: createListRouter({ registry }),
    proxy: createProxyRouter({ registry }),
    legacyShims: {
      play: createLegacyPlayShim(),
      list: createLegacyListShim(),
      mediaLog: legacyMediaLogMiddleware(watchStore)
    }
  };
}
```

**Step 3: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/infrastructure/bootstrap.test.mjs --verbose
```

**Step 4: Commit**

```bash
git add backend/src/0_infrastructure/bootstrap.mjs tests/unit/infrastructure/bootstrap.test.mjs
git commit -m "feat(bootstrap): wire all API routers and legacy shims"
```

---

## Task 6: Mount All Routers in Legacy Backend

**Files:**
- Modify: `backend/_legacy/index.js`

**Step 1: Update legacy index to mount all new routers**

Find the section where content router is mounted and update to:

```javascript
// Content domain (new DDD structure)
const { createContentRegistry, createWatchStore, createApiRouters } = await import('../src/0_infrastructure/bootstrap.mjs');

// Initialize registry and stores
const contentRegistry = createContentRegistry({
  mediaBasePath: config.media?.filesystem?.mediaBasePath || process.env.MEDIA_PATH || '/data/media',
  plexHost: config.media?.plex?.host,
  plexToken: config.media?.plex?.token,
  dataPath: config.data?.basePath || process.env.DATA_PATH || '/data',
  watchlistPath: config.data?.watchlistPath || '/data/state/watchlist.yml'
});

const watchStore = createWatchStore({
  watchStatePath: config.data?.watchStatePath || '/data/state/watch'
});

// Create all routers
const apiRouters = createApiRouters({ registry: contentRegistry, watchStore });

// Mount legacy shims FIRST (they intercept old endpoints)
app.use(apiRouters.legacyShims.play);
app.use(apiRouters.legacyShims.list);
app.post('/media/log', apiRouters.legacyShims.mediaLog);

// Mount new API routers
app.use('/api/content', apiRouters.content);
app.use('/api/play', apiRouters.play);
app.use('/api/list', apiRouters.list);
app.use('/proxy', apiRouters.proxy);

console.log('[content] Mounted Content API with adapters:',
  ['filesystem', 'plex', 'local-content', 'folder']
    .filter(a => contentRegistry.getAdapter(a))
    .join(', ')
);
```

**Step 2: Verify with dev server**

Run: `npm run dev`

Test legacy endpoints still work:
```bash
curl http://localhost:3112/media/plex/info/12345
curl http://localhost:3112/data/list/TVApp
```

Test new endpoints work:
```bash
curl http://localhost:3112/api/play/plex/12345
curl http://localhost:3112/api/list/folder/TVApp
```

**Step 3: Commit**

```bash
git add backend/_legacy/index.js
git commit -m "feat(backend): mount all Content API routers with legacy shims"
```

---

## Summary

**Tasks in this plan:**

1. **Play API Router** - `/api/play/:source/*` for retrieving playable media info
2. **Legacy Play Shim** - `/media/plex/info`, `/media/info` backward compatibility
3. **List API Router** - `/api/list/:source/*` for browsing containers
4. **Legacy List Shim** - `/data/list`, `/media/plex/list` backward compatibility
5. **Bootstrap Update** - Wire all routers and shims
6. **Backend Integration** - Mount everything in legacy index

**API Endpoint Summary:**

| New Endpoint | Legacy Endpoint | Purpose |
|--------------|-----------------|---------|
| `GET /api/play/:source/*` | `/media/plex/info/:id`, `/media/info/*` | Get playable item info |
| `GET /api/list/:source/*` | `/data/list/:folder`, `/media/plex/list/:id` | Browse container contents |
| `POST /api/progress/:source/*` | `/media/log` | Update watch progress |
| `GET /proxy/:source/stream/*` | `/media/*` | Stream media files |

**Next Phase (5):** LocalContent endpoints for scripture, talks, hymns, poetry.
