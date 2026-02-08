# 2026-02-07 — Siblings Abstraction Failure Audit

## Problem Summary

The frontend `doFetchSiblings` function (and its duplicate in `ContentSearchCombobox.loadSiblings`) contains ~150 lines of **source-routing logic that belongs in the backend**. The frontend has hardcoded knowledge of:

- Which sources are "local content collections" (`scripture`, `hymn`, `primary`, `talk`, `poem`)
- Which scripture IDs are volume-level containers (`ot`, `nt`, `bom`, `dc`, `pgp`)
- How Plex parent keys work (`parentRatingKey`, `parentKey`, `parentId`, `albumId`, `artistId`)
- Which sources use library sections vs. parent containers
- That `freshvideo` siblings live at `files:video/news`
- That `list` source normalizes to `menu`
- That `talk` maps to `local-content` with a specific URL shape
- That `hymn`/`primary` map to `singalong` category and `scripture` to `readalong`

This is a classic **abstraction leak** — the frontend is reimplementing backend domain logic to assemble what should be a single API call.

## Affected Files

| File | Lines | Issue |
|---|---|---|
| `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` | L26-35, L103-260, L1190-1400 | `ADAPTER_TO_CATEGORY`, `LOCAL_CONTENT_COLLECTIONS`, `SCRIPTURE_VOLUMES`, `doFetchSiblings()`, inline `fetchSiblings()` |
| `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx` | L61-66, L151-205 | Duplicate `LOCAL_CONTENT_COLLECTIONS`, `SCRIPTURE_VOLUMES`, `loadSiblings()` |
| `frontend/src/modules/Admin/ContentLists/siblingsCache.js` | All | Caching layer for multi-request siblings fetching |

## Current Flow (What `doFetchSiblings` Does)

```
Frontend receives item ID (e.g., "hymn:113")
  │
  ├─ Is source in LOCAL_CONTENT_COLLECTIONS?
  │    ├─ Is it scripture?
  │    │    ├─ Is localId a SCRIPTURE_VOLUME? → fetch /local-content/collection/scripture
  │    │    └─ No → fall through to info-based fetch
  │    └─ Not scripture → fetch /local-content/collection/{source}
  │
  ├─ Else → fetch /info/{source}/{localId}
  │    │
  │    ├─ Has metadata.parentRatingKey? → fetch /list/{source}/{parentKey}
  │    │    └─ Also fetch /info/{source}/{parentKey} for parent title
  │    │
  │    ├─ Has metadata.librarySectionID? → fetch /list/{source}/library/sections/{id}/all
  │    │
  │    ├─ Is watchlist/query/menu/program? → fetch /list/{source}/
  │    │
  │    ├─ Is freshvideo? → fetch /list/files/video/news
  │    │
  │    ├─ Is talk/local-content? → fetch /list/local-content/talk:
  │    │
  │    └─ Has slash in localId? → parse parent path, fetch /list/{source}/{parentPath}
  │
  └─ Map children to browseItems, return { browseItems, currentParent }
```

**This is 2–3 sequential HTTP requests** (`info` → parent `info` → `list`) that the frontend orchestrates, with domain-specific branching at every step.

## Duplication

The logic is **duplicated across 3 locations**:

1. **`doFetchSiblings()`** — standalone function at module scope (used by `preloadSiblings`)
2. **`fetchSiblings()`** — inline in `ListsItemRow` component (nearly identical copy, ~L1190-1400)
3. **`loadSiblings()`** — in `ContentSearchCombobox` (simplified copy, ~L151-205)

Each copy has the same `LOCAL_CONTENT_COLLECTIONS` / `SCRIPTURE_VOLUMES` checks and the same multi-step fetch chain.

## Proposed Solution: Backend `/api/v1/siblings/:source/:localId`

### New Endpoint

```
GET /api/v1/siblings/{source}/{localId}
```

**Response shape:**

```json
{
  "parent": {
    "id": "plex:12345",
    "title": "Season 3",
    "source": "plex",
    "thumbnail": "/api/v1/proxy/plex/photo/...",
    "parentId": "plex:6789",
    "libraryId": "1"
  },
  "items": [
    {
      "id": "plex:111",
      "title": "Episode 1",
      "source": "plex",
      "type": "episode",
      "thumbnail": "...",
      "parentTitle": "Season 3",
      "grandparentTitle": "Show Name",
      "libraryTitle": "TV Shows",
      "isContainer": false,
      "childCount": null
    }
  ]
}
```

### Backend Implementation Strategy

Each adapter already has the building blocks:

| Source | Parent Resolution | Siblings |
|---|---|---|
| **Plex** | `item.metadata.parentRatingKey` → `adapter.getItem(parentKey)` | `adapter.getList(parentKey)` |
| **hymn/primary** | Implicit — collection is parent | `adapter.listCollection('hymn')` |
| **scripture** | Volume name from ID path | `adapter.listCollection('scripture')` or `adapter.getList('scripture:volume')` |
| **talk** | Conference folder from localId path | `adapter.getList('talk:folderId')` |
| **poem** | Collection folder from localId path | `adapter.listCollection('poem')` |
| **freshvideo** | Implicit — `video/news` is parent | `filesAdapter.getList('video/news')` |
| **watchlist/query/menu** | Implicit — type is parent | `adapter.getList(type + ':')` |
| **path-based** (media) | Parent directory from path | `adapter.getList(parentPath)` |

