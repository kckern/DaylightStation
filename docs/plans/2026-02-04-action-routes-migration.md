# Action Routes Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate from resource-centric routes (`/item/`, `/content/:source/image/`) to intent-driven action routes (`/info/`, `/display/`, `/play/`, `/list/`) that align with query-combinatorics.

**Architecture:** Create new action routers (`info.mjs`, `display.mjs`) that use a shared ID resolution utility supporting three formats: path segments (`/plex/12345`), compound IDs (`/plex:12345`), and heuristic resolution (`/12345`). Deprecate old routes with redirects. Update frontend consumers incrementally.

**Tech Stack:** Express routers, MediaKeyResolver for heuristic resolution, existing ContentSourceRegistry, modifierParser.

---

## Summary

| Phase | Tasks | Purpose |
|-------|-------|---------|
| 1 | 1-3 | Create shared ID parser utility |
| 2 | 4-7 | Create `/info/` router (replaces `/item/`, `/content/:source/info/`) |
| 3 | 8-11 | Create `/display/` router (replaces `/content/:source/image/`) |
| 4 | 12-14 | Update `/play/` router for unified ID format |
| 5 | 15-17 | Update `/list/` router for unified ID format |
| 6 | 18-22 | Add deprecation redirects to old routes |
| 7 | 23-28 | Migrate frontend consumers (6 files) |
| 8 | 29-30 | Update tests and documentation |

---

## Task 1: Create Action Route ID Parser Utility

**Files:**
- Create: `backend/src/4_api/v1/utils/actionRouteParser.mjs`
- Test: `tests/unit/api/utils/actionRouteParser.test.mjs`

**Step 1: Write the failing tests**

