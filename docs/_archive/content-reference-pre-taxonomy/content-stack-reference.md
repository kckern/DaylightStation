# Content Stack Reference

This document defines the content stack: API topology, ID resolution, search system, adapters, configuration, and response formats for interacting with content across multiple sources in DaylightStation.

For domain model concepts (entities, value objects, domain services), see the actual implementation in `backend/src/2_domains/content/`.

**Scope:** Content stack only (media, gallery, audiobooks, ebooks). Other stacks (AI, finance, home automation) share the category/provider model but are documented separately.

---

## 1. Core Concepts

The content system has five key concepts:

| Dimension | Description | Examples | Implementation |
|-----------|-------------|----------|----------------|
| **Category** | Domain grouping declared in household config | `media`, `gallery`, `audiobooks`, `ebooks` | `integrations.yml` entries: `media: [{provider: plex}]` |
| **Provider** | Software/service hosting content | `plex`, `immich`, `audiobookshelf`, `komga` | `services.yml` URLs per environment: `plex: {docker: http://plex:32400}` |
| **Source** | Runtime adapter name (provider + optional instance) | `plex`, `immich`, `immich-family`, `folder`, `canvas` | `ContentSourceRegistry.register(adapter, {category, provider})` |
| **Capability** | What you can do with an **item** (not source-level) | `playable`, `displayable`, `readable`, `listable` | Item classes: `PlayableItem`, `DisplayableItem`, `ListableItem` |
| **Shape** | Response structure | `item`, `list`, `asset` | `/item/:source/*` → single, `/list` → array, `/proxy/*` → binary |

### Key Distinctions

- **Category** is a household-level declaration grouping providers by purpose
- **Provider** is the software (Plex, Immich) - connection URLs defined in `services.yml`
- **Source** is the runtime adapter registered in `ContentSourceRegistry`
- **Capability** is per-item, not per-source (Immich photos are displayable, Immich videos are playable)

### Special Sources

| Source | Notes | Reference |
|--------|-------|-----------|
| `folder` | Bridges YAML data files and filesystem. Provides content, config, and menus. | |
| `local` | Alias for `watchlist` (resolved by ContentIdResolver). See [ContentIdResolver](./content-id-resolver.md). | |
| `list` | Exposes menus/programs/watchlists as content. Prefixes: `menu:`, `program:`, `watchlist:` (alias: `list:` → `menu:`). See [ListAdapter](./list-adapter.md). | |
| `canvas` | Static art images from filesystem or Immich libraries. | |
| `singalong` | Participatory sing-along content (hymns, primary songs). Playable with synced stanzas. | |
| `readalong` | Follow-along readalong content (scripture, talks, poetry). Playable with synced paragraphs. | |
| `app` | Interactive frontend apps (webcam, gratitude, family-selector). Format: `app:{appId}[/{param}]`. | |
| `query` | Saved content queries (smart playlists). See [SavedQueryService](../../_wip/). | `/api/v1/queries/*` |

### Content ID Aliases

User-friendly aliases are resolved by [ContentIdResolver](./content-id-resolver.md) before reaching adapters:

| Alias Prefix | Resolves To | Example |
|-------------|-------------|---------|
| `hymn:` | `singalong:hymn/` | `hymn:166` → `singalong:hymn/166` |
| `primary:` | `singalong:primary/` | `primary:42` → `singalong:primary/42` |
| `scripture:` | `readalong:scripture/` | `scripture:alma-32` → `readalong:scripture/alma-32` |
| `talk:` | `readalong:talks/` | `talk:ldsgc` → `readalong:talks/ldsgc` |
| `poem:` | `readalong:poetry/` | `poem:remedy/01` → `readalong:poetry/remedy/01` |

---

## 2. API Topology

### URL Schema

```
/api/v1/{action}/{source}/{localId}[/{modifier}]
```

| Component | Required | Description |
|-----------|----------|-------------|
| `action` | Yes | Operation type: `item`, `list`, `siblings`, `queue`, `play`, `proxy`, `content` |
| `source` | Yes | Adapter name: `plex`, `immich`, `folder`, `canvas` |
| `localId` | Usually | Source-specific identifier (rating key, UUID, path) |
| `modifier` | No | Behavior flags: `playable`, `shuffle`, `recent_on_top` |

### Core Content Routes