### Adapter Interface Addition

```javascript
// On ContentAdapter base or per-adapter:
async getSiblings(compoundId) {
  // Default: resolve parent from item metadata, then list parent's children
  const item = await this.getItem(compoundId);
  if (!item) return null;

  const parentId = this._resolveParentId(item);
  if (!parentId) return null;

  const parentItem = await this.getItem(parentId);
  const siblings = await this.getList(parentId);

  return {
    parent: parentItem ? { id: parentItem.id, title: parentItem.title, ... } : null,
    items: siblings?.children || siblings || []
  };
}
```

For `LocalContentAdapter`, `_resolveParentId` would:
- For `hymn:113` → return `hymn:` (collection root)
- For `talk:ldsgc202510/13` → return `talk:ldsgc202510` (conference folder)
- For `scripture:bom/sebom/31103` → return `scripture:bom` (volume)
- For `poem:remedy/01` → return `poem:remedy` (collection)

For `PlexAdapter`, `_resolveParentId` would:
- Read `item.metadata.parentRatingKey` and return `plex:{parentKey}`

### Frontend Simplification

After the backend endpoint exists, `doFetchSiblings` becomes:

```javascript
async function doFetchSiblings(itemId, contentInfo) {
  const source = contentInfo.source;
  const localId = itemId.split(':')[1]?.trim();

  const response = await fetch(`/api/v1/siblings/${source}/${localId}`);
  if (!response.ok) return null;

  const data = await response.json();
  return {
    browseItems: data.items.map(item => ({
      value: item.id,
      title: item.title,
      source: item.source,
      type: item.type,
      thumbnail: item.thumbnail,
      grandparent: item.grandparentTitle,
      parent: item.parentTitle,
      library: item.libraryTitle,
      itemCount: item.childCount,
      isContainer: item.isContainer || false
    })),
    currentParent: data.parent ? {
      id: data.parent.id,
      title: data.parent.title,
      source: data.parent.source,
      thumbnail: data.parent.thumbnail,
      parentKey: data.parent.parentId,
      libraryId: data.parent.libraryId
    } : null
  };
}
```

~10 lines replacing ~150 lines + eliminates all domain constants from the frontend.

## Constants to Remove from Frontend

After migration, these can be deleted from both `ListsItemRow.jsx` and `ContentSearchCombobox.jsx`:

- `LOCAL_CONTENT_COLLECTIONS` — scripture/hymn/primary/talk/poem membership
- `SCRIPTURE_VOLUMES` — ot/nt/bom/dc/pgp membership  
- `ADAPTER_TO_CATEGORY` — hymn→singalong, primary→singalong, scripture→readalong mapping
- `normalizeListSource()` — list→menu mapping (backend should handle)
- All the `isScriptureVolume` branching logic

## Migration Plan

### Phase 1: Add Backend Endpoint (non-breaking)

1. Add `getSiblings(id)` method to adapter interface (with default implementation)
2. Override in `LocalContentAdapter` with collection-aware parent resolution
3. Override in `PlexAdapter` with parentRatingKey-based resolution
4. Create `/api/v1/siblings/:source/*` router
5. Test with existing item types

### Phase 2: Migrate Frontend Callers

1. Replace `doFetchSiblings()` with single-fetch version
2. Replace inline `fetchSiblings()` in ListsItemRow
3. Replace `loadSiblings()` in ContentSearchCombobox
4. Remove `LOCAL_CONTENT_COLLECTIONS`, `SCRIPTURE_VOLUMES`, `ADAPTER_TO_CATEGORY` constants
5. Simplify `siblingsCache.js` (single request = simpler caching)

### Phase 3: Cleanup

1. Remove `normalizeListSource()` from frontend
2. Remove `toCanonicalContentId()` if no longer needed
3. Update tests

## Impact Assessment

- **Risk**: Low. New endpoint is additive; frontend migration can be incremental.
- **Performance**: Better — one backend round-trip instead of 2-3 sequential frontend fetches.
- **Maintainability**: Significantly improved — adding a new content source no longer requires frontend changes for sibling browsing.
- **DRY**: Eliminates 3 copies of the same routing logic.

## Related Code

- Backend: `backend/src/4_api/v1/routers/info.mjs`, `backend/src/4_api/v1/routers/list.mjs`, `backend/src/4_api/v1/routers/localContent.mjs`
- Backend: `backend/src/1_adapters/content/local-content/LocalContentAdapter.mjs`
- Backend: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`
- Frontend: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`
- Frontend: `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx`
- Frontend: `frontend/src/modules/Admin/ContentLists/siblingsCache.js`
