# Content Navigation

Content navigation covers how users discover, browse, and search for content. This document describes the APIs for traversing content hierarchies and the frontend components that present them.

---

## API Surface

### List API — Browse Container Contents

**Route**: `GET /api/v1/list/:source/*`

Returns the children of a container item. The source adapter's `getList()` method is called.

**Request**:
```
GET /api/v1/list/plex-main/12345
GET /api/v1/list/hymn-library/         # root listing
```

**Response**:
```json
{
  "source": "plex-main",
  "path": "12345",
  "title": "TV Shows",
  "items": [
    {
      "id": "plex-main:67890",
      "title": "The Office",
      "type": "show",
      "itemType": "container",
      "thumbnail": "/api/v1/display/plex-main/67890",
      "capabilities": ["listable", "queueable"]
    }
  ]
}
```

**Modifiers** (appended to path):
- `/playable` — flatten to playable leaves only (calls `resolvePlayables()`)
- `/shuffle` — randomize item order
- `/recent_on_top` — sort by menu interaction history

**Query parameters**:
- `take=N` — limit number of results
- `skip=N` — offset for pagination

### Siblings API — Peer Navigation

**Route**: `GET /api/v1/siblings/:source/*`

Given a content ID, returns the item's siblings (items at the same level in the hierarchy) and parent info. Used by content pickers and admin UI for contextual navigation.

**Request**:
```
GET /api/v1/siblings/plex-main/67890
```

**Response**:
```json
{
  "parent": {
    "id": "plex-main:12345",
    "title": "TV Shows",
    "source": "plex-main"
  },
  "items": [
    { "id": "plex-main:67890", "title": "The Office", "type": "show" },
    { "id": "plex-main:67891", "title": "Parks and Rec", "type": "show" }
  ]
}
```

### Search API — Cross-Source Discovery

**Route**: `GET /api/v1/content/query/search`

Searches across all configured source instances that support the `searchable` capability.

**Request**:
```
GET /api/v1/content/query/search?text=office&take=20
```

**Response**:
```json
{
  "items": [
    {
      "id": "plex-main:67890",
      "title": "The Office",
      "source": "plex-main",
      "type": "show",
      "thumbnail": "..."
    }
  ]
}
```

**Streaming variant**: `GET /api/v1/content/query/search/stream` — returns results via Server-Sent Events as each source adapter responds, allowing progressive display.

### Content ID Resolution

All navigation APIs accept content IDs through the full resolution chain (see content-model.md). The following are equivalent:

```
GET /api/v1/list/hymn-library/198
GET /api/v1/list/singalong/hymn/198    # format match + path
GET /api/v1/list/hymn/198              # alias resolution
```

---

## Config Lists

Config lists are YAML-defined content structures stored in the household configuration directory. They serve as navigation containers whose children reference content from other sources.

### List Types

| Type | Purpose | Selection Strategy |
|------|---------|-------------------|
| **menu** | Static navigation hierarchy | None — browse and select manually |
| **watchlist** | Ordered playlists with progress tracking | Watch state filtering, priority sorting |
| **program** | Scheduled content sequences | Time-based, strategy-driven selection |

### YAML Structure

Config lists use action-as-key semantics. Each item has a `title` and an action key that determines behavior when selected.

```yaml
# data/household/config/lists/menus/fhe-night.yml (to-be format)
title: FHE Night
items:
  - title: Opening Hymn
    play:
      contentId: hymn:198
    fixed_order: true
  - title: Scripture Reading
    play:
      contentId: scripture:john-1
  - title: Lesson Video
    play:
      contentId: plex:12345
  - title: Family Activity
    open: family-selector
  - title: Movies
    list:
      contentId: plex-main:67890
  - title: Art Display
    display:
      contentId: canvas:religious/treeoflife.jpg
```

Each item in a config list can have actions (`play`, `queue`, `list`, `open`, `display`) that reference other content by ID. The actions determine what happens when the item is selected in the menu.

#### Current (Legacy) Format

Existing config lists use an `input`/`label` schema with an optional `action` field. The yaml-config driver normalizes both formats during the transition period.

```yaml
# data/household/config/lists/menus/fhe.yml (current format)
title: Fhe
items:
  - label: Opening Hymn
    input: singalong:hymn/166
    fixed_order: true
    image: https://...
    uid: e7302007-...
  - label: Spotlight
    input: app:family-selector/alan
    action: Open
    fixed_order: true
  - label: Felix
    input: plex:457385
    action: Play
    active: true
  - label: Soren
    input: canvas:religious/treeoflife.jpg
    action: Display
  - label: Gratitude and Hope
    input: 'app: gratitude'          # note: space after colon (YAML quirk)
    action: Open
  - label: Closing Hymn
    input: singalong:hymn/108
```

