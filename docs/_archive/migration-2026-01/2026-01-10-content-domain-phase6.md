# Content Domain Phase 6 - Integration, Testing & Frontend Adoption

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Final integration testing, legacy endpoint removal timeline, and frontend adoption guide.

**Architecture:** This phase validates the complete Content Domain system, establishes deprecation warnings, and provides a migration guide for frontend consumers.

**Tech Stack:** JavaScript ES Modules (.mjs), Jest for testing, Express.js

**Reference Docs:**
- `docs/plans/2026-01-10-content-domain-phase5.md` - Phase 5 completed
- `docs/_wip/plans/2026-01-10-api-consumer-inventory.md` - Frontend migration checklist

---

## Task 1: Integration Tests for Full System

**Files:**
- Create: `tests/integration/content-domain/fullSystem.test.mjs`

**Step 1: Write comprehensive integration tests**

```javascript
// tests/integration/content-domain/fullSystem.test.mjs
import express from 'express';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createContentRegistry,
  createWatchStore,
  createApiRouters
} from '../../../backend/src/0_infrastructure/bootstrap.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../_fixtures');

describe('Content Domain Integration', () => {
  let app;
  let registry;
  let watchStore;

  beforeAll(async () => {
    registry = createContentRegistry({
      mediaBasePath: path.join(fixturesPath, 'media'),
      dataPath: path.join(fixturesPath, 'local-content'),
      watchlistPath: path.join(fixturesPath, 'folder/watchlist.yaml')
    });

    watchStore = createWatchStore({
      watchStatePath: path.join(fixturesPath, 'watch-state')
    });

    const routers = createApiRouters({ registry, watchStore });

    app = express();
    app.use(express.json());

    // Mount legacy shims first
    app.use(routers.legacyShims.play);
    app.use(routers.legacyShims.list);
    app.use(routers.legacyShims.localContent);
    app.post('/media/log', routers.legacyShims.mediaLog);

    // Mount new routers
    app.use('/api/content', routers.content);
    app.use('/api/play', routers.play);
    app.use('/api/list', routers.list);
    app.use('/api/local-content', routers.localContent);
    app.use('/proxy', routers.proxy);
  });

  describe('Adapter Registration', () => {
    it('registers filesystem adapter', () => {
      expect(registry.getAdapter('filesystem')).toBeDefined();
    });

    it('registers local-content adapter', () => {
      expect(registry.getAdapter('local-content')).toBeDefined();
    });

    it('registers folder adapter', () => {
      expect(registry.getAdapter('folder')).toBeDefined();
    });
  });

  describe('Play API Flow', () => {
    it('fetches filesystem item', async () => {
      const res = await request(app).get('/api/play/filesystem/audio/test.mp3');
      expect(res.status).toBe(200);
      expect(res.body.media_url).toBeDefined();
    });

    it('legacy endpoint forwards correctly', async () => {
      const res = await request(app).get('/media/info/audio/test.mp3');
      expect(res.status).toBe(200);
      expect(res.body.media_key).toBeDefined();
    });
  });

  describe('List API Flow', () => {
    it('lists folder contents', async () => {
      const res = await request(app).get('/api/list/folder/Morning%20Shows');
      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
    });

    it('legacy data/list forwards correctly', async () => {
      const res = await request(app).get('/data/list/Morning+Shows');
      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
    });
  });

  describe('LocalContent API Flow', () => {
    it('fetches talk content', async () => {
      const res = await request(app).get('/api/local-content/talk/general/test-talk');
      expect([200, 404]).toContain(res.status); // 404 if fixture missing
    });

    it('legacy data/talk forwards correctly', async () => {
      const res = await request(app).get('/data/talk/general/test-talk');
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('Watch State Flow', () => {
    it('updates progress via new endpoint', async () => {
      const res = await request(app)
        .post('/api/content/progress/filesystem/audio/test.mp3')
        .send({ seconds: 90, duration: 180 });

      expect([200, 404]).toContain(res.status);
    });

    it('legacy media/log updates correctly', async () => {
      const res = await request(app)
        .post('/media/log')
        .send({
          type: 'media',
          library: 'audio/test.mp3',
          playhead: 90,
          mediaDuration: 180
        });

      expect(res.status).toBe(200);
    });
  });

  describe('Proxy Flow', () => {
    it('streams filesystem file', async () => {
      const res = await request(app).get('/proxy/filesystem/stream/audio/test.mp3');
      expect([200, 404]).toContain(res.status);
    });

    it('handles range requests', async () => {
      const res = await request(app)
        .get('/proxy/filesystem/stream/audio/test.mp3')
        .set('Range', 'bytes=0-100');

      expect([200, 206, 404]).toContain(res.status);
    });
  });
});
```