| Pattern | Returns | Description |
|---------|---------|-------------|
| `GET /item/:source/:localId` | Item + `items:[]` | Single item. For containers, includes children array. |
| `GET /item/:source/:localId/playables` | Item + `items:[]` | Recursively resolves nested containers to leaf playables. Includes `groups` metadata for skipped hierarchy levels. |
| `GET /siblings/:source/:localId` | Siblings response | Returns a parent descriptor plus items at the same level. |
| `GET /queue/:source/:localId` | Queue response | Flattens containers into playables and returns queue-shaped items (no navigation actions). |
| `GET /item/:source/:localId/shuffle` | Same, shuffled | Randomizes `items:[]` order. |
| `GET /item/:source/:localId/recent_on_top` | Same, sorted | Sorts by last menu selection timestamp (`menu_memory.yml`). |

**Modifier semantics:**
- **No modifier:** Returns item. If container, `items:[]` contains direct children.
- **`playables`:** Flattens hierarchy. Show → episodes (skipping seasons). Playlist → tracks.
- **`shuffle`:** Randomizes item order.
- **`recent_on_top`:** Sorts by menu selection history.

Modifiers combine: `/item/plex/123/playables,shuffle`

### Queue Routes

| Pattern | Returns | Description |
|---------|---------|-------------|
| `GET /queue/:source/:localId` | Queue response | Flattened playables for playback. Supports `?shuffle=true` and `?limit=10`. |

Queue responses include:
- `count` (items returned)
- `totalDuration` (seconds)
- `items` (queue-shaped items)

### Deprecated Routes

- `GET /api/content/playables/:source/*` - Redirects to `/api/v1/queue/:source/:localId` with deprecation headers.

### Siblings Routes

| Pattern | Returns | Description |
|---------|---------|-------------|
| `GET /siblings/:source/:localId` | Siblings response | Returns `{ parent, items }` for peer browsing in admin UI. |

### Unified Query Routes

| Pattern | Purpose |
|---------|---------|
| `GET /content/query/search?params` | Cross-source search with filters |
| `GET /content/query/list?from=alias` | List containers by canonical alias |
| `POST /content/compose` | Compose multi-track presentation |

### Proxy Routes

| Pattern | Purpose |
|---------|---------|
| `GET /proxy/:source/*` | Binary passthrough to external service |

### Play Routes

| Pattern | Purpose |
|---------|---------|
| `GET /play/:source/:localId` | Playable item info with resume state |
| `GET /play/:source/:localId/shuffle` | Random playable from container |
| `POST /play/log` | Log playback progress |
| `GET /play/plex/mpd/:id` | DASH manifest URL |

---

## 3. Frontend URL Schema (TVApp)

The TV frontend uses query parameters to invoke content actions.

### Action Parameters

| Param | Action | Backend Route |
|-------|--------|---------------|
| `?display=<id>` | Show static image | `GET /item/:source/:localId` → use `imageUrl` |
| `?play=<id>` | Play media | `GET /item/:source/:localId` → use `mediaUrl` |
| `?play=a,b,c` | Composed presentation | `POST /content/compose` |
| `?queue=<id>` | Queue playback | Same as play, different UI behavior |
| `?list=<id>` | Browse as menu | `GET /item/:source/:localId` → render menu |
| `?read=<id>` | Read content | `GET /item/:source/:localId` → use `contentUrl` |
| `?open=<app>` | Launch frontend app | Loads component from `/frontend/src/Apps/` |

### Config Modifiers

These modify playback behavior and combine with any action:

| Param | Type | Description |
|-------|------|-------------|
| `volume` | number | Initial volume (0-100) |
| `shader` | string | Visual effect shader name |
| `playbackRate` | number | Speed multiplier (0.5, 1, 2) |
| `shuffle` | boolean | Randomize queue order |
| `continuous` | boolean | Auto-advance to next item |
| `repeat` | boolean | Loop current item |
| `loop` | boolean | Loop entire queue |
| `overlay` | string | Plex playlist ID for background music |
| `advance` | string | Slideshow advance mode (`timed`, `audio`) |
| `interval` | number | Slideshow interval in ms |

### Per-Track Modifiers

For composed presentations, apply modifiers to specific tracks:

```
?play=visual:immich:abc,audio:plex:123&loop.audio=0&shuffle.visual=1
```

Pattern: `{modifier}.{track}={value}`

### Compound ID Formats

| Source | Format | Example |
|--------|--------|---------|
| plex | `plex:{ratingKey}` | `plex:12345` |
| immich | `immich:{assetId}` | `immich:abc-def-123` |
| immich | `immich:person:{personId}` | `immich:person:abc-123` |
| immich | `immich:album:{albumId}` | `immich:album:xyz-789` |
| canvas | `canvas:{path}` | `canvas:religious/nativity.jpg` |
| folder | `folder:{path}` | `folder:TVApp/FHE` |
| local | Alias for watchlist (via ContentIdResolver) | `local:TVApp` |
| singalong | `singalong:{collection}/{id}` | `singalong:hymn/166` |
| readalong | `readalong:{collection}/{id}` | `readalong:scripture/alma-32` |
| app | `app:{appId}[/{param}]` | `app:webcam`, `app:family-selector/alan` |
| query | `query:{savedQueryName}` | `query:dailynews` |
| hymn | Alias → `singalong:hymn/{id}` | `hymn:166` |
| scripture | Alias → `readalong:scripture/{id}` | `scripture:alma-32` |

