# Item Selection Service Reference

ItemSelectionService provides unified item selection logic for content queries. It answers: "Given a list of items and a context, which items should be returned and in what order?"

For query parameter syntax and action semantics, see `query-combinatorics.md`.

---

## 1. Overview

Selection operates as a pipeline:

```
Items → Filter → Sort → Pick → Result
```

| Stage | Purpose | Examples |
|-------|---------|----------|
| **Filter** | Remove ineligible items | watched, on hold, past deadline |
| **Sort** | Order remaining items | priority, track order, chronological |
| **Pick** | Select subset | first, all, random, take N |

**Location:** `backend/src/2_domains/content/services/ItemSelectionService.mjs`

**Import:**
```javascript
import { ItemSelectionService } from '#domains/content';
```

---

## 2. API

### Main Entry Point

```javascript
ItemSelectionService.select(items, context, overrides)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `items` | `Array` | Pre-enriched items with metadata (percent, priority, etc.) |
| `context.now` | `Date` | Current date (required for filtering) |
| `context.action` | `string` | play, queue, display, list, read |
| `context.containerType` | `string` | folder, album, playlist, search |
| `context.query` | `object` | Query filters used (person, time, text) |
| `overrides.strategy` | `string` | Force named strategy |
| `overrides.sort` | `string` | Override sort only |
| `overrides.pick` | `string` | Override pick only |
| `overrides.filter` | `'none'` | Disable all filtering |
| `overrides.allowFallback` | `boolean` | Enable fallback cascade |

**Returns:** Selected items array

### Example

```javascript
const items = [
  { id: '1', priority: 'low', hold: false, percent: 0 },
  { id: '2', priority: 'high', hold: false, percent: 0 },
  { id: '3', priority: 'medium', hold: true, percent: 0 }
];

const result = ItemSelectionService.select(items, {
  containerType: 'watchlist',
  now: new Date()
});

// Result: [{ id: '2', ... }] - high priority item (id:3 filtered by hold)
```

---

## 3. Strategies

Strategies are named presets that define filter, sort, and pick behavior.

| Strategy | Filter | Sort | Pick | Use Case |
|----------|--------|------|------|----------|
| `watchlist` | skipAfter, waitUntil, hold, watched, days | priority | first | Pick N from content pool |
| `program` | skipAfter, waitUntil, hold, days | source_order | all | Daily program sequence |
| `binge` | watched | source_order | all | Catch-up viewing |
| `album` | (none) | track_order | all | Music albums |
| `playlist` | (none) | source_order | all | User-curated playlists |
| `discovery` | (none) | random | first | Search results |
| `chronological` | (none) | date_asc | all | Person/time queries |
| `slideshow` | (none) | random | all | Photo display |

### Strategy Resolution

Strategies are resolved in layers, with later layers overriding earlier:

```
1. INFERENCE (from context)
        ↓
2. EXPLICIT OVERRIDE (from query params)
```

**Inference Rules (in order):**

| Context Signal | Inferred Strategy |
|----------------|-------------------|
| `containerType === 'watchlist'` | watchlist |
| `containerType === 'program'` | program |
| `containerType === 'folder'` | watchlist (deprecated) |
| `containerType === 'album'` | album |
| `containerType === 'playlist'` | playlist |
| `query.person` present | chronological |
| `query.time` present | chronological |
| `query.text` present | discovery |
| `action === 'display'` | slideshow |
| (no match) | discovery |

**Override Examples:**

```javascript
// Force binge strategy on a watchlist
ItemSelectionService.select(items, { containerType: 'watchlist', now }, { strategy: 'binge' });

// Override just the sort
ItemSelectionService.select(items, { containerType: 'watchlist', now }, { sort: 'random' });

// Disable all filtering
ItemSelectionService.select(items, { containerType: 'watchlist', now }, { filter: 'none' });

// Pick 2 items from a watchlist (for embedding in a program)
ItemSelectionService.select(items, { containerType: 'watchlist', now }, { pick: 'take:2' });
```

### Program vs Watchlist

Two core container types that use different selection strategies:

| Concept | Question Answered | Pick | Filters `watched` |
|---------|------------------|------|-------------------|
| **Program** | "What's eligible for today's run?" | all | No |
| **Watchlist** | "What N items from this content pool?" | first/take:N | Yes |

**Program** - An ordered sequence of items (e.g., "Morning Program"):
- Returns ALL eligible items in source order
- Filters by scheduling (days, hold, skipAfter) but NOT by watch state
- Items play through in sequence

**Watchlist** - A content pool to pick from (e.g., "Cooking Lessons"):
- Returns N items based on priority and watch state
- Filters watched items so you get the "next" unwatched content
- Use `pick: 'take:N'` to get multiple items

**Programs can contain watchlists:**

```
Morning Program (program strategy)
├── Intro                      → atomic item
├── News                       → atomic item
├── Cooking Lessons (pick: 2)  → watchlist → returns [Lesson 5, Lesson 6]
└── Closing                    → atomic item

