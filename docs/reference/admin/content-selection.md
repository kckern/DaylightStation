# Content Selection

When creating list items (playlists, watchlists, workout queues), admins specify content via the `input` field. Content lives across multiple sources - Plex libraries, local media, Immich photos, YouTube, etc. Each uses standardized `source:localId` format.

## Content ID Format

All content references follow `source:localId`:

| Source | Example | Description |
|--------|---------|-------------|
| `plex` | `plex:12345` | Plex library item by rating key |
| `media` | `media:workouts/hiit.mp4` | Local media file by path |
| `immich` | `immich:abc-123` | Immich photo/video by asset ID |
| `youtube` | `youtube:dQw4w9WgXcQ` | YouTube video by ID |
| `query` | `query:dailynews` | Reference to saved query (see Mode 4) |

### Resolution Cascade

The system resolves IDs through a fallback cascade. Multiple formats can resolve to the same item:

```
Input ID
    │
    ├── Contains ".query:" ? ──────────► Query Path (ContentQueryService)
    │
    └── Explicit/Heuristic ───► Parse source:localId
                                        │
                                        ├── Known source? ──► Adapter lookup
                                        │
                                        ├── Known alias? ───► Expand, retry
                                        │
                                        └── No colon? ──────► Heuristic detection
                                                              (digits→plex, path→filesystem)
```

**Example:** These all resolve to the same Plex item:
- `plex:12345` — Explicit source
- `media:12345` — Alias expands to plex
- `12345` — Heuristic: digits → plex

**Alias mappings:**

| Alias | Resolves To |
|-------|-------------|
| `media:` | `filesystem` (or `plex` for numeric IDs) |
| `file:` | `filesystem` |
| `local:` | `folder` |
| `gallery:` | `immich` |
| `hymn:` | `singing:hymn/` |
| `scripture:` | `narrated:scripture/` |

**Heuristic detection:**

| Pattern | Resolved Source |
|---------|-----------------|
| Digits only (`12345`) | `plex` |
| Path-like (`audio/song.mp3`) | `filesystem` |

See `docs/reference/content/query-combinatorics.md` for full resolution rules.

## Four Modes of Content Selection

### Mode 1: Direct Input

Type the exact `source:id` when you already know it.

**When to use:** You have the ID from another source (API, URL, previous list).

**Flow:** Paste or type directly into input field.

**Cardinality:** 1:1 - One input, one item.

---

### Mode 2: Browse

Navigate content hierarchically without search.

**When to use:**
- Start from current item and find siblings
- Navigate to parent container
- Drill into nested content (Show → Season → Episode)

**Flow:**
1. Open dropdown (initializes to current item's parent if value exists)
2. Navigate using breadcrumbs and container drill-down
3. Select target item

**Cardinality:** 1:1 - Navigation yields one selected item.

**Example scenarios:**
- Editing a list item, want to switch to adjacent episode
- Browsing a Plex library structure
- Finding a track within an album

---

### Mode 3: Search

Keyword lookup to locate a specific item.

**When to use:** You know what you're looking for but not the exact ID.

**Flow:**
1. Type keywords (minimum 2 characters)
2. Results appear from all content sources
3. Select the matching item

**Cardinality:** 1:1 - Keywords locate one item to select.

**API:** `GET /api/v1/content/query/search?text={keywords}&take=20`

---

### Mode 4: Query (Aspirational)

Define criteria that resolve to multiple items dynamically at runtime.

**When to use:**
- Content should refresh automatically (daily news, recent photos)
- Selection criteria matter more than specific items
- Building dynamic playlists

**Cardinality:** 1:n - One query definition yields multiple items.

**Query storage:** `data/household/config/lists/queries/*.yml`

**Example query definition (`dailynews.yml`):**
```yaml
type: freshvideo
sources:
  - news/world_az
  - news/cnn
```

**Reference in list item:** `query:dailynews`

**Potential inline syntax:** `immich:beach dad 2025` - semantic search resolved at runtime.

**Distinction from Search:**
- Search: keyword → find → select one specific ID
- Query: criteria → dynamic container resolved each time list loads

---

## UI Component

`ContentSearchCombobox` (`frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx`) supports Modes 2 and 3:

- Debounced search (300ms) for Mode 3
- Breadcrumb navigation for Mode 2
- Container drill-down with type-aware icons
- Sibling context when opening with existing value

Mode 1 bypasses the combobox entirely (direct text input).

Mode 4 requires future work - query builder UI or saved query selector.

---

## Content Types

The system recognizes these content types for icon display and container detection:

| Type | Icon | Container? |
|------|------|------------|
| `show`, `movie`, `episode`, `video` | Video | show=yes |
| `track`, `album`, `artist`, `audio` | Music | album/artist=yes |
| `photo`, `image` | Photo | no |
| `folder`, `series`, `conference` | Folder | yes |
| `playlist`, `channel` | List | yes |

Containers can be browsed into; leaf items are selectable.