---

## 4. ID Resolution

Compound IDs follow the format `{source}:{localId}`. The backend resolves these through the `ContentIdResolver` — a 5-layer resolution chain.

> **Full reference:** See [content-id-resolver.md](./content-id-resolver.md) for the complete resolution chain, system aliases, and household aliases.

### Resolution Priority

The `ContentIdResolver.resolve()` method resolves IDs in this order:

1. **Exact source match** → `plex:12345` matches registered source `plex`
2. **Registry prefix** → `media:path/file.mp3` matches `filesystem` via its `media` prefix
3. **System alias** → `hymn:166` maps to `singalong:hymn/166` via alias config
4. **No-colon default** → `sfx/intro` (no colon) defaults to `media` adapter
5. **Household alias** → `music:` maps to `plex:12345` via household config

### Prefix Aliases (Layer 2)

Adapters declare prefixes they handle. A prefix is not the same as the source name:

| Adapter | Source Name | Prefixes (aliases) |
|---------|-------------|-------------------|
| `FilesystemAdapter` | `filesystem` | `media`, `file`, `fs` |
| `PlexAdapter` | `plex` | `plex` |
| `ImmichAdapter` | `immich` | `immich` |
| `FolderAdapter` | `folder` | `folder`, `local` |
| `FilesystemCanvasAdapter` | `canvas` | `canvas` |

This means `media:audio/song.mp3` resolves to `FilesystemAdapter` with `localId = audio/song.mp3`.

### Frontend ID Heuristics

The frontend (TVApp) uses heuristics when the source isn't explicit:

```javascript
// TVApp.jsx - auto-detect source from value format
const findKey = (value) => /^\d+$/.test(value) ? "plex" : "media";
```

| Input | Detected Source | Rationale |
|-------|-----------------|-----------|
| `12345` | `plex` | All digits = Plex rating key |
| `audio/song.mp3` | `media` | Contains path = filesystem |
| `abc-def-123` | `media` | UUID format = fallback to media |

**Explicit sources override heuristics:**
- `?play=12345` → `{ play: { plex: "12345" } }`
- `?play=plex:12345` → `{ play: { plex: "12345" } }`
- `?play=immich:abc-123` → `{ play: { immich: "abc-123" } }`

### Backend Resolution Examples

```javascript
// ContentSourceRegistry.resolve() examples:

resolve("plex:12345")
// → { adapter: PlexAdapter, localId: "12345" }

resolve("media:audio/song.mp3")
// → { adapter: FilesystemAdapter, localId: "audio/song.mp3" }
// (via prefix alias, not exact source match)

resolve("immich:abc-def-123")
// → { adapter: ImmichAdapter, localId: "abc-def-123" }

resolve("immich:person:abc-123")
// → { adapter: ImmichAdapter, localId: "person:abc-123" }
// (nested colon is part of localId)

resolve("audio/song.mp3")
// → { adapter: FilesystemAdapter, localId: "audio/song.mp3" }
// (no colon = default to filesystem)
```

### ID Transform Functions

Prefixes can include transform functions for ID normalization:

```javascript
// Adapter prefix declaration with transform
get prefixes() {
  return [
    { prefix: 'media' },
    { prefix: 'file', idTransform: (id) => id.replace(/^\//, '') }
  ];
}
```

---

## 5. Search & Query System

The unified query interface (`/content/query/*`) enables cross-source searching with canonical keys that translate to adapter-specific fields.

### Architecture

```
Frontend Query Params
        │
        ▼
┌─────────────────────────────────┐
│ API Layer: parseContentQuery()  │  Normalize params, validate
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│ ContentQueryService.search()    │  Resolve sources, translate keys
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│ Adapter.search(translatedQuery) │  Execute with native params
└─────────────────────────────────┘
```

### Canonical Keys

Canonical keys work across all adapters that support them. Each adapter declares mappings:

| Canonical | Description | Immich Mapping | Plex Mapping |
|-----------|-------------|----------------|--------------|
| `text` | Free text search | `text` | `text` |
| `person` | Filter by person | `personIds` | (not supported) |
| `creator` | Filter by creator | (not supported) | `director` |
| `time` | Time filter | `takenAfter`/`takenBefore` | `year` |
| `duration` | Length filter | `durationMin`/`durationMax` | (not supported) |
| `mediaType` | Content type | `type` | `type` |

