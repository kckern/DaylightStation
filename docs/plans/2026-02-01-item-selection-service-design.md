# ItemSelectionService Design

**Date:** 2026-02-01
**Status:** Design

---

## Overview

ItemSelectionService provides unified item selection logic for content queries. It answers: "Given a list of items and a context, which items should be returned and in what order?"

This service unifies two previously separate concerns:
- **Prioritized selection** (QueueService) - filtering and priority-based ordering for watchlists
- **Smart sorting** (reference doc Section 8) - context-aware ordering for search results

---

## Core Concept

Selection operates as a pipeline:

```
Items → Filter → Sort → Pick → Result
```

| Stage | Purpose | Examples |
|-------|---------|----------|
| **Filter** | Remove ineligible items | watched, on hold, past deadline |
| **Sort** | Order remaining items | priority, track order, chronological |
| **Pick** | Select subset | first, all, random, take N |

---

## API

```javascript
class ItemSelectionService {
  /**
   * Select items based on context and strategy.
   *
   * @param {Item[]} items - Pre-enriched items (with metadata.percent, etc.)
   * @param {Object} context - Selection context
   * @param {string} context.action - play, queue, display, list, read
   * @param {string} context.containerType - folder, album, playlist, search
   * @param {Object} context.query - Query filters used (person, time, text)
   * @param {Date} context.now - Current date (for scheduling filters)
   * @param {Object} [overrides] - Explicit strategy overrides
   * @returns {Item[]} Selected items
   */
  select(items, context, overrides = {}) {
    const strategy = this.resolveStrategy(context, overrides);

    const filtered = strategy.filter
      ? this.applyFilters(items, strategy.filter, context)
      : items;

    const sorted = this.applySort(filtered, strategy.sort, context);

    return this.applyPick(sorted, strategy.pick, context);
  }
}
```

---

## Strategy Resolution

Strategies are resolved in layers, with later layers overriding earlier:

```
1. INFERENCE (from context)
        ↓
2. CONFIG (from household/app settings)
        ↓
3. EXPLICIT OVERRIDE (from query params)
```

### 1. Inference Rules

| Context Signal | Inferred Strategy |
|----------------|-------------------|
| `containerType === 'folder'` | `watchlist` |
| `containerType === 'album'` | `album` |
| `containerType === 'playlist'` | `playlist` |
| `query.person` present | `chronological` |
| `query.time` present | `chronological` |
| `query.text` (no album match) | `discovery` |
| `action === 'display'` | `slideshow` |

### 2. Config Defaults

```yaml
# apps/tv/config.yml
defaults:
  selection:
    folders:
      FHE:
        strategy: watchlist
      "Music Videos":
        strategy: discovery
    containers:
      album: album
      playlist: playlist
```

### 3. Explicit Overrides

Query parameters override inference and config:

| Parameter | Effect |
|-----------|--------|
| `?strategy=binge` | Full strategy override |
| `?sort=random` | Override sort only |
| `?pick=random` | Override pick only |
| `?filter=none` | Disable filtering |

---

## Named Strategies (Presets)

| Strategy | Filter | Sort | Pick | Use Case |
|----------|--------|------|------|----------|
| `watchlist` | skipAfter, hold, watched, days, waitUntil | priority | first | Daily programming |
| `binge` | watched | source_order | all | Catch-up viewing |
| `album` | none | track_order | all | Music albums |
| `playlist` | none | source_order | all | User-curated playlists |
| `discovery` | none | random | first/all | Search results |
| `chronological` | none | date_asc | all | Person/time queries |
| `slideshow` | none | random | all | Photo display |

---

## Filter Types

### Watchlist Filters

Used by `watchlist` strategy. Implements the "next lecture today" pattern.

| Filter | Behavior |
|--------|----------|
| `skipAfter` | Exclude if `item.metadata.skipAfter < now` |
| `waitUntil` | Exclude if `item.metadata.waitUntil > now + 2 days` |
| `hold` | Exclude if `item.metadata.hold === true` |
| `watched` | Exclude if `item.metadata.percent >= 90` or `item.metadata.watched === true` |
| `days` | Exclude if today's weekday not in `item.metadata.days` |

### Urgency Promotion

Items with `skipAfter` within 8 days are promoted to `priority: 'urgent'`.

### Fallback Cascade

If all items are filtered out, progressively relax filters:
1. Ignore skipAfter/hold
2. Ignore watched
3. Ignore waitUntil

