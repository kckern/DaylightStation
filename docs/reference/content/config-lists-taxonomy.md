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
| GET | `/lists/:type` | List all lists of a type |
| POST | `/lists/:type` | Create new list |
| GET | `/lists/:type/:name` | Get items in list |
| PUT | `/lists/:type/:name` | Replace list contents (reorder) |
| DELETE | `/lists/:type/:name` | Delete entire list |
| POST | `/lists/:type/:name/items` | Add item to list |
| PUT | `/lists/:type/:name/items/:index` | Update item |
| DELETE | `/lists/:type/:name/items/:index` | Remove item |

Where `:type` is one of: `menus`, `watchlists`, `programs`

---

## Item Schema

All config list items share a base schema:

```yaml
- label: "Display Name"
  input: "plex: 12345"        # Content reference
  action: "Play"              # Play, Queue, List
  active: true                # Whether item is enabled
  image: "https://..."        # Optional thumbnail
```

### Watchlist-specific fields

```yaml
- label: "Parenting Video"
  input: "plex: 311549"
  priority: "high"            # urgent, high, medium, low
  hold: false                 # Temporarily skip
  skipAfter: "2026-03-01"     # Deadline
  waitUntil: "2026-02-15"     # Don't show before
  days: [1, 3, 5]             # ISO weekdays (M, W, F)
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

## Related Documentation

- `item-selection-service.md` - Selection strategies and filters
- `query-combinatorics.md` - Query parameter syntax
- `content-stack-reference.md` - Full content API reference