Result queue: [Intro, News, Lesson5, Lesson6, Closing]
```

When a program contains a watchlist reference, the watchlist resolves to N items which get flattened into the program queue.

---

## 4. Filters

Filters remove items that shouldn't be shown or played.

| Filter | Behavior | Date Required |
|--------|----------|---------------|
| `skipAfter` | Exclude if `item.skipAfter < now` | Yes |
| `waitUntil` | Exclude if `item.waitUntil > now + 2 days` | Yes |
| `hold` | Exclude if `item.hold === true` | No |
| `watched` | Exclude if `item.percent >= 90` or `item.watched === true` | No |
| `days` | Exclude if today's weekday not in `item.days` | Yes |

### Filter Methods

```javascript
// Apply single filter
ItemSelectionService.applyFilter(items, 'watched', { now });

// Apply multiple filters
ItemSelectionService.applyFilters(items, ['hold', 'watched'], { now });
```

### Days Filter Format

The `days` field accepts:

| Format | Meaning |
|--------|---------|
| `[1, 3, 5]` | ISO weekdays (1=Monday, 7=Sunday) |
| `'Weekdays'` | Monday through Friday |
| `'Weekend'` | Saturday and Sunday |
| `'M•W•F'` | Monday, Wednesday, Friday |
| `'T•Th'` | Tuesday, Thursday |
| `'M•W'` | Monday, Wednesday |

### Urgency Promotion

Items with `skipAfter` within 8 days are promoted to `priority: 'urgent'`. This happens automatically when the strategy includes the `skipAfter` filter.

```javascript
// Item with skipAfter in 5 days gets priority upgraded
{ id: '1', priority: 'medium', skipAfter: '2026-01-20' }
// Becomes:
{ id: '1', priority: 'urgent', skipAfter: '2026-01-20' }
```

---

## 5. Sorts

Sorts order the items after filtering.

| Sort | Ordering | Notes |
|------|----------|-------|
| `priority` | in_progress > urgent > high > medium > low | in_progress sorted by percent desc |
| `track_order` | discNumber, then trackNumber | Falls back to itemIndex |
| `source_order` | Preserve input order | Returns shallow copy |
| `date_asc` | date ascending | Falls back to takenAt |
| `date_desc` | date descending | Falls back to takenAt |
| `random` | Fisher-Yates shuffle | Non-deterministic |
| `title` | Alphabetical by title | Uses localeCompare |

### Sort Method

```javascript
const sorted = ItemSelectionService.applySort(items, 'priority');
```

### Priority Order

```
in_progress (by percent desc)
    ↓
urgent
    ↓
high
    ↓
medium (default for items without priority)
    ↓
low
```

---

## 6. Picks

Picks select a subset of items after sorting.

| Pick | Behavior |
|------|----------|
| `first` | Return `[items[0]]` |
| `all` | Return all items |
| `random` | Return one random item |
| `take:N` | Return first N items |

### Pick Method

```javascript
const selected = ItemSelectionService.applyPick(items, 'first');
const batch = ItemSelectionService.applyPick(items, 'take:5');
```

---

## 7. Fallback Cascade

When `allowFallback: true` and all items are filtered out, the service progressively relaxes filters until results are found.

**Relaxation Order:**
1. Remove `skipAfter` filter
2. Remove `hold` filter
3. Remove `watched` filter
4. Remove `waitUntil` filter

The `days` filter is never relaxed (day-of-week constraints represent user scheduling intent).

### Example

```javascript
const items = [
  { id: '1', hold: true, percent: 95 } // Both on hold AND watched
];

// Without fallback: returns []
ItemSelectionService.select(items, { containerType: 'folder', now });

// With fallback: relaxes hold, then watched, returns item
ItemSelectionService.select(items, { containerType: 'folder', now }, { allowFallback: true });
```

---

## 8. Item Enrichment Contract

ItemSelectionService expects items to have standard metadata fields. Adapters are responsible for enrichment before calling select().

```typescript
interface SelectableItem {
  id: string;

  // Watch state (for watchlist strategy)
  percent?: number;        // 0-100, from mediaProgressMemory
  watched?: boolean;       // explicit mark from config
  priority?: 'in_progress' | 'urgent' | 'high' | 'medium' | 'low';

  // Scheduling (for watchlist strategy)
  hold?: boolean;
  skipAfter?: string;      // ISO date
  waitUntil?: string;      // ISO date
  days?: number[] | string; // [1,3,5] or 'M•W•F'

  // Ordering (for track_order strategy)
  trackNumber?: number;
  discNumber?: number;
  itemIndex?: number;      // generic ordering fallback

  // Temporal (for chronological strategy)
  date?: string;           // ISO date
  takenAt?: string;        // for photos

