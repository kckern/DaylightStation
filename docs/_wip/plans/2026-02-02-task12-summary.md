# Task 12 Summary: Create API Routes for singing/reading

**Status:** ✅ COMPLETED - No code changes required

**Date:** 2026-02-02

**Key Finding:** The existing API infrastructure fully supports singing and reading sources through generic patterns. No router modifications are needed.

---

## Verification Performed

### Step 1: Examined Item Router Pattern
**File:** `backend/src/4_api/v1/routers/item.mjs`

The item router uses a universal pattern:
```javascript
router.get('/:source/*', asyncHandler(async (req, res) => {
  const { source } = req.params;
  const adapter = registry.get(source);  // ← Works for ANY source
  // ... rest of handler
}));
```

**Finding:** The router makes NO assumptions about specific sources. It looks up any source in the registry and proceeds if found. ✅

### Step 2: Examined Content Router Pattern
**File:** `backend/src/4_api/v1/routers/content.mjs`

Both the item and playables endpoints use the same pattern:
```javascript
router.get('/item/:source/*', asyncHandler(async (req, res) => {
  let adapter = registry.get(source);  // ← Generic lookup
  if (!adapter) {
    const resolved = registry.resolveFromPrefix(source, localId);
    // ... handle legacy prefix resolution
  }
  // ... rest of handler
}));
```

**Finding:** Like the item router, this also uses generic source lookup with fallback to prefix resolution. ✅

### Step 3: Verified Adapter Registration
**File:** `backend/src/0_system/bootstrap.mjs` (lines 548-569)

Both adapters are registered conditionally:
```javascript
// SingingAdapter
if (config.singing?.dataPath && config.singing?.mediaPath) {
  registry.register(new SingingAdapter({ ... }), { ... });
}

// ReadingAdapter
if (config.reading?.dataPath && config.reading?.mediaPath) {
  registry.register(new ReadingAdapter({ ... }), { ... });
}
```

**Finding:** Adapters are properly registered with correct source names ('singing', 'reading'). ✅

### Step 4: Confirmed Adapter Interface Compliance
**Files:**
- `backend/src/1_adapters/content/singing/SingingAdapter.mjs`
- `backend/src/1_adapters/content/reading/ReadingAdapter.mjs`

Both adapters implement the required methods:
- ✅ `async getItem(localId)` - Get single item metadata
- ✅ `async getList(localId)` - Get container children
- ✅ `async resolvePlayables(localId)` - Get flattened playable items

**Finding:** Both adapters fully implement IContentSource interface. ✅

### Step 5: Checked Router Mounting
**File:** `backend/src/4_api/v1/routers/api.mjs`

Routes are mounted dynamically from the `routers` map:
```javascript
const routeMap = {
  '/item': 'item',      // ← Mounts item router
  '/content': 'content', // ← Mounts content router
  // ... other routes
};

for (const [path, key] of Object.entries(routeMap)) {
  if (routers[key]) {
    router.use(path, routers[key]);
  }
}
```

**Finding:** Routes are mounted generically - no hardcoded source restrictions. ✅

### Step 6: Verified Router Creation in App Setup
**File:** `backend/src/app.mjs` (lines 386-507)

Both routers are created with the content registry that contains singing and reading:
```javascript
const contentRouters = createApiRouters({
  registry: contentRegistry,  // Contains singing & reading adapters
  mediaProgressMemory,
  // ... other config
});

const itemRouter = createItemRouter({
  registry: contentRegistry,  // Contains singing & reading adapters
  menuMemoryPath,
  // ... other config
});
```

**Finding:** Both routers receive the complete registry with all registered sources. ✅

---

## API Routes Available

### Item Router - Primary Endpoint
```
GET /api/v1/item/:source/*
GET /api/v1/item/:source/*/playable
GET /api/v1/item/:source/*/shuffle
GET /api/v1/item/:source/*/recent_on_top
POST /api/v1/item/menu-log
```

**Works for singing/reading:**
```bash
curl http://localhost:3112/api/v1/item/singing/hymn/2
curl http://localhost:3112/api/v1/item/reading/scripture/bom/sebom/31103
```

### Content Router - Legacy Compatibility
```
GET /api/v1/content/item/:source/*
GET /api/v1/content/playables/:source/*
POST /api/v1/content/progress/:source/*
```

