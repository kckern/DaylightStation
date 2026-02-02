# Config Lists Taxonomy

This document defines the taxonomy for user-defined lists (Config Lists) in DaylightStation.

---

## Overview

Lists in DaylightStation come in two categories:

| Category | Source | Mutable | Examples |
|----------|--------|---------|----------|
| **Content Lists** | Adapters (Plex, Immich, etc.) | No | Album, Season, Artist, Show, Playlist |
| **Config Lists** | Household config | Yes (Admin UI) | Menu, Watchlist, Program |

**Content Lists** are structural - they reflect how content is organized in source systems.

**Config Lists** are curational - they reflect user intent for how to consume/navigate content.

---

## Config List Types

Config Lists come in three types, distinguished by their capabilities:

| Type | Listable | Queueable | Purpose |
|------|----------|-----------|---------|
| **Menu** | ✓ | ✗ | Navigation structures (may contain non-playables) |
| **Watchlist** | ✓ | ✓ | Content pools with progress tracking |
| **Program** | ✓ | ✓ | Ordered sequences for scheduled playback |

### Menu

- **Purpose:** Navigation/display structure for app UIs
- **Capabilities:** Listable only
- **Items may contain:** Other menus, list references, non-playable config items
- **Cannot be queued:** Some items don't resolve to playables
- **Example:** TVApp menu with buttons for "Christmas", "FHE", "Cartoons"

### Watchlist

- **Purpose:** Content pool to pick from with progress tracking
- **Capabilities:** Listable + Queueable
- **Items must be:** Playable or resolve to playables
- **Selection strategy:** `watchlist` (filters watched, priority sort, picks first/N)
- **Example:** Parenting videos - picks next unwatched item by priority

### Program

- **Purpose:** Ordered sequence for scheduled playback
- **Capabilities:** Listable + Queueable
- **Items may reference:** Other watchlists (resolved via ItemSelectionService)
- **Selection strategy:** `program` (source order, returns all eligible)
- **Example:** Morning Program - plays through sequence in order

---

## Storage Structure

```
config/lists/
├── menus/
│   ├── tvapp.yml
│   ├── fhe.yml
│   └── ...
├── watchlists/
│   ├── parenting.yml
│   ├── scripture.yml
│   └── ...
└── programs/
    ├── morning-program.yml
    ├── evening-program.yml
    └── ...
```

---

## API Endpoints

Base: `/api/v1/admin/content`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/lists` | Overview of all types with counts |
| GET | `/lists/:type` | List all lists of a type (with metadata) |
| POST | `/lists/:type` | Create new list |
| GET | `/lists/:type/:name` | Get list with metadata and items |
| PUT | `/lists/:type/:name` | Replace list items (preserves metadata) |
| PUT | `/lists/:type/:name/settings` | Update list-level settings only |
| DELETE | `/lists/:type/:name` | Delete entire list |
| POST | `/lists/:type/:name/items` | Add item to list |
| PUT | `/lists/:type/:name/items/:index` | Update item |
| DELETE | `/lists/:type/:name/items/:index` | Remove item |

Where `:type` is one of: `menus`, `watchlists`, `programs`

---

## YAML Format

Lists support two YAML formats for backward compatibility:

### Old Format (Array at Root)

```yaml
# cartoons.yml - items directly at root
- label: Stinky and Dirty
  input: plex:585114
- label: Holy Moly
  input: plex:456598
```

### New Format (Metadata + Items)

```yaml
# cartoons.yml - metadata wrapper with items key
title: Saturday Cartoons
description: Weekend cartoon rotation for kids
group: Kids
sorting: manual
days: Weekend
defaultAction: Queue

items:
  - label: Stinky and Dirty
    input: plex:585114
    continuous: true
  - label: Holy Moly
    input: plex:456598
