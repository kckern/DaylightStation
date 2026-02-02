# ListAdapter Reference

Exposes menus, programs, and watchlists as content sources, enabling YAML-defined lists to participate in the content system.

**Location:** `backend/src/1_adapters/content/list/ListAdapter.mjs`

---

## Overview

ListAdapter bridges configuration YAML files and the content source system. It handles three list types:

| Prefix | Directory | Purpose |
|--------|-----------|---------|
| `menu:` | `lists/menus/` | Navigation menus, submenus |
| `program:` | `lists/programs/` | Scheduled content programs |
| `watchlist:` | `lists/watchlists/` | User-curated watch queues |

| Property | Value |
|----------|-------|
| Source name | `list` |
| Prefixes | `menu:`, `program:`, `watchlist:` |
| Category | `list` |
| Provider | `list` |
| Relevance Score | 40 (between CONTAINER:125 and EPISODE:20) |

---

## File Locations

Lists are stored as YAML files:

```
data/household/config/lists/
├── menus/
│   ├── fhe.yml
│   └── tv.yml
├── programs/
│   ├── music-queue.yml
│   └── morning-routine.yml
└── watchlists/
    └── kids-movies.yml
```

---

## ID Format

```
{prefix}:{name}
```

**Examples:**
- `menu:fhe` → `lists/menus/fhe.yml`
- `program:music-queue` → `lists/programs/music-queue.yml`
- `watchlist:kids-movies` → `lists/watchlists/kids-movies.yml`

**Browsing all lists of a type:**
- `menu:` → Returns all menus
- `program:` → Returns all programs
- `watchlist:` → Returns all watchlists

---

## List YAML Structure

### Basic Structure

```yaml
title: FHE Menu
description: Family Home Evening activities

items:
  - label: Scripture Study
    input: 'local-content:scripture/bom'
    action: Play

  - label: Music
    input: 'program:music-queue'
    action: Queue
    shuffle: true

  - label: Games Submenu
    input: 'menu:games'
    action: List
```

### Item Fields

| Field | Required | Description |
|-------|----------|-------------|
| `label` | Yes | Display name |
| `input` | Yes | Content reference (`source:id`) |
| `action` | No | `Play`, `Queue`, `List`, `Open` (default: Play) |
| `image` | No | Thumbnail URL |
| `active` | No | Set `false` to hide item |

### Action Types

| Action | Behavior |
|--------|----------|
| `Play` | Play single item or next from container |
| `Queue` | Queue all items from container |
| `List` | Navigate to submenu |
| `Open` | Launch app or external resource |

### Playback Options

```yaml
- label: Shuffle Music
  input: 'plex:672596'
  action: Queue
  shuffle: true      # Randomize order
  continuous: true   # Auto-advance
```

---

## Program Scheduling

Programs support day-based filtering for scheduled content.

### Days Field

**String presets:**
```yaml
days: Daily      # Every day
days: Weekdays   # Mon-Fri
days: Weekend    # Sat-Sun
days: MWF        # Mon, Wed, Fri
days: TTh        # Tue, Thu
```

**Array format:**
```yaml
days: ["M", "W", "F"]
days: ["Saturday", "Sunday"]
days: ["T", "Th"]
```

### Schedule Behavior

When `resolvePlayables()` is called:
- Items without `days` field: Always included
- Items with `days` field: Only included if today matches

**Override per-item:**
```yaml
- label: All Music (ignore schedule)
  input: 'program:music-queue'
  action: List
  applySchedule: false  # Show all items regardless of day
```

---

## API Usage

ListAdapter integrates with ContentSourceRegistry. Access via standard content endpoints:

### Get All Lists of Type

```bash
# All menus
curl /api/v1/content/resolve?id=menu:

# All programs
curl /api/v1/content/resolve?id=program:

# All watchlists
curl /api/v1/content/resolve?id=watchlist:
```

### Get Specific List

```bash
curl /api/v1/item/list/menu:fhe
```

### Resolve Playables

```bash
# With schedule filtering (default)
curl /api/v1/item/list/program:music-queue/playables

# Without schedule filtering
# (handled internally via options.applySchedule)
```

---

## Search

ListAdapter supports searching by:
- List names (menu names, program names)
- Item labels within lists

```bash
curl /api/v1/content/search?q=fhe
```

Returns both:
- Lists matching the query name
- Lists containing items with matching labels

---

## Item Structure

### List Container

```javascript
{
  id: 'menu:fhe',
  source: 'list',
  title: 'FHE',
  itemType: 'container',
  childCount: 25,
  metadata: {
    category: 'list',
    listType: 'menu'
  }
}
```

### List Item

```javascript
{
  id: 'plex:672596',
  source: 'plex',
  title: 'Scripture Study',
  metadata: {
    category: 'list',
    listType: 'menu',
    days: ['M', 'W', 'F']
  },
  actions: {
    play: { plex: '672596' },
    queue: { plex: '672596', shuffle: true }
  }
}
```

---

## Relationship to FolderAdapter

| Adapter | Purpose |
|---------|---------|
| **ListAdapter** | List-as-content-source: browsing/searching lists themselves |
| **FolderAdapter** | List-item-resolution: resolving what's inside a list |

ListAdapter may delegate to FolderAdapter internally for item resolution.

---

## ContentCategory.LIST

ListAdapter items use `ContentCategory.LIST` with relevance score 40:

```javascript
// ContentCategory.mjs
LIST: 'list'  // Score: 40

// Scoring hierarchy:
// CURATED (148) > CONTAINER (125) > LIST (40) > EPISODE (20) > MEDIA (10)
```

Lists rank below curated containers but above individual media items in search results.

---

## Dependencies

- **ContentSourceRegistry:** For resolving referenced items
- **MediaProgressMemory:** Optional, for watch state on items
- **ConfigService:** Optional, for household config lookup

---

## See Also

- [Content Stack Reference](./content-stack-reference.md) - Overall content architecture
- [LocalMediaAdapter](./local-media-adapter.md) - Local filesystem browsing
- [Config Lists Taxonomy](./config-lists-taxonomy.md) - List configuration details