```javascript
// tests/unit/api/utils/actionRouteParser.test.mjs
import { describe, it, expect } from 'vitest';
import { parseActionRouteId } from '../../../../backend/src/4_api/v1/utils/actionRouteParser.mjs';

describe('parseActionRouteId', () => {
  describe('path segment format: /:source/:id', () => {
    it('parses plex/12345 as source=plex, localId=12345', () => {
      const result = parseActionRouteId({ source: 'plex', path: '12345' });
      expect(result).toEqual({ source: 'plex', localId: '12345', compoundId: 'plex:12345' });
    });

    it('parses folder/watchlist/FHE as source=folder, localId=watchlist/FHE', () => {
      const result = parseActionRouteId({ source: 'folder', path: 'watchlist/FHE' });
      expect(result).toEqual({ source: 'folder', localId: 'watchlist/FHE', compoundId: 'folder:watchlist/FHE' });
    });

    it('parses immich/abc-def-123 as source=immich, localId=abc-def-123', () => {
      const result = parseActionRouteId({ source: 'immich', path: 'abc-def-123' });
      expect(result).toEqual({ source: 'immich', localId: 'abc-def-123', compoundId: 'immich:abc-def-123' });
    });
  });

  describe('compound ID format: /source:id', () => {
    it('parses plex:12345 (no source param) as source=plex, localId=12345', () => {
      const result = parseActionRouteId({ source: 'plex:12345', path: '' });
      expect(result).toEqual({ source: 'plex', localId: '12345', compoundId: 'plex:12345' });
    });

    it('parses immich:abc-def-123 as source=immich, localId=abc-def-123', () => {
      const result = parseActionRouteId({ source: 'immich:abc-def-123', path: '' });
      expect(result).toEqual({ source: 'immich', localId: 'abc-def-123', compoundId: 'immich:abc-def-123' });
    });
  });

  describe('heuristic format: /:id (no source)', () => {
    it('parses bare digits 12345 as source=plex (heuristic)', () => {
      const result = parseActionRouteId({ source: '12345', path: '' });
      expect(result).toEqual({ source: 'plex', localId: '12345', compoundId: 'plex:12345' });
    });

    it('parses UUID pattern as source=immich (heuristic)', () => {
      const result = parseActionRouteId({ source: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', path: '' });
      expect(result).toEqual({
        source: 'immich',
        localId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        compoundId: 'immich:a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      });
    });

    it('parses path-like string as source=filesystem (heuristic)', () => {
      const result = parseActionRouteId({ source: 'audio', path: 'song.mp3' });
      expect(result).toEqual({
        source: 'filesystem',
        localId: 'audio/song.mp3',
        compoundId: 'filesystem:audio/song.mp3'
      });
    });
  });

  describe('alias normalization', () => {
    it('normalizes local to folder', () => {
      const result = parseActionRouteId({ source: 'local', path: 'TVApp' });
      expect(result).toEqual({ source: 'folder', localId: 'TVApp', compoundId: 'folder:TVApp' });
    });
  });

  describe('modifier extraction', () => {
    it('extracts shuffle modifier from path', () => {
      const result = parseActionRouteId({ source: 'plex', path: '12345/shuffle' });
      expect(result).toEqual({
        source: 'plex',
        localId: '12345',
        compoundId: 'plex:12345',
        modifiers: { shuffle: true }
      });
    });

    it('extracts playable modifier from path', () => {
      const result = parseActionRouteId({ source: 'plex', path: '672445/playable' });
      expect(result).toEqual({
        source: 'plex',
        localId: '672445',
        compoundId: 'plex:672445',
        modifiers: { playable: true }
      });
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/api/utils/actionRouteParser.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/4_api/v1/utils/actionRouteParser.mjs
import { parseModifiers } from './modifierParser.mjs';

/**
 * Known content sources for compound ID detection
 */
const KNOWN_SOURCES = ['plex', 'immich', 'folder', 'local', 'filesystem', 'canvas', 'audiobookshelf', 'komga', 'singing', 'narrated'];

/**
 * Source aliases that normalize to canonical names
 */
const SOURCE_ALIASES = {
  local: 'folder'
};

/**
 * Heuristic patterns for source detection when source is omitted
 */
const HEURISTIC_PATTERNS = [
  { match: /^\d+$/, source: 'plex' },  // Bare digits = plex
  { match: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, source: 'immich' },  // UUID = immich
  { match: /\.[a-z0-9]{2,4}$/i, source: 'filesystem' }  // Has file extension = filesystem
];

/**
 * Parse action route parameters into normalized source/localId/compoundId.
 *
 * Supports three ID formats:
 * - Path segments: /plex/12345 → { source: 'plex', localId: '12345' }
 * - Compound ID: /plex:12345 → { source: 'plex', localId: '12345' }
 * - Heuristic: /12345 → { source: 'plex', localId: '12345' } (digits = plex)
 *
 * @param {Object} params - Route parameters
 * @param {string} params.source - First path segment (may be source, compound ID, or bare ID)
 * @param {string} [params.path=''] - Remaining path segments (wildcard capture)
 * @returns {{ source: string, localId: string, compoundId: string, modifiers?: Object }}
 */
export function parseActionRouteId({ source, path = '' }) {
  let resolvedSource = source;
  let resolvedLocalId = path;

  // Check if source param contains a compound ID (source:id format)
  const colonIndex = source.indexOf(':');
  if (colonIndex !== -1) {
    const prefix = source.substring(0, colonIndex);
    if (KNOWN_SOURCES.includes(prefix)) {
      // Compound ID in source param
      resolvedSource = prefix;
      resolvedLocalId = source.substring(colonIndex + 1) + (path ? `/${path}` : '');
    }
  }

  // Check if source is a known source
  if (!KNOWN_SOURCES.includes(resolvedSource)) {
    // Not a known source - try heuristic detection
    const fullPath = path ? `${source}/${path}` : source;

    for (const { match, source: detectedSource } of HEURISTIC_PATTERNS) {
      if (match.test(fullPath)) {
        resolvedSource = detectedSource;
        resolvedLocalId = fullPath;
        break;
      }
    }

    // If still not resolved, check if it looks like a path (has slash or extension)
    if (!KNOWN_SOURCES.includes(resolvedSource)) {
      if (fullPath.includes('/') || /\.[a-z0-9]+$/i.test(fullPath)) {
        resolvedSource = 'filesystem';
        resolvedLocalId = fullPath;
      } else {
        // Default fallback to plex for unknown patterns
        resolvedSource = 'plex';
        resolvedLocalId = fullPath;
      }
    }
  }

  // Normalize source aliases
  if (SOURCE_ALIASES[resolvedSource]) {
    resolvedSource = SOURCE_ALIASES[resolvedSource];
  }

  // Parse modifiers from localId
  const { modifiers, localId: cleanLocalId } = parseModifiers(resolvedLocalId);
  const hasModifiers = Object.keys(modifiers).length > 0;

  const result = {
    source: resolvedSource,
    localId: cleanLocalId,
    compoundId: `${resolvedSource}:${cleanLocalId}`
  };

  if (hasModifiers) {
    result.modifiers = modifiers;
  }

  return result;
}

export default { parseActionRouteId, KNOWN_SOURCES, SOURCE_ALIASES };
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/api/utils/actionRouteParser.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/utils/actionRouteParser.mjs tests/unit/api/utils/actionRouteParser.test.mjs
git commit -m "$(cat <<'EOF'
feat(api): add action route ID parser with multi-format support

Supports path segments (/plex/12345), compound IDs (/plex:12345),
and heuristic resolution (/12345 → plex). Extracts modifiers.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create Info Router

**Files:**
- Create: `backend/src/4_api/v1/routers/info.mjs`
- Modify: `backend/src/4_api/v1/routers/index.mjs:42` (add export)
- Test: `tests/unit/api/routers/info.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/api/routers/info.test.mjs
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createInfoRouter } from '../../../../backend/src/4_api/v1/routers/info.mjs';