### Adapter Query Mappings

Adapters implement `getQueryMappings()` to translate canonical keys:

```javascript
// ImmichAdapter
getQueryMappings() {
  return {
    person: 'personIds',
    time: { from: 'takenAfter', to: 'takenBefore' },
    duration: { from: 'durationMin', to: 'durationMax' },
  };
}

// PlexAdapter
getQueryMappings() {
  return {
    creator: 'director',
    time: 'year',
  };
}
```

### Range Value Syntax

Filters support range syntax with `..` separator:

```
duration=3m..10m    → { from: 180, to: 600 }
duration=..5m       → { from: null, to: 300 }
duration=30m..      → { from: 1800, to: null }
time=2024..2025     → { from: "2024-01-01", to: "2025-12-31" }
```

### Duration Parsing

| Format | Seconds |
|--------|---------|
| `30` | 30 |
| `3m` | 180 |
| `1h` | 3600 |
| `1h30m` | 5400 |
| `3m..10m` | Range: 180-600 |

### Time Parsing

| Format | Result |
|--------|--------|
| `2025` | Jan 1 - Dec 31, 2025 |
| `2025-06` | Jun 1 - Jun 30, 2025 |
| `2025-06-15` | Exact date |
| `summer` | Jun 1 - Aug 31 (current year) |
| `2024..2025` | Jan 1, 2024 - Dec 31, 2025 |

### Search Capabilities

Adapters declare what keys they support via `getSearchCapabilities()`:

```javascript
// ImmichAdapter
getSearchCapabilities() {
  return {
    canonical: ['text', 'person', 'time', 'duration', 'mediaType'],
    specific: ['location', 'cameraModel']
  };
}
```

The `ContentQueryService` skips adapters that can't handle the query:

```javascript
#canHandle(adapter, query) {
  const caps = adapter.getSearchCapabilities();
  const queryKeys = Object.keys(query);
  return queryKeys.some(k =>
    caps.canonical.includes(k) || caps.specific.includes(k)
  );
}
```

### Adapter-Specific Keys

Bypass canonical translation with prefixed keys:

```
GET /content/query/search?immich.cameraModel=iPhone
GET /content/query/search?plex.actor=Tom+Hanks
```

These pass directly to the specified adapter without translation.

### Multi-Source Result Merging

When searching across sources:

1. Resolve source param → adapter list
2. Filter adapters that can handle query
3. Translate canonical keys per-adapter
4. Execute searches in parallel
5. Merge results, apply capability filter
6. Apply pagination post-merge

Partial failures return partial results with warnings:

```json
{
  "items": [...],
  "sources": ["immich"],
  "warnings": [
    { "source": "plex", "error": "Connection timeout" }
  ]
}
```

---

## 6. Capability System

Capabilities describe what you can do with an **item**, not a source. A single source can produce items with different capabilities.

### Capability Classes

| Capability | Item Class | Required Fields | Example Items |
|------------|-----------|-----------------|---------------|
| `listable` | `ListableItem` | `id`, `title`, `itemType` | Album, Person, Folder |
| `playable` | `PlayableItem` | `mediaUrl`, `duration` | Video, Audio track |
| `displayable` | `DisplayableItem` | `imageUrl` | Photo, Canvas art |
| `readable` | (planned) | `contentUrl`, `format` | Ebook, Article |

### Per-Source Capabilities

| Source | Items Produced | Capabilities |
|--------|----------------|--------------|
| `immich` | photos, videos, albums, people | displayable (photo), playable (video), listable (container) |
| `plex` | movies, episodes, tracks, playlists | playable, listable (container) |
| `audiobookshelf` | audiobooks, podcasts, ebooks | playable (audio), readable (ebook), listable |
| `komga` | comics, manga | readable, listable |
| `canvas` | art images | displayable, listable (directory) |
| `folder` | YAML-defined menus | listable, may reference playable items |
| `filesystem` | audio, video files | playable, listable (directory) |
| `singalong` | hymns, primary songs | playable (with synced stanzas), listable |
| `readalong` | scripture, talks, poetry | playable (with synced paragraphs), listable |
| `list` | menus, programs, watchlists | listable, references other sources |

### Capability Filtering

The unified query API supports filtering by capability:

```
GET /content/query/search?capability=playable&source=gallery
```

Returns only playable items (videos) from gallery sources.

---

## 7. Hierarchy Abstraction

When `/playables` flattens a container hierarchy, the API communicates which intermediate containers were skipped using **relative hierarchy naming**.

### Field Naming Convention

The system uses relative position names (`parent`, `grandparent`) rather than abstract names (`group`, `collection`). This was chosen because:

