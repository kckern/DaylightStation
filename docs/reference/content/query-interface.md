# Content Query Interface

This document defines the dimensions and terminology for querying content across multiple sources.

## Dimensions

The content system has five orthogonal dimensions:

### 1. Category (Source Type)

What **type of content** a source provides. Derived from adapter folder structure.

| Category | Description | Sources |
|----------|-------------|---------|
| `gallery` | Photos, home videos, slideshows | Immich |
| `media` | Movies, TV shows, music | Plex, Jellyfin |
| `readable` | Ebooks, audiobooks, articles | Audiobookshelf, Komga |

### 2. Provider (Software/Platform)

The **software or service** that hosts the content.

| Provider | Category | Description |
|----------|----------|-------------|
| `immich` | gallery | Self-hosted photo/video management |
| `plex` | media | Media server for movies, TV, music |
| `jellyfin` | media | Open-source media server |
| `abs` | readable | Audiobookshelf - audiobooks and ebooks |
| `komga` | readable | Comic/manga server |

### 3. Instance (Installation)

A **specific installation** of a provider. Allows multiple instances of the same provider.

Examples:
- `default` - implicit when no instance specified
- `family` - family photo library
- `work` - work media server

### 4. Source (Registered Name)

The **unique identifier** for an adapter in the ContentSourceRegistry. Combines provider + instance.

| Source | Provider | Instance |
|--------|----------|----------|
| `immich` | immich | default |
| `immich-family` | immich | family |
| `plex` | plex | default |
| `jellyfin` | jellyfin | default |
| `abs` | abs | default |

### 5. Capability (Item Behavior)

What you can **do with an item**. Defined in `backend/src/2_domains/content/capabilities/`.

| Capability | Description | Item Class |
|------------|-------------|------------|
| `Listable` | Can appear in lists, be browsed | `ListableItem` |
| `Playable` | Can be played/streamed (video, audio) | `PlayableItem` |
| `Displayable` | Can be displayed statically (images, art) | `DisplayableItem` / `ListableItem` with `imageUrl` |
| `Readable` | Can be read (ebooks, flow content) | `ReadableItem` |
| `Queueable` | Can be added to a playback queue | `QueueableItem` |

A single source can provide items with multiple capabilities:

| Source | Category | Supported Capabilities |
|--------|----------|------------------------|
| immich | gallery | Listable, Playable (video), Displayable (photo) |
| plex | media | Listable, Playable |
| jellyfin | media | Listable, Playable |
| abs | readable | Listable, Playable (audiobook), Readable (ebook) |
| canvas | gallery | Listable, Displayable (static art) |

---

## Frontend Action Mapping

The frontend uses URL action params to request content for specific purposes. Each action maps to a backend capability.

### Action → Capability Mapping

| URL Param | Action | Backend Capability | Required Response Fields |
|-----------|--------|-------------------|--------------------------|
| `display=` | Show static image | Displayable | `imageUrl` (full-size) |
| `play=` | Play media | Playable | `mediaUrl`, `duration` |
| `read=` | Read content | Readable | `contentUrl` or inline content |
| `queue=` | Add to queue | Queueable | `mediaUrl`, `duration` |
| `list=` | Browse container | Listable | `items[]`, `childCount` |

### Example URLs

```
# Display a static image (canvas art, gallery photo)
/tv?display=canvas:religious/nativity.jpg
/tv?display=immich:931cb18f-2642-489b-bff5-c554e8ad4249

# Play a video or audio
/tv?play=plex:movie:12345
/tv?play=immich:album:vacation-2025  # slideshow

# Read an ebook
/tv?read=abs:book:9780061120084

# Add to playback queue
/tv?queue=plex:playlist:workout-mix

# Browse a container
/tv?list=immich:album:family-photos
```

### Resolution Flow

