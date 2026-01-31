# Immich Adapter Design

## Overview

Build out the Immich content adapter following the Plex pattern, enabling DaylightStation to ingest photos and videos from Immich as a gallery source. Additionally, introduce a unified search interface at the media domain level that all adapters can implement.

## Context

- **ImmichProxyAdapter** already exists for HTTP proxying with `x-api-key` auth
- **Plex pattern** provides the template: `PlexClient` (API) + `PlexAdapter` (content interface)
- **Use cases**: Photo slideshows, TV interstitials, memories/on-this-day features
- **Query-first access**: Unlike Plex (ID-first), Immich often starts with queries (photos of X in 2025)

## Immich API Surface (Verified v2.5.2)

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/server/version` | GET | Health check |
| `/api/assets/{id}` | GET | Single asset with full metadata + exifInfo |
| `/api/assets/{id}/thumbnail` | GET | Thumbnail image (webp) |
| `/api/assets/{id}/video/playback` | GET | Video stream (mp4) |
| `/api/search/metadata` | POST | Query assets (primary search method) |
| `/api/albums` | GET | List albums |
| `/api/albums/{id}` | GET | Album with assets |
| `/api/people` | GET | Face recognition list |
| `/api/timeline/buckets` | GET | Date-grouped counts |

### Authentication

- Header: `x-api-key: {token}`
- Token stored in `auth/immich.yml`

### Asset Structure

```javascript
{
  id: "931cb18f-2642-489b-bff5-c554e8ad4249",  // UUID format
  type: "IMAGE" | "VIDEO",
  originalFileName: "2026-01-25 06.57.10.jpg",
  originalMimeType: "image/jpeg",
  duration: "00:05:17.371",  // HH:MM:SS.mmm format (videos)
  duration: "0:00:00.00000", // Zero for images
  thumbhash: "cAgCBQBnqIB5SYeoeIaImABVeAJk",
  width: 2277,
  height: 2949,
  isFavorite: false,
  isArchived: false,
  isTrashed: false,
  visibility: "timeline",
  people: [],  // Array of person objects
  exifInfo: {
    dateTimeOriginal: "2026-01-25T14:57:10+00:00",
    city: "East Hill-Meridian",
    state: "Washington",
    country: "United States of America",
    latitude: 47.425,
    longitude: -122.198888888889,
    make: "samsung",
    model: "Galaxy S24",
    fNumber: 1.8,
    iso: 200,
    rating: null
  }
}
```

## Domain Model Mapping

### Immich → DaylightStation

| Immich Concept | Domain Entity | Notes |
|----------------|---------------|-------|
| Album | `ListableItem` (container) | Has children, childCount |
| Photo | `ListableItem` (leaf) | No mediaUrl, just thumbnail |
| Photo (slideshow) | `PlayableItem` (image) | Synthetic duration for timed display |
| Video | `PlayableItem` (video) | Actual duration from metadata |

### Field Mapping

```javascript
// Immich Asset → Domain
{
  id: "931cb18f-...",                   → id: "immich:931cb18f-..."
  type: "IMAGE",                        → ListableItem { itemType: 'leaf' }
  type: "VIDEO",                        → PlayableItem { mediaType: 'video' }
  originalFileName: "photo.jpg",        → title: "photo.jpg"
  thumbhash: "cAgCBQ...",               → metadata.thumbhash
  width/height,                         → metadata.dimensions
  isFavorite,                           → metadata.favorite
  exifInfo.dateTimeOriginal,            → metadata.capturedAt
  exifInfo.city/state/country,          → metadata.location
  exifInfo.make/model,                  → metadata.camera
  people,                               → metadata.people
}

// URLs (via proxy)
thumbnail: "/api/v1/proxy/immich/assets/{id}/thumbnail"
mediaUrl (video): "/api/v1/proxy/immich/assets/{id}/video/playback"
imageUrl (full): "/api/v1/proxy/immich/assets/{id}/original"
```

### Duration Parsing

```javascript
// "00:05:17.371" → 317 seconds
function parseDuration(durationStr) {
  if (!durationStr || durationStr === "0:00:00.00000") return null;
  const [h, m, rest] = durationStr.split(':');
  const [s] = rest.split('.');
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s);
}
```

## Search Interface Design

### IMediaSearchable Interface

```javascript
// backend/src/2_domains/media/IMediaSearchable.mjs

/**
 * @typedef {Object} MediaSearchQuery
 * @property {string} [text] - Free text search (title, description)
 * @property {string[]} [people] - Person names or IDs
 * @property {string} [dateFrom] - ISO date start
 * @property {string} [dateTo] - ISO date end
 * @property {string} [location] - City, state, or country
 * @property {number[]} [coordinates] - [lat, lng] for geo search
 * @property {number} [radius] - Radius in km (with coordinates)
 * @property {'image'|'video'|'audio'} [mediaType] - Filter by type
 * @property {boolean} [favorites] - Only favorites
 * @property {number} [ratingMin] - Minimum rating (1-5)
 * @property {string[]} [tags] - Tag/label names
 * @property {number} [take] - Limit results
 * @property {number} [skip] - Offset for pagination
 * @property {'date'|'title'|'random'} [sort] - Sort order
 */