  // Display
  title?: string;          // for title sort
}
```

### Enrichment by Source

| Source | Fields Enriched |
|--------|-----------------|
| folder | percent, priority, hold, skipAfter, waitUntil, days |
| plex | percent, trackNumber, year |
| immich | takenAt, date |
| filesystem | trackNumber, discNumber (from ID3) |
| audiobookshelf | percent, trackNumber |

---

## 9. Pipeline Internals

The `select()` method orchestrates this pipeline:

```
items
  │
  ├── resolveStrategy(context, overrides)
  │         │
  │         ├── Apply inference rules
  │         ├── Override with explicit strategy
  │         └── Apply individual overrides (sort, pick, filter)
  │
  ├── applyUrgency(items, now)  [if strategy includes skipAfter]
  │
  ├── applyFiltersWithFallback(items, filters, context, allowFallback)
  │         │
  │         ├── Apply all filters
  │         └── If empty && allowFallback: progressively relax
  │
  ├── applySort(items, sortName)
  │
  └── applyPick(items, pickType)
          │
          └── result
```

### Pure and Sync

ItemSelectionService is pure and synchronous:
- No I/O (watch state already on items)
- No external dependencies except QueueService
- All date-dependent logic requires `context.now` to be passed explicitly

---

## 10. Common Patterns

### Daily Watchlist Playback

```javascript
// Get next item from watchlist for today
const result = ItemSelectionService.select(folderItems, {
  containerType: 'folder',
  now: new Date()
});
// Returns: first eligible item by priority
```

### Binge Mode

```javascript
// Skip all watch-state filters, play in order
const result = ItemSelectionService.select(showEpisodes, {
  containerType: 'folder',
  now: new Date()
}, {
  strategy: 'binge'
});
// Returns: all unwatched episodes in source order
```

### Album Playback

```javascript
// Play album in track order
const result = ItemSelectionService.select(albumTracks, {
  containerType: 'album',
  now: new Date()
});
// Returns: all tracks sorted by discNumber, trackNumber
```

### Photo Slideshow

```javascript
// Random slideshow of all photos
const result = ItemSelectionService.select(photos, {
  action: 'display',
  now: new Date()
});
// Returns: all photos in random order
```

### Search with Random Pick

```javascript
// Pick one random result from search
const result = ItemSelectionService.select(searchResults, {
  query: { text: 'vacation' },
  now: new Date()
});
// Returns: one random item
```

### Person Timeline

```javascript
// Chronological photos of a person
const result = ItemSelectionService.select(personPhotos, {
  query: { person: 'uuid-123' },
  now: new Date()
});
// Returns: all photos sorted by date ascending
```

---

## 11. Error Handling

| Error | Cause |
|-------|-------|
| `Unknown strategy: {name}` | Invalid strategy name passed |
| `Unknown filter: {name}` | Invalid filter name |
| `Unknown sort: {name}` | Invalid sort name |
| `Unknown pick: {type}` | Invalid pick type |
| `Invalid take format` | `take:abc` instead of `take:5` |
| `now date required for filtering` | Missing `context.now` with date-dependent filters |

---

## 12. Testing

Test file: `tests/isolated/domain/content/services/ItemSelectionService.test.mjs`

```bash
npx jest tests/isolated/domain/content/services/ItemSelectionService.test.mjs
```

57 tests covering:
- All 7 strategy presets
- All 5 filter types
- All 7 sort types
- All 4 pick types
- Strategy resolution (inference + overrides)
- Full pipeline integration
- Fallback cascade behavior

---

## 13. Integration with ContentQueryService

ItemSelectionService is wired into the playback flow via `ContentQueryService.resolve()`:

```javascript
// Application layer orchestrates the pipeline
const result = await contentQueryService.resolve('folder', 'FHE', {
  now: new Date(),
  containerType: 'folder'
});

// Returns: { items: [...selected], strategy: { name, filter, sort, pick } }
```

### Resolution Flow

```
Route (/api/v1/play/:source/*)
    ↓
ContentQueryService.resolve()
    ↓
adapter.resolvePlayables()     → Flat list of items
    ↓
#enrichWithWatchState()        → Add percent, watched, priority from memory
    ↓
ItemSelectionService.select()  → Filter → Sort → Pick
    ↓
Selected items returned
```

### Watch State Enrichment

Before selection, items are enriched with:

| Field | Source | Purpose |
|-------|--------|---------|
| `percent` | mediaProgressMemory | Watch progress (0-100) |
| `watched` | percent >= 90 | Boolean for filter |
| `priority` | 'in_progress' if 0 < percent < 90 | Sort ordering |
| `playhead` | mediaProgressMemory | Resume position |

This ensures ItemSelectionService has the data it needs to apply watchlist filters.

---

## Related Documentation

- `query-combinatorics.md` - Query parameter syntax, action definitions
- `content-stack-reference.md` - API routes, adapter model
- `docs/plans/2026-02-01-item-selection-service-design.md` - Original design document