When the frontend requests `?display=canvas:religious/nativity.jpg`:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Frontend: /tv?display=canvas:religious/nativity.jpg                  │
│                                                                     │
│   1. Parse action param: display = "canvas:religious/nativity.jpg" │
│   2. Determine capability needed: Displayable                       │
│   3. Fetch item via /api/v1/content/item/canvas/religious/nativity │
└───────────────────────────│─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ API Layer: GET /api/v1/content/item/:source/*                       │
│                                                                     │
│   1. Extract source: "canvas"                                       │
│   2. Resolve adapter via ContentSourceRegistry                      │
│   3. Call adapter.getItem("religious/nativity.jpg")                │
└───────────────────────────│─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Adapter: FilesystemCanvasAdapter.getItem()                          │
│                                                                     │
│   Returns ListableItem with:                                        │
│   - id: "canvas:religious/nativity.jpg"                            │
│   - imageUrl: "/api/v1/canvas/image/religious/nativity.jpg"        │
│   - thumbnail: "/api/v1/canvas/image/religious/nativity.jpg"       │
└───────────────────────────│─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Frontend: Receives item, extracts imageUrl for display              │
│                                                                     │
│   if (action === 'display') {                                       │
│     const imageUrl = item.imageUrl || item.thumbnail;              │
│     // Render full-screen image                                     │
│   }                                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### Adapter Response Normalization

**Critical:** Adapters must return consistent fields for each capability. The frontend relies on these fields existing.

#### Displayable Items

For any item that can be displayed statically (photos, art, images):

| Field | Required | Description |
|-------|----------|-------------|
| `imageUrl` | **Yes** | Full-resolution image URL for display |
| `thumbnail` | Optional | Smaller preview (for lists, grids) |

```javascript
// Correct: Adapter returns imageUrl for displayable content
#toListableItem(asset) {
  return new ListableItem({
    id: `immich:${asset.id}`,
    source: 'immich',
    title: asset.originalFileName,
    itemType: 'leaf',
    thumbnail: this.#thumbnailUrl(asset.id),    // For lists
    imageUrl: this.#originalUrl(asset.id),      // For display
    // ...
  });
}

// Wrong: Only returning thumbnail forces frontend workarounds
#toListableItem(asset) {
  return new ListableItem({
    thumbnail: this.#thumbnailUrl(asset.id),    // Only thumbnail!
    // Frontend would have to guess at full-size URL
  });
}
```

#### Playable Items

For any item that can be played (video, audio, slideshow):

| Field | Required | Description |
|-------|----------|-------------|
| `mediaUrl` | **Yes** | Playable media URL |
| `duration` | **Yes** | Duration in seconds |
| `resumable` | Optional | Whether progress tracking is supported |
| `thumbnail` | Optional | Preview image |

#### Readable Items

For any item that can be read (ebooks, articles):

| Field | Required | Description |
|-------|----------|-------------|
| `contentUrl` | **Yes** | URL to fetch readable content |
| `format` | **Yes** | Content format (epub, html, pdf) |
| `progress` | Optional | Current reading position |

### Prefix-Based Resolution

When a compound ID like `canvas:religious/nativity.jpg` is used:

1. **Exact source match**: Try `registry.get("canvas")`
2. **Prefix resolution**: If no exact match, try `registry.resolveFromPrefix("canvas", "religious/nativity.jpg")`

This allows adapters to register prefixes they handle:

```javascript
// FilesystemCanvasAdapter
get source() { return 'canvas'; }
get prefixes() { return [{ prefix: 'canvas' }]; }

// ImmichAdapter
get source() { return 'immich'; }
get prefixes() { return [{ prefix: 'immich' }]; }
```

The content router uses both:

```javascript
router.get('/item/:source/*', async (req, res) => {
  const { source } = req.params;
  const localId = req.params[0] || '';

  // Try exact source match first
  let adapter = registry.get(source);
  let resolvedLocalId = localId;

  if (!adapter) {
    // Try prefix-based resolution
    const resolved = registry.resolveFromPrefix(source, localId);
    if (resolved) {
      adapter = resolved.adapter;
      resolvedLocalId = resolved.localId;
    }
  }

  if (!adapter) {
    return res.status(404).json({ error: `Unknown source: ${source}` });
  }

  const item = await adapter.getItem(resolvedLocalId);
  // ...
});
```

---

## Source Resolution

When a query specifies `source=X`, resolution follows this priority:

1. **Exact source match** - `source=immich-family` → `[immich-family]`
2. **Provider match** - `source=immich` → all instances `[immich, immich-family]`
3. **Category match** - `source=gallery` → all sources in category `[immich, immich-family]`
4. **No source** - all registered sources

```
source=gallery        → [immich, immich-family]
source=media          → [plex, jellyfin]
source=immich         → [immich, immich-family]
source=immich-family  → [immich-family]
source=plex           → [plex]
(no source)           → [immich, immich-family, plex, jellyfin, abs]
```

---

## Container Aliases

Adapters declare canonical names for their browsable containers. This enables queries like `from=playlists` to work across sources.

### Alias Declaration

Each adapter implements `getContainerAliases()`:

```javascript
// ImmichAdapter
getContainerAliases() {
  return {
    playlists: 'album:',   // "playlists" maps to albums in Immich
    albums: 'album:',
    people: 'person:',
    cameras: 'camera:',
  };
}

// PlexAdapter
getContainerAliases() {
  return {
    playlists: 'playlist:',
    albums: 'album:',       // music albums
    artists: 'artist:',
    collections: 'collection:',
  };
}

// AudiobookshelfAdapter
getContainerAliases() {
  return {
    libraries: 'lib:',
    authors: 'author:',
    narrators: 'narrator:',
    series: 'series:',
  };
}
```

### Alias Matrix

| Canonical | immich | plex | jellyfin | abs |
|-----------|--------|------|----------|-----|
| `playlists` | `album:` | `playlist:` | `playlist:` | - |
| `albums` | `album:` | `album:` | `album:` | - |
| `people` | `person:` | - | - | - |
| `artists` | - | `artist:` | `artist:` | - |
| `collections` | - | `collection:` | `collection:` | - |
| `authors` | - | - | - | `author:` |
| `narrators` | - | - | - | `narrator:` |
| `cameras` | `camera:` | - | - | - |

### Resolution

```
from=playlists              → combined from all sources that support it
from=playlists&source=plex  → only Plex playlists
from=immich:album:abc       → specific container by full ID
```

---

## Query Keys

### Canonical Keys (Best Effort)

Adapters interpret these based on their capabilities. Unknown keys are silently ignored.

#### Filter Categories

| Category | Keys | Value Type | Examples |
|----------|------|------------|----------|
| **Text** | `text` | string | `text=vacation` |
| **Time** | `time`, `timeFrom`, `timeTo` | date, year, season | `time=2025`, `time=summer`, `timeFrom=2024-06-01` |
| **Duration** | `duration`, `durationMin`, `durationMax` | seconds or human | `duration=3m..10m`, `durationMin=180` |
| **People** | `person`, `creator` | name string | `person=alice`, `creator=Nolan` |
| **Content** | `mediaType`, `tags` | string, enum | `mediaType=video`, `tags=workout` |
| **Quality** | `resolution`, `rating` | resolution, number | `resolution=1080p`, `rating=4..5` |

#### Canonical Key Reference

| Canonical | Description | Adapter Interpretation |
|-----------|-------------|------------------------|
| `text` | Free text search | Title, description, tags |
| `person` | Filter by person | Face (immich), actor/director (plex), narrator/author (abs) |
| `creator` | Filter by creator | Director (plex), author (abs) |
| `time` | Time filter | `takenAfter/Before` (immich), `year` (plex) |
| `duration` | Length filter | Video/audio duration |
| `mediaType` | `image`, `video`, `audio` | Filter by content type |
| `resolution` | Video quality | `720p`, `1080p`, `4k` |
| `rating` | User/critic rating | Normalized to 1-5 scale |

### Range Value Syntax

For filters that support ranges, use double-dot syntax:

```
# Range syntax (preferred - compact)
duration=3m..10m          # 3 to 10 minutes
time=2024-01..2024-06     # January to June 2024
rating=4..5               # 4 or 5 stars

# Open-ended ranges
duration=..5m             # up to 5 minutes
duration=30m..            # 30 minutes or longer
time=2024..               # 2024 onwards

# Explicit min/max (fallback - when you need fine control)
durationMin=180&durationMax=600    # 180-600 seconds
timeFrom=2024-06-01&timeTo=2024-08-31
```

#### Duration Formats

| Format | Meaning |
|--------|---------|
| `30` | 30 seconds |
| `3m` | 3 minutes (180 seconds) |
| `1h` | 1 hour (3600 seconds) |
| `1h30m` | 1 hour 30 minutes |
| `3m..10m` | Range: 3-10 minutes |

#### Time Formats

| Format | Meaning |
|--------|---------|
| `2025` | Year 2025 |
| `2025-06` | June 2025 |
| `2025-06-15` | Specific date |
| `summer` | Semantic (June-August) |
| `2024..2025` | Range: 2024-2025 |
| `2024-06-01..2024-08-31` | Date range |

### Adapter-Specific Keys

Prefixed with adapter source to bypass canonical mapping:

```
immich.cameraModel=iPhone
plex.actor=Tom Hanks
plex.director=Christopher Nolan
abs.narrator=Stephen Fry
```

### Capability Filter

Filter results by item capability:

```
capability=playable    → only items that can be played
capability=displayable → only items that can be displayed (photos, art)
capability=readable    → only items that can be read (ebooks)
```

---

## API Endpoints

### Search

```
GET /content/search?[params]
```

| Param | Type | Description |
|-------|------|-------------|
| `source` | string | Source filter (category, provider, or exact source) |
| `capability` | string | Filter by item capability |
| `text` | string | Free text search |
| `person` | string | Person filter (canonical) |
| `creator` | string | Creator filter (canonical) |
| `time` | string | Time filter: `2025`, `summer`, `2024-01..2024-06` |
| `timeFrom` | string | Explicit start date |
| `timeTo` | string | Explicit end date |
| `sort` | string | `date`, `title`, `random` (alias: `shuffle`) |
| `duration` | string | Duration filter: `3m..10m`, `..5m`, `30m..` |
| `durationMin` | number | Explicit min duration (seconds) |
| `durationMax` | number | Explicit max duration (seconds) |
| `mediaType` | string | `image`, `video`, `audio` |
| `resolution` | string | `720p`, `1080p`, `4k` |
| `rating` | string | Rating filter: `4`, `4..5` |
| `tags` | string | Comma-separated tags |
| `take` | number | Limit results |
| `skip` | number | Offset for pagination |
| `{source}.{key}` | string | Adapter-specific filter |

### List Containers

```
GET /content/list?[params]
```

| Param | Type | Description |
|-------|------|-------------|
| `from` | string | Container alias or full ID |
| `source` | string | Source filter |
| `sort` | string | `date`, `title`, `random` (alias: `shuffle`) |
| `pick` | string | `random` - select one container, return its contents |
| `take` | number | Limit results |
| `skip` | number | Offset for pagination |

**`sort` vs `pick`:**

| Param | Returns | Use Case |
|-------|---------|----------|
| `sort=random` | Shuffled list of containers | "Playlists in random order" |
| `pick=random` | Contents of randomly selected container | "Photos from a random playlist" |

### Examples

```
# All playlists from all sources
GET /content/list?from=playlists

# Only Plex playlists
GET /content/list?from=playlists&source=plex

# Playlists in random order
GET /content/list?from=playlists&shuffle

# Photos from a random playlist
GET /content/list?from=playlists&pick=random

# Videos from a random playlist, filtered to 3-10 min
GET /content/list?from=playlists&pick=random&mediaType=video&duration=3m..10m

# Photos from a random person
GET /content/list?from=people&pick=random&source=gallery

# Photos of Alice from 2025
GET /content/search?source=gallery&person=alice&time=2025

# Audiobooks narrated by Stephen Fry
GET /content/search?source=readable&abs.narrator=Stephen Fry

# All playable content (videos, audiobooks, music)
GET /content/search?capability=playable

# Videos from any gallery source
GET /content/search?source=gallery&mediaType=video

# Workout videos between 3-10 minutes
GET /content/search?mediaType=video&duration=3m..10m&tags=workout

# Short clips under 5 minutes from 2025
GET /content/search?mediaType=video&duration=..5m&time=2025

# Highly rated movies (4+ stars)
GET /content/search?source=media&mediaType=video&rating=4..5

# 4K content
GET /content/search?source=media&resolution=4k

# Summer photos from any year
GET /content/search?source=gallery&mediaType=image&time=summer

# Long audiobooks (10+ hours)
GET /content/search?source=readable&capability=playable&durationMin=36000
```

---

## Response Format

### Search Response

```json
{
  "query": {
    "source": "gallery",
    "person": "alice",
    "time": "2025"
  },
  "sources": ["immich", "immich-family"],
  "total": 142,
  "items": [
    {
      "id": "immich:abc-123",
      "source": "immich",
      "title": "Beach Day",
      "itemType": "leaf",
      "thumbnail": "/api/v1/proxy/immich/assets/abc-123/thumbnail",
      "metadata": {
        "type": "image",
        "capturedAt": "2025-06-15T14:30:00Z",
        "people": ["alice", "bob"]
      }
    }
  ]
}
```

### List Response

```json
{
  "from": "playlists",
  "sources": ["immich", "plex"],
  "total": 8,
  "items": [
    {
      "id": "immich:album:vacation-2025",
      "source": "immich",
      "title": "Vacation 2025",
      "itemType": "container",
      "childCount": 47,
      "thumbnail": "/api/v1/proxy/immich/assets/xyz/thumbnail"
    },
    {
      "id": "plex:playlist:123",
      "source": "plex",
      "title": "Workout Mix",
      "itemType": "container",
      "childCount": 12,
      "thumbnail": "/api/v1/proxy/plex/..."
    }
  ]
}
```

### List Response with `pick=random`

When `pick=random` is specified, the response contains the contents of the randomly selected container, with metadata about which container was picked:

```json
{
  "from": "playlists",
  "picked": {
    "id": "immich:album:vacation-2025",
    "source": "immich",
    "title": "Vacation 2025"
  },
  "sources": ["immich"],
  "total": 47,
  "items": [
    {
      "id": "immich:photo-1",
      "source": "immich",
      "title": "Beach.jpg",
      "itemType": "leaf",
      "thumbnail": "/api/v1/proxy/immich/assets/photo-1/thumbnail",
      "metadata": { "type": "image" }
    },
    {
      "id": "immich:photo-2",
      "source": "immich",
      "title": "Sunset.jpg",
      "itemType": "leaf",
      "thumbnail": "/api/v1/proxy/immich/assets/photo-2/thumbnail",
      "metadata": { "type": "image" }
    }
  ]
}
```

**Flow for `pick=random`:**
1. Get all containers matching `from` (and `source` if specified)
2. Pick one randomly
3. Get contents of that container
4. Apply any filters (`mediaType`, `duration`, etc.) to contents
5. Return filtered contents with `picked` metadata

---

## Architecture (DDD Layers)

### Layer Responsibilities

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **API** | `4_api/` | Parse HTTP params → `ContentQuery`, call service, format response |
| **Application** | `3_applications/` | `ContentQueryService` - orchestrate, translate keys, merge results |
| **Domain** | `2_domains/` | `ContentSourceRegistry` - source/category/provider resolution. Entities (`ListableItem`, etc.) |
| **Adapter** | `1_adapters/` | Implement `search()`, `getList()`, declare query mappings |

### Query Normalization (API Layer)

The API layer normalizes HTTP params before passing to the application layer. This handles:
- Parameter aliases (`src` → `source`, `shuffle` → `sort=random`)
- Boolean coercion (`shuffle=1`, `shuffle=true`, `&shuffle` all → true)
- Type conversion (strings to numbers for `take`, `skip`)

**File structure:**

```
4_api/
├── v1/
│   ├── routers/
│   │   └── content.mjs              # Routes
│   └── parsers/
│       └── contentQueryParser.mjs   # Normalization
```

**Query Parser:**

```javascript
// 4_api/v1/parsers/contentQueryParser.mjs

export const QUERY_ALIASES = {
  // Sort aliases
  sort: {
    'shuffle': 'random',
    'rand': 'random',
  },
  // Source aliases
  source: {
    'src': null,       // src is alias for source param itself
    'photos': 'gallery',
  },
  // Boolean params (key existence = true)
  booleans: ['shuffle', 'favorites', 'random'],
};

const BOOLEAN_TRUTHY = ['1', 'true', 'yes', ''];

/**
 * Normalize raw HTTP query params into ContentQuery object.
 */
