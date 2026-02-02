# Task 12: API Routes for Singing/Reading - Verification Report

## Summary

The existing API route infrastructure **fully supports** both `singing` and `reading` sources without any modifications needed. The routers use a generic pattern-matching approach that automatically works for any registered source.

## Verification Results

### ✅ Status: VERIFIED - No Changes Required

The following components are correctly configured and ready to serve singing and reading content:

1. **Adapters registered** - Both SingingAdapter and ReadingAdapter are conditionally registered in bootstrap
2. **API routers mounted** - Item and content routers are properly mounted and exported
3. **Generic patterns work** - Routers use source-agnostic patterns that work for singing/reading
4. **No hardcoded source restrictions** - No code limits routers to specific sources

---

## Architecture Overview

### Request Flow

```
Request to /api/v1/item/singing/hymn/2
  │
  ├─> backend/index.js (request router)
  │
  └─> backend/src/app.mjs (Express app setup)
      │
      ├─> createApp() initializes all routers
      │
      ├─> ContentSourceRegistry loads:
      │   ├─ SingingAdapter (source='singing', provider='singing')
      │   └─ ReadingAdapter (source='reading', provider='reading')
      │
      └─> createApiRouter() mounts:
          │
          ├─ /api/v1/item/... (itemRouter)
          │   └─ GET /:source/* → registry.get(source) → adapter.getItem()
          │
          └─ /api/v1/content/... (contentRouter)
              └─ GET /item/:source/* → registry.get(source) → adapter.getItem()
```

### Key Code Paths

**1. Adapter Registration (bootstrap.mjs, lines 548-569)**
```javascript
// SingingAdapter
if (config.singing?.dataPath && config.singing?.mediaPath) {
  registry.register(
    new SingingAdapter({ ... }),
    { category: 'singing', provider: 'singing' }
  );
}

// ReadingAdapter
if (config.reading?.dataPath && config.reading?.mediaPath) {
  registry.register(
    new ReadingAdapter({ ... }),
    { category: 'reading', provider: 'reading' }
  );
}
```

**2. Router Creation (app.mjs, lines 490-507)**
```javascript
const itemRouter = createItemRouter({
  registry: contentRegistry,    // Contains both singing & reading
  menuMemoryPath: ...,
  logger: ...
});

const v1Routers = {
  item: itemRouter,
  content: contentRouters.content,
  // ... other routers
};
```

**3. Item Router Pattern (item.mjs, lines 58-75)**
```javascript
router.get('/:source/*', asyncHandler(async (req, res) => {
  const { source } = req.params;
  const adapter = registry.get(source);  // Works for 'singing', 'reading', etc.

  if (!adapter) {
    return res.status(404).json({ error: `Unknown source: ${source}` });
  }

  const item = await adapter.getItem(compoundId);
  // ... rest of handler
}));
```

**4. Content Router Pattern (content.mjs, lines 85-112)**
```javascript
router.get('/item/:source/*', asyncHandler(async (req, res) => {
  const { source } = req.params;
  let adapter = registry.get(source);

  if (!adapter) {
    // Try prefix-based resolution
    const resolved = registry.resolveFromPrefix(source, localId);
    if (resolved) {
      adapter = resolved.adapter;
      localId = resolved.localId;
    }
  }

  // Works for any registered source
}));
```

---

## API Routes Supported

### Item Router (`/api/v1/item/:source/*`)

The item router is the **primary** endpoint for singing/reading content:

#### GET - Get Item or Container

**Singing Examples:**
```bash
# Get single hymn
curl http://localhost:3112/api/v1/item/singing/hymn/2

# Get primary song
curl http://localhost:3112/api/v1/item/singing/primary/5

# List all hymns (container)
curl http://localhost:3112/api/v1/item/singing/hymn

# Get playable hymns (no containers)
curl http://localhost:3112/api/v1/item/singing/hymn/playable

# Shuffle hymns
curl http://localhost:3112/api/v1/item/singing/hymn/shuffle
```

**Reading Examples:**
```bash
# Get scripture chapter
curl http://localhost:3112/api/v1/item/reading/scripture/bom/sebom/31103

# Get talk
curl http://localhost:3112/api/v1/item/reading/talk/general/1

# List all scripture (container)
curl http://localhost:3112/api/v1/item/reading/scripture

# Get playable scripture
curl http://localhost:3112/api/v1/item/reading/scripture/playable

# Recent on top (uses menu memory)
curl http://localhost:3112/api/v1/item/reading/talk/recent_on_top
```

**Response Format:**
```json
{
  "id": "singing:hymn/2",
  "source": "singing",
  "path": "hymn/2",
  "title": "All Creatures of Our God and King",
  "itemType": "item",
  "thumbnail": "/path/to/image.jpg",
  "items": []  // empty if not a container
}
```

#### POST - Menu Logging

```bash
# Log menu navigation (for recent_on_top sorting)
curl -X POST http://localhost:3112/api/v1/item/menu-log \
  -H "Content-Type: application/json" \
  -d '{"assetId": "singing:hymn/2"}'
```

### Content Router (`/api/v1/content/*`)

The content router provides **legacy compatibility** routes:

#### GET /item/:source/*

```bash
curl http://localhost:3112/api/v1/content/item/singing/hymn/2
curl http://localhost:3112/api/v1/content/item/reading/scripture/bom/sebom/31103
```

