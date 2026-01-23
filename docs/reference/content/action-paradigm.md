# Content Action Paradigm

Comprehensive documentation for the play/queue/list/open action system that powers content navigation and playback.

## Core Concepts

### Action Types

Four action types determine HOW content is consumed:

| Action | Behavior | UI Result |
|--------|----------|-----------|
| **play** | Get "next up" single item | Player with 1 item |
| **queue** | Get ALL playables | Player with playlist |
| **list** | Get children for browsing | Menu/submenu |
| **open** | Launch embedded app | App container |

### Content Sources

Sources determine WHERE content comes from:

```
Sources
├── Direct Sources (valid with just localId)
│   ├── plex          → Plex library (rating keys: 545064)
│   ├── folder        → Named collections from lists.yml
│   ├── filesystem    → Local media paths (news/teded, sfx/intro)
│   └── scripture     → Scripture chapters (nt, bom/sebom/31103)
│
├── Parent Sources (require subsource to be valid)
│   ├── song → hymn, primary     (songs/hymn/, songs/primary/)
│   ├── talk → {dynamic folders} (talk/ldsgc202010)
│   └── poem → {collections}     (poem/edpoe, poem/remedy)
│
├── Subsource Shortcuts (resolve to parent/subsource)
│   ├── hymn/2    → song/hymn/2
│   └── primary/5 → song/primary/5
│
└── Composite (pipe fallback syntax)
    └── news/world_az|news/cnn (try first, fallback)
```

### Key Insight

**Action type × Source = Behavior**

- `{play: {folder: "Morning Program"}}` → single "next up" from collection
- `{queue: {folder: "Morning Program"}}` → all playables from collection
- `{list: {folder: "Morning Program"}}` → browse collection as menu

Folder and queue sources are the same underlying data (lists.yml collections) - the action type determines presentation.

---

## API Structure

### Unified Endpoint Pattern

`/api/v1/item/:source/:localId[/operation]`

| Operation | Purpose | When to use |
|-----------|---------|-------------|
| *(bare)* | Item metadata | Leaf → playable; Container → parent + children inline |
| `/playable` | Resolve to playable items | queue action, or play on container |
| `/single` | First "next up" playable | play action on container |
| `/random` | Random playable | shuffle play without loading full list |
| `/children` | Explicit children list | list action (usually bare is sufficient) |
| `/thumb` | Thumbnail image | Display |
| `/stream` | Media stream | Playback |

### Frontend Action → API Mapping

```javascript
// play: {hymn: 2}  →  leaf item
GET /item/hymn/2
// Returns: {id, title, media_url, ...}

// play: {plex: 545064}  →  container, want single
GET /item/plex/545064/single
// Returns: single "next up" playable

// play: {plex: 545064, shuffle: true}  →  random from container
GET /item/plex/545064/random
// Returns: single random playable

// queue: {plex: 545064}  →  all playables
GET /item/plex/545064/playable
// Returns: {parent, items: [...all playables...]}

// queue: {plex: 545064, shuffle: true}
GET /item/plex/545064/playable?shuffle=true
// Returns: shuffled playlist

// list: {folder: "FHE"}  →  browse children
GET /item/folder/FHE
// Returns: {parent, items: [...children...]}
```

---

## Parameters & Options

### Playback Parameters

| Parameter | Scope | Purpose | Values |
|-----------|-------|---------|--------|
| `shuffle` | queue | Randomize playback order | `true`/`false` |
| `continuous` | queue | Loop playlist when finished | `true`/`false` |
| `playbackRate` | item/queue | Playback speed | `0.5`, `1`, `1.5`, `2` |
| `volume` | item/queue | Volume level | `0`-`1` |
| `shader` | player | Visual mode | `default`, `focused`, `night`, `blackout` |
| `overlay` | item/queue | Composite playback | `{queue: {plex: id}, shuffle: true}` |
| `resume` | item | Resume from last position | `true`/`false` |
| `maxVideoBitrate` | item/queue | Bandwidth cap | number |
| `maxResolution` | item/queue | Quality cap | `1080p`, `720p` |

### Overlay Syntax (Composite Playback)

For silent video with background music:

```yaml
# In lists.yml
input: 'plex: 663035; overlay: 461309'
# Video from 663035, audio from playlist 461309

# Or in action object
play:
  plex: 663035
  overlay:
    queue: {plex: 461309}
    shuffle: true
```