describe('GET /info/:source/*', () => {
  const mockRegistry = {
    get: vi.fn()
  };

  const mockAdapter = {
    getItem: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry.get.mockReturnValue(mockAdapter);
  });

  function createApp() {
    const app = express();
    app.use('/info', createInfoRouter({ registry: mockRegistry }));
    return app;
  }

  it('returns item metadata for /info/plex/12345', async () => {
    mockAdapter.getItem.mockResolvedValue({
      id: 'plex:12345',
      title: 'Test Episode',
      type: 'episode',
      capabilities: ['playable', 'displayable']
    });

    const res = await request(createApp()).get('/info/plex/12345');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('plex:12345');
    expect(res.body.title).toBe('Test Episode');
    expect(res.body.capabilities).toContain('playable');
  });

  it('returns item for compound ID /info/plex:12345', async () => {
    mockAdapter.getItem.mockResolvedValue({
      id: 'plex:12345',
      title: 'Test Episode'
    });

    const res = await request(createApp()).get('/info/plex:12345');

    expect(res.status).toBe(200);
    expect(mockAdapter.getItem).toHaveBeenCalledWith('plex:12345');
  });

  it('returns item for heuristic ID /info/12345 (digits → plex)', async () => {
    mockAdapter.getItem.mockResolvedValue({
      id: 'plex:12345',
      title: 'Test Episode'
    });

    const res = await request(createApp()).get('/info/12345');

    expect(res.status).toBe(200);
    expect(mockRegistry.get).toHaveBeenCalledWith('plex');
  });

  it('returns 404 for unknown source', async () => {
    mockRegistry.get.mockReturnValue(null);

    const res = await request(createApp()).get('/info/unknown/12345');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Unknown source');
  });

  it('returns 404 for item not found', async () => {
    mockAdapter.getItem.mockResolvedValue(null);

    const res = await request(createApp()).get('/info/plex/99999');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/api/routers/info.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write the router implementation**

```javascript
// backend/src/4_api/v1/routers/info.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';

/**
 * Create info API router for retrieving item metadata
 *
 * Endpoints:
 * - GET /api/v1/info/:source/:id - Get item metadata (path segments)
 * - GET /api/v1/info/:source::id - Get item metadata (compound ID)
 * - GET /api/v1/info/:id - Get item metadata (heuristic resolution)
 *
 * @param {Object} config
 * @param {Object} config.registry - ContentSourceRegistry
 * @param {Object} [config.contentQueryService] - ContentQueryService for enrichment
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createInfoRouter(config) {
  const { registry, contentQueryService, logger = console } = config;
  const router = express.Router();

  /**
   * Transform internal item to info response
   */
  function toInfoResponse(item) {
    const capabilities = [];
    if (item.mediaUrl) capabilities.push('playable');
    if (item.thumbnail || item.imageUrl) capabilities.push('displayable');
    if (item.items || item.itemType === 'container') capabilities.push('listable');
    if (item.contentUrl || item.format) capabilities.push('readable');

    return {
      id: item.id,
      source: item.source || item.id?.split(':')[0],
      type: item.type,
      title: item.title,
      capabilities,
      metadata: {
        duration: item.duration,
        grandparentTitle: item.grandparentTitle,
        parentTitle: item.parentTitle,
        summary: item.summary,
        year: item.year,
        labels: item.labels,
        ...item.metadata
      }
    };
  }

  /**
   * GET /api/v1/info/:source/*
   * Get item metadata with unified ID format support
   */
  router.get('/:source/*?', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const path = req.params[0] || '';

    // Parse ID using unified parser
    const { source: resolvedSource, localId, compoundId } = parseActionRouteId({ source, path });

    const adapter = registry.get(resolvedSource);
    if (!adapter) {
      return res.status(404).json({
        error: `Unknown source: ${resolvedSource}`,
        hint: 'Valid sources: plex, immich, folder, filesystem, canvas, audiobookshelf, komga'
      });
    }

    if (!localId) {
      return res.status(400).json({ error: 'Missing item ID' });
    }

    // Get item from adapter
    let item;
    try {
      item = await adapter.getItem(compoundId);
    } catch (err) {
      logger.error?.('info.getItem.error', { compoundId, error: err.message });
      return res.status(500).json({ error: err.message });
    }

    if (!item) {
      return res.status(404).json({
        error: `Item not found: ${compoundId}`,
        source: resolvedSource,
        localId
      });
    }

    // Enrich with watch state if available
    if (contentQueryService && typeof contentQueryService.getWatchState === 'function') {
      try {
        const watchState = await contentQueryService.getWatchState(compoundId);
        if (watchState) {
          item.watchProgress = watchState.percent;
          item.watchSeconds = watchState.playhead;
          item.watchedDate = watchState.lastPlayed;
        }
      } catch (err) {
        // Watch state enrichment is optional
        logger.warn?.('info.watchState.error', { compoundId, error: err.message });
      }
    }

    res.json(toInfoResponse(item));
  }));

  return router;
}

export default createInfoRouter;
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/api/routers/info.test.mjs`
Expected: PASS

**Step 5: Add export to index.mjs**

In `backend/src/4_api/v1/routers/index.mjs`, add after line 42:

```javascript
export { createInfoRouter } from './info.mjs';
```

**Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/info.mjs backend/src/4_api/v1/routers/index.mjs tests/unit/api/routers/info.test.mjs
git commit -m "$(cat <<'EOF'
feat(api): add /info/ router with unified ID format support

Supports /info/plex/12345, /info/plex:12345, and /info/12345 (heuristic).
Returns item metadata with capabilities array.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create Display Router

**Files:**
- Create: `backend/src/4_api/v1/routers/display.mjs`
- Modify: `backend/src/4_api/v1/routers/index.mjs` (add export)
- Test: `tests/unit/api/routers/display.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/api/routers/display.test.mjs
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDisplayRouter } from '../../../../backend/src/4_api/v1/routers/display.mjs';

describe('GET /display/:source/*', () => {
  const mockRegistry = {
    get: vi.fn()
  };

  const mockAdapter = {
    getThumbnailUrl: vi.fn(),
    getItem: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry.get.mockReturnValue(mockAdapter);
  });

  function createApp() {
    const app = express();
    app.use('/display', createDisplayRouter({ registry: mockRegistry }));
    return app;
  }

  it('redirects to thumbnail for /display/plex/12345', async () => {
    mockAdapter.getThumbnailUrl.mockResolvedValue('http://plex.local/thumbnail.jpg');

    const res = await request(createApp()).get('/display/plex/12345');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/proxy/plex');
  });

  it('handles compound ID /display/plex:12345', async () => {
    mockAdapter.getThumbnailUrl.mockResolvedValue('http://plex.local/thumbnail.jpg');

    const res = await request(createApp()).get('/display/plex:12345');

    expect(res.status).toBe(302);
    expect(mockAdapter.getThumbnailUrl).toHaveBeenCalledWith('12345');
  });

  it('handles heuristic ID /display/12345 (digits → plex)', async () => {
    mockAdapter.getThumbnailUrl.mockResolvedValue('http://plex.local/thumbnail.jpg');

    const res = await request(createApp()).get('/display/12345');

    expect(res.status).toBe(302);
    expect(mockRegistry.get).toHaveBeenCalledWith('plex');
  });

  it('falls back to getItem().thumbnail when getThumbnailUrl not available', async () => {
    mockAdapter.getThumbnailUrl = undefined;
    mockAdapter.getItem.mockResolvedValue({ thumbnail: 'http://example.com/thumb.jpg' });

    const res = await request(createApp()).get('/display/plex/12345');

    expect(res.status).toBe(302);
  });

  it('returns 404 when no thumbnail available', async () => {
    mockAdapter.getThumbnailUrl.mockResolvedValue(null);
    mockAdapter.getItem.mockResolvedValue({ title: 'No thumbnail' });

    const res = await request(createApp()).get('/display/plex/12345');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Thumbnail not found');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/api/routers/display.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write the router implementation**

```javascript
// backend/src/4_api/v1/routers/display.mjs
import express from 'express';
import fs from 'fs';
import path from 'path';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';

/**
 * Create display API router for retrieving displayable content (images/thumbnails)
 *
 * Endpoints:
 * - GET /api/v1/display/:source/:id - Get displayable image
 * - GET /api/v1/display/:source::id - Get displayable image (compound ID)
 * - GET /api/v1/display/:id - Get displayable image (heuristic resolution)
 *
 * @param {Object} config
 * @param {Object} config.registry - ContentSourceRegistry
 * @param {string} [config.cacheBasePath] - Base path for image cache
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createDisplayRouter(config) {
  const { registry, cacheBasePath, logger = console } = config;
  const router = express.Router();

  /**
   * GET /api/v1/display/:source/*
   * Get displayable image with unified ID format support
   */
  router.get('/:source/*?', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const pathParam = req.params[0] || '';

    // Parse ID using unified parser
    const { source: resolvedSource, localId, compoundId } = parseActionRouteId({ source, path: pathParam });

    const adapter = registry.get(resolvedSource);
    if (!adapter) {
      return res.status(404).json({
        error: `Unknown source: ${resolvedSource}`,
        hint: 'Valid sources: plex, immich, folder, filesystem, canvas'
      });
    }

    if (!localId) {
      return res.status(400).json({ error: 'Missing item ID' });
    }

    // Check cache first
    if (cacheBasePath) {
      const cacheDir = path.join(cacheBasePath, resolvedSource);
      const safeId = localId.replace(/[^a-zA-Z0-9-_]/g, '_');
      const cacheFile = path.join(cacheDir, `${safeId}.jpg`);

      if (fs.existsSync(cacheFile)) {
        return res.sendFile(cacheFile);
      }
    }

    // Get thumbnail URL from adapter
    let thumbnailUrl;
    try {
      if (typeof adapter.getThumbnailUrl === 'function') {
        thumbnailUrl = await adapter.getThumbnailUrl(localId);
      } else if (typeof adapter.getItem === 'function') {
        const item = await adapter.getItem(compoundId);
        thumbnailUrl = item?.thumbnail || item?.imageUrl;
      }
    } catch (err) {
      logger.error?.('display.getThumbnail.error', { compoundId, error: err.message });
      return res.status(500).json({ error: err.message });
    }

    if (!thumbnailUrl) {
      return res.status(404).json({
        error: `Thumbnail not found: ${compoundId}`,
        source: resolvedSource,
        localId,
        hint: 'Item may not have a displayable representation'
      });
    }

    // Redirect through proxy (replace external host with proxy path)
    const proxyUrl = thumbnailUrl.replace(/https?:\/\/[^\/]+/, `/api/v1/proxy/${resolvedSource}`);
    res.redirect(proxyUrl);
  }));

  return router;
}

