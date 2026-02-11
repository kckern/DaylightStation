# List Sections Data Model Rearch

**Date:** 2026-02-10
**Status:** Draft

## Summary

Rearchitect the list YAML format to support **sections** — named, configurable partitions within a list. Sections provide grouping, per-section behavior (sort, shuffle, limit), display metadata (title, subtitle, description, thumbnail), and cascading defaults that items inherit.

Sections are an **authoring-time concept**. The runtime adapter flattens sections into a single ordered item list, applying cascade, sort, shuffle+limit, and filters. Frontend consumers (menus, queues, players) never see sections. The admin UI is the only place sections are visible and editable.

---

## Motivation

1. **Grouping/partitioning** — Lists like `bible.yml` (900+ items) use a `program` field for informal grouping. Sections make this explicit and structured.
2. **Per-section behavior** — Different parts of the same list need different sort rules, display modes, or playback behaviors (e.g., one section shuffled with limit=3, another fixed-order).
3. **UI presentation** — The admin needs section headers, subtitles, descriptions, and thumbnails to render lists with visual hierarchy.
4. **DRY config** — Watchlist items currently repeat `src: plex`, `priority: Medium`, `program: BibleProject` on every item. Section-level inheritance eliminates this.

---

## Core YAML Schema

### Full format (with sections)

```yaml
title: "Come Follow Me 2025"              # Required. Display title.
description: "Weekly scripture supplements" # Optional.
image: /api/v1/local-content/cover/cfm     # Optional. List-level thumbnail.

metadata:                                   # Optional. List-level defaults + custom fields.
  group: "Scripture Study"                  # UI grouping label
  fixed_order: true                         # List-level fixed order
  priority: medium                          # Cascades to all sections/items
  playbackrate: 2                           # Cascades to all sections/items
  # ... any inheritable field

sections:                                   # Ordered array of sections
  - title: "BibleProject"                  # Section title (optional for anonymous sections)
    description: "Short animated videos"    # Optional.
    image: https://...                      # Optional. Section thumbnail.
    fixed_order: true                       # Section-level override
    shuffle: false                          # Randomize items in this section
    limit: null                             # With shuffle: pick N random items ("grab bag")
    priority: medium                        # Cascades to items in this section
    items:                                  # The actual content items
      - title: "Generosity"
        play: { plex: "463210" }
        subtitle: "D&C 42:30-31"
        skip_after: "2025-05-04"
        wait_until: "2025-04-27"
        uid: a8543aa3-...
```

### Flat format (sugar for single anonymous section)

```yaml
title: "Kids"
items:
  - title: Bluey
    play: { plex: "59493" }
    continuous: true
```

Normalized internally to:

```yaml
title: "Kids"
sections:
  - items:
      - title: Bluey
        play: { plex: "59493" }
        continuous: true
```

### Bare array format (legacy, backward compat)

```yaml
- label: Bluey
  input: 'plex: 59493'
  continuous: true
```

Normalized to:

```yaml
title: (derived from filename)
sections:
  - items:
      - title: Bluey
        play: { plex: "59493" }
        continuous: true
```

---

## Item Format

Items across all list types use the **action-as-key** pattern:

```yaml
# Required
title: "Generosity"                        # Display title

# Action (exactly one required)
play: { plex: "463210" }                   # Play content directly
queue: { plex: "463210", shuffle: true }   # Queue all playables from source
list: { plex: "47229" }                    # Browse as sub-list
open: "gratitude"                          # Open an app
display: { canvas: "religious/treeoflife.jpg" } # Display static content

# Optional display
image: https://...                          # Thumbnail
subtitle: "D&C 42:30-31"                   # Shown below title
description: "Longer explanation..."        # Detail view

# Optional behavior (all inheritable from section/list)
uid: a8543aa3-...                           # Stable identity across reorders
active: true                                # false = skip entirely
continuous: true                            # Continue to next episode
playbackrate: 2                             # Playback speed override

# Watchlist-specific (all inheritable)
priority: medium                            # low | medium | high | urgent
skip_after: "2025-05-04"                   # Auto-skip after this date
wait_until: "2025-04-27"                   # Don't play before this date
hold: false                                 # Manually paused
watched: false                              # Manually marked watched

# Program-specific (all inheritable)
days: weekdays                              # Schedule filter
applySchedule: true                         # Whether schedule filtering applies
```