### Parameter Inheritance

Options cascade: action → queue → individual item

```javascript
// Queue-level applies to all
queue: {plex: 545064, shuffle: true, playbackRate: 1.5}

// Item-level override
{plex: 545189, playbackRate: 1.0}  // This track at normal speed
```

---

## Recursive Queue Resolution

### The Challenge

A folder can contain items that reference other containers, creating nested resolution.

**Morning Program example:**

```yaml
- input: 'media: sfx/intro'           # single file → 1 item
- input: 'media: news/world_az'       # folder → multiple files
- input: 'plex: 375839'               # Crash Course Kids → 97 episodes
- input: 'scripture: cfm'             # scripture queue → many chapters
- input: 'app: wrapup'                # app launch (not playable)
  action: Open
```

### Play vs Queue Resolution

| Action | Resolution | Result |
|--------|------------|--------|
| `play: {folder: "Morning Program"}` | Each child → "next up" single | ~5 items (one per source) |
| `queue: {folder: "Morning Program"}` | Each child → ALL playables | ~150+ items (everything) |

### Resolution Algorithm

**For `play` action:**

```
for each child in folder:
  if child.action == 'open':
    skip (not playable)
  else if child.action == 'play' (default):
    get SINGLE "next up" from child source
    (uses watch state: in_progress > unwatched > first)
  else if child.action == 'queue':
    get ALL playables from child source
```

**For `queue` action:**

```
for each child in folder:
  if child.action == 'open':
    skip (not playable)
  else:
    get ALL playables from child source (flatten)
```

### Watch State Heuristics

"Next up" selection priority:

1. **In-progress** item (1% < percent < 90%)
2. **Unwatched** item (percent < 90%)
3. **First item** as fallback

This creates variety and rotation - each day different content from each source.

---

## Two Queue Patterns

### Pattern 1: lists.yml - Pointer Collections

```yaml
- input: 'plex: 545064'
  label: 이루마
  action: Queue
  shuffle: true
  folder: TVApp
```

- `input:` contains source pointer (plex:, media:, scripture:)
- Resolution happens at request time
- Action type determines play vs queue behavior
- Light metadata (label, image, action, shuffle, continuous)

### Pattern 2: watchlist.yml - Curated Item Queue

```yaml
- media_key: '225728'
  title: Introduction - Why Study the New Testament
  summary: This course approaches the New Testament...
  duration: 40
  program: Yale - New Testament
  index: 1
  list: Bible
  folder: Bible
  priority: Medium
  progress: 100
  watched: true
  skip_after: '2023-08-21'
  wait_until: '2023-08-07'
```

- `media_key:` is already resolved (Plex rating key)
- Rich per-item metadata (title, summary, duration)
- **Scheduling fields:**
  - `priority`: High, Medium, Low
  - `skip_after`: Expiration date
  - `wait_until`: Embargo date
  - `hold`: Pause flag
- **Watch state:** `progress`, `watched`
- **Organization:** `program`, `index`, `list`, `folder`

### When to Use Which

| Pattern | Use Case |
|---------|----------|
| lists.yml | Dynamic menus, shuffled playlists, source pointers |
| watchlist.yml | Curated learning queues, series with order, scheduled content |

---

## Architecture

### Frontend Component Hierarchy

```
TVApp
└── MenuNavigationProvider (context for stack-based navigation)
    └── MenuStack (renders current stack level)
        ├── TVMenu (browse/select items)
        ├── PlexMenuRouter (Plex-specific views)
        ├── Player (playback)
        └── AppContainer (embedded apps)
```

### Backend Adapter Pattern

```
API Router (/item/:source/:localId)
    ↓
ContentSourceRegistry (resolves source → adapter)
    ↓
Adapters (implement consistent interface)
    ├── PlexAdapter         → Plex API
    ├── FolderAdapter       → lists.yml collections
    ├── FilesystemAdapter   → local media files
    └── LocalContentAdapter → hymns, talks, scripture, poems
```

### Adapter Interface

```javascript
class IContentAdapter {
  get source()           // 'plex', 'folder', 'filesystem', etc.
  get prefixes()         // [{prefix: 'hymn'}, {prefix: 'primary'}]

  canResolve(id)         // Can this adapter handle this ID?
  getStoragePath(id)     // Path for watch state storage

  getItem(id)            // Single item metadata
  getList(id)            // Container with children
  resolvePlayables(id)   // Flatten to playable items
}
```

