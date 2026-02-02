# Local Media and Lists as Content Sources - Design

**Date:** 2026-02-02
**Status:** Draft
**Priority:** P0

## Overview

Two new content source adapters join the registry alongside Plex and Immich:

1. **LocalMediaAdapter** (`source: 'local'`) - Browses configured filesystem paths, provides thumbnails, searches filename + metadata

2. **ListAdapter** (`source: 'list'`) - Exposes menus/programs/watchlists as content sources with prefixes `menu:`, `program:`, `watchlist:`

Both implement the standard content source interface:
- `getItem(id)` - Single item lookup
- `getList(id)` - Container contents
- `search(query)` - Text search with relevance scoring
- `resolvePlayables(id)` - Flatten to playable items

### ID Formats

```
local:video/clips              # folder
local:video/clips/intro.mp4   # file

menu:fhe                       # menu list
program:music-queue            # program list
watchlist:kids-movies          # watchlist
```

ContentSourceRegistry registers both adapters. Search results from all sources merge and sort via RelevanceScoringService.

---

## LocalMediaAdapter

### Configuration

Household config at `data/household/config/local-media.yml`:

```yaml
roots:
  - path: video/clips
    label: Video Clips
    mediaType: video
  - path: img/art
    label: Artwork
    mediaType: image
  - path: audio/scripture
    label: Scripture Audio
    mediaType: audio
```

### Browsing Behavior

- `getList('')` returns configured roots as containers
- `getList('video/clips')` returns folder contents (subfolders + files)
- Subfolders become containers, files become leaf items
- Each item gets `itemType: 'container'` or `'leaf'`

### Item Structure

Mirrors Immich/Plex patterns:

```javascript
{
  id: 'local:video/clips/intro.mp4',
  source: 'local',
  title: 'intro.mp4',
  itemType: 'leaf',
  thumbnail: '/api/v1/local/thumbnail/video/clips/intro.mp4',
  mediaType: 'video',
  metadata: {
    category: ContentCategory.MEDIA,
    path: 'video/clips',
    size: 12345678,
    duration: 120,  // from ffprobe
    mimeType: 'video/mp4'
  }
}
```

### Thumbnails

- **Endpoint:** `/api/v1/local/thumbnail/:path`
- **Generation:** On-demand, first request triggers creation
- **Cache location:** `{dataMount}/system/cache/thumbnails/{hash}.jpg`
- **Hash:** Based on file path + modified time (invalidates on file change)
- **Video:** ffmpeg extracts frame at 10% duration
- **Image:** sharp resizes to 300px width

### Metadata Index

**Storage:** `{dataMount}/system/cache/local-media-index.json`

**Structure:**
```javascript
{
  "video/clips/intro.mp4": {
    title: "intro.mp4",
    mediaType: "video",
    size: 12345678,
    duration: 120,
    mimeType: "video/mp4",
    modifiedAt: "2026-01-15T...",
    // Audio: ID3 tags (artist, album, track)
    // Images: EXIF (dimensions, camera, date taken)
  }
}
```

**Lifecycle:**
1. First search triggers full scan of configured roots
2. Extracts metadata via ffprobe (video/audio) or sharp/exif (images)
3. Writes index to cache file
4. Subsequent searches use cached index
5. Manual refresh via admin API (`POST /api/v1/local/reindex`)

### Search Behavior

- Matches against `title` and metadata fields (artist, album, etc.)
- Path displayed in results but not matched
- Results scored via RelevanceScoringService with `ContentCategory.MEDIA`

### resolvePlayables

- For files: returns single PlayableItem
- For folders: returns all playable files within

---

## ListAdapter

### Prefixes and Paths

| Prefix | Path |
|--------|------|
| `menu:` | `data/household/config/lists/menus/{name}.yml` |
| `program:` | `data/household/config/lists/programs/{name}.yml` |
| `watchlist:` | `data/household/config/lists/watchlists/{name}.yml` |

### Browsing Behavior

