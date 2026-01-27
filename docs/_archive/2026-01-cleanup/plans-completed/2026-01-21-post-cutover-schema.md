# Post-Cutover API Schema Changes

**Date:** 2026-01-21
**Status:** Planned (after cutover complete)
**Prerequisites:** Frontend fully migrated to DDD endpoints

---

## Overview

This document tracks recommended API schema improvements to implement **after** the legacy-to-DDD cutover is complete and the frontend has been updated to use the new endpoints.

These changes were deferred to avoid breaking the frontend during cutover.

---

## List API (`/api/v1/list/folder/{key}`)

### Current (Legacy-Compatible)

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
    "play": { "plex": "457381" },
    "plex": "457381",
    "src": "plex",
    "media_key": "457381",
    "percent": 0,
    "seconds": 0,
    "priority": "medium",
    "hold": false,
    "program": "FHE"
  }]
}
```

### Recommended (Post-Cutover)

```json
{
  "id": "folder:FHE",
  "title": "FHE",
  "items": [{
    "id": "plex:457381",
    "title": "Felix",
    "thumbnail": "/media/img/lists/...",
    "source": "plex",
    "sourceId": "457381",
    "watchState": {
      "percent": 0,
      "seconds": 0
    },
    "scheduling": {
      "priority": "medium",
      "hold": false
    }
  }]
}
```

### Changes

| Change | Rationale |
|--------|-----------|
| Remove `play` object | Frontend should use `source`/`sourceId` directly |
| Remove `media_key` (top-level) | Use `id` instead |
| Remove `folder`, `folder_color` | Display metadata belongs in UI layer |
| Remove `uid` | Standardize on `id` |
| Nest `watchState` | Group related watch progress fields |
| Nest `scheduling` | Group priority/hold/wait fields |
| Remove flattened metadata | Keep in `metadata` object only |

---

## Frontend Migration Steps

1. Update `useQueueController.js` to build queue items from `source`/`sourceId` instead of spreading `item.play`
2. Update `flattenQueueItems()` in `api.js` to handle new structure
3. Update `Menu.jsx` selection logging to use `id` instead of `media_key`
4. Update any code checking `item.play.plex`, `item.play.hymn` etc.

---

## Content API (`/api/v1/content/plex/{id}`)

### Current (Legacy-Compatible)

Response mirrors legacy `/media/plex/info/{id}` structure.

### Recommended (Post-Cutover)

```json
{
  "id": "plex:457381",
  "title": "Felix",
  "type": "episode",
  "source": "plex",
  "media": {
    "url": "/plex_proxy/video/...",
    "type": "dash_video",
    "duration": 1800
  },
  "metadata": {
    "show": "Kids Shows",
    "season": "Season 1",
    "episode": 5
  },
  "thumbnail": "/plex_proxy/library/metadata/457381/thumb/..."
}
```

### Changes

| Change | Rationale |
|--------|-----------|
| Nest media properties | Group URL, type, duration |
| Standardize `id` format | `{source}:{sourceId}` pattern |
| Remove `listkey`, `key` | Redundant with `id` |
| Simplify metadata | Only essential display fields |

---

## Local Content API (`/api/v1/local-content/{type}/{path}`)

### Current

Each type (scripture, hymn, talk, poem, media) has slightly different response shapes inherited from legacy.

### Recommended (Post-Cutover)

Standardize all local content responses:

```json
{
  "id": "hymn:304",
  "title": "Hymn 304",
  "type": "hymn",
  "content": {
    "text": "...",
    "audio_url": "/media/hymns/304.mp3"
  },
  "metadata": {
    "author": "...",
    "year": "..."
  }
}
```

---

## Implementation Timeline

| Phase | Tasks |
|-------|-------|
| **Cutover** | DDD matches legacy exactly |
| **Post-Cutover Week 1** | Update frontend to not depend on `play` object |
| **Post-Cutover Week 2** | Update frontend to use `id` instead of `uid`/`media_key` |
| **Post-Cutover Week 3** | Remove legacy compat fields from DDD |
| **Post-Cutover Week 4** | Nest grouped fields (watchState, scheduling) |

---

## Related

- `docs/plans/2026-01-21-ddd-legacy-compat-design.md` - Current compatibility work
- `tests/fixtures/parity-baselines/` - Parity test baselines
- `docs/runbooks/parity-testing.md` - How to run parity tests