export default createDisplayRouter;
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/api/routers/display.test.mjs`
Expected: PASS

**Step 5: Add export to index.mjs**

In `backend/src/4_api/v1/routers/index.mjs`, add:

```javascript
export { createDisplayRouter } from './display.mjs';
```

**Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/display.mjs backend/src/4_api/v1/routers/index.mjs tests/unit/api/routers/display.test.mjs
git commit -m "$(cat <<'EOF'
feat(api): add /display/ router for displayable content

Supports /display/plex/12345, /display/plex:12345, and /display/12345.
Returns thumbnail images via redirect to proxy. Includes caching support.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire New Routers in Bootstrap

**Files:**
- Modify: `backend/src/app.mjs` (mount new routers)

**Step 1: Find router mounting section**

Search for where routers are mounted in app.mjs (around line 180-220).

**Step 2: Add info and display router mounting**

Add after the existing item router mounting:

```javascript
// Info router (action-based metadata)
const { createInfoRouter } = await import('./4_api/v1/routers/info.mjs');
v1Routers.info = createInfoRouter({
  registry: contentRegistry,
  contentQueryService,
  logger: rootLogger.child({ module: 'info-api' })
});

// Display router (action-based images)
const { createDisplayRouter } = await import('./4_api/v1/routers/display.mjs');
v1Routers.display = createDisplayRouter({
  registry: contentRegistry,
  cacheBasePath: imageCachePath,
  logger: rootLogger.child({ module: 'display-api' })
});
```

**Step 3: Test manually**

Run: `curl -s http://localhost:3112/api/v1/info/plex/672445 | jq .`
Expected: JSON with item metadata and capabilities array

