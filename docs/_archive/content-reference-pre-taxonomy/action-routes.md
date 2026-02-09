# Action Routes Reference

> Intent-driven API routes that map directly to query-combinatorics actions.

**Status:** Frontend migration complete (2026-02-06). All action routes live. `/item/` deprecated. All frontend calls migrated to `/list/`, `/info/`, `/play/`, `/display/`.

---

## Design Principles

1. **Intent-driven, not resource-driven** - Routes express what the client wants to do, not what the thing is
2. **Maps to query-combinatorics** - URL structure mirrors query syntax (`play=plex:12345` → `/play/plex/12345`)
3. **Capability validation at backend** - Returns 400 if action doesn't match capability
4. **Uniform caching semantics** - Each action route has consistent cache behavior
5. **Self-documenting** - No modifiers needed; action is the route

---

## Route Structure

### Action Routes

| Action | Capability | Route | Returns |
|--------|------------|-------|---------|
| `play` | playable | `/api/v1/play/:source?/:id` | mediaUrl, resumePosition, duration |
| `display` | displayable | `/api/v1/display/:source?/:id` | image (redirect or stream) |
| `list` | listable | `/api/v1/list/:source?/:id` | children array with action objects |
| `read` | readable | `/api/v1/read/:source?/:id` | reader content, format info |
| `info` | (none) | `/api/v1/info/:source?/:id` | metadata, capabilities[] |

### ID Resolution (All Routes)

All action routes support three ID formats with equivalent behavior:

| Format | Example | Resolution |
|--------|---------|------------|
| Explicit path | `/play/plex/12345` | source=plex, id=12345 |
| Compound ID | `/play/plex:12345` | parsed from compound |
| Heuristic | `/play/12345` | digits→plex, UUID→immich, path→filesystem |

```
/api/v1/play/plex/12345      ≡  /api/v1/play/plex:12345  ≡  /api/v1/play/12345
```

### Query Operations (under /content/)

Operations that span sources or don't target a single item:

| Route | Purpose |
|-------|---------|
| `/api/v1/content/search` | Federated search across sources |
| `/api/v1/content/progress` | Log playback progress (POST) |
| `/api/v1/content/containers` | List containers by type |

---

## Route Details

### GET /api/v1/play/:source?/:id

Returns playable media information with resume position.

**Response:**
```json
{
  "id": "plex:12345",
  "mediaUrl": "/api/v1/proxy/plex/...",
  "mediaType": "video",
  "format": "video",
  "duration": 1800,
  "resumable": true,
  "resumePosition": 542,
  "resumePercent": 30,
  "title": "Episode Title",
  "thumbnail": "/api/v1/display/plex/12345"
}
```

The `format` field tells the frontend which renderer to use. Possible values:

| Format | Frontend Renderer | Content Type |
|--------|------------------|--------------|
| `video` | VideoPlayer | Plex video, media files |
| `audio` | AudioPlayer | Audio-only media |
| `dash_video` | VideoPlayer (DASH) | Plex transcoded video |
| `singalong` | SingalongScroller | Hymns, primary songs |
| `readalong` | ReadalongScroller | Scripture, talks, poetry |
| `app` | PlayableAppShell | Interactive apps (webcam, gratitude) |
| `readable_paged` | PagedReader (stub) | Comics, manga |
| `readable_flow` | FlowReader (stub) | Ebooks |