/**
 * @typedef {Object} MediaSearchResult
 * @property {Array<ListableItem|PlayableItem>} items - Matched items
 * @property {number} total - Total matches (for pagination)
 * @property {Object} [facets] - Aggregations (people counts, date buckets)
 */

export const IMediaSearchable = {
  async search(query) {},
  getSearchCapabilities() { return []; }
};
```

### Capability Matrix

| Query Field | Immich | Plex | Filesystem |
|-------------|--------|------|------------|
| `text` | ✓ | ✓ | ✓ |
| `people` | ✓ | ✗ | ✗ |
| `dateFrom/dateTo` | ✓ | ✓ | ✓ |
| `location` | ✓ | ✗ | ✗ |
| `coordinates` | ✓ | ✗ | ✗ |
| `mediaType` | ✓ | ✓ | ✓ |
| `favorites` | ✓ | ✗ | ✗ |
| `ratingMin` | ✓ | ✓ | ✗ |
| `tags` | ✓ | ✓ | ✗ |

## File Structure

### New Files

```
backend/src/
├── 2_domains/media/
│   ├── IMediaSearchable.mjs          # Search interface
│   ├── MediaSearchQuery.mjs          # Query value object
│   ├── MediaKeyResolver.mjs          # UPDATE: Add 'immich' to knownSources
│   └── index.mjs                     # UPDATE: Export new interfaces
│
├── 1_adapters/content/gallery/immich/
│   ├── ImmichAdapter.mjs             # IContentSource + IMediaSearchable
│   ├── ImmichClient.mjs              # Low-level API client
│   └── manifest.mjs                  # Provider metadata
│
├── 3_applications/media/services/
│   └── MediaSearchService.mjs        # Cross-source search orchestration

tests/isolated/
├── adapter/content/
│   └── ImmichAdapter.test.mjs        # Unit tests
├── domains/media/
│   └── IMediaSearchable.test.mjs     # Interface contract tests
```

### Existing Files (No Changes Needed)

```
backend/src/1_adapters/proxy/ImmichProxyAdapter.mjs  # Already exists
data/household/auth/immich.yml                        # Already exists
data/household/config/integrations.yml                # Already configured
data/system/config/services.yml                       # Already configured
```

## Implementation Plan

### Phase 1: Domain Layer

1. Create `IMediaSearchable.mjs` - interface definition
2. Create `MediaSearchQuery.mjs` - query value object with validation
3. Update `MediaKeyResolver.mjs` - add 'immich' to knownSources with UUID pattern

### Phase 2: Adapter Layer

1. Create `ImmichClient.mjs` - thin API wrapper
   - `getAsset(id)` → single asset
   - `getAlbums()` → album list
   - `getAlbumAssets(albumId)` → assets in album
   - `getPeople()` → face recognition list
   - `searchMetadata(query)` → search API
   - `getTimelineBuckets()` → date groupings

2. Create `ImmichAdapter.mjs` - implements interfaces
   - `IContentSource`: source, prefixes, getItem, getList, resolvePlayables
   - `IMediaSearchable`: search, getSearchCapabilities

3. Create `manifest.mjs` - provider config schema

### Phase 3: Application Layer

1. Create `MediaSearchService.mjs` - multi-source search orchestration

### Phase 4: Tests

1. Contract tests for `IMediaSearchable`
2. Unit tests for `ImmichAdapter` (mocked client)
3. Integration test with live API (optional, uses real credentials)

## API Examples

### ImmichClient

```javascript
const client = new ImmichClient({ host, apiKey }, { httpClient });

// Get single asset
const asset = await client.getAsset('931cb18f-2642-489b-bff5-c554e8ad4249');

// Search for photos
const results = await client.searchMetadata({
  type: 'IMAGE',
  personIds: ['ed9bc3fb-d957-446f-b1e3-493a5d6bc76f'],
  take: 50
});

// Get people list
const people = await client.getPeople();
```

### ImmichAdapter

```javascript
const adapter = new ImmichAdapter(config, { httpClient });

// Get album contents
const items = await adapter.getList('immich:album:xyz-789');

// Search for photos of Felix
const results = await adapter.search({
  people: ['Felix'],
  dateFrom: '2025-12-01',
  mediaType: 'image'
});

// Resolve album to slideshow queue
const playables = await adapter.resolvePlayables('immich:album:xyz-789');
// Returns PlayableItem[] with mediaType: 'image', duration: 10 (configurable)
```

### MediaSearchService

```javascript
const searchService = new MediaSearchService({ adapters });

// Cross-source search
const results = await searchService.search({
  text: 'vacation',
  dateFrom: '2025-06-01',
  dateTo: '2025-08-31'
}, ['immich', 'plex']);

// Get capabilities
const caps = searchService.getCapabilities();
// { immich: ['text', 'people', 'dateFrom', ...], plex: ['text', 'dateFrom', ...] }
```

## Config Integration

```yaml
# integrations.yml
gallery:
  - provider: immich

# services.yml
immich:
  docker: http://immich:2283
  kckern-server: http://localhost:2283

# auth/immich.yml
token: {api-key}
```

## Open Questions

1. **Slideshow duration**: Default seconds per image? Configurable per album?
2. **People name resolution**: Cache people list or fetch on each search?
3. **Timeline buckets**: Expose as virtual albums or separate API?
4. **Smart search**: Use Immich CLIP search for natural language queries?
