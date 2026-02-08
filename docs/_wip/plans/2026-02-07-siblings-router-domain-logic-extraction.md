# Siblings Router — Adapter-Driven Sibling Resolution

**Date:** 2026-02-07  
**Status:** Plan (v2 — adapter-driven)  
**Related code:** `backend/src/4_api/v1/routers/siblings.mjs`, `backend/src/3_applications/content/`, `backend/src/1_adapters/content/`

---

## Problem

`siblings.mjs` (API layer 4) contains significant domain knowledge, violating DDD layer rules:

1. **Hardcoded domain constants** — `LIST_PREFIXES`, `LOCAL_CONTENT_COLLECTIONS`, `SCRIPTURE_VOLUMES` encode content categorization knowledge that belongs in domain/application layers.
2. **Source-specific branching** — Three special-case branches (`local-content` collections, `list` prefixes, `freshvideo`) embed routing heuristics that decide *which adapter to call and how*, rather than delegating to a service.
3. **Parent resolution logic** — The parent-finding algorithm (check `parentRatingKey` → `libraryId` → path splitting) is domain navigation logic, not HTTP translation.
4. **Response mapping functions** — `mapSiblingItem()` and `mapParentInfo()` normalize heterogeneous adapter outputs into a uniform sibling response shape; this is application-layer orchestration.

**The "Thin Layer Test" fails:** the router contains business logic, conditional adapter selection, and multi-adapter orchestration — all of which should live below the API layer.

### Why "move if/else to a service" is not enough

Simply relocating the branching logic from the router into an application-layer `SiblingsService` still violates DDD: the application layer would need knowledge about *how each adapter finds siblings* (scripture volumes, list prefixes, freshvideo path mapping). That knowledge belongs in the adapters themselves.

---

## Proposed Solution: Adapter-Driven Strategy

Each adapter that needs custom sibling logic implements an **optional `resolveSiblings(compoundId)` method** on `IContentSource`. The application-layer `SiblingsService` becomes a thin delegator:

1. Resolve adapter from registry
2. If adapter has `resolveSiblings` → call it → normalize response
3. Else → use default fallback (getItem → parent metadata → getList)

**No source-specific branching in the service. Zero.**

### Architecture

```
┌───────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  API Router   │────►│ SiblingsService  │────►│  adapter.resolve-   │
│  (HTTP only)  │     │  (delegate +     │     │  Siblings(id)       │
│               │     │   normalize)     │     │  (adapter-owned     │
│               │     │                  │     │   strategy)         │
└───────────────┘     └──────────────────┘     └─────────────────────┘
                              │
                              ▼ (fallback for adapters without resolveSiblings)
                      ┌──────────────────┐
                      │ defaultResolve-  │
                      │ Siblings()       │
                      │ (getItem→parent  │
                      │  →getList)       │
                      └──────────────────┘
```

### New / Modified Files

| File | Layer | Change |
|------|-------|--------|
| `3_applications/content/ports/ISiblingsService.mjs` | App (3) | Port interface for SiblingsService |
| `3_applications/content/services/SiblingsService.mjs` | App (3) | Thin delegator + default fallback + response normalization |
| `1_adapters/content/local-content/LocalContentAdapter.mjs` | Adapter (1) | Add `resolveSiblings()` for collection roots |
| `1_adapters/content/list/ListAdapter.mjs` | Adapter (1) | Add `resolveSiblings()` for list-type roots |
| `1_adapters/content/media/files/FileAdapter.mjs` | Adapter (1) | Add `resolveSiblings()` for freshvideo + path-based parent |
| `4_api/v1/routers/siblings.mjs` | API (4) | Gut all logic; delegate to injected SiblingsService |
| `0_system/bootstrap.mjs` | System (0) | Wire SiblingsService, inject into router factory |

---

## Design Detail

### 1. Optional `resolveSiblings` on IContentSource

```js
/**
 * @typedef {Object} SiblingsResult
 * @property {{ id, title, source, thumbnail, parentId?, libraryId? }|null} parent
 * @property {Array<Item>} items - Raw adapter items (same shape as getList returns)
 */

// Optional method on IContentSource:
// resolveSiblings(compoundId: string): Promise<SiblingsResult|null>
//
// Return null to indicate "I don't handle this case, use default fallback"
```

Adapters that don't implement it simply don't have the method — the service detects `typeof adapter.resolveSiblings === 'function'` and falls back to the default.

### 2. SiblingsService (Application Layer)

```js
class SiblingsService {
  #registry;
  #logger;

  constructor({ registry, logger })

  async resolveSiblings(source, localId):
    1. resolveAdapter(source, localId) via registry
    2. if adapter.resolveSiblings exists:
         result = await adapter.resolveSiblings(compoundId)
         if result !== null → return normalizeResult(result)
    3. return defaultResolveSiblings(adapter, compoundId, ...)
}
```