### Key changes from current format

| Old | New | Notes |
|-----|-----|-------|
| `label` | `title` | Consistency across all list types |
| `input` + `action` | Action-as-key (`play:`, `queue:`, etc.) | Already partially adopted |
| `src` + `media_key` | Action-as-key | Watchlist old format eliminated |
| `summary` | `subtitle` | More generic, usable across types |
| `program` (on item) | Section title | Grouping becomes structural |
| `group` (on item) | Eliminated | Replaced by sections |

The normalizer still accepts old format for backward compatibility.

---

## Cascading Inheritance

Behavioral fields set at a higher level flow down unless overridden.

**Resolution order:** item field > section field > list `metadata` field > system default

### Inheritable fields

- `priority`, `hold`, `watched`, `skip_after`, `wait_until`
- `playbackrate`, `continuous`, `shuffle`
- `days`, `applySchedule`
- `active`
- `image` (section thumb as item fallback)
- `fixed_order`

### Example

```yaml
title: "Scripture Study"
metadata:
  playbackrate: 2           # All items default to 2x speed
  priority: medium           # All items default to medium priority

sections:
  - title: "BibleProject"
    skip_after: "2025-05-04" # All items in this section inherit skip_after
    wait_until: "2025-04-27" # All items inherit wait_until
    items:
      - title: "Generosity"
        play: { plex: "463210" }
        # Inherits: playbackrate=2, priority=medium, skip_after, wait_until

      - title: "Holy Spirit"
        play: { plex: "463212" }
        priority: high          # Override: this one is high priority

  - title: "Yale Lectures"
    playbackrate: 1.5           # Override list-level: 1.5x for this section
    days: weekdays              # Only show on weekdays
    items:
      - title: "Introduction"
        play: { plex: "225728" }
        # Inherits: playbackrate=1.5, priority=medium, days=weekdays
```

---

## Section Ordering Modes

Each section has an ordering mode that controls how its items are presented at resolve time:

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Default** | No flags | YAML order is canonical, but menu memory can reorder (recent on top) |
| **Fixed** | `fixed_order: true` | YAML order is sacred. No menu memory reordering. |
| **Shuffle** | `shuffle: true` | Randomize items each time |
| **Grab bag** | `shuffle: true` + `limit: N` | Pick N random items from the section |

These are set at the section level. Items don't have ordering modes — they inherit from their section.

---

## Runtime Behavior (Adapter)

Sections are resolved at adapter level. The output is always a **flat list of items**.

### Resolution steps

1. **Normalize**: `normalizeListConfig(rawYaml)` produces `{ title, description, image, metadata, sections }`
2. **Cascade**: For each section, merge list metadata > section defaults > item fields
3. **Filter**: Remove `active: false` items, apply schedule filters (`days`, `applySchedule`)
4. **Order**: Apply section ordering mode (fixed, shuffle, shuffle+limit, or default)
5. **Flatten**: Concatenate all section item arrays into one flat array
6. **Output**: Return flat `Item[]` — consumers never see sections

### ListAdapter changes

- `_loadList()` returns normalized config (always has `sections`)
- All `Array.isArray(data) ? data : (data.items || [])` patterns eliminated
- `getList()` returns flat `ListableItem` with `children: Item[]` (same as today)
- `resolvePlayables()` iterates normalized sections internally
- `_buildListItems()` receives resolved (cascaded) items

---

## Admin API Changes

### Updated endpoints

```
GET    /lists/:type/:name              → Returns { metadata, sections: [{ title, items, ... }] }
PUT    /lists/:type/:name/settings     → Update list-level metadata
DELETE /lists/:type/:name              → Delete list

# Section CRUD
POST   /lists/:type/:name/sections                    → Add new section
PUT    /lists/:type/:name/sections/:sectionIndex       → Update section settings
DELETE /lists/:type/:name/sections/:sectionIndex       → Delete section
PUT    /lists/:type/:name/sections/reorder             → Reorder sections

# Item CRUD (scoped to section)
POST   /lists/:type/:name/sections/:si/items           → Add item to section
PUT    /lists/:type/:name/sections/:si/items/:ii       → Update item
DELETE /lists/:type/:name/sections/:si/items/:ii       → Delete item
PUT    /lists/:type/:name/sections/:si/items/reorder   → Reorder within section

# Cross-section move
PUT    /lists/:type/:name/items/move                   → { from: {section, index}, to: {section, index} }
```