---

## Edge Cases & Gotchas

### Known Issues

| Issue | Current State | Resolution |
|-------|---------------|------------|
| Pipe fallback syntax | Not parsed, returns 0 items | Parse `a\|b`, try first, fallback |
| Compound ID mapping | `scripture:` → `local-content:` mismatch | Consistent prefix handling |
| Circular folder refs | Could infinite loop | Circuit breaker (track visited IDs) |

### Circuit Breaker Implementation

```javascript
async resolvePlayables(id, options = {}) {
  const visited = options._visited || new Set();

  if (visited.has(id)) {
    console.warn(`Circular reference detected: ${id}`);
    return [];
  }
  visited.add(id);

  // Pass visited set to recursive calls
  for (const child of children) {
    const childPlayables = await adapter.resolvePlayables(
      child.id,
      { ...options, _visited: visited }
    );
  }
}
```

### Action Type Defaults

```yaml
# No action specified → defaults to 'Play'
- input: 'plex: 545064'
  label: Something

# Explicit action required for non-play behavior
- input: 'plex: 545064'
  action: Queue
  shuffle: true
```

### Overlay Requires Queue Source

```javascript
// Correct - overlay audio from a playlist
play: { plex: 123, overlay: { queue: { plex: 456 }, shuffle: true } }

// Wrong - overlay from single item doesn't loop
play: { plex: 123, overlay: { play: { plex: 456 } } }
```

### Empty Folder Fallback Cascade

When all items filtered (watched, skipped, on hold), progressively relaxes:

1. Ignore skip_after dates
2. Ignore watch status
3. Ignore wait_until dates

---

## Quick Reference

### Source Reference

| Source | LocalId format | Example | Parent |
|--------|----------------|---------|--------|
| `plex` | rating key | `545064` | - |
| `folder` | collection name | `Morning Program` | - |
| `filesystem` | path | `news/teded` | - |
| `scripture` | volume/path | `nt`, `bom/sebom/31103` | - |
| `hymn` | number | `2` | song |
| `primary` | number | `5` | song |
| `talk` | folder/id | `ldsgc202010/eyring` | - (dynamic) |
| `poem` | collection/id | `edpoe/raven` | - (dynamic) |

### YAML Schemas

**lists.yml - Pointer collection item:**

```yaml
- input: 'source: localId'      # Required: plex:, media:, list:, etc.
  label: Display Name           # Required
  folder: FolderName            # Required: which collection
  action: Play|Queue|List|Open  # Default: Play
  shuffle: true                 # Optional
  continuous: true              # Optional
  playable: true                # Optional: resolve to playables for List
  image: /path/to/image         # Optional
  active: false                 # Optional: exclude from collection
  uid: uuid                     # Auto-generated
```

**watchlist.yml - Curated item:**

```yaml
- media_key: '545064'           # Required: resolved Plex ID
  title: Full Title             # Required
  summary: Description          # Optional
  duration: 40                  # Optional: minutes
  folder: FolderName            # Required
  list: ListName                # Required
  program: Series Name          # Optional: grouping
  index: 1                      # Optional: order in program
  priority: High|Medium|Low     # Default: Medium
  progress: 0-100               # Watch state
  watched: true                 # Completion flag
  hold: true                    # Pause scheduling
  skip_after: 'YYYY-MM-DD'      # Expiration
  wait_until: 'YYYY-MM-DD'      # Embargo
  uid: uuid                     # Auto-generated
```

### File Locations

| File | Purpose |
|------|---------|
| `backend/src/4_api/routers/item.mjs` | Unified /item router |
| `backend/src/2_adapters/content/folder/FolderAdapter.mjs` | Collection resolution |
| `backend/src/1_domains/content/services/ContentSourceRegistry.mjs` | Adapter registry |
| `frontend/src/modules/Menu/MenuStack.jsx` | Navigation stack |
| `frontend/src/modules/Player/Player.jsx` | Playback orchestration |
| `frontend/src/modules/Player/hooks/useQueueController.js` | Queue management |
| `data/households/{hid}/state/lists.yml` | Pointer collections |
| `data/households/{hid}/state/watchlist.yml` | Curated items |

---

## Related Documentation

- Item-centric API design: `docs/plans/2026-01-23-item-centric-api-design.md`
- TV app context: `docs/ai-context/tv.md`
