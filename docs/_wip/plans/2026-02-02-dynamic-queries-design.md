# Dynamic Queries as Content Sources - Design

**Date:** 2026-02-02
**Status:** Draft
**Priority:** P2

## Overview

Queries are the **fourth list type** in the content lists taxonomy. Unlike menus, programs, and watchlists which have manually curated items, queries dynamically populate from search results each time they're accessed.

```
data/household/config/lists/
├── menus/           # Manual curation - static items
├── programs/        # Manual + scheduling - day-based filtering
├── watchlists/      # Manual + progress - watch state tracking
└── queries/         # Dynamic from search - fresh results each time
```

### ID Format

```
query:beach-with-dad
query:recent-family-photos
query:unwatched-comedies
```

### Key Concepts

- **Dynamic container** - Query resolves to a virtual container (like an album) populated fresh each time
- **Source-agnostic** - Queries can target any content source (Immich, Plex, Local) or all sources
- **Presets** - System-defined templates to help build common query patterns
- **Overrides** - Menu items can tweak saved queries with additional filters

---

## Query File Format

**Location:** `data/household/config/lists/queries/{name}.yml`

### Basic Query

```yaml
# beach-with-dad.yml
title: Beach Photos with Dad
description: Beach vacation photos featuring Dad

query:
  text: beach
  person: Dad
```

### Full Query with All Options

```yaml
# family-christmas-2024.yml
title: Christmas 2024 Family Photos
description: Photos from Christmas 2024 with family members

query:
  # Search parameters
  text: christmas
  person: [Mom, Dad, Kids]      # Multiple people
  source: immich                 # Optional - defaults to all sources
  mediaType: image               # image, video, or omit for both

  # Date range
  time:
    from: "2024-12-20"
    to: "2024-12-31"

  # Location
  location: "Salt Lake City"

  # Other filters
  favorites: true
  tags: [holiday, family]

# Result handling
limit: 100                       # Max results (default: unlimited)
sort: recent                     # random, recent, relevance (default: relevance)
```

### Multi-Source Query

```yaml
# christmas-media.yml
title: All Christmas Media
description: Photos and videos from any source

query:
  text: christmas
  source: [immich, plex, local]  # Explicit multi-source
```

### Plex-Style Smart Playlist

```yaml
# unwatched-comedies.yml
title: Unwatched Comedies
description: Comedy movies I haven't seen yet

query:
  source: plex
  genre: Comedy
  year:
    from: 2020
  unwatched: true

sort: random
limit: 20
```

### Local Media Query

```yaml
# video-clips.yml
title: Recent Video Clips
description: Video clips from the last 30 days

query:
  source: local
  mediaType: video
  path: video/clips/*
  time:
    from: "-30d"

sort: recent
```

---

## Query Parameters Reference

### Common Parameters (All Sources)

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | string | Keyword search |
| `source` | string/array | Target source(s), defaults to all |
| `mediaType` | string | `image`, `video`, `audio` |
| `time.from` | string | Start date (ISO or relative `-30d`) |
| `time.to` | string | End date (ISO or relative) |
| `limit` | number | Max results |
| `sort` | string | `random`, `recent`, `relevance` |

### Immich-Specific

| Parameter | Type | Description |
|-----------|------|-------------|
| `person` | string/array | Person name(s) |
| `location` | string | City or place name |
| `favorites` | boolean | Only favorites |
| `tags` | array | Tag names |

### Plex-Specific

| Parameter | Type | Description |
|-----------|------|-------------|
| `genre` | string | Genre filter |
| `year.from` | number | Release year start |
| `year.to` | number | Release year end |
| `unwatched` | boolean | Only unwatched |
| `collection` | string | Collection name |

### Local-Specific

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | Path glob pattern |
| `artist` | string | Audio artist (ID3) |
| `album` | string | Audio album (ID3) |

---

## Menu Item Integration

### Basic Reference

```yaml
# In a menu
- label: Beach Photos with Dad
  input: 'query:beach-with-dad'
  action: List
```

### With Query Overrides

Menu items can add or override query parameters:

```yaml
- label: Recent Beach with Dad
  input: 'query:beach-with-dad'
  action: List
  queryOverrides:
    time:
      from: "-90d"
    limit: 20

- label: Beach Videos Only
  input: 'query:beach-with-dad'
  action: Play
  queryOverrides:
    mediaType: video
    sort: random
```

### Action Behavior

| Action | Result |
|--------|--------|
| `List` | Shows query results as browsable container |
| `Play` | Resolves to playable items (slideshow/playlist) |
| `Queue` | Adds resolved items to playback queue |

---

## ListAdapter Extension

ListAdapter handles `query:` prefix alongside existing list types:

```javascript
class ListAdapter {
  prefixes = [
    { prefix: 'menu' },
    { prefix: 'program' },
    { prefix: 'watchlist' },
    { prefix: 'query' }        // New
  ];

  async getList(id) {
    const [type, name] = this.parseId(id);

    if (type === 'query') {
      return this.resolveQuery(name);
    }
    // ... existing list handling
  }

  async resolveQuery(name, overrides = {}) {
    const queryDef = this.loadQueryFile(name);
    const mergedQuery = { ...queryDef.query, ...overrides };

    // Execute search via ContentQueryService
    const results = await this.contentQueryService.search(mergedQuery);

    // Return as virtual container
    return {
      id: `query:${name}`,
      source: 'list',
      title: queryDef.title,
      itemType: 'container',
      children: results.items,
      metadata: {
        category: ContentCategory.LIST,
        listType: 'query',
        description: queryDef.description,
        childCount: results.total,
        dynamic: true
      }
    };
  }
}
```

---