1. **Avoids Plex naming collision** - Plex has a "Collections" feature that's unrelated to hierarchy
2. **Intuitive mapping** - `parent` = immediate container, `grandparent` = container's container
3. **Source-agnostic** - Works for any 2-3 level hierarchy (show→season→episode, artist→album→track, etc.)

### Canonical Hierarchy Fields

| Field | Description | Plex Source | Immich Source |
|-------|-------------|-------------|---------------|
| `parentId` | Parent container ID | `parentRatingKey` | `albumId` |
| `parentTitle` | Parent container name | `parentTitle` | `albumTitle` |
| `parentIndex` | Parent sequence number | `parentIndex` | N/A |
| `parentType` | Parent container type | `'season'` | `'album'` |
| `grandparentId` | Root container ID | `grandparentRatingKey` | N/A |
| `grandparentTitle` | Root container name | `grandparentTitle` | N/A |
| `grandparentType` | Root container type | `'show'` | N/A |
| `itemIndex` | Item position in parent | `index` | N/A |

**Note:** Parent thumbnails are accessed via the `parents` map lookup (`parents[parentId].thumbnail`), not as top-level fields on items. This avoids duplicating thumbnail URLs across many items.

### Response Structure

**Item response with hierarchy:**
```json
{
  "items": [
    {
      "id": "plex:12345",
      "title": "Episode 1",
      "parentId": "662028",
      "parentTitle": "Season 1",
      "parentIndex": 1,
      "parentType": "season",
      "grandparentTitle": "Show Name",
      "grandparentType": "show",
      "itemIndex": 1
    }
  ],
  "parents": {
    "662028": { "index": 1, "title": "Season 1", "thumbnail": "...", "type": "season" }
  }
}
```

**Key structures:**
- `parents` map - Lookup table for parent containers (keyed by `parentId`)
- Each item has `parentId` to reference its entry in the `parents` map
- `grandparent*` fields on items for root container info (no separate map needed)

### Component Props

Frontend components use canonical prop names matching the hierarchy level they display:

| Component | Prop | Description |
|-----------|------|-------------|
| `ShowView` | `grandparentId` | ID of the show (grandparent level) |
| `SeasonView` | `parentId` | ID of the season (parent level) |
| `FitnessShow` | `showId` | Semantic alias for show display |

### History

**Previous implementation (pre-2026-02)** used Plex-specific field names that leaked domain terminology:

```json
{
  "items": [
    {
      "seasonId": "662028",
      "seasonName": "Season 1",
      "seasonNumber": 1,
      "episodeNumber": 1,
      "show": "Show Name",
      "showId": "662027"
    }
  ],
  "seasons": {
    "662028": { "num": 1, "title": "Season 1", "img": "..." }
  }
}
```

**Problems with the old approach:**
- Field names like `seasonId`, `episodeNumber` assumed TV show domain
- Other sources (Immich albums, Audiobookshelf series) couldn't map cleanly
- Frontend components had Plex-specific field references scattered throughout

**Migration (2026-02):** Standardized to relative hierarchy naming:

| Old Field | New Field |
|-----------|-----------|
| `seasonId` | `parentId` |
| `seasonName` | `parentTitle` |
| `seasonNumber` | `parentIndex` |
| `episodeNumber` | `itemIndex` |
| `showId` | `grandparentId` |
| `show` | `grandparentTitle` |
| `seasons` map | `parents` map |
| `seasons[].num` | `parents[].index` |
| `seasons[].img` | `parents[].thumbnail` |

**Why relative naming over abstract naming:** An earlier proposal suggested `groupId`/`collectionId`, but this was rejected because Plex has a "Collections" feature unrelated to hierarchy, which would cause confusion. Relative naming (`parent`/`grandparent`) is unambiguous and intuitive.

---

## 8. Configuration

### integrations.yml (Household)

Declares which providers a household uses for each content category:

```yaml
# What capabilities this household uses (provider selection)
# Auth credentials come from auth/*.yml
# Host/port come from system/services.yml

media:
  - provider: plex
    protocol: dash
    platform: Chrome

gallery:
  - provider: immich

audiobooks:
  - provider: audiobookshelf

ebooks:
  - provider: audiobookshelf
  - provider: komga
```

### services.yml (System)

Defines connection URLs per environment:

```yaml
# Service name → URL per environment
# All values are full URLs - no host/port assembly needed

plex:
  docker: http://plex:32400
  kckern-server: https://plex.kckern.net
  kckern-macbook: https://plex.kckern.net

immich:
  docker: http://immich:2283
  kckern-server: https://photos.kckern.net

audiobookshelf:
  docker: http://audiobookshelf:80
  kckern-server: https://audiobookshelf.kckern.net

komga:
  docker: http://komga:8080
  kckern-server: https://mags.kckern.net
```