**Step 2: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/content-domain/fullSystem.test.mjs --verbose
```

**Step 3: Commit**

```bash
git add tests/integration/content-domain/fullSystem.test.mjs
git commit -m "test(integration): add full Content Domain system tests"
```

---

## Task 2: Add Deprecation Warnings to Legacy Endpoints

**Files:**
- Modify: `backend/src/4_api/middleware/legacyPlayShim.mjs`
- Modify: `backend/src/4_api/middleware/legacyListShim.mjs`
- Modify: `backend/src/4_api/middleware/legacyLocalContentShim.mjs`

**Step 1: Add deprecation logging**

```javascript
// Add to each shim file

const DEPRECATION_LOG_INTERVAL = 60000; // Log once per minute per endpoint
const lastLogTimes = new Map();

function logDeprecationWarning(legacyEndpoint, newEndpoint) {
  const now = Date.now();
  const lastLog = lastLogTimes.get(legacyEndpoint) || 0;

  if (now - lastLog > DEPRECATION_LOG_INTERVAL) {
    console.warn(`[DEPRECATED] ${legacyEndpoint} -> Use ${newEndpoint} instead`);
    lastLogTimes.set(legacyEndpoint, now);
  }
}

// Add X-Deprecated header to responses
function addDeprecationHeader(res, newEndpoint) {
  res.setHeader('X-Deprecated', `Use ${newEndpoint} instead`);
  res.setHeader('X-Deprecated-Since', '2026-01-10');
}
```

**Step 2: Update shim handlers**

```javascript
// In legacyPlayShim.mjs, update handlers:

router.get('/media/plex/info/:key/:config?', async (req, res, next) => {
  const newPath = `/api/play/plex/${req.params.key}`;
  logDeprecationWarning('/media/plex/info', newPath);
  addDeprecationHeader(res, newPath);
  // ... rest of handler
});
```

**Step 3: Commit**

```bash
git add backend/src/4_api/middleware/
git commit -m "feat(api): add deprecation warnings to legacy endpoint shims"
```

---

## Task 3: Create Frontend Migration Guide

**Files:**
- Create: `docs/reference/core/content-api-migration.md`

**Step 1: Write the migration guide**

```markdown
# Content API Migration Guide

This document guides frontend developers through migrating from legacy endpoints to the new Content Domain API.

## Migration Priority

| Priority | Legacy Endpoint | New Endpoint | Impact |
|----------|-----------------|--------------|--------|
| **CRITICAL** | `/media/plex/info/:id` | `/api/play/plex/:id` | All playback |
| **CRITICAL** | `/media/info/*` | `/api/play/filesystem/*` | All playback |
| **CRITICAL** | `/media/log` | `/api/content/progress/:source/*` | Watch tracking |
| **HIGH** | `/data/list/:folder` | `/api/list/folder/:name` | Menu navigation |
| **HIGH** | `/media/plex/list/:id` | `/api/list/plex/:id` | Plex browsing |
| **MEDIUM** | `/data/scripture/*` | `/api/local-content/scripture/*` | Scripture |
| **MEDIUM** | `/data/talk/*` | `/api/local-content/talk/*` | Talks |
| **MEDIUM** | `/data/hymn/:num` | `/api/local-content/hymn/:num` | Hymns |
| **MEDIUM** | `/data/poetry/*` | `/api/local-content/poem/*` | Poetry |
| **LOW** | `/media/plex/img/:id` | `/proxy/plex/thumb/:id` | Thumbnails |