```

The API reads both formats and always writes the new format (preserving metadata).

---

## List-Level Metadata

Lists can have the following metadata fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `title` | string | filename | Display title for the list |
| `description` | string | null | Optional description |
| `group` | string | null | Group name for organizing lists |
| `icon` | string | null | Tabler icon name (e.g., "IconMusic") |
| `sorting` | string | "manual" | Sorting mode: manual, alpha, random, recent |
| `days` | string | null | Days preset when list is active |
| `active` | boolean | true | Whether list is enabled |
| `defaultAction` | string | "Play" | Default action for new items |
| `defaultVolume` | number | null | Default volume (0-100) |
| `defaultPlaybackRate` | number | null | Default playback speed (0.5-3.0) |

---

## Item Schema

All config list items share a base schema with optional extended fields.

### Identity Fields

| Field | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `label` | string | - | Yes | Display name |
| `input` | string | - | Yes | Content reference (e.g., "plex:12345") |
| `action` | string | "Play" | No | Action: Play, Queue, List, Shuffle |
| `active` | boolean | true | No | Whether item is enabled |
| `group` | string | null | No | Group name for organization |
| `image` | string | null | No | Custom thumbnail URL/path |
| `uid` | string | auto | No | Unique identifier (auto-generated) |

### Playback Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `shuffle` | boolean | false | Randomize playback order |
| `continuous` | boolean | false | Auto-advance to next item |
| `loop` | boolean | false | Loop playback |
| `fixedOrder` | boolean | false | Prevent shuffle override |
| `volume` | number | 100 | Volume level (0-100) |
| `playbackRate` | number | 1.0 | Playback speed (0.5-3.0) |

### Scheduling Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `days` | string | null | Days preset: Daily, Weekdays, Weekend, MWF, TTh |
| `snooze` | string | null | Snooze duration (e.g., "1d", "2h") |
| `waitUntil` | string | null | ISO date - don't show before |

### Display Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `shader` | string | null | Visual shader effect |
| `composite` | boolean | false | Composite mode |
| `playable` | boolean | true | Whether item is directly playable |

### Progress Fields (Watchlists)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `progress` | number | null | Override progress (0-100) |
| `watched` | boolean | false | Override watched status |

> **Note:** Progress fields are typically managed by media_memory. Manual overrides may be reset when media is played.

### Watchlist-specific fields

```yaml
- label: "Parenting Video"
  input: "plex: 311549"
  priority: "high"            # urgent, high, medium, low
  hold: false                 # Temporarily skip
  skipAfter: "2026-03-01"     # Deadline
  waitUntil: "2026-02-15"     # Don't show before
  days: "MWF"                 # Mon, Wed, Fri
```

### Program-specific fields

```yaml
- label: "Morning Scripture"
  input: "watchlist: scripture"  # Reference to watchlist
  pick: 2                        # Take 2 items from watchlist
  days: "Weekdays"               # When to include
```

---

## Integration with ItemSelectionService

When content is requested from a config list:

1. Router receives request with `containerType`
2. Adapter loads items from YAML
3. Items enriched with watch state
4. `ItemSelectionService.select()` applies appropriate strategy:
   - `containerType: 'watchlist'` → filter watched, sort by priority, pick first
   - `containerType: 'program'` → preserve source order, return all eligible

See `item-selection-service.md` for full selection logic.

---

## Admin UI Components

The ContentLists module (`frontend/src/modules/Admin/ContentLists/`) provides a complete admin interface.

### Index View (ListsIndex)

- Grid of list cards grouped by `group` field
- Shows title, description, icon, item count
- "Inactive" badge for disabled lists
- Click to navigate to list contents

### Folder View (ListsFolder)

- Spreadsheet-style table with drag-and-drop reordering
- Columns: Active, Drag, Index, Label, Action, Input, Progress (watchlists), Config, Menu
- **Progress Column:** Shows progress bar or watched checkmark (watchlists only)
- **Config Column:** Shows priority icons for active config options (max 2 + overflow)
- Inline editing for label, action, and input
- Settings modal for list-level metadata

### Item Editor (ListsItemEditor)

Two-mode editor accessible via row menu or config icons:

**Simple Mode:**
- Label, Input, Action, Active, Image, Group
- Quick editing for basic items

**Full Mode:**
- Accordion categories: Identity, Playback, Scheduling, Display, Progress, Custom
- All item fields with appropriate controls (switches, sliders, date pickers)
- Custom fields section for unknown YAML keys (pass-through)

### Config Indicators (ConfigIndicators)

Shows active config options as icons in the table:
- Priority-based display (max 2 icons + "+N" overflow)
- Icons: shuffle, continuous, loop, fixedOrder, volume, playbackRate, days, snooze, waitUntil, shader, composite
- Tooltip shows all active options
- Click opens editor in Full mode

### Constants (listConstants.js)

Exports for use across components:
- `ACTION_OPTIONS` - Play, Queue, List, Shuffle
- `SORTING_OPTIONS` - Manual, Alphabetical, Random, Recently Added
- `DAYS_PRESETS` - Daily, Weekdays, Weekend, MWF, TTh
- `KNOWN_ITEM_FIELDS` - All managed fields
- `ITEM_DEFAULTS` - Default values
- `CONFIG_INDICATORS` - Icon definitions with conditions
- `LIST_DEFAULTS` - List-level defaults

---

## Related Documentation

- `item-selection-service.md` - Selection strategies and filters
- `query-combinatorics.md` - Query parameter syntax
- `content-stack-reference.md` - Full content API reference