### Adapter Registration (bootstrap.mjs)

Adapters register with category and provider metadata:

```javascript
// Register Plex adapter
registry.register(
  new PlexAdapter({ host: config.plex.host, ... }),
  { category: 'media', provider: 'plex' }
);

// Register Immich adapter
registry.register(
  new ImmichAdapter({ host: config.immich.host, ... }),
  { category: 'gallery', provider: 'immich' }
);

// Register folder adapter (special - bridges content and config)
registry.register(
  folderAdapter,
  { category: 'local', provider: 'folder' }
);
```

### ContentSourceRegistry Resolution

The registry resolves source filters by priority:

1. **Exact source match:** `source=immich-family` → `[immich-family]`
2. **Provider match:** `source=immich` → all Immich instances `[immich, immich-family]`
3. **Category match:** `source=gallery` → all gallery sources `[immich, immich-family]`
4. **No source:** all registered sources

---

## 9. Container Aliases

Adapters declare canonical names for browsable containers, enabling cross-source queries like `from=playlists`.

### Alias Declaration

```javascript
// ImmichAdapter
getContainerAliases() {
  return {
    playlists: 'album:',  // "playlists" maps to albums in Immich
    albums: 'album:',
    people: 'person:',
    cameras: 'camera:'
  };
}

// PlexAdapter
getContainerAliases() {
  return {
    playlists: 'playlist:',
    albums: 'album:',      // music albums
    artists: 'artist:',
    collections: 'collection:'
  };
}
```

### Alias Matrix

| Canonical | immich | plex | audiobookshelf | komga |
|-----------|--------|------|----------------|-------|
| `playlists` | `album:` | `playlist:` | - | - |
| `albums` | `album:` | `album:` | - | - |
| `people` | `person:` | - | - | - |
| `artists` | - | `artist:` | - | - |
| `authors` | - | - | `author:` | - |
| `series` | - | - | `series:` | `series:` |
| `cameras` | `camera:` | - | - | - |

### Usage

```
GET /content/query/list?from=playlists              # All sources
GET /content/query/list?from=playlists&source=plex  # Plex only
GET /content/query/list?from=people&source=gallery  # Immich only
```

---

## 10. Response Formats

### Item Response

```json
{
  "id": "plex:12345",
  "source": "plex",
  "title": "Episode Title",
  "itemType": "leaf",
  "thumbnail": "/api/v1/proxy/plex/photo/...",
  "duration": 2700,
  "mediaUrl": "/api/v1/proxy/plex/video/...",
  "play": { "plex": "12345" },
  "metadata": { ... }
}
```

### Container Response

```json
{
  "id": "plex:662027",
  "source": "plex",
  "title": "Show Title",
  "itemType": "container",
  "childCount": 24,
  "thumbnail": "/api/v1/proxy/plex/photo/...",
  "items": [
    { "id": "plex:12345", "title": "Episode 1", ... },
    { "id": "plex:12346", "title": "Episode 2", ... }
  ]
}
```

### Playables Response (flattened hierarchy)

```json
{
  "id": "plex:662027",
  "source": "plex",
  "title": "Show Title",
  "itemType": "container",
  "items": [
    {
      "id": "plex:12345",
      "title": "Episode 1",
      "groupId": "662028",
      "groupTitle": "Season 1",
      "groupIndex": 1,
      "itemIndex": 1,
      "play": { "plex": "12345" },
      "duration": 2700
    }
  ],
  "groups": {
    "662028": { "index": 1, "title": "Season 1", "thumbnail": "..." },
    "662029": { "index": 2, "title": "Season 2", "thumbnail": "..." }
  }
}
```

### Search Response

```json
{
  "query": { "source": "gallery", "mediaType": "video" },
  "sources": ["immich"],
  "total": 42,
  "items": [
    {
      "id": "immich:abc-123",
      "source": "immich",
      "title": "Beach Video.mp4",
      "itemType": "leaf",
      "mediaUrl": "/api/v1/proxy/immich/assets/abc-123/video/playback",
      "duration": 120
    }
  ]
}
```

### Composed Presentation Response

```json
{
  "visual": {
    "items": [
      { "url": "/api/v1/proxy/immich/assets/abc/original", "duration": 10 }
    ],
    "advance": { "mode": "timed", "interval": 5000 }
  },
  "audio": {
    "items": [
      { "url": "/api/v1/proxy/plex/audio/...", "duration": 180 }
    ]
  },
  "config": { "loop": true, "shuffle": true }
}
```

---

## 11. Content Browser Model (Admin UI)

Admin UIs need to browse, select, and display content with rich metadata. This section documents the patterns for content selection interfaces.