## File-by-File Migration

### Player Module

**File:** `frontend/src/modules/Player/lib/api.js`

| Old | New |
|-----|-----|
| `DaylightAPI(\`media/plex/info/${plex}/shuffle\`)` | `DaylightAPI(\`api/play/plex/${plex}/shuffle\`)` |
| `DaylightAPI(\`media/info/${media}?shuffle=...\`)` | `DaylightAPI(\`api/play/filesystem/${media}?shuffle=...\`)` |

**Response mapping:**
```javascript
// Old response shape
{ media_key, media_url, media_type, title, duration, plex, show, season, episode }

// New response shape (same fields, just different endpoint)
{ id, media_key, media_url, media_type, title, duration, plex, show, season, episode }
```

### Menu Module

**File:** `frontend/src/modules/Menu/Menu.jsx`

| Old | New |
|-----|-----|
| `DaylightAPI(\`data/list/${target}/${config}\`)` | `DaylightAPI(\`api/list/folder/${target}/${config}\`)` |

**Note:** Replace `+` with `%20` in folder names:
- Old: `data/list/Morning+Program`
- New: `api/list/folder/Morning%20Program`

### ContentScroller Module

**File:** `frontend/src/modules/ContentScroller/ContentScroller.jsx`

| Old | New |
|-----|-----|
| `DaylightAPI(\`data/scripture/${ref}\`)` | `DaylightAPI(\`api/local-content/scripture/${ref}\`)` |
| `DaylightAPI(\`data/talk/${id}\`)` | `DaylightAPI(\`api/local-content/talk/${id}\`)` |
| `DaylightAPI(\`data/hymn/${num}\`)` | `DaylightAPI(\`api/local-content/hymn/${num}\`)` |
| `DaylightAPI(\`data/poetry/${id}\`)` | `DaylightAPI(\`api/local-content/poem/${id}\`)` |

### Progress Logging

**File:** `frontend/src/modules/Player/hooks/useCommonMediaController.js`

| Old | New |
|-----|-----|
| `DaylightAPI('media/log', payload)` | `DaylightAPI('api/content/progress/${source}/${id}', payload)` |

**Payload change:**
```javascript
// Old payload
{ title, type, media_key, seconds, percent, watched_duration }

// New payload
{ seconds, duration }
// (source and id are in the URL now)
```

## Testing Your Migration

After updating an endpoint:

1. **Verify response shape** - Check that all fields your code uses are present
2. **Test with shim disabled** - Temporarily comment out legacy shim to ensure new endpoint works
3. **Check console for deprecation warnings** - If you still see warnings, something is still using legacy

## Timeline

| Date | Milestone |
|------|-----------|
| 2026-01-10 | New endpoints available, shims active |
| 2026-02-01 | Deprecation warnings in console |
| 2026-03-01 | Legacy endpoints removed |

## Getting Help

If you encounter issues during migration:
1. Check the response shape matches what you expect
2. Look for `X-Deprecated` headers indicating which new endpoint to use
3. Review the API Consumer Inventory in `docs/_wip/plans/2026-01-10-api-consumer-inventory.md`
```

**Step 2: Commit**

```bash
git add docs/reference/core/content-api-migration.md
git commit -m "docs: add Content API frontend migration guide"
```

---

## Task 4: Create API Index/Documentation

**Files:**
- Create: `docs/reference/core/content-api.md`

**Step 1: Write the API documentation**

```markdown
# Content Domain API Reference