**Key differences**: Legacy uses `label`/`input`/`action` (action as separate field). Target uses `title` + action-as-key (`play:`, `open:`, `list:`, `display:`). Some legacy `input` values have a space after the colon (e.g., `'app: gratitude'`) — the yaml-config driver must `.trim()` after splitting.

#### Dynamic Query References

Items can reference saved queries as dynamic containers:

```yaml
items:
  - title: Family Photos
    list:
      contentId: query:family-photos-2025     # browse dynamic results
  - title: Workout Videos
    queue:
      contentId: query:recent-fitness         # play all as queue
  - title: Today's News
    play:
      contentId: query:daily-news             # play first result
```

Query results are computed at request time — unlike static watchlist references, they automatically reflect new content from upstream sources. See content-sources.md for the query driver and definition schema.

#### Watchlists

Watchlists track ordered content with progress and scheduling metadata:

```yaml
# data/household/config/lists/watchlists/cfmscripture.yml (current format)
- title: D&C 1
  src: scriptures
  media_key: dc/rex/37707
  program: Rex Pinnegar
  priority: High
  uid: 250bd26f-...
  wait_until: '2025-01-12'         # not eligible until this date
  skip_after: '2025-01-26'         # auto-skip after this date
  watched: true
  progress: 100
```

**Key fields**: `media_key` (content path within source), `src` (source adapter name), `wait_until`/`skip_after` (scheduling window), `priority`, `watched`/`progress` (watch state), `program` (grouping label).

#### Programs

Programs are sequenced content lists referencing multiple source types:

```yaml
# data/household/config/lists/programs/morning-program.yml (current format)
- label: Intro
  input: 'media: sfx/intro'
  uid: 742d6d79-...
- label: 10 Min News
  input: 'query: dailynews'
- label: Come Follow Me Supplement
  input: 'watchlist: comefollowme2025'
- label: Crash Course Kids
  input: 'plex: 375839'
- label: Ted Ed
  input: 'freshvideo: teded'
- label: General Conference
  input: 'talk: ldsgc'
- label: Wrap Up
  input: 'app: wrapup'
  action: Open
```

Programs reference diverse sources: `media:` (filesystem clips), `query:` (dynamic queries), `watchlist:` (watchlist selection), `plex:` (Plex content), `freshvideo:` (ingestion pipeline), `talk:` (conference talks), `app:` (interactive apps).

---

## Frontend Navigation

### MenuStack

The `MenuStack` component manages a stack-based navigation model. Each stack entry has a type that determines which component renders it.

```
Stack: [
  { type: 'menu', props: { contentId: 'menu:fhe-night' } },    # depth 0: root menu
  { type: 'menu', props: { contentId: 'plex-main:67890' } },   # depth 1: browsed into Movies
  { type: 'player', props: { play: { contentId: '...' } } }    # depth 2: playing a movie
]
```

| Stack Type | Component | Purpose |
|-----------|-----------|---------|
| `menu` | TVMenu | Browse a container's children |
| `plex-menu` | PlexMenuRouter | Plex-specific show/season navigation |
| `player` | Player | Media playback |
| `composite` | Player (composite mode) | Multi-track playback |
| `app` | AppContainer | Interactive app |
| `display` | Displayer | Static image display |

### Selection Flow

When a user selects an item in a menu, the item's action determines the next stack entry:

```
Item action     → Stack push
─────────────────────────────
play / queue    → { type: 'player', props: { play/queue: ... } }
list            → { type: 'menu', props: { list: ... } }
open            → { type: 'app', props: { open: ... } }
display         → { type: 'display', props: { display: ... } }
```

### ContentSearchCombobox

The admin UI provides a searchable combobox for selecting content IDs. It combines:

1. **Text search** via the Search API (streaming SSE for progressive results)
2. **Container browsing** via the List API (drill into folders)
3. **Sibling navigation** via the Siblings API (browse peers of current selection)
4. **Saved queries** — browse existing query containers, or save the current search as a new query definition

This combobox is used wherever the admin UI needs a content ID picker (list item editors, config fields, etc.). The "save as query" flow captures the current search filters and persists them as a named query definition, which can then be referenced in list configs as `query:{name}`.

### URL Parameter Routing

TVApp supports content navigation via URL query parameters:

```
?play=hymn:198              → play single item
?queue=plex-main:67890      → queue a container's playables
?list=menu:fhe-night        → browse a menu
?display=immich:photo-id    → display an image
?webcam=0                   → open an app
```

Parameters pass through the same content ID resolution chain. `?play=hymn:198` resolves `hymn:198` through aliases just like any other content ID.