### Item Display Model

Every content item renders with these display fields:

| Field | Source | Description |
|-------|--------|-------------|
| `title` | ID3 tags, Plex metadata, or filename | Primary display text |
| `thumbnail` | Cover art, poster, or album art | Avatar/image (falls back to first letter) |
| `type` | `audio`, `video`, `folder`, `show`, `episode`, etc. | Icon and type label |
| `source` | Extracted from compound ID | Source badge (`PLEX`, `MEDIA`, etc.) |
| `parentTitle` | Parent folder/container name | Subtitle line (e.g., "SFX", "Season 1") |
| `itemCount` | `childCount` for containers | Badge showing child count |

**Display hierarchy:**
```
┌─────────────────────────────────────────────────────┐
│ [Thumbnail]  Title                    [5] [SOURCE]  │
│              🎵 Audio • Parent Folder         [>]   │
└─────────────────────────────────────────────────────┘
```

### Container Types

Items are either **containers** (browsable) or **leaves** (selectable):

```javascript
const CONTAINER_TYPES = [
  'show', 'season', 'artist', 'album', 'collection', 'playlist', 'folder', 'container',
  'series', 'channel', 'conference', 'watchlist', 'query', 'menu', 'program'
];

function isContainerItem(item) {
  if (item.itemType === 'container') return true;
  return CONTAINER_TYPES.includes(item.type || item.metadata?.type);
}
```

Containers show a chevron (`>`) for drill-down navigation.

### Sibling Resolution

Siblings are peer items within the same parent container. The system resolves siblings via a dedicated backend service that delegates entirely to the owning adapter — no source-specific branching in the application layer or frontend.

#### Architecture

```
Frontend                 API Layer              Application Layer        Adapter Layer
  │                        │                        │                      │
  │ GET /siblings/plex/123 │                        │                      │
  │──────────────────────→ │                        │                      │
  │                        │ siblingsService        │                      │
  │                        │  .resolveSiblings()    │                      │
  │                        │──────────────────────→ │                      │
  │                        │                        │ adapter              │
  │                        │                        │  .resolveSiblings()  │
  │                        │                        │─────────────────────→│
  │                        │                        │                      │ (adapter-specific
  │                        │                        │     { parent, items }│  strategy)
  │                        │                        │←─────────────────────│
  │                        │     { parent, items }  │                      │
  │                        │←──────────────────────│                      │
  │     { parent, items }  │                        │                      │
  │←──────────────────────│                        │                      │
```

**Key design principle:** Each adapter owns its sibling resolution strategy. The `SiblingsService` (application layer) is a pure delegator with zero domain knowledge. Adding a new adapter never requires changing the service.

#### Adapter Sibling Strategies

| Adapter | Strategy | Parent Determination |
|---------|----------|---------------------|
| FileAdapter | Path-based | Parent directory |
| PlexAdapter | Metadata-based | `parentRatingKey` → `librarySectionID` chain |
| LocalContentAdapter | Collection-based | YAML collection root |
| ListAdapter | Prefix-based | List type (`watchlist:`, `menu:`, etc.) |
| SingalongAdapter | Collection-based | Collection name (`hymn`, `primary`) |
| ReadalongAdapter | Path-based | Strip last path segment for deep items |
| AudiobookshelfAdapter | Library-based | `libraryId` from item metadata |
| ImmichAdapter | Container-based | `album:`, `person:`, `tag:` containers; null for ambiguous assets |
| Canvas adapters | N/A | Returns null (display-only, no siblings) |

#### Response Shape

```json
{
  "parent": {
    "id": "plex:662028",
    "title": "Season 1",
    "source": "plex",
    "thumbnail": "/api/v1/proxy/plex/photo/...",
    "parentId": "plex:662027",
    "libraryId": null
  },
  "items": [
    {
      "id": "plex:12345",
      "title": "Episode 1",
      "source": "plex",
      "type": "episode",
      "thumbnail": "/api/v1/proxy/plex/photo/...",
      "parentTitle": "Season 1",
      "grandparentTitle": "Show Name",
      "libraryTitle": null,
      "childCount": null,
      "isContainer": false
    }
  ]
}
```

When an adapter returns null (unsupported or ambiguous), the service returns `{ parent: null, items: [] }`.

#### Frontend Usage

```javascript
// Simple — one call, no source-specific logic
async function loadSiblings(compoundId) {
  const [source, ...rest] = compoundId.split(':');
  const localId = rest.join(':');
  const response = await fetch(`/api/v1/siblings/${source}/${localId}`);
  return response.json(); // { parent, items }
}
```

#### Related Code