```javascript
// getList('menu:') → all menus as containers
[
  { id: 'menu:tv', title: 'TV', itemType: 'container', childCount: 10 },
  { id: 'menu:fhe', title: 'FHE', itemType: 'container', childCount: 25 },
]

// getList('menu:tv') → items within that menu
// (delegates to existing FolderAdapter-style parsing)
```

### Item Structure

```javascript
{
  id: 'menu:fhe',
  source: 'list',
  title: 'FHE',
  itemType: 'container',
  metadata: {
    category: ContentCategory.LIST,
    listType: 'menu',  // or 'program', 'watchlist'
    childCount: 25
  }
}
```

### Relationship to FolderAdapter

- **ListAdapter:** Handles list-as-content-source (browsing/searching lists themselves)
- **FolderAdapter:** Handles list-item-resolution (what's inside a list)
- ListAdapter may delegate to FolderAdapter internally

### Action Behavior

Action field controls behavior when menu item references another list:

| Action | Input | Result |
|--------|-------|--------|
| `List` | `menu:fhe` | Opens FHE as submenu navigation |
| `Play` | `menu:fhe` | Resolves FHE's playables and starts playback |
| `Queue` | `program:music-queue` | Queues the program's resolved items |

---

## Program Schedule Filtering

### Schedule Format

Array-based day format:

```yaml
days: ["Sunday"]
days: ["Saturday"]
days: ["M", "W", "F"]
days: ["T", "Th"]
```

### resolvePlayables Behavior

```javascript
// program:music-queue with today = Wednesday
// Only returns items where days includes Wednesday (or no days specified)

resolvePlayables('program:music-queue', { applySchedule: true })
// → items matching today's schedule

resolvePlayables('program:music-queue', { applySchedule: false })
// → all items regardless of schedule
```

### Menu Item Override

```yaml
# Default: schedule applies
- label: Today's Music
  input: 'program:music-queue'
  action: Queue

# Override: ignore schedule
- label: All Music Programs
  input: 'program:music-queue'
  action: List
  applySchedule: false
```

---

## Search & Relevance

### Search Scope

`search({ text: 'fhe' })` searches:
- List names (menu names, program names, watchlist names)
- Item labels within lists

Results include both levels:
```javascript
[
  { id: 'menu:fhe', title: 'FHE', itemType: 'container' },  // Menu itself
  { id: 'menu:tv', title: 'TV' },  // Contains item labeled "FHE Night"
]
```

### Relevance Scoring

New category in `ContentCategory.mjs`:

```javascript
LIST: 'list'  // Score: 40 (between CURATED:50 and MEDIA:30)
```

Lists rank below curated containers (albums, people) but above individual media items.

### Admin Autocomplete

Same search endpoint, mixed results. User types "music", sees:
- `program:music-queue`
- `plex:Music Library`
- `immich:album:Music Photos`

All sorted by relevance score.

---

## API Endpoints

### Local Media

```
GET  /api/v1/local/roots              # Configured entry points
GET  /api/v1/local/browse/:path       # Folder contents
GET  /api/v1/local/thumbnail/:path    # On-demand thumbnail
POST /api/v1/local/reindex            # Force index rebuild
```

### Content Search

```
GET  /api/v1/content/search?text=...  # Existing endpoint, now includes lists
```

---

## Admin UI Integration

**No changes needed.** The `input` field autocomplete already calls content search. With ListAdapter registered, typing "fhe" returns `menu:fhe` in results automatically.

Action dropdown already has Play, Queue, List, Display, Read. List action works naturally with `menu:` inputs for submenus.

---

## Open Questions (Defer to Implementation)

1. **Index staleness** - How long before index is considered stale? Manual refresh only, or time-based?
2. **Recursive resolvePlayables** - For local folders, resolve all nested files or single level?
3. **Thumbnail size** - 300px width standard, or configurable?

---

## Future Work (P1/P2)

- **P1: Apps as Content** - App registry with typed parameters
- **P2: Dynamic Image Queries** - Saved keyword searches that execute fresh each time