Run: `curl -I http://localhost:3112/api/v1/display/plex/672445`
Expected: 302 redirect to proxy URL

**Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "$(cat <<'EOF'
feat(api): wire info and display routers in bootstrap

Mounts /api/v1/info/* and /api/v1/display/* action routes.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update Play Router for Unified ID Format

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs:62` (use parseActionRouteId)

**Step 1: Import the parser**

Add at top of play.mjs:

```javascript
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';
```

**Step 2: Update the main route handler**

Replace the ID parsing logic in the `GET /:source/*` handler to use `parseActionRouteId`.

**Step 3: Remove the separate `/plex/mpd/:id` route**

The unified `/play/:source/:id` now handles all sources including Plex MPD.

**Step 4: Test**

Run: `curl -s http://localhost:3112/api/v1/play/plex/672445 | jq .`
Run: `curl -s http://localhost:3112/api/v1/play/plex:672445 | jq .`
Run: `curl -s http://localhost:3112/api/v1/play/672445 | jq .`
Expected: All three return equivalent playable info

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs
git commit -m "$(cat <<'EOF'
fix(api): update play router for unified ID format

Supports /play/plex/12345, /play/plex:12345, and /play/12345.
Removes separate /plex/mpd/:id route.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add Deprecation Redirects

**Files:**
- Modify: `backend/src/4_api/v1/routers/content.mjs` (add redirects)
- Modify: `backend/src/4_api/v1/routers/item.mjs` (add redirects)

**Step 1: Add redirect for /content/:source/image/:id → /display/:source/:id**

In content.mjs, before the existing image route:

```javascript
/**
 * DEPRECATED: Redirect to /api/v1/display/:source/:id
 */