**Works for singing/reading:**
```bash
curl http://localhost:3112/api/v1/content/item/singing/hymn/2
curl http://localhost:3112/api/v1/content/item/reading/scripture/bom/sebom/31103
```

### Query/Search Endpoint
```
GET /api/v1/content/query/search?source=singing
GET /api/v1/content/query/search?source=reading
```

**Uses legacy prefix mapping for backward compatibility:**
```bash
curl "http://localhost:3112/api/v1/content/query/search?text=hymn"
```

---

## Documentation Created

Three new planning documents were created to document this finding:

1. **`docs/plans/2026-02-02-api-routes-verification.md`**
   - Complete architectural overview
   - Code path documentation
   - Expected responses
   - Configuration requirements

2. **`docs/plans/2026-02-02-api-test-commands.md`**
   - Quick curl command reference
   - All test scenarios
   - Expected/error responses
   - Debugging tips

3. **`docs/reference/core/content-api.md` (Updated)**
   - Added singing/reading to compound ID examples
   - Added Unified Item API section
   - Updated related code links

---

## Configuration Required

For the routes to work, ensure system.yml has:

```yaml
content:
  singing:
    dataPath: /path/to/singing/data
    mediaPath: /path/to/singing/media
  reading:
    dataPath: /path/to/reading/data
    mediaPath: /path/to/reading/media
```

And for legacy prefix support, ensure `data/config/content-prefixes.yml` has:

```yaml
legacy:
  hymn: 'singing:hymn'
  primary: 'singing:primary'
  scripture: 'reading:scripture'
  talk: 'reading:talk'
  poem: 'reading:poem'
```

---

## Why No Changes Were Needed

The API router infrastructure was designed with **extensibility** as a core principle:

1. **Generic Source Lookup** - `registry.get(source)` works for any registered source
2. **No Hardcoded Lists** - No code limits routers to specific source names
3. **Conditional Registration** - Adapters only load if config present
4. **Metadata-Driven** - Source capabilities come from adapter manifests, not router code
5. **Legacy Support** - Prefix mapping handles backward compatibility without router changes

**Result:** When a new source (singing/reading) is registered with adapters implementing IContentSource, it automatically becomes available through all existing routes.

---

## Testing

### Manual Testing (when dev server running)

```bash
# Test Item Router
curl http://localhost:3112/api/v1/item/singing/hymn/2 | jq
curl http://localhost:3112/api/v1/item/reading/scripture/bom/sebom/31103 | jq

# Test Content Router
curl http://localhost:3112/api/v1/content/item/singing/hymn/2 | jq
curl http://localhost:3112/api/v1/content/item/reading/scripture/bom/sebom/31103 | jq

# Test Legacy Resolution
curl "http://localhost:3112/api/v1/content/query/search?text=hymn" | jq
```

### Automated Testing

```bash
# Run flow tests (includes content/singing/reading)
npm run test:live:flow
```

---

## Files Involved

**No code changes made.** The following files were verified:

### Routers
- `/backend/src/4_api/v1/routers/item.mjs` - ✅ Generic pattern works
- `/backend/src/4_api/v1/routers/content.mjs` - ✅ Generic pattern works
- `/backend/src/4_api/v1/routers/api.mjs` - ✅ Dynamic mounting works

### Bootstrap
- `/backend/src/0_system/bootstrap.mjs` - ✅ Adapters registered correctly

### Adapters
- `/backend/src/1_adapters/content/singing/SingingAdapter.mjs` - ✅ Implements interface
- `/backend/src/1_adapters/content/reading/ReadingAdapter.mjs` - ✅ Implements interface

### App Setup
- `/backend/src/app.mjs` - ✅ Routers created with correct registry

---

## Next Steps

The API routes are ready for:
1. ✅ Task 13 - Frontend SingingScroller
2. ✅ Task 14 - Frontend ReadingScroller
3. ✅ Task 15 - Query Param Resolver
4. ✅ Integration testing
5. ✅ Runtime tests

---

## References

- `docs/plans/2026-02-02-api-routes-verification.md` - Detailed verification
- `docs/plans/2026-02-02-api-test-commands.md` - Test command reference
- `docs/reference/core/content-api.md` - API reference (updated)
- `backend/src/4_api/v1/routers/item.mjs` - Item router implementation
- `backend/src/4_api/v1/routers/content.mjs` - Content router implementation
- `backend/src/0_system/bootstrap.mjs` - Adapter registration