### parseListConfig() (shared normalizer)

Both the admin API and the ListAdapter use the same normalizer:

```js
normalizeListConfig(rawYaml) → {
  title, description, image, metadata,
  sections: [{ title, description, image, ...sectionDefaults, items: [...] }]
}
```

- Array input → `{ sections: [{ items: array }] }`
- `{ items }` input → `{ sections: [{ items }] }`
- `{ sections }` input → pass through
- Each item runs through existing `normalizeListItem()` for old→new format compat

### serializeListConfig() (admin write path)

When saving, the serializer writes the most compact valid format:
- If only one anonymous section with no section-level config → write as `{ title, items }`
- Otherwise → write with `sections`

---

## Admin UI Changes

### ListsFolder.jsx

**Before:** Flat list of items with optional flat/grouped toggle.
**After:** Always shows sections as collapsible groups.

```
┌──────────────────────────────────────────────────┐
│  <- Scripture Study              [+ Section] [...]│
│  Weekly scripture supplements                     │
├──────────────────────────────────────────────────┤
│  v BibleProject           [shuffle] [gear] [...] │
│    priority: medium                               │
│  ┌──────────────────────────────────────────────┐│
│  │ 1. [x] Generosity      plex:463210     [...] ││
│  │ 2. [x] Holy Spirit     plex:463212     [...] ││
│  │ 3. [ ] God              plex:463211     [...] ││
│  │    + Add item                                 ││
│  └──────────────────────────────────────────────┘│
│                                                   │
│  v Yale - New Testament    [fixed] [gear]  [...] │
│    playbackrate: 2                                │
│  ┌──────────────────────────────────────────────┐│
│  │ 1. [x] Introduction    plex:225728     [...] ││
│  │    + Add item                                 ││
│  └──────────────────────────────────────────────┘│
│                                                   │
│  [+ Add Section]                                  │
└──────────────────────────────────────────────────┘
```

Key behaviors:
1. Section headers are collapsible, show title + inherited config badges
2. Section gear icon opens section settings panel
3. DnD: drag items within a section to reorder, drag items between sections
4. Sections themselves are drag-reorderable (drag the section header)
5. "+ Add Section" at bottom creates new empty section
6. Anonymous sections (single-section lists) show as items with no section header

### Removed concepts
- `viewMode` flat/grouped toggle — gone, sections are always shown
- `existingGroups` computed from item `group` field — gone, sections are explicit
- `group` field on items — eliminated

### useAdminLists.js hook changes

**State:**
```js
// Before
const [items, setItems] = useState([]);

// After
const [sections, setSections] = useState([]);
```

**Method signature changes:**

| Before | After |
|--------|-------|
| `fetchItems(type, name)` | `fetchList(type, name)` |
| `addItem(item)` | `addItem(sectionIndex, item)` |
| `updateItem(index, updates)` | `updateItem(sectionIndex, itemIndex, updates)` |
| `deleteItem(index)` | `deleteItem(sectionIndex, itemIndex)` |
| `reorderItems(newItems)` | `reorderItems(sectionIndex, newItems)` |
| `toggleItemActive(index)` | `toggleItemActive(sectionIndex, itemIndex)` |
| — | `addSection(sectionData)` |
| — | `updateSection(sectionIndex, updates)` |
| — | `deleteSection(sectionIndex)` |
| — | `reorderSections(newOrder)` |
| — | `moveItem(from, to)` |

**Computed helper:**
```js
const flatItems = useMemo(() =>
  sections.flatMap((section, si) =>
    section.items.map((item, ii) => ({ ...item, sectionIndex: si, itemIndex: ii, sectionTitle: section.title }))
  ), [sections]);
```

Used for search, filtering, and total counts.

---

## Migration Strategy

### Phase 1 — Normalizer backward compat (zero risk)