export function parseContentQuery(rawParams) {
  const query = {};

  // Source (with alias support)
  const source = rawParams.source ?? rawParams.src;
  if (source) {
    query.source = QUERY_ALIASES.source[source] ?? source;
  }

  // Sort normalization
  let sort = rawParams.sort;
  if (!sort && hasKey(rawParams, 'shuffle')) {
    sort = 'random';
  }
  if (sort) {
    query.sort = QUERY_ALIASES.sort[sort] ?? sort;
  }

  // Pick (for random container selection)
  if (rawParams.pick) query.pick = rawParams.pick;

  // Boolean params
  if (isTruthy(rawParams.shuffle)) query.sort = 'random';
  if (isTruthy(rawParams.favorites)) query.favorites = true;

  // Canonical filters (pass through)
  const canonicalKeys = [
    'text', 'person', 'creator', 'time', 'timeFrom', 'timeTo',
    'duration', 'durationMin', 'durationMax', 'mediaType',
    'capability', 'tags', 'resolution', 'rating', 'from'
  ];
  for (const key of canonicalKeys) {
    if (rawParams[key] !== undefined) query[key] = rawParams[key];
  }

  // Pagination (convert to numbers)
  if (rawParams.take) query.take = parseInt(rawParams.take, 10);
  if (rawParams.skip) query.skip = parseInt(rawParams.skip, 10);

  // Adapter-specific keys (prefix.key format) - pass through
  for (const [key, value] of Object.entries(rawParams)) {
    if (key.includes('.')) {
      query[key] = value;
    }
  }

  return query;
}