**What the service owns:**
- Adapter resolution via registry (get/resolve)
- Response normalization (`mapSiblingItem`, `mapParentInfo`) — DTO mapping for API response shape
- Default fallback for adapters without `resolveSiblings`

**What the service does NOT own:**
- Knowledge of scripture volumes, list prefixes, collection names
- Any source-specific branching
- Decision about *how* a particular source finds its parent/siblings

### 3. Default Fallback (in SiblingsService)

For adapters that don't implement `resolveSiblings` (Plex, Komga, ABS, Immich, etc.):

```
defaultResolveSiblings(adapter, compoundId, source, ...):
  item = await adapter.getItem(compoundId)
  parentKey = item.metadata.parentRatingKey || parentKey || parentId || ...
  if parentKey → getItem(parent) + getList(parent)
  else if libraryId → getList(library/sections/id/all)
  else if path has '/' → path-based parent + getList(parentPath)
  else → { parent: null, items: [] }
```

This stays in the service as the "generic" strategy. Most adapters will use it.

### 4. Adapter Implementations

#### LocalContentAdapter.resolveSiblings(compoundId)

```js
// compoundId format (from prefix resolution): "talk:folderId" or "hymn:123"
// Parse prefix from compound ID
// If requesting a collection root (e.g., "talk:", "hymn:") → getList('talk:') 
// If scripture volume root (e.g., "scripture:ot") → getList('scripture:ot')
// For deep items → return null (let default fallback handle it)
```

Owns: knowledge of which prefixes are collections, what scripture volumes are.

#### ListAdapter.resolveSiblings(compoundId)

```js
// compoundId format: "menu:listname" or "menu:" (root)
// If root request (prefix with empty name) → getList('menu:') to list all menus
// For specific list items → return null (let default handle)
```

Owns: knowledge of list-type prefix patterns.

#### FileAdapter.resolveSiblings(compoundId)

```js
// compoundId format: "files:video/news/channel" or path-based
// Path-based parent resolution: split path, parent = parent directory
// getList(parentPath) to list sibling files
// No need for freshvideo special case — prefix resolution already maps
// freshvideo:channel → files:video/news/channel, so path-based parent = video/news
```

Owns: filesystem path-based navigation.

### 5. Slimmed Router (unchanged from v1)

```js
export function createSiblingsRouter({ siblingsService }) {
  const router = express.Router();
  const handler = asyncHandler(async (req, res) => {
    const { source, localId } = parseActionRouteId({ ... });
    const result = await siblingsService.resolveSiblings(source, localId);
    if (result.error) return res.status(result.status || 404).json({ error: result.error });
    res.json(result);
  });
  router.get('/:source/*', handler);
  router.get('/:source', handler);
  return router;
}
```

### 6. Bootstrap Wiring

```js
const siblingsService = new SiblingsService({ registry, logger });
siblings: createSiblingsRouter({ siblingsService, logger }),
```

---

## Migration Strategy

1. **Add `resolveSiblings()` to LocalContentAdapter, ListAdapter, FileAdapter** — each adapter owns its special-case logic. Return `null` for cases where the default fallback should apply.
2. **Rewrite `SiblingsService`** as thin delegator: resolve adapter → delegate to `adapter.resolveSiblings` or default → normalize response.
3. **Keep slimmed router** — already done, delegates to SiblingsService.
4. **Wire in bootstrap** — already done.
5. **Update tests** — verify behavior unchanged.

---

## What Lives Where

| Concern | Location | Rationale |
|---------|----------|-----------|
| Scripture volumes, collection names | LocalContentAdapter | Adapter knows its own content structure |
| List prefix patterns (menu, program, ...) | ListAdapter | Adapter knows its own list types |
| Freshvideo → video/news mapping | FileAdapter prefix | Already handled by prefix `idTransform` |
| Path-based parent resolution | FileAdapter.resolveSiblings | Adapter knows filesystem navigation |
| Metadata-based parent (parentRatingKey) | SiblingsService default | Generic pattern used by Plex, ABS, etc. |
| Response DTO mapping | SiblingsService | API response shape normalization |
| HTTP parsing + status codes | Router | HTTP translation only |

---

## Risk Assessment

- **Low risk** — Same output shape, same algorithms per adapter.
- **No API contract changes** — Response JSON identical.
- **Adapter `resolveSiblings` is optional** — existing adapters without it use the default. Only 3 adapters get the new method.
- **Return `null` escape hatch** — If an adapter's `resolveSiblings` returns `null`, the service falls back to default. This avoids forcing adapters to handle every case.

---

## Success Criteria

- [ ] `siblings.mjs` router passes the "Thin Layer Test" — no business logic
- [ ] `SiblingsService` has zero source-specific branching (no `if adapter.source === 'xxx'`)
- [ ] Each adapter's domain knowledge lives in that adapter's `resolveSiblings()`
- [ ] Adapters without `resolveSiblings` still work via default fallback
- [ ] All existing siblings tests pass unchanged
- [ ] Bootstrap wiring uses constructor injection
- [ ] No layer-violation imports