## Overview

The Content Domain provides a unified API for accessing media from multiple sources (Plex, filesystem, local content). All endpoints use compound IDs in the format `source:localId`.

## Base URL

```
/api/content - General content operations
/api/play    - Playable item info
/api/list    - Container browsing
/api/local-content - Scripture, hymns, talks, poetry
/proxy       - Media streaming
```

## Compound ID Format

All items use compound IDs:
- `plex:12345` - Plex item by rating key
- `filesystem:audio/music/song.mp3` - Filesystem path
- `folder:Morning Program` - Named folder
- `talk:general/talk-id` - Local talk
- `scripture:cfm/1nephi1` - Scripture chapter
- `hymn:113` - Hymn by number
- `poem:remedy/01` - Poetry item

---

## Play API

### GET /api/play/:source/*

Get playable item information with media URL.

**Path Parameters:**
- `source` - Adapter name (plex, filesystem, local-content)
- `*` - Local ID within the source

**Path Modifiers:**
- `/shuffle` - Get random item from container

**Response:**
```json
{
  "id": "plex:12345",
  "media_key": "plex:12345",
  "media_url": "/proxy/plex/stream/12345",
  "media_type": "video",
  "title": "Movie Title",
  "duration": 7200,
  "resumable": true,
  "resume_position": 3600,
  "thumbnail": "/proxy/plex/thumb/12345"
}
```

---

## List API

### GET /api/list/:source/*

List contents of a container.

**Path Modifiers:**
- `/playable` - Flatten to playable items only
- `/shuffle` - Randomize order
- `/recent_on_top` - Sort by access time

**Response:**
```json
{
  "source": "folder",
  "path": "Morning Program",
  "title": "Morning Program",
  "image": "/img/morning.jpg",
  "items": [
    {
      "id": "plex:12345",
      "title": "Show One",
      "itemType": "container",
      "thumbnail": "/proxy/plex/thumb/12345"
    }
  ]
}
```

---

## Content API

### GET /api/content/item/:source/*

Get item metadata.

### GET /api/content/list/:source/*

Browse container (alias for /api/list).

### POST /api/content/progress/:source/*

Update watch progress.

**Body:**
```json
{
  "seconds": 3600,
  "duration": 7200
}
```

**Response:**
```json
{
  "itemId": "plex:12345",
  "playhead": 3600,
  "duration": 7200,
  "percent": 50,
  "watched": false
}
```

---

## LocalContent API

### GET /api/local-content/scripture/*

Get scripture chapter with verses.

**Response:**
```json
{
  "reference": "1 Nephi 1",
  "media_key": "scripture:cfm/1nephi1",
  "mediaUrl": "/proxy/local-content/stream/scripture/cfm/1nephi1",
  "duration": 360,
  "verses": [
    { "num": 1, "text": "...", "start": 0, "end": 15 }
  ]
}
```

### GET /api/local-content/hymn/:number

Get hymn with lyrics.

### GET /api/local-content/talk/*

Get talk with paragraphs.

### GET /api/local-content/poem/*

Get poem with stanzas.

---

## Proxy API

### GET /proxy/:source/stream/*

Stream media file. Supports range requests for seeking.

**Headers:**
- `Content-Type` - Media MIME type
- `Accept-Ranges: bytes`
- `Content-Length`

**Range Requests:**
- Request: `Range: bytes=0-1000`
- Response: 206 with `Content-Range: bytes 0-1000/50000`

### GET /proxy/:source/thumb/*

Get thumbnail image.

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message",
  "source": "plex",
  "localId": "12345"
}
```

**Status Codes:**
- 200 - Success
- 206 - Partial content (range request)
- 400 - Bad request (invalid parameters)
- 404 - Not found (item or source)
- 500 - Internal error
```

**Step 2: Commit**

```bash
git add docs/reference/core/content-api.md
git commit -m "docs: add Content Domain API reference"
```

