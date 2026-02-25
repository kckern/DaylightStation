# Content Watchlists

Watchlists are ordered content playlists with **watch-state awareness**, **scheduling windows**, and **priority-based selection**. They are one of three config list types (alongside menus and programs). The key differentiator: watchlists automatically determine "next up" by combining scheduling, priority, and progress tracking.

---

## Data Storage

Watchlist YAML files live at:

```
data/household/config/lists/watchlists/{name}.yml
```

Each file is either a **bare array** of items (legacy, most common) or an **object** with `title`, `items`, and optional `sections`.

---

## YAML Format

### Current (Legacy) Format — Bare Array

Most watchlists use a flat array where each item has `src` + `media_key` to identify content, plus scheduling and state fields.

```yaml
# data/household/config/lists/watchlists/cfmscripturekc.yml
- skip_after: '2025-01-26'
  program: Rex Pinnegar
  wait_until: '2025-01-12'
  progress: 100
  priority: High
  media_key: dc/rex/37707
  src: scriptures
  watched: true
  uid: 680b8136-82af-4fa8-8c70-fd9ebb07719d
  label: D&C 1
```

```yaml
# data/household/config/lists/watchlists/comefollowme2025.yml
- skip_after: '2025-05-04'
  program: BibleProject
  wait_until: '2025-04-27'
  priority: Medium
  media_key: '463210'
  summary: D&C 42:30-31
  src: plex
  uid: a8543aa3-2900-45c6-8799-4a6085a340f6
  label: Generosity
```

### Target (To-Be) Format — Action-as-Key

```yaml
title: Family Movies
strategy: unwatched-first
items:
  - contentId: plex:11111
    priority: 1
  - contentId: plex:22222
  - contentId: plex:33333
    hold: true
    holdReason: "Too scary for youngest"
  - contentId: plex:44444
    waitUntil: "2026-03-01"
```

The `listConfigNormalizer.mjs` handles both formats transparently — legacy `src` + `media_key` is normalized to `play: { contentId: '{src}:{media_key}' }` at read time.

---

## Per-Item Fields

| Field | Type | Purpose |
|-------|------|---------|
| `src` | string | Source adapter name (legacy format — `scriptures`, `plex`, etc.) |
| `media_key` | string | Content path within source (legacy format — `dc/rex/37707`, `463210`) |
| `label` / `title` | string | Display name |
| `program` | string | Grouping label for display (e.g., "BibleProject", "Rex Pinnegar") |
| `priority` | string | Selection priority: `urgent`, `high` (alias: `High`), `medium` (alias: `Medium`), `low` |
| `wait_until` | date string | Item is invisible before this date |
| `skip_after` | date string | Auto-skip if still unwatched by this date |
| `watched` | boolean | Explicitly marked as watched |
| `progress` | number | Completion percentage (0–100) |
| `hold` | boolean | Temporarily excluded from selection |
| `days` | string/array | Day-of-week restriction (e.g., `'Weekdays'`, `'M•W•F'`, `['M', 'W', 'F']`) |
| `uid` | UUID string | Stable identity for watch-state memory lookup |
| `summary` | string | Supplementary text (e.g., scripture reference) |
| `shuffle` | boolean | Randomize playback order when this item is a container |
| `continuous` | boolean | Auto-advance through items without stopping |
| `playbackrate` | number | Playback speed multiplier |
| `fixed_order` | boolean | Item keeps its position (not affected by reordering logic) |
| `active` | boolean | Whether item is currently active/enabled |

### Scheduling Window

The `wait_until` and `skip_after` fields create a **visibility window**. This is the core mechanism for curriculum-aligned watchlists like Come Follow Me:

```
                 wait_until          skip_after
                    │                    │
  ─── invisible ────┼──── eligible ──────┼──── auto-skipped ───
                    │                    │
```

Items outside their window are filtered out during selection. Items approaching their `skip_after` deadline (within 8 days) are automatically promoted to `urgent` priority.

