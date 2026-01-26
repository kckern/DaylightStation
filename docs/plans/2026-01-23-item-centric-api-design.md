# Item-Centric API Design

## Overview

Migrate from split `/content/*` + `/list/*` structure to unified `/item/:source/:localId` pattern.

## URL Structure

### Item Endpoints (with localId)
```
/item/:source/:localId           → if playable: item with media_url
                                 → if container: parent + children inline
/item/:source/:localId/playable  → resolve container to playable items
/item/:source/:localId/random    → single random playable from container
/item/:source/:localId/single    → first playable from container (no shuffle)
/item/:source/:localId/children  → (optional) explicit children request
```

### Collection Endpoints (no localId)
```
/item/:source                    → if parent: list subsources
                                 → if subsource: list collection items
/item/:source/playable           → all playables from collection
/item/:source/random             → single random playable from collection
/item/:source/single             → first playable from collection
/item/:source/children           → (optional) explicit children request
```

**Key simplifications:**
- Containers return children inline at bare ID
- `/random` and `/single` provide direct playback without loading full playlist

## Source Taxonomy

Sources are organized hierarchically. Subsources must know their parent for path resolution.

### Direct Sources (no parent)
| Source | LocalId Format | Examples |
|--------|----------------|----------|
| `plex` | rating key | `545064`, `663508` |
| `folder` | folder name | `FHE`, `TVApp`, `TV` |
| `queue` | queue name | `Music%20Queue` |
| `filesystem` | path | `videos/vacation` |
| `scripture` | volume/version/verse | `bom/sebom/31103` |
| `poem` | collection/id | `remedy/01` |

### Hierarchical Sources

#### song (parent) → hymn, primary (subsources)
```
/item/song              → list subsources: [{id: "hymn", title: "Hymns"}, {id: "primary", title: "Primary Songs"}]
/item/song/hymn         → list all hymns
/item/song/hymn/1       → hymn #1 (with media_url)
/item/hymn              → shortcut to /item/song/hymn
/item/hymn/1            → shortcut to /item/song/hymn/1
```

#### talk (parent) → {folder} (dynamic subsources)
```
/item/talk              → list talk folders: [{id: "ldsgc202510", title: "Oct 2025 General Conference"}, ...]
/item/talk/ldsgc202510  → list talks in folder
/item/talk/ldsgc202510/eyring-1 → specific talk (with media_url)
```

### Subsource Registry
Subsources know their parent for path resolution:

| Subsource | Parent | Storage Path |
|-----------|--------|--------------|
| `hymn` | `song` | `songs/hymn/` |
| `primary` | `song` | `songs/primary/` |

Dynamic subsources (talk folders) are resolved at runtime by listing the `talks/` directory.

## Response Schemas

### Playable Item (leaf with media)
Request: `GET /item/hymn/2`
```json
{
  "id": "hymn:2",
  "source": "local-content",
  "localId": "2",
  "title": "The Spirit of God",
  "type": "hymn",
  "itemType": "leaf",
  "media_url": "/proxy/local-content/stream/hymn/2",
  "duration": 185,
  "thumbnail": "..."
}
```

### Container (returns children inline)
Request: `GET /item/plex/545064`
```json
{
  "parent": {
    "id": "plex:545064",
    "source": "plex",
    "localId": "545064",
    "title": "이루마",
    "type": "artist",
    "itemType": "container"
  },
  "items": [
    { "id": "plex:545276", "localId": "545276", "title": "Atmosfera", "itemType": "container" },
    { "id": "plex:545125", "localId": "545125", "title": "기억에 머무르다", "itemType": "container" }
  ]
}
```

### Playable Response
```json
{
  "parent": { "id": "plex:545064", "title": "이루마" },
  "items": [
    { "id": "plex:545189", "title": "River Flows in You", "media_url": "..." },
    { "id": "plex:545190", "title": "Kiss the Rain", "media_url": "..." }
  ],
  "shuffle": false,
  "first": null
}
```

## Query Parameters

| Param | Endpoint | Purpose |
|-------|----------|---------|
| `shuffle` | `/playable` | Randomize order |
| `first` | `/playable` | Return only first item |
| `limit` | `/children`, `/playable` | Limit results |
| `continuous` | `/playable` | Mark for continuous play |

## Frontend Action Mapping

```javascript
// play: {plex: 545064, shuffle: true}
GET /api/v1/item/plex/545064/playable?first=true&shuffle=true
// Returns single playable item with media_url

// queue: {plex: 545064, shuffle: true}
GET /api/v1/item/plex/545064/playable?shuffle=true
// Returns all playable items for queue

// list: {plex: 545064}
GET /api/v1/item/plex/545064/children
// Returns children for submenu

// list: {folder: "FHE"}
GET /api/v1/item/folder/FHE/children
// Returns folder items for submenu

// play: {hymn: 2}
GET /api/v1/item/hymn/2
// Returns item with media_url (leaf node)

// play: {scripture: "dc88"}
GET /api/v1/item/scripture/dc88
// Returns item with media_url

// queue: {queue: "Music Queue", shuffle: true}
GET /api/v1/item/queue/Music%20Queue/playable?shuffle=true
// Returns queue items
```

## Migration Path

### Phase 1: Create New Router
- Create `/api/v1/item` router
- Implement unified dispatch to adapters
- All adapters implement: `getItem()`, `getChildren()`, `getPlayables()`

### Phase 2: Adapter Alignment
- Ensure all adapters return consistent Item schema
- Add `localId` to all Item entities (done)
- Standardize `itemType`: "container" | "leaf"

### Phase 3: Frontend Migration
- Update API client to use new endpoints
- Map action objects to new URL patterns
- Deprecation warnings on old endpoints

### Phase 4: Cleanup
- Remove `/content/*` router
- Remove `/list/*` router
- Update tests

## Files to Create/Modify

### New Files
- `backend/src/4_api/routers/item.mjs` - unified item router

### Modified Files
- `backend/src/4_api/routers/apiV1.mjs` - mount new router
- `backend/src/2_adapters/content/*/` - ensure consistent interface
- `frontend/src/*/` - update API calls

### Deprecated (Phase 4)
- `backend/src/4_api/routers/content.mjs`
- `backend/src/4_api/routers/list.mjs`

## Open Questions

1. Should `/item/:source/:localId` return children inline for small containers?
2. Thumbnail URLs: `/item/:source/:localId/thumb` or keep `/proxy/*`?
3. Streaming URLs: `/item/:source/:localId/stream` or keep `/proxy/*`?