The format is determined by `resolveFormat()` (`backend/src/4_api/v1/utils/resolveFormat.mjs`) which checks: adapter `contentFormat` property, item `mediaType`, and source-specific heuristics.
```

**Errors:**
- 400: Item is not playable (e.g., `read` capability only)
- 404: Item not found
- 503: Source adapter not configured

### GET /api/v1/display/:source?/:id

Returns or redirects to displayable image.

**Behavior:**
- For thumbnails: redirects to cached/proxied image
- For photos: streams image with appropriate content-type
- For items with only thumbnail (not primary displayable): returns thumbnail

**Cache:** Aggressive caching (images are static)

**Errors:**
- 400: Item has no displayable representation
- 404: Item not found

### GET /api/v1/list/:source?/:id

Returns children of a container with action objects.

**Response:**
```json
{
  "id": "plex:672445",
  "type": "show",
  "title": "Show Name",
  "items": [
    {
      "id": "plex:12345",
      "title": "Episode 1",
      "type": "episode",
      "capabilities": ["playable", "displayable"],
      "play": "/api/v1/play/plex/12345",
      "display": "/api/v1/display/plex/12345"
    }
  ],
  "total": 24
}
```

**Errors:**
- 400: Item is not listable (leaf item)
- 404: Item not found

### GET /api/v1/read/:source?/:id

Returns readable content for ebooks, comics, etc.

**Response:**
```json
{
  "id": "komga:comic-123",
  "format": "cbz",
  "contentUrl": "/api/v1/proxy/komga/...",
  "pageCount": 24,
  "currentPage": 5,
  "title": "Comic Title"
}
```

**Errors:**
- 400: Item is not readable
- 404: Item not found

### GET /api/v1/info/:source?/:id

Returns metadata without assuming intent. Use when you need to inspect capabilities before acting.

**Response:**
```json
{
  "id": "plex:12345",
  "source": "plex",
  "type": "episode",
  "title": "Episode Title",
  "capabilities": ["playable", "displayable"],
  "metadata": {
    "duration": 1800,
    "grandparentTitle": "Show Name",
    "parentTitle": "Season 1"
  }
}
```

---

## Heuristic Resolution

When source is omitted, the ID format determines the source:

| Pattern | Detected Source | Example |
|---------|-----------------|---------|
| Digits only | plex | `12345` → `plex:12345` |
| UUID format | immich | `abc-def-123` → `immich:abc-def-123` |
| Path with extension | filesystem | `audio/song.mp3` → `filesystem:audio/song.mp3` |
| Path without extension | folder | `watchlist/FHE` → `folder:watchlist/FHE` |
| Compound ID | parsed | `plex:12345` → source=plex, id=12345 |

---

## Capability Mismatches

When action doesn't match capability:

| Request | Item Capability | Response |
|---------|-----------------|----------|
| `GET /play/komga:comic` | readable | 400: "komga:comic is readable, not playable. Use /read/" |
| `GET /read/plex:12345` | playable | 400: "plex:12345 is playable, not readable. Use /play/" |
| `GET /list/plex:12345` | playable (leaf) | 400: "plex:12345 is not listable (leaf item)" |

---

## Migration from Legacy Routes

| Legacy Route | New Route | Notes |
|--------------|-----------|-------|
| `/api/v1/content/:source/image/:id` | `/api/v1/display/:source/:id` | 301 redirect active |
| `/api/v1/content/:source/info/:id` | `/api/v1/info/:source/:id` | 301 redirect active |
| `/api/v1/content/item/:source/*` | `/api/v1/info/:source/:id` | |
| `/api/v1/item/:source/:id` | `/api/v1/info/:source/:id` | For metadata only |
| `/api/v1/item/:source/:id/playable` | `/api/v1/list/:source/:id/playable` | Path modifier, NOT query param |
| `/api/v1/item/:source/:id/shuffle` | `/api/v1/list/:source/:id/shuffle` | Path modifier, NOT query param |
| `/api/v1/play/:source/mpd/:id` | `/api/v1/play/:source/:id` | |

> **IMPORTANT:** Modifiers like `playable` and `shuffle` are **path segments**, not query
> params. `/list/plex/123/playable` works. `/list/plex/123?playable=true` does NOT.
> The `/info/` route does not handle modifiers -- use `/list/` for filtered/shuffled results.

---

## Caching Strategy

| Route | Cache Behavior | Rationale |
|-------|----------------|-----------|
| `/display/*` | Aggressive (1 day+) | Images are static |
| `/info/*` | Short TTL (5 min) | Metadata changes infrequently |
| `/list/*` | Short TTL (5 min) | Children change infrequently |
| `/play/*` | No cache | Resume position must be fresh |
| `/read/*` | No cache | Reading position must be fresh |

---

## Siblings and Queue Routes

These routes complement the action routes but serve distinct use cases.

### GET /api/v1/siblings/:source/:localId

Returns peer items within the same parent container. Used by admin UIs for content selection ("show me what else is in this folder/collection/season").

**Architecture:** The router delegates to `SiblingsService`, which delegates to the adapter's `resolveSiblings()`. Each adapter implements its own strategy (path-based, metadata-based, collection-based). Zero domain knowledge in the application layer.

**Response:**
```json
{
  "parent": {
    "id": "plex:662028",
    "title": "Season 1",
    "source": "plex",
    "thumbnail": "/api/v1/proxy/plex/photo/..."
  },
  "items": [
    {
      "id": "plex:12345",
      "title": "Episode 1",
      "source": "plex",
      "type": "episode",
      "isContainer": false
    }
  ]
}
```

**Errors:**
- 404: Unknown source or item not found
- 500: Adapter error

**Cache:** Short TTL (5 min) — siblings change infrequently.

### GET /api/v1/queue/:source/:localId

Flattens containers into playable items for playback. This is the "Play All" endpoint.

**Distinct from `/list`:** The queue endpoint applies watch state filtering, schedule checks, and returns queue-shaped items (no navigation actions). See behavioral comparison below.

**Query Parameters:**

| Param | Type | Default | Effect |
|-------|------|---------|--------|
| `shuffle` | boolean | false | Fisher-Yates shuffle on resolved items |
| `limit` | number | — | Cap queue to first N items |

**Response:**
```json
{
  "source": "watchlist",
  "id": "watchlist:cfm2025",
  "count": 5,
  "totalDuration": 3420,
  "items": [
    {
      "id": "plex:12345",
      "title": "Episode Title",
      "source": "plex",
      "mediaUrl": "/api/v1/proxy/plex/video/...",
      "mediaType": "video",
      "duration": 1800,
      "resumePosition": 542,
      "thumbnail": "/api/v1/proxy/plex/photo/..."
    }
  ]
}
```

**Errors:**
- 400: Source does not support queue resolution
- 404: Unknown source

**Cache:** No cache — watch state must be fresh.

**Deprecation:** `GET /api/content/playables/:source/*` redirects to `/api/v1/queue` with `Deprecation` headers.

### List vs Queue: Behavioral Differences

| Dimension | `/list` (getList) | `/queue` (resolvePlayables) |
|-----------|-------------------|---------|
| **Depth** | 1 level (direct children) | Recursive (flattens through containers) |
| **Item types** | Mixed: containers, leaves, openers | Playables only — no containers |
| **Watch state** | None — shows all items | Filters watched (≥90%), held, past skipAfter, future waitUntil |
| **Sorting** | Preserves source order | Priority: `in_progress` > `urgent` > `high` > `medium` > `low` |
| **Schedule** | None | Programs: day-of-week matching |
| **Item shape** | Rich: `toListItem()` with actions, thumbnails, parents | Bare: queue-shaped (mediaUrl, duration, resume) |
| **Modifiers** | `?playable`, `?shuffle`, `?recent_on_top` | `?shuffle`, `?limit` |

---

## Related Documents

- [Query Combinatorics](./query-combinatorics.md) - Full query syntax reference
- [Content Stack Reference](./content-stack-reference.md) - Architecture overview