---

## Sort Types

| Sort | Ordering | Used By |
|------|----------|---------|
| `priority` | in_progress (by % desc) > urgent > high > medium > low | watchlist |
| `track_order` | discNumber, trackNumber | album |
| `source_order` | Preserve source ordering | playlist, binge |
| `date_asc` | metadata.date ascending | chronological |
| `date_desc` | metadata.date descending | - |
| `random` | Fisher-Yates shuffle | discovery, slideshow |
| `title` | Alphabetical by title | - |

---

## Pick Types

| Pick | Behavior | Used By |
|------|----------|---------|
| `first` | Return `[items[0]]` | play action |
| `all` | Return all items | queue, list actions |
| `random` | Return one random item | discovery play |
| `take:N` | Return first N items | pagination |

---

## Item Enrichment Contract

ItemSelectionService expects items to have standard metadata fields. Adapters are responsible for enrichment.

```typescript
interface SelectableItem {
  id: string;
  metadata: {
    // Watch state (for watchlist strategy)
    percent?: number;        // 0-100, from mediaProgressMemory
    watched?: boolean;       // explicit mark from config
    priority?: 'in_progress' | 'urgent' | 'high' | 'medium' | 'low';

    // Scheduling (for watchlist strategy)
    hold?: boolean;
    skipAfter?: string;      // ISO date
    waitUntil?: string;      // ISO date
    days?: number[] | string; // [1,3,5] or 'M·W·F'

    // Ordering (for track_order strategy)
    trackNumber?: number;
    discNumber?: number;
    itemIndex?: number;      // generic ordering

    // Temporal (for chronological strategy)
    date?: string;           // ISO date
    takenAt?: string;        // for photos
    year?: number;
  }
}
```

---

## Enrichment Responsibility

| Source | Adapter | Fields Enriched |
|--------|---------|-----------------|
| folder | FolderAdapter | percent, priority, hold, skipAfter, waitUntil, days |
| plex | PlexAdapter | percent, trackNumber, year |
| immich | ImmichAdapter | takenAt, date |
| filesystem | FilesystemAdapter | trackNumber, discNumber (from ID3) |
| audiobookshelf | AudiobookshelfAdapter | percent, trackNumber |

---

## Relationship to Existing Code

### QueueService

QueueService contains the pure filter/sort logic for watchlist strategy. It becomes an internal implementation detail of ItemSelectionService.

```javascript
// QueueService methods become internal helpers:
// - filterBySkipAfter() → filter: 'skipAfter'
// - filterByWaitUntil() → filter: 'waitUntil'
// - filterByHold() → filter: 'hold'
// - filterByWatched() → filter: 'watched'
// - filterByDayOfWeek() → filter: 'days'
// - applyUrgency() → pre-sort promotion
// - sortByPriority() → sort: 'priority'
```

### FolderAdapter

FolderAdapter currently has inline filter logic in `_shouldSkipForPlayback()`. This will be replaced by calls to ItemSelectionService with `strategy: 'watchlist'`.

```javascript
// Before (FolderAdapter.resolvePlayables)
if (this._shouldSkipForPlayback(child)) continue;

// After
const selected = itemSelectionService.select(children, {
  action: 'play',
  containerType: 'folder',
  now: new Date()
});
```

FolderAdapter will eventually be deprecated in favor of ConfigService-managed watchlists.

---

## Implementation Notes

### Pure and Sync

ItemSelectionService is pure and synchronous:
- No I/O (watch state already on items)
- No dependencies except config
- Easily testable with mock items

### Date Injection

All date-dependent logic requires `context.now` to be passed explicitly. This enables:
- Deterministic testing
- Timezone-aware scheduling
- Replay/simulation

---

## Open Questions

1. **Album detection**: How do we detect that search results are an album? Signals:
   - All items share `parentId`
   - Sequential `itemIndex` values
   - Track count matches known album

2. **Capability validation**: Should ItemSelectionService validate that selected items match the action's required capability? Current recommendation: warn but don't error.

---

## References

- `query-combinatorics.md` Section 2 - Action × Target Type Behavior
- `query-combinatorics.md` Section 8 - Sorting
- `backend/src/2_domains/content/services/QueueService.mjs` - Watchlist filter/sort logic
- `backend/src/1_adapters/content/folder/FolderAdapter.mjs` - Current implementation