## Query Presets

System-defined templates to help build queries.

**Location:** `backend/config/query-presets.yml`

```yaml
presets:
  - name: photos-of-person
    label: "Photos of [Person]"
    description: "All photos featuring a specific person"
    template:
      source: immich
      person: "{{person}}"
      mediaType: image
    variables:
      - name: person
        type: household-member
        label: Person
        required: true

  - name: recent-from-location
    label: "Recent from [Location]"
    description: "Photos from a location in the last 30 days"
    template:
      source: immich
      location: "{{location}}"
      time:
        from: "-30d"
    variables:
      - name: location
        type: string
        label: Location
        required: true

  - name: unwatched-genre
    label: "Unwatched [Genre]"
    description: "Unwatched movies of a specific genre"
    template:
      source: plex
      genre: "{{genre}}"
      unwatched: true
    variables:
      - name: genre
        type: string
        label: Genre
        required: true

  - name: random-favorites
    label: "Random Favorites"
    description: "Random selection of favorite photos"
    template:
      source: immich
      favorites: true
    defaults:
      sort: random
      limit: 50
```

### Preset Variables

| Type | UI Component |
|------|--------------|
| `string` | TextInput |
| `household-member` | Member dropdown |
| `number` | NumberInput |
| `date` | DatePicker |

---

## Admin UI

### Location

Content Lists → Queries tab (alongside Menus, Programs, Watchlists)

### Entry Points

1. **Content Lists → Queries → New Query** - Full query builder
2. **Search results → "Save this search"** - Quick save current search

### Query Builder (Progressive Disclosure)

```
┌─────────────────────────────────────────────┐
│ Create Query                                │
├─────────────────────────────────────────────┤
│ Name: [beach-with-dad            ]          │
│ Title: [Beach Photos with Dad    ]          │
│ Description: [                   ]          │
│                                             │
│ Source: (•) All  ( ) Immich  ( ) Plex       │
│                                             │
│ ▼ Keywords ─────────────────────────────    │
│   Text: [beach                    ]         │
│                                             │
│ ▼ People ───────────────────────────────    │
│   [Dad                           ] [+ Add]  │
│                                             │
│ ▶ Date Range                                │
│ ▶ Location                                  │
│ ▶ Media Type                                │
│ ▶ Advanced (limit, sort)                    │
│                                             │
│ ─────────────────────────────────────────── │
│ Preview: 47 results              [Refresh]  │
│                                             │
│                    [Cancel]  [Save Query]   │
└─────────────────────────────────────────────┘
```

**Collapsed sections** - Only expand what's needed, reduces clutter.

**Live preview** - Shows result count, can expand to see sample results.

### "Save This Search" Flow

From search results page:

1. User performs search (e.g., "beach" with person filter)
2. Clicks "Save this search" button
3. Modal prompts for name and title
4. Query saved to `lists/queries/{name}.yml`

---

## Search & Autocomplete

Queries appear in content search results:

```javascript
// User types "beach" in admin input field
[
  { id: 'query:beach-with-dad', title: 'Beach Photos with Dad', ... },
  { id: 'immich:album:Beach Trip 2024', title: 'Beach Trip 2024', ... },
  { id: 'plex:12345', title: 'Beach Party Movie', ... }
]
```

**Filtering:** User can type `query:` prefix to see only saved queries.

**Relevance:** Queries scored as `ContentCategory.LIST` (score 40), same as other list types.

---

## API Endpoints

Queries use existing list endpoints:

```
GET  /api/v1/admin/content/lists/queries          # List all queries
POST /api/v1/admin/content/lists/queries          # Create query
GET  /api/v1/admin/content/lists/queries/:name    # Get query definition
PUT  /api/v1/admin/content/lists/queries/:name    # Update query
DELETE /api/v1/admin/content/lists/queries/:name  # Delete query
```

**Additional endpoints:**

```
GET  /api/v1/queries/presets                      # Get available presets
POST /api/v1/queries/preview                      # Preview query results
```

### Preview Request

```json
{
  "query": {
    "text": "beach",
    "person": "Dad",
    "source": "immich"
  },
  "limit": 10
}
```

### Preview Response

```json
{
  "total": 47,
  "items": [
    { "id": "immich:abc123", "title": "IMG_1234.jpg", "thumbnail": "..." },
    // ... sample items
  ]
}
```

---

## Runtime Resolution

When a menu item references `query:beach-with-dad`:

1. **Load query definition** from `lists/queries/beach-with-dad.yml`
2. **Apply overrides** from menu item's `queryOverrides` if present
3. **Execute search** via ContentQueryService
4. **Return virtual container** with results as children

```javascript
// Resolution flow
const queryDef = loadQuery('beach-with-dad');
const finalQuery = mergeOverrides(queryDef.query, menuItem.queryOverrides);
const results = await contentQueryService.search(finalQuery);

return {
  id: 'query:beach-with-dad',
  title: queryDef.title,
  itemType: 'container',
  children: results.items
};
```

---

## Summary

| Aspect | Decision |
|--------|----------|
| Storage | `lists/queries/{name}.yml` (fourth list type) |
| ID format | `query:{name}` |
| Sources | Default all, filter optional |
| Presets | System config templates with variables |
| Admin UI | Content Lists → Queries, progressive disclosure |
| Quick save | "Save this search" from search results |
| Autocomplete | Mixed with other sources, filterable by `query:` prefix |
| Overrides | Menu items can add/modify query parameters |

---

## Future Enhancements

- **Scheduled refresh** - Cache results with TTL for performance
- **Notifications** - Alert when query finds new results
- **Query sharing** - Export/import query definitions
- **Query chaining** - Query based on results of another query