router.get('/:source/image/:id', (req, res) => {
  const { source, id } = req.params;
  const newUrl = `/api/v1/display/${source}/${id}`;
  logger.info?.('content.image.deprecated_redirect', { from: req.originalUrl, to: newUrl });
  res.redirect(301, newUrl);
});
```

**Step 2: Add redirect for /content/:source/info/:id → /info/:source/:id**

```javascript
/**
 * DEPRECATED: Redirect to /api/v1/info/:source/:id
 */
router.get('/:source/info/:id/:modifiers?', (req, res) => {
  const { source, id, modifiers } = req.params;
  const newUrl = modifiers
    ? `/api/v1/info/${source}/${id}/${modifiers}`
    : `/api/v1/info/${source}/${id}`;
  logger.info?.('content.info.deprecated_redirect', { from: req.originalUrl, to: newUrl });
  res.redirect(301, newUrl);
});
```

**Step 3: Add redirect for /item/:source/* → /info/:source/***

In item.mjs, add at the top of the router:

```javascript
/**
 * DEPRECATED: /item/ routes redirect to action routes
 * - /item/:source/:id → /info/:source/:id
 * - /item/:source/:id/playable → /list/:source/:id (with playable filter)
 */
// Note: Keep existing implementation for now, add deprecation logging
```

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/content.mjs backend/src/4_api/v1/routers/item.mjs
git commit -m "$(cat <<'EOF'
chore(api): add deprecation redirects for legacy routes

/content/:source/image/:id → /display/:source/:id
/content/:source/info/:id → /info/:source/:id

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Migrate Frontend - Player Module

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js:70,83`
- Modify: `frontend/src/modules/Player/lib/api.js:18,22`
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx:254`
- Modify: `frontend/src/modules/Player/components/DebugInfo.jsx:33-34`

**Step 1: Update api.js media info fetch**

Replace line 70:
```javascript
// Before:
const response = await fetch(`api/v1/content/plex/info/${plex}${shuffleModifier ? '/shuffle' : ''}`);

