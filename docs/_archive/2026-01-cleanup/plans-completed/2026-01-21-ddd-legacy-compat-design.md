# DDD-Legacy Response Compatibility Design

**Date:** 2026-01-21
**Status:** In Progress
**Goal:** Make DDD API responses compatible with frontend during cutover

---

## Problem

The DDD `/api/v1/list/folder/{key}` endpoint returns a different response structure than legacy `/data/list/{key}`. The frontend spreads `item.play` into queue items, so the `play` field must exist with the correct structure.

### Legacy Response (what frontend expects)
```json
{
  "media_key": "FHE",
  "label": "FHE",
  "items": [{
    "label": "Felix",
    "uid": "75cdcd12-...",
    "folder": "FHE",
    "folder_color": "#9FA5C2",
    "image": "/media/img/lists/...",
    "play": { "plex": "457381" }
  }]
}
```

### DDD Response (current)
```json
{
  "source": "folder",
  "path": "FHE",
  "title": "FHE",
  "label": "FHE",
  "items": [{
    "id": "plex:457381",
    "title": "Felix",
    "label": "Felix",
    "plex": "457381",
    "src": "plex",
    "uid": "75cdcd12-..."
  }]
}
```

### Key Differences

| Field | Legacy | DDD | Frontend Usage |
|-------|--------|-----|----------------|
| `media_key` | ✓ | ✗ | Menu logging |
| `play` | ✓ `{plex:"457381"}` | ✗ | **Critical**: spread into queue items |
| `folder` | ✓ | ✗ | Display only |
| `folder_color` | ✓ | ✗ | Display only |
| `id` | ✗ | ✓ | Not used by legacy code |
| `src` | ✗ | ✓ | DDD internal |

---

## Approach

**Modify at adapter level** - FolderAdapter builds the `play` object from `src` and `media_key` fields. This keeps data flowing correctly from source.

### Changes Required

1. **FolderAdapter.mjs** - Build `actions.play` object from item source data
2. **list.mjs toListItem()** - Already handles `item.actions.play`, no change needed
3. **Top-level response** - Add `media_key` field

---

## Implementation

### 1. FolderAdapter Changes

Location: `backend/src/2_adapters/content/folder/FolderAdapter.mjs`

In the item transformation, build the `play` object:

```javascript
// Build play action from source type
const playAction = {};
if (item.play) {
  // Raw YAML already has play object - use it
  Object.assign(playAction, item.play);
} else if (src && media_key) {
  // Build from src/media_key
  playAction[src] = media_key;
}

return {
  // ... existing fields ...
  actions: {
    play: Object.keys(playAction).length > 0 ? playAction : undefined
  }
};
```

### 2. Top-Level Response

In list router, add `media_key` to folder response:

```javascript
return {
  media_key: key,  // Add for legacy compat
  source: 'folder',
  // ... rest
};
```

### 3. Item-Level Legacy Fields

Add to FolderAdapter item response:
- `folder`: folder key (for display)
- `folder_color`: from folder config if available

---

## Testing

After changes, verify with parity tests:

```bash
npm run parity:live --type=list --verbose
```

Expected: `play` field matches between legacy and DDD.

---

## Post-Cutover Schema Changes

Document in separate file: `docs/plans/2026-01-21-post-cutover-schema.md`

After frontend is updated, these changes can be made:
1. Remove `play` object in favor of `src`/`media_key`
2. Remove `folder`, `folder_color` display fields
3. Standardize on `id` instead of `uid`
4. Remove flattened metadata fields

---

## Files to Modify

1. `backend/src/2_adapters/content/folder/FolderAdapter.mjs`
2. `backend/src/4_api/routers/list.mjs` (minor - add media_key to response)
3. `tests/fixtures/parity-baselines/endpoint-map.yml` (already fixed)