| File | Purpose |
|------|---------|
| `backend/src/4_api/v1/routers/siblings.mjs` | Thin HTTP router (parses params, calls service, sends JSON) |
| `backend/src/3_applications/content/services/SiblingsService.mjs` | Pure delegator — resolves adapter via registry, normalizes DTO |
| `backend/src/3_applications/content/ports/ISiblingsService.mjs` | Port interface with JSDoc typedefs |
| `backend/src/3_applications/content/ports/IContentSource.mjs` | `resolveSiblings()` in interface + `ContentSourceBase` |

### API Endpoints for Browsing

| Endpoint | Returns | Use Case |
|----------|---------|----------|
| `GET /api/v1/item/{source}/{localId}` | Single item with full metadata | Display selected item |
| `GET /api/v1/item/{source}/{path}` | Container children as list | Browse folder, load siblings |
| `GET /api/v1/content/item/{source}/{localId}` | Item metadata only | Resolve display info |
| `GET /api/v1/content/query/search?text=...` | Search results | Free-text content search |

### Rich Metadata via getItem

The `getItem()` adapter method returns rich metadata. For filesystem items:

```json
{
  "id": "filesystem:sfx/intro.mp3",
  "title": "Good Morning",           // From ID3 tags
  "thumbnail": "/api/v1/local-content/cover/sfx%2Fintro.mp3",
  "type": "audio",
  "parentTitle": "Sfx",
  "artist": "Morning Program",       // From ID3 tags
  "duration": 45,
  "metadata": {
    "type": "audio",
    "parentTitle": "Sfx",
    "librarySectionTitle": "Media"
  }
}
```

The `getList()` method calls `getItem()` for each child to provide the same rich metadata.

### Source Badge Colors

```javascript
const SOURCE_COLORS = {
  plex: 'orange',
  immich: 'blue',
  abs: 'green',
  media: 'gray',
  filesystem: 'gray',
  watchlist: 'violet',
  query: 'cyan',
  menu: 'teal',
  program: 'teal',
  freshvideo: 'lime',
  talk: 'pink',
  'local-content': 'pink',
  list: 'violet',
  default: 'gray'
};
```

### Navigation State

Browser components maintain navigation state for drill-down:

| State | Purpose |
|-------|---------|
| `currentParent` | Container being browsed (for header display) |
| `navStack` | Breadcrumb trail of visited containers |
| `browseItems` | Current list of items to display |
| `highlightedIdx` | Keyboard navigation index |

**Navigation actions:**
- **Drill down (→):** Push current to stack, fetch container children
- **Go up (←):** Pop from stack, fetch previous parent's children
- **Select (Enter):** Call `onChange(item.id)` for leaves

---

## Appendix: Query Parameters

### Search Parameters

| Param | Type | Description |
|-------|------|-------------|
| `source` | string | Filter by source name, provider, or category |
| `capability` | string | Filter by item capability (`playable`, `displayable`, `readable`) |
| `text` | string | Free text search |
| `person` | string | Person filter (faces in Immich, actors in Plex) |
| `time` | string | Time filter: `2025`, `2025-06`, `2024..2025`, `summer` |
| `duration` | string | Duration filter: `3m`, `3m..10m`, `..5m` |
| `mediaType` | string | `image`, `video`, `audio` |
| `sort` | string | `date`, `title`, `random` |
| `take` | number | Limit results |
| `skip` | number | Pagination offset |

### List Parameters

| Param | Type | Description |
|-------|------|-------------|
| `from` | string | **Required.** Container alias (`playlists`, `albums`, `people`) |
| `source` | string | Filter by source |
| `pick` | string | `random` - return contents of randomly selected container |
| `sort` | string | `date`, `title`, `random` |
| `take` | number | Limit results |
| `skip` | number | Pagination offset |

### Duration Formats

| Format | Meaning |
|--------|---------|
| `30` | 30 seconds |
| `3m` | 3 minutes |
| `1h` | 1 hour |
| `1h30m` | 1 hour 30 minutes |
| `3m..10m` | Range: 3-10 minutes |
| `..5m` | Up to 5 minutes |
| `30m..` | 30+ minutes |

### Time Formats

| Format | Meaning |
|--------|---------|
| `2025` | Year 2025 |
| `2025-06` | June 2025 |
| `2025-06-15` | Specific date |
| `summer` | Semantic (June-August) |
| `2024..2025` | Year range |

## Related code:

- backend/src/2_domains/content/services/ContentSourceRegistry.mjs
- backend/src/3_applications/content/ContentQueryService.mjs
- backend/src/4_api/v1/routers/item.mjs
- backend/src/4_api/v1/routers/siblings.mjs
- backend/src/4_api/v1/routers/queue.mjs
- frontend/src/lib/queryParamResolver.js