---

## Sections

Watchlists support **sections** for grouping items within a single file. Sections support cascading field inheritance: list-level metadata → section defaults → item overrides.

```yaml
title: Scripture Study
sections:
  - title: Come Follow Me
    priority: High
    items:
      - label: D&C 1
        src: scriptures
        media_key: dc/rex/37707
  - title: Supplemental
    priority: Medium
    items:
      - label: Generosity
        src: plex
        media_key: '463210'
```

### Inheritable Fields

These fields cascade from list → section → item (via `applyCascade()` in `listConfigNormalizer.mjs`):

`priority`, `hold`, `watched`, `skip_after`, `wait_until`, `playbackrate`, `continuous`, `shuffle`, `days`, `applySchedule`, `active`, `fixed_order`

---

## Selection Logic: ItemSelectionService

When a watchlist is played (not browsed), `ItemSelectionService` determines which item to surface. The watchlist strategy is a composable pipeline:

```
All items → Filter → Urgency Promotion → Sort → Pick → (Fallback if empty)
```

### Watchlist Strategy

```javascript
watchlist: {
  filter: ['skipAfter', 'waitUntil', 'hold', 'watched', 'days'],
  sort: 'priority',
  pick: 'first'
}
```

### Filter Pipeline

Filters are applied in sequence. Each removes items that don't meet a criterion:

| Filter | Removes Items Where... |
|--------|----------------------|
| `skipAfter` | Current date is past `skip_after` |
| `waitUntil` | Current date is before `wait_until` (with 2-day lookahead) |
| `hold` | `hold` is `true` |
| `watched` | `watched` is `true` or `progress` >= 90% |
| `days` | Current day-of-week doesn't match `days` restriction |

### Urgency Promotion

Before filtering, items with `skip_after` within **8 days** of the current date are automatically promoted to `urgent` priority. This ensures time-sensitive content surfaces before it expires.

### Priority Sort

After filtering, items are sorted by priority. Lower number = surfaces first:

| Priority | Order |
|----------|-------|
| `in_progress` | 0 (highest — items partially watched) |
| `urgent` | 1 (approaching deadline or manually flagged) |
| `high` | 2 |
| `medium` | 3 (default if no priority set) |
| `low` | 4 |