- Add `normalizeListConfig()` to `listConfigNormalizer.mjs`
- ListAdapter uses it — all existing YAML files work without changes
- Ship and validate nothing breaks

### Phase 2 — Admin UI sections

- Admin reads/writes section format
- New admin API endpoints for section CRUD
- Admin auto-migrates: saving a list through admin writes new format
- Organic migration as lists are edited

### Phase 3 — Bulk migration script

- CLI script to convert remaining YAML files
- Groups watchlist items by `program` field into sections
- Removes redundant fields absorbed by section inheritance
- Converts `input`/`action`/`label` to `play`/`title` canonical format

Key principle: **Phase 1 means zero breakage.** Old format files work indefinitely. Migration is never forced.

---

## Migration Examples

### morning-program.yml (bare array -> flat format)

**Before:**
```yaml
- input: 'media: sfx/intro'
  label: Intro
  uid: 742d6d79-...
- input: 'query: dailynews'
  label: 10 Min News
  uid: c1074415-...
```

**After:**
```yaml
title: Morning Program
description: Weekday morning content rotation
items:
  - title: Intro
    play: { media: sfx/intro }
    uid: 742d6d79-...
  - title: 10 Min News
    play: { query: dailynews }
    uid: c1074415-...
```

### comefollowme2025.yml (flat with repeated fields -> sections)

**Before:** 200+ items, each repeating `program`, `priority`, `src`.

**After:**
```yaml
title: Come Follow Me 2025
description: Weekly scripture study supplements
sections:
  - title: BibleProject
    priority: medium
    items:
      - title: Generosity
        play: { plex: "463210" }
        subtitle: "D&C 42:30-31"
        skip_after: "2025-05-04"
        wait_until: "2025-04-27"
        uid: a8543aa3-...
      - title: Holy Spirit
        play: { plex: "463212" }
        subtitle: "D&C 8:2-3"
        skip_after: "2025-02-09"
        wait_until: "2025-02-02"
        uid: cab0bbad-...
```

### bible.yml (massive flat list grouped by `program` -> sections)

**Before:** 900+ items with `program: "Yale - New Testament"`, `list: Bible`, etc.

**After:**
```yaml
title: Bible
sections:
  - title: "Yale - New Testament"
    playbackrate: 2
    items:
      - title: "Introduction - Why Study the New Testament"
        play: { plex: "225728" }
        subtitle: "Introduction to New Testament (RLST 152)..."
        watched: true
        uid: b706cdc2-...
  - title: "Yale - Old Testament"
    playbackrate: 2
    items: [...]
```

### fhe.yml (already has title/items -> minimal change)

```yaml
title: FHE
fixed_order: true
items:
  - title: Opening Hymn
    play: { singalong: "hymn/166" }
    image: https://...
    uid: e7302007-...
  - title: Spotlight
    open: "family-selector/alan"
    image: https://...
    uid: 019b6750-...
```

---

## Files Affected

### Backend
- `backend/src/1_adapters/content/list/listConfigNormalizer.mjs` — Add `normalizeListConfig()`, `serializeListConfig()`
- `backend/src/1_adapters/content/list/ListAdapter.mjs` — Use `normalizeListConfig()` in `_loadList()`, simplify all methods
- `backend/src/4_api/v1/routers/admin/content.mjs` — Section CRUD endpoints, updated `parseListContent`
- `backend/src/4_api/v1/routers/list.mjs` — No changes needed (consumes flat output from adapter)

### Frontend
- `frontend/src/hooks/admin/useAdminLists.js` — `items` -> `sections` state, section CRUD methods
- `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx` — Section-based rendering, remove flat/grouped toggle
- `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` — Accept `sectionIndex` + `itemIndex`
- `frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx` — Replace `group` with section selector
- `frontend/src/modules/Admin/ContentLists/ListSettingsModal.jsx` — Inheritable field defaults

### New files
- `frontend/src/modules/Admin/ContentLists/SectionHeader.jsx` — Collapsible section header with config badges
- `frontend/src/modules/Admin/ContentLists/SectionSettingsModal.jsx` — Section settings editor

### Migration
- `cli/migrate-lists-to-sections.mjs` — Bulk migration script (Phase 3)