// After:
const response = await fetch(`api/v1/info/plex/${plex}${shuffleModifier ? '?shuffle=true' : ''}`);
```

Replace line 83:
```javascript
// Before:
const response = await fetch(`api/v1/content/item/${source}/${localId}`);

// After:
const response = await fetch(`api/v1/info/${source}/${localId}`);
```

**Step 2: Update queue flattening**

Replace lines 18 and 22:
```javascript
// Before:
`api/v1/item/folder/${queueKey}/playable`
`api/v1/item/plex/${item.queue.plex}/playable`

// After:
`api/v1/list/folder/${queueKey}?capability=playable`
`api/v1/list/plex/${item.queue.plex}?capability=playable`
```

**Step 3: Update SinglePlayer.jsx**

Replace line 254:
```javascript
// Before:
const response = await fetch(`/api/v1/item/plex/${plex}/playable`);

// After:
const response = await fetch(`/api/v1/list/plex/${plex}?capability=playable`);
```

**Step 4: Update DebugInfo.jsx**

Replace lines 33-34:
```javascript
// Before:
{ name: 'Plex Info', url: `/api/v1/content/plex/info/${plexId}` },
{ name: 'Play URL', url: `/api/v1/play/plex/mpd/${plexId}` },

// After:
{ name: 'Plex Info', url: `/api/v1/info/plex/${plexId}` },
{ name: 'Play URL', url: `/api/v1/play/plex/${plexId}` },
```

**Step 5: Test player functionality**

Run Playwright test: `npx playwright test tests/live/flow/tv/tv-composite-player.runtime.test.mjs`

**Step 6: Commit**

```bash
git add frontend/src/modules/Player/
git commit -m "$(cat <<'EOF'
fix(frontend): migrate Player module to action routes