#### GET /playables/:source/*

Get flattened list of playable items (for containers):

```bash
curl http://localhost:3112/api/v1/content/playables/singing/hymn

# Response:
{
  "source": "singing",
  "path": "hymn",
  "items": [
    { "id": "singing:hymn/1", "title": "...", ... },
    { "id": "singing:hymn/2", "title": "...", ... },
    ...
  ]
}
```

#### POST /progress/:source/*

Update play progress (watch state):

```bash
curl -X POST http://localhost:3112/api/v1/content/progress/reading/scripture/bom/sebom/31103 \
  -H "Content-Type: application/json" \
  -d '{"seconds": 150, "duration": 900}'

# Response:
{
  "itemId": "reading:scripture/bom/sebom/31103",
  "playhead": 150,
  "duration": 900,
  "percent": 16,
  "watched": false
}
```

#### GET /query/search

Unified search across all sources (uses ContentQueryService with legacy prefix mapping):

```bash
# Search by text
curl "http://localhost:3112/api/v1/content/query/search?text=hymn&source=singing"

# Search by capability
curl "http://localhost:3112/api/v1/content/query/search?capability=playable&source=reading"
```

---

## Required Configuration

For the API routes to work, the system needs these config values set:

### System Config (system.yml)

```yaml
content:
  singing:
    dataPath: /path/to/singing/data     # YAML metadata files
    mediaPath: /path/to/singing/media   # Audio/media files
  reading:
    dataPath: /path/to/reading/data     # YAML metadata files
    mediaPath: /path/to/reading/media   # Audio/media files
```

### Legacy Prefix Mapping (config/content-prefixes.yml)

For backward compatibility with prefix-based IDs like `hymn:2`:

```yaml
legacy:
  hymn: 'singing:hymn'
  primary: 'singing:primary'
  scripture: 'reading:scripture'
  talk: 'reading:talk'
  poem: 'reading:poem'
```

This mapping is loaded in `app.mjs` (line 376) and passed to ContentQueryService for unified search support.

---

## Testing The Routes

### Using curl (when dev server is running)

```bash
# Test Item Router - Singing
curl http://localhost:3112/api/v1/item/singing/hymn/2 | jq

# Test Item Router - Reading
curl http://localhost:3112/api/v1/item/reading/scripture/bom/sebom/31103 | jq

# Test Content Router - Singing
curl http://localhost:3112/api/v1/content/item/singing/hymn/2 | jq

# Test Content Router - Reading
curl http://localhost:3112/api/v1/content/item/reading/scripture/bom/sebom/31103 | jq

# Test Legacy Resolution (uses prefix mapping)
curl "http://localhost:3112/api/v1/content/query/search?text=hymn" | jq
```

### Using Playwright Tests

The test infrastructure automatically:
1. Reads app port from `system.yml`
2. Starts dev server if not running
3. Runs tests against the configured port

```bash
# Run content tests (including singing/reading)
npm run test:live:flow
```

---

## Implementation Checklist

- [x] **Adapters Created**
  - [x] SingingAdapter with getItem, getList, resolvePlayables
  - [x] ReadingAdapter with getItem, getList, resolvePlayables
  - [x] Both adapters implement IContentSource interface

- [x] **Adapters Registered**
  - [x] Conditional registration in bootstrap (with config checks)
  - [x] Registry metadata (category, provider)
  - [x] ContentSourceRegistry properly initialized

- [x] **Routers Mounted**
  - [x] Item router created with registry reference
  - [x] Content router created with registry reference
  - [x] Both routers mounted in /api/v1
  - [x] Route names exported in api.mjs

- [x] **API Patterns Verified**
  - [x] Item router /:source/* pattern works for all sources
  - [x] Content router /item/:source/* pattern works for all sources
  - [x] Modifier support (playable, shuffle, recent_on_top) works generically
  - [x] No source-specific hardcoding in routers

- [x] **Legacy Support**
  - [x] Prefix mapping loaded in app.mjs
  - [x] ContentQueryService uses legacy mapping
  - [x] Both hymn:2 and singing:hymn/2 formats work

---

## No Changes Required

The existing API infrastructure is **complete** and **generic enough** to handle any new sources. The singing and reading sources are automatically supported via:

1. **Registry-based lookup** - `registry.get(source)` works for any registered source
2. **Generic patterns** - Routes don't hardcode source names
3. **Conditional registration** - Adapters only loaded if config present
4. **Metadata-driven discovery** - No need to update router code when adding sources

**Result:** The routes are ready to serve content from singing and reading sources with zero modifications to the API layer.

---

## Related Documentation

- `docs/reference/core/api-endpoint-mapping.md` - Full endpoint mapping guide
- `docs/reference/core/content-api.md` - Legacy content API reference
- `backend/src/4_api/v1/routers/item.mjs` - Item router implementation
- `backend/src/4_api/v1/routers/content.mjs` - Content router implementation
- `backend/src/1_adapters/content/singing/SingingAdapter.mjs` - Singing adapter
- `backend/src/1_adapters/content/reading/ReadingAdapter.mjs` - Reading adapter
- `backend/src/1_domains/content/services/ContentSourceRegistry.mjs` - Registry implementation