For `in_progress` items with equal priority, higher `percent` completion sorts first (resume what you're closest to finishing).

### Pick

The watchlist strategy uses `pick: 'first'` — after filtering and sorting, the **single top item** is returned as "next up."

### Fallback Cascade

When all items are filtered out (everything watched, on hold, or outside its window), the `allowFallback` option progressively relaxes filters in this order until at least one item is available:

1. Remove `skipAfter` filter (show expired items)
2. Remove `hold` filter (show held items)
3. Remove `watched` filter (show already-watched items)
4. Remove `waitUntil` filter (show future items)

This ensures a watchlist **always has something to play** rather than returning empty.

---

## Backend Architecture

### Adapter: ListAdapter

`ListAdapter` (`backend/src/1_adapters/content/list/ListAdapter.mjs`) handles the `watchlist:` content ID prefix.

**Resolution flow for `watchlist:comefollowme2025`:**

1. Parse compound ID → `(prefix=watchlist, name=comefollowme2025)`
2. Load YAML file from `data/household/config/lists/watchlists/comefollowme2025.yml`
3. Normalize via `normalizeListConfig()` → canonical `{ title, sections: [{ items }] }` format
4. Build `Item` objects for each entry via `_buildListItems()`:
   - Normalize `src:media_key` → `contentId`
   - Enrich with **live watch state** from `MediaProgressMemory` (percent, playhead, lastPlayed)
   - Compute **effective priority** (demote watched items, promote approaching-deadline items)
   - Attach scheduling metadata (hold, skipAfter, waitUntil) to item metadata
   - Construct action objects (play, queue, list) for the frontend

### Config Normalizer: listConfigNormalizer.mjs

`backend/src/1_adapters/content/list/listConfigNormalizer.mjs`

| Function | Purpose |
|----------|---------|
| `normalizeListConfig(raw)` | Accepts bare array, `{ items }`, or `{ sections }` — produces canonical `{ title, sections }` |
| `normalizeListItem(item)` | Translates legacy `{ src, media_key }` → `{ play: { contentId } }` |
| `applyCascade(config)` | Resolves field inheritance: list metadata → section → item |
| `extractContentId(item)` | Pulls content ID from any action key format |
| `serializeListConfig(config)` | Converts back to YAML-ready object for persistence |
| `denormalizeItem(item)` | Converts action-key format back to `input` + `action` for storage |

### Domain: QueueService

`QueueService` (`backend/src/2_domains/content/services/QueueService.mjs`) provides the low-level filter and sort primitives:

| Method | What It Does |
|--------|-------------|
| `sortByPriority(items)` | Sort by priority order, in_progress items by percent desc |
| `filterBySkipAfter(items, now)` | Remove items past their skip_after deadline |
| `filterByWaitUntil(items, now)` | Remove items before their wait_until date (2-day lookahead) |
| `filterByHold(items)` | Remove items with `hold: true` |
| `filterByWatched(items)` | Remove items with `watched: true` or percent >= 90% |
| `filterByDayOfWeek(items, now)` | Remove items not scheduled for today |
| `applyUrgency(items, now)` | Promote items within 8 days of skip_after to `urgent` |

### Application: ListManagementService

`ListManagementService` (`backend/src/3_applications/content/services/ListManagementService.mjs`) provides CRUD operations for the admin UI:

| Method | Purpose |
|--------|---------|
| `listByType('watchlists', hid)` | List all watchlist files |
| `getList(type, name, hid)` | Load watchlist with denormalized items |
| `createList(type, name, hid)` | Create a new watchlist file |
| `deleteList(type, name, hid)` | Delete a watchlist file |
| `addItem(type, name, item, hid)` | Add an item to the watchlist |
| `updateItem(type, name, index, item, hid)` | Update a specific item |
| `deleteItem(type, name, index, hid)` | Remove a specific item |
| `reorderItems(type, name, order, hid)` | Reorder items within a section |
| `addSection`, `splitSection`, `reorderSections`, `deleteSection` | Section management |
| `updateSettings(type, name, settings, hid)` | Update list-level metadata (title, description, image) |

Persistence is handled by `YamlListDatastore` (`backend/src/1_adapters/persistence/yaml/YamlListDatastore.mjs`), implementing the `IListStore` port.

---

## API Routes

### Content API (read/play)

| Route | Purpose |
|-------|---------|
| `GET /api/v1/list/watchlist/{name}` | Browse watchlist items with watch state |
| `GET /api/v1/list/watchlist/{name}/playable` | Resolve to playable leaves |
| `GET /api/v1/list/watchlist/{name}/recent_on_top` | Sort by most-recently-selected |

The list router enriches items with watch state via `ContentQueryService.enrichWithWatchState()`, mapping domain fields to API contract names (`percent` → `watchProgress`, `playhead` → `watchSeconds`).

### Admin API (CRUD)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/v1/admin/content/lists/watchlists` | GET | List all watchlists |
| `/api/v1/admin/content/lists/watchlists` | POST | Create new watchlist |
| `/api/v1/admin/content/lists/watchlists/{name}` | GET | Load with sections + items |
| `/api/v1/admin/content/lists/watchlists/{name}` | PUT | Replace/reorder items |
| `/api/v1/admin/content/lists/watchlists/{name}` | DELETE | Delete watchlist |
| `/api/v1/admin/content/lists/watchlists/{name}/items` | POST | Add item |
| `/api/v1/admin/content/lists/watchlists/{name}/items/{index}` | PUT | Update item |
| `/api/v1/admin/content/lists/watchlists/{name}/items/{index}` | DELETE | Delete item |
| `/api/v1/admin/content/lists/watchlists/{name}/sections` | POST | Add section |
| `/api/v1/admin/content/lists/watchlists/{name}/sections/{index}` | PUT/DELETE | Update/delete section |
| `/api/v1/admin/content/lists/watchlists/{name}/sections/reorder` | PUT | Reorder sections |
| `/api/v1/admin/content/lists/watchlists/{name}/sections/split` | POST | Split section at index |
| `/api/v1/admin/content/lists/watchlists/{name}/settings` | PUT | Update list metadata |

---

## Frontend

### Admin UI

`ListsFolder` (`frontend/src/modules/Admin/ContentLists/ListsFolder.jsx`) provides the admin editing interface:

- Drag-and-drop reordering via `@dnd-kit`
- Section collapsing, splitting, adding, deleting, reordering
- Per-item inline editing
- **Progress column** — shown only for `watchlists` type, exposing watch state (`percent`/`progress`)
- Content metadata preloading for each item's content ID

CRUD operations come from the `useAdminLists` hook (`frontend/src/hooks/admin/useAdminLists.js`).

### TV App

The TV app fetches its main menu (which may contain watchlist references) like:

```javascript
DaylightAPI("api/v1/list/watchlist/TVApp/recent_on_top")
```

Programs reference watchlists as items:

```yaml
- label: Come Follow Me Supplement
  input: 'watchlist: comefollowme2025'
```

When a program plays a watchlist item, `ListAdapter._getNextPlayableFromChild()` runs the watchlist selection strategy: first in-progress, then first unwatched, then first overall.

---

## Watchlists in Programs

Watchlists are frequently referenced as items within **programs** (time-sequenced content). When a program encounters a `watchlist:` item:

1. The `ListAdapter` resolves the watchlist name
2. `ItemSelectionService` applies the `watchlist` strategy
3. The **single "next up" item** is returned to the program queue
4. The program advances to its next slot after playback

This creates a "daily pick" pattern — each time the program runs, the watchlist surfaces its highest-priority eligible item.

---

## Content ID Patterns in Watchlists

Watchlist items reference content via compound IDs that pass through the full resolution chain:

| Pattern | Source | Example |
|---------|--------|---------|
| `plex:{ratingKey}` | Plex media | `plex:463210` |
| `scriptures:{volume}/{version}/{verseId}` | Scripture read-along | `scriptures:dc/rex/37707` |
| `watchlist:{name}` | Nested watchlist (acts as "next up" selector) | `watchlist:comefollowme2025` |
| `talk:{conference}` | Conference talk collection | `talk:ldsgc` |
| `singalong:{collection}/{id}` | Hymn/song | `singalong:hymn/198` |

---

## Key Files

| File | Layer | Purpose |
|------|-------|---------|
| `backend/src/1_adapters/content/list/ListAdapter.mjs` | Adapter | Content resolution, watch-state enrichment |
| `backend/src/1_adapters/content/list/listConfigNormalizer.mjs` | Adapter | YAML format normalization, cascade inheritance |
| `backend/src/1_adapters/persistence/yaml/YamlListDatastore.mjs` | Adapter | YAML file read/write persistence |
| `backend/src/2_domains/content/services/ItemSelectionService.mjs` | Domain | Strategy-based item selection pipeline |
| `backend/src/2_domains/content/services/QueueService.mjs` | Domain | Filter/sort primitives (priority, watched, dates) |
| `backend/src/3_applications/content/services/ListManagementService.mjs` | Application | Admin CRUD orchestration |
| `backend/src/4_api/v1/routers/list.mjs` | API | List/watchlist HTTP endpoints |
| `backend/src/4_api/v1/routers/admin/content.mjs` | API | Admin CRUD HTTP endpoints |
| `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx` | Frontend | Admin watchlist editor |
| `frontend/src/hooks/admin/useAdminLists.js` | Frontend | Admin CRUD hook |