function hasKey(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isTruthy(value) {
  if (value === undefined) return false;
  return BOOLEAN_TRUTHY.includes(String(value).toLowerCase());
}
```

**Router usage:**

```javascript
// 4_api/v1/routers/content.mjs
import { parseContentQuery } from '../parsers/contentQueryParser.mjs';

router.get('/search', async (req, res) => {
  const query = parseContentQuery(req.query);
  const results = await contentQueryService.search(query);
  res.json(results);
});

router.get('/list', async (req, res) => {
  const query = parseContentQuery(req.query);
  const results = await contentQueryService.list(query);
  res.json(results);
});
```

**Equivalent queries:**

```
# These all do the same thing:
/content/list?from=playlists&sort=shuffle
/content/list?from=playlists&sort=random
/content/list?from=playlists&shuffle=1
/content/list?from=playlists&shuffle=true
/content/list?from=playlists&shuffle

# Source aliases:
/content/search?source=gallery
/content/search?src=gallery
/content/search?src=photos
```

### Query Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ 4_api/v1/routers/content.mjs                                        │
│                                                                     │
│   GET /content/search?source=gallery&person=alice&time=2025         │
│                           │                                         │
│                           ▼                                         │
│   Parse HTTP params → ContentQuery object                           │
└───────────────────────────│─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3_applications/content/ContentQueryService.mjs                      │
│                                                                     │
│   1. Resolve source → adapter list (via registry)                   │
│   2. Filter adapters that can handle query                          │
│   3. Translate canonical keys → adapter-specific                    │
│   4. Execute search on each adapter                                 │
│   5. Merge results                                                  │
│   6. Apply capability filter                                        │
└───────────────────────────│─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2_domains/content/services/ContentSourceRegistry.mjs                │
│                                                                     │
│   - resolveSource(source) → [adapters]                              │
│   - Index by category, provider, source                             │
│   - No HTTP or manifest knowledge                                   │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1_adapters/content/gallery/immich/ImmichAdapter.mjs                 │
│                                                                     │
│   - search(adapterQuery) → results                                  │
│   - getQueryMappings() → { person: 'personIds', ... }               │
│   - getContainerAliases() → { playlists: 'album:', ... }            │
└─────────────────────────────────────────────────────────────────────┘
```

### ContentQueryService (Application Layer)

Orchestrates multi-source queries:

```javascript
// 3_applications/content/ContentQueryService.mjs
export class ContentQueryService {
  #registry;

  constructor({ registry }) {
    this.#registry = registry;
  }

  async search(query) {
    // 1. Resolve source param → adapter list
    const adapters = this.#registry.resolveSource(query.source);

    // 2. Execute search on each adapter that can handle the query
    const results = await Promise.all(
      adapters
        .filter(a => this.#canHandle(a, query))
        .map(a => this.#executeSearch(a, query))
    );

    // 3. Merge and filter
    return this.#mergeResults(results, query);
  }

  async list(from, source) {
    const adapters = this.#registry.resolveSource(source);
    const results = await Promise.all(
      adapters.map(a => this.#executeList(a, from))
    );
    return this.#mergeResults(results);
  }

  #canHandle(adapter, query) {
    const caps = adapter.getSearchCapabilities?.() ?? {};
    // Check if adapter supports at least one query key
    return Object.keys(query).some(k =>
      caps.canonical?.includes(k) || caps.specific?.includes(k)
    );
  }

  #executeSearch(adapter, query) {
    const translated = this.#translateQuery(adapter, query);
    return adapter.search(translated);
  }

  #translateQuery(adapter, canonicalQuery) {
    const mappings = adapter.getQueryMappings?.() ?? {};
    const translated = {};

    for (const [key, value] of Object.entries(canonicalQuery)) {
      if (mappings[key]) {
        // Apply mapping (could be string or object for complex mappings)
        const mapping = mappings[key];
        if (typeof mapping === 'string') {
          translated[mapping] = value;
        } else if (mapping.from && mapping.to) {
          // Range mapping (e.g., time → takenAfter/takenBefore)
          const [fromVal, toVal] = this.#parseRange(value);
          if (fromVal) translated[mapping.from] = fromVal;
          if (toVal) translated[mapping.to] = toVal;
        }
      } else {
        // Pass through unmapped keys
        translated[key] = value;
      }
    }
    return translated;
  }

  #parseRange(value) {
    if (typeof value !== 'string' || !value.includes('..')) {
      return [value, value];
    }
    const [from, to] = value.split('..');
    return [from || null, to || null];
  }

  #mergeResults(results, query = {}) {
    let items = results.flatMap(r => r.items || []);

    // Apply capability filter if specified
    if (query.capability) {
      items = items.filter(item =>
        this.#hasCapability(item, query.capability)
      );
    }

    return {
      items,
      total: items.length,
      sources: [...new Set(items.map(i => i.source))]
    };
  }

  #hasCapability(item, capability) {
    const capMap = {
      playable: () => typeof item.isPlayable === 'function' && item.isPlayable(),
      displayable: () => !!item.imageUrl,  // Displayable items have imageUrl
      readable: () => typeof item.isReadable === 'function' && item.isReadable(),
      listable: () => typeof item.isContainer === 'function',
    };
    return capMap[capability]?.() ?? false;
  }
}
```

### ContentSourceRegistry (Domain Layer)

Source resolution only - no HTTP or infrastructure concerns:

```javascript
// 2_domains/content/services/ContentSourceRegistry.mjs
export class ContentSourceRegistry {
  #adapters = new Map();      // source → { adapter, category, provider }
  #categoryIndex = new Map(); // category → [sources]
  #providerIndex = new Map(); // provider → [sources]

  /**
   * Register an adapter with its domain metadata.
   * Note: category/provider extracted from manifest at bootstrap time,
   * not passed as manifest object (no infrastructure leak).
   */
  register(adapter, { category, provider }) {
    const source = adapter.source;

    this.#adapters.set(source, { adapter, category, provider });

    // Index by category
    if (!this.#categoryIndex.has(category)) {
      this.#categoryIndex.set(category, []);
    }
    this.#categoryIndex.get(category).push(source);

    // Index by provider
    if (!this.#providerIndex.has(provider)) {
      this.#providerIndex.set(provider, []);
    }
    this.#providerIndex.get(provider).push(source);
  }

  /**
   * Resolve source param to adapter list.
   * Priority: exact source → provider → category → all
   */
  resolveSource(sourceParam) {
    if (!sourceParam) {
      return this.#allAdapters();
    }

    // 1. Exact source match
    const exact = this.#adapters.get(sourceParam);
    if (exact) return [exact.adapter];

    // 2. Provider match (e.g., "immich" → all immich instances)
    const byProvider = this.#providerIndex.get(sourceParam);
    if (byProvider?.length) {
      return byProvider.map(s => this.#adapters.get(s).adapter);
    }

    // 3. Category match (e.g., "gallery" → all gallery sources)
    const byCategory = this.#categoryIndex.get(sourceParam);
    if (byCategory?.length) {
      return byCategory.map(s => this.#adapters.get(s).adapter);
    }

    return [];
  }

  #allAdapters() {
    return [...this.#adapters.values()].map(e => e.adapter);
  }
}
```

### Adapter Interface

Adapters implement:

```javascript
// Required (existing)
get source()                    // Unique source name
get prefixes()                  // URL prefixes handled
getItem(id)                     // Get single item
getList(id)                     // List container contents

// For search support
search(query)                   // Search with translated query
getSearchCapabilities()         // { canonical: [...], specific: [...] }

// For query translation (application layer uses this)
getQueryMappings()              // { person: 'personIds', time: { from: '...', to: '...' } }

// For container aliases
getContainerAliases()           // { playlists: 'album:', people: 'person:' }
getRootContainers()             // ['albums', 'people', 'cameras']
```

### Bootstrap Registration

Manifest data is extracted at bootstrap, only domain-relevant fields passed to registry:

```javascript
// 0_system/bootstrap.mjs
import manifest from '#adapters/content/gallery/immich/manifest.mjs';

// Extract domain-relevant metadata (no manifest object in domain)
const { category, provider } = manifest;

contentRegistry.register(immichAdapter, { category, provider });
```

---

## Error Handling

### Error Scenarios

| Scenario | Behavior | Response |
|----------|----------|----------|
| Unknown source | Return empty results | `{ items: [], sources: [], total: 0 }` |
| No adapters support query | Return empty results | `{ items: [], sources: [], total: 0 }` |
| One adapter fails, others succeed | Log error, return partial results | Include `warnings` array |
| Invalid range syntax | 400 Bad Request | `{ error: "Invalid duration format: xyz" }` |
| `pick=random` with no containers | Return empty | `{ picked: null, items: [], total: 0 }` |

### Partial Failure Response

When some adapters fail but others succeed, return partial results with warnings:

```json
{
  "query": { "source": "gallery", "person": "alice" },
  "sources": ["immich"],
  "warnings": [
    { "source": "immich-family", "error": "Connection timeout" }
  ],
  "total": 42,
  "items": [...]
}
```

### Validation

Input validation happens in the API layer before calling the application service:

```javascript
// 4_api/v1/parsers/contentQueryParser.mjs

export function validateContentQuery(query) {
  const errors = [];

  if (query.duration && !isValidDuration(query.duration)) {
    errors.push({ field: 'duration', message: `Invalid format: ${query.duration}` });
  }

  if (query.time && !isValidTime(query.time)) {
    errors.push({ field: 'time', message: `Invalid format: ${query.time}` });
  }

  if (query.take && (query.take < 1 || query.take > 1000)) {
    errors.push({ field: 'take', message: 'Must be between 1 and 1000' });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}
```

### Pagination for Merged Results

When merging from multiple sources, pagination is applied post-merge:

1. Fetch all results from all adapters (ignoring skip/take)
2. Merge results
3. Apply skip/take to merged list
4. Return paginated results with total count

This is simple but less efficient for large result sets. Can be optimized later with distributed pagination if needed.

---

## Design Principles

1. **Implicit first, explicit override** - Canonical keys work by default; adapter-specific keys for precision
2. **Best effort matching** - Unknown keys are ignored, not errors
3. **Uniform navigation** - Containers are just ListableItems; no special "facet" abstraction
4. **Source resolution hierarchy** - Exact → Provider → Category → All
5. **Capability orthogonal to category** - A gallery source can have playable items; a readable source can have playable audiobooks
6. **Extensible filters** - New canonical keys can be added without breaking existing queries; adapters implement what they support
7. **Graceful degradation** - Partial failures return partial results with warnings, not errors