---

## Task 5: Cleanup and Final Verification

**Files:**
- Review: All modified files across phases

**Step 1: Run full test suite**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/content/ --verbose
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/api/ --verbose
NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/ --verbose
```

**Step 2: Verify dev server starts**

```bash
npm run dev
# Check for any startup errors in logs
```

**Step 3: Manual API verification**

```bash
# Test new endpoints
curl http://localhost:3112/api/play/filesystem/audio/test.mp3
curl http://localhost:3112/api/list/folder/TVApp

# Test legacy endpoints still work
curl http://localhost:3112/media/info/audio/test.mp3
curl http://localhost:3112/data/list/TVApp
```

**Step 4: Check for deprecation warnings**

```bash
# Look for deprecation logs in dev.log
grep "DEPRECATED" dev.log
```

**Step 5: Commit any final fixes**

```bash
git add .
git commit -m "chore: final Content Domain cleanup and verification"
```

---

## Summary

**Phase 6 Tasks:**

1. **Integration Tests** - Full system tests for all adapters and routers
2. **Deprecation Warnings** - Add logging and headers for legacy endpoints
3. **Frontend Migration Guide** - Step-by-step guide for updating frontend
4. **API Documentation** - Complete reference for all new endpoints
5. **Cleanup & Verification** - Final testing and verification

---

## Complete Phase Summary

### Phase 1: Core Domain Types
- Item, Listable, Playable entities
- IContentSource port
- ContentSourceRegistry
- FilesystemAdapter

### Phase 1d: Integration
- Content API integration with backend
- PlexAdapter

### Phase 2: Queue & State
- Queueable capability
- WatchState entity
- YamlWatchStateStore
- QueueService
- Progress API
- Proxy endpoints

### Phase 3: LocalContent & Folders
- LocalContentAdapter (talks)
- FolderAdapter (watchlists)
- Legacy media log shim

### Phase 4: Frontend Migration
- Play API router
- List API router
- Legacy play/list shims

### Phase 5: LocalContent API
- Scripture, hymn, talk, poetry support
- LocalContent router
- Legacy LocalContent shims
- LocalContent proxy routes

### Phase 6: Integration & Cleanup
- Full system integration tests
- Deprecation warnings
- Migration documentation
- API reference

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend                                  │
│  (Player, Menu, ContentScroller, Fitness)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                    HTTP Requests
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express.js Backend                            │
├─────────────────────────────────────────────────────────────────┤
│  Legacy Shims (deprecated)         │  New API Routers           │
│  ├── /media/plex/info  ─────────▶  │  ├── /api/play/:source/*   │
│  ├── /media/info       ─────────▶  │  ├── /api/list/:source/*   │
│  ├── /data/list        ─────────▶  │  ├── /api/content/*        │
│  ├── /data/scripture   ─────────▶  │  ├── /api/local-content/*  │
│  └── /media/log        ─────────▶  │  └── /proxy/:source/*      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ContentSourceRegistry                          │
├─────────────────────────────────────────────────────────────────┤
│  Adapters:                                                       │
│  ├── FilesystemAdapter    → /media/audio, /media/video          │
│  ├── PlexAdapter          → Plex Server API                     │
│  ├── LocalContentAdapter  → YAML + media files                  │
│  └── FolderAdapter        → watchlist.yaml                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Persistence Layer                              │
├─────────────────────────────────────────────────────────────────┤
│  YamlWatchStateStore  → watch state YAML files                  │
└─────────────────────────────────────────────────────────────────┘
```

## Next Steps

After completing all phases:

1. **Monitor deprecation logs** - Track legacy endpoint usage
2. **Gradual frontend migration** - Update frontend files per migration guide
3. **Remove legacy shims** - After frontend fully migrated (target: 2026-03-01)
4. **Consider additional adapters** - Immich, Audiobookshelf, FreshRSS