/content/plex/info/ → /info/plex/
/item/plex/*/playable → /list/plex/*?capability=playable
/play/plex/mpd/ → /play/plex/

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Migrate Frontend - FitnessApp

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx:632,643,645,661,663`

**Step 1: Update episode metadata fetch**

Replace line 632:
```javascript
// Before:
const response = await DaylightAPI(`api/v1/content/${contentSource}/info/${episodeId}`);

// After:
const response = await DaylightAPI(`api/v1/info/${contentSource}/${episodeId}`);
```

**Step 2: Update image URLs**

Replace lines 643, 645, 661, 663:
```javascript
// Before:
image: DaylightMediaPath(`api/v1/content/${contentSource}/image/${episodeId}`)

// After:
image: DaylightMediaPath(`api/v1/display/${contentSource}/${episodeId}`)
```

**Step 3: Test fitness flow**

Run: `npx playwright test tests/live/flow/fitness/fitness-happy-path.runtime.test.mjs`

**Step 4: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "$(cat <<'EOF'
fix(frontend): migrate FitnessApp to action routes

/content/:source/info/ → /info/:source/
/content/:source/image/ → /display/:source/

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Migrate Frontend - Menu Module

**Files:**
- Modify: `frontend/src/modules/Menu/Menu.jsx:705`

**Step 1: Update image URL construction**

Replace line 705:
```javascript
// Before:
image = DaylightMediaPath(`/api/v1/content/plex/image/${val}`);

// After:
image = DaylightMediaPath(`/api/v1/display/plex/${val}`);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Menu/Menu.jsx
git commit -m "$(cat <<'EOF'
fix(frontend): migrate Menu to action routes

/content/plex/image/ → /display/plex/

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Migrate Frontend - Admin UI

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` (8 locations)
- Modify: `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx` (5 locations)

**Step 1: Update ListsItemRow.jsx**

Replace all occurrences of:
```javascript
// Before:
`/api/v1/content/item/${source}/${localId}`
`/api/v1/item/${source}/${localId}`

// After:
`/api/v1/info/${source}/${localId}`
```

**Step 2: Update ContentSearchCombobox.jsx**

Replace all occurrences of:
```javascript
// Before:
`/api/v1/item/${source}/`
`/api/v1/item/${source}/${path}`

// After:
`/api/v1/info/${source}/`
`/api/v1/info/${source}/${path}`
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/
git commit -m "$(cat <<'EOF'
fix(frontend): migrate Admin UI to action routes

/content/item/ → /info/
/item/ → /info/

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Migrate Frontend - FitnessShow

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessShow.jsx:35,108,112,553,564,967,969`

**Step 1: Update all image URL constructions**

Replace all occurrences of:
```javascript
// Before:
DaylightMediaPath(`api/v1/content/plex/image/${id}`)

// After:
DaylightMediaPath(`api/v1/display/plex/${id}`)
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessShow.jsx
git commit -m "$(cat <<'EOF'
fix(frontend): migrate FitnessShow to action routes

/content/plex/image/ → /display/plex/

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Update Test Files

**Files:**
- Modify: `tests/live/flow/fitness/*.test.mjs`
- Modify: `tests/live/flow/tv/*.test.mjs`
- Modify: `tests/integrated/api/parity/*.test.mjs`

**Step 1: Update fitness tests**

Replace all occurrences:
```javascript
// Before:
`/api/v1/content/plex/info/${id}`
`/api/v1/item/plex/${id}`

// After:
`/api/v1/info/plex/${id}`
```

**Step 2: Update TV tests**

Replace all occurrences:
```javascript
// Before:
`/api/v1/item/folder/TVApp`

// After:
`/api/v1/info/folder/TVApp`
```

**Step 3: Run all tests**

Run: `npm run test:live`

**Step 4: Commit**

```bash
git add tests/
git commit -m "$(cat <<'EOF'
fix(tests): migrate test files to action routes

Updates all endpoint references to use new action-based routes.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Update Documentation

**Files:**
- Modify: `docs/reference/content/query-combinatorics.md:743-762` (API Routes Reference section)
- Modify: `docs/reference/core/api-endpoint-mapping.md:108-116`

**Step 1: Update query-combinatorics.md**

Replace the API Routes Reference section with the new action routes.

**Step 2: Update api-endpoint-mapping.md**

Add new action routes and mark old routes as deprecated.

**Step 3: Commit**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs: update API documentation for action routes migration

Adds /info/, /display/ to route references.
Marks /content/:source/image/, /item/ as deprecated.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Verification Checklist

After all tasks complete:

1. **New routes work with all ID formats:**
   ```bash
   curl -s localhost:3112/api/v1/info/plex/672445 | jq .id
   curl -s localhost:3112/api/v1/info/plex:672445 | jq .id
   curl -s localhost:3112/api/v1/info/672445 | jq .id
   ```
   Expected: All return `"plex:672445"`

2. **Display route returns redirects:**
   ```bash
   curl -I localhost:3112/api/v1/display/plex/672445
   ```
   Expected: 302 with Location header

3. **Deprecation redirects work:**
   ```bash
   curl -I localhost:3112/api/v1/content/plex/image/672445
   ```
   Expected: 301 redirect to `/api/v1/display/plex/672445`

4. **All tests pass:**
   ```bash
   npm run test:live
   ```

5. **Frontend loads without console errors**

---

## Rollback Plan

Each task has independent commits. To rollback:

1. Revert specific commits if needed
2. Deprecation redirects ensure old URLs still work
3. Frontend changes can be reverted independently of backend

---

## Related Documents

- [Action Routes Reference](../reference/content/action-routes.md)
- [Query Combinatorics](../reference/content/query-combinatorics.md)
- [API Layer Guidelines](../reference/core/layers-of-abstraction/api-layer-guidelines.md)
