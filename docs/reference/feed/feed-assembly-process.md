# Feed Assembly Process

How scroll batches are assembled from raw source data to rendered cards — covering the full pipeline from API request through pool management, flex allocation, tier assembly, spacing enforcement, and response.

---

## Overview

When a user scrolls the feed, a `GET /api/v1/feed/scroll` request triggers a multi-stage pipeline that produces a batch of mixed-content items. The pipeline is split across six services, each with a single responsibility:

| Service | Responsibility |
|---------|---------------|
| `FeedAssemblyService` | Orchestrator — coordinates the pipeline, owns the LRU item cache |
| `FeedPoolManager` | Item pool — fetches from sources with pagination, age filtering, recycling |
| `TierAssemblyService` | Batch composition — flex allocation, within-tier selection, interleaving |
| `FlexAllocator` | Slot distribution — CSS flexbox-inspired algorithm for dividing batch slots |
| `FlexConfigParser` | Config normalization — parses YAML flex shorthand into allocator descriptors |
| `SpacingEnforcer` | Distribution rules — prevents clustering of same-source items |

### Request-to-Response Flow

```
GET /api/v1/feed/scroll?cursor=...&limit=...&focus=...&filter=...
                │
                ▼
     FeedAssemblyService.getNextBatch()
                │
        ┌───────┴───────┐
        │  ?filter= ?   │  Resolve via FeedFilterResolver
        │  tier/source/ │  (4-layer chain)
        │  query/alias  │
        └───────┬───────┘
                │ yes → #getFilteredBatch() → bypass assembly → return
                │ no
                ▼
        ┌───────┴───────┐
        │  Fresh load?  │  (no cursor)
        │  Reset pool   │
        └───────┬───────┘
                │
                ▼
     FeedPoolManager.getPool()
        │
        ├─ First call: #initializePool()
        │   └─ Fan-out fetchPage() to all sources in parallel
        │   └─ Age-filter results, record cursors
        │
        ├─ Pool empty + sources remain: await #proactiveRefill()
        │
        └─ Return unseen items (tagged with _seen flag)
                │
                ▼
        ┌───────┴──────────────┐
        │  Source filter mode?  │  (?source=reddit,komga)
        │  Skip tier assembly  │
        └───────┬──────────────┘
                │ no
                ▼
     TierAssemblyService.assemble()
        │
        ├─ Level 1: FlexAllocator distributes slots across tiers
        ├─ Wire decay: exponential reduction of wire slots
        ├─ Overflow cascade: freed wire slots → non-wire tiers
        ├─ Level 2: Within-tier selection (sort → cap → filler)
        ├─ Shortfall redistribution: exhausted tiers → others
        ├─ Cross-tier: interleave non-wire into wire backbone
        ├─ Deduplicate
        └─ SpacingEnforcer.enforce()
                │
                ▼
     Padding pass (fill short batches from padding sources)
                │
                ▼
     Cycling pass (duplicate items as last resort)
                │
                ▼
     Image dimension probe (parallel HEAD requests)
                │
                ▼
     FeedPoolManager.markSeen() → triggers proactive refill or recycle
                │
                ▼
     Cache items in LRU (for deep-link resolution)
                │
                ▼
     Return { items, hasMore, colors, feed_assembly }
```

---

## Stage 1: Pool Management (FeedPoolManager)

`FeedPoolManager` maintains a per-user in-memory pool of feed items. It sits between `FeedAssemblyService` and the source adapters, handling pagination, age filtering, and content recycling.

### State (per user)

| Field | Type | Purpose |
|-------|------|---------|
| `#pools` | `Map<username, Object[]>` | Accumulated item pool (grows as pages are fetched) |
| `#seenIds` | `Map<username, Set<string>>` | IDs already served in batches |
| `#seenItems` | `Map<username, Object[]>` | Full item objects for recycling (capped at 500) |
| `#cursors` | `Map<username, Map<sourceKey, { cursor, exhausted, lastFetch }>>` | Per-source pagination state |
| `#refilling` | `Map<username, boolean>` | Prevents concurrent refills |
| `#batchCounts` | `Map<username, number>` | 1-indexed batch counter (reset on fresh load) |
| `#scrollConfigs` | `Map<username, Object>` | Cached scroll config per user |
| `#firstPageCursors` | `Map<sourceKey, cursor>` | Cached first-page cursors for cache-hit pagination |

All state is session-scoped — it resets when the user does a fresh page load (no cursor in the request).

### Constants

```
REFILL_THRESHOLD_MULTIPLIER = 2   // refill when unseen < batchSize × 2
MAX_SEEN_ITEMS = 500              // cap history to prevent unbounded growth
SOURCE_TIMEOUT_MS = 20_000        // per-source fetch timeout
```

### Pool Initialization

On first request, all query configs are dispatched in parallel via `Promise.allSettled`:

```
Query configs (household + user merged)
    │
    ├── reddit.yml    → RedditFeedAdapter.fetchPage()     → { items, cursor: "t3_abc" }
    ├── news.yml      → FreshRSS built-in handler          → { items, cursor: "cont123" }
    ├── headlines.yml  → Headlines built-in handler         → { items, cursor: "30" }
    ├── photos.yml    → ImmichFeedAdapter.fetchPage()      → { items, cursor: null }
    ├── weather.yml   → WeatherFeedAdapter.fetchPage()     → { items, cursor: null }
    └── ...
```

Each result is age-filtered and its cursor is recorded. Sources returning `cursor: null` are marked as exhausted. Each source fetch has a 20-second timeout.

### getPool Flow

1. Cache scroll config for later reference
2. Initialize pool on first call
3. Increment batch counter (1-indexed)
4. Tag items with `_seen: true` if ID is in seen set
5. Filter dismissed items (from dismissedItemsStore)
6. If unseen count is 0 AND sources are refillable → await `#proactiveRefill()`
7. Return available items

### Pagination (fetchPage)

Source adapters implement `IFeedSourceAdapter.fetchPage(query, username, { cursor })`:

| Adapter | Cursor Type | Mechanism |
|---------|-------------|-----------|
| `FreshRSSFeedAdapter` | GReader `continuation` token | Passed as `continuation` param to GReader API |
| `RedditFeedAdapter` | Reddit `after` fullname | Passed as `after=` query param to Reddit JSON API |
| `GoogleNewsFeedAdapter` | Integer offset | Re-fetches all topics, slices at offset (RSS has no native pagination) |
| All others | `null` (no pagination) | Base class default returns `cursor: null` |

The base class `IFeedSourceAdapter.fetchPage()` delegates to `fetchItems()` by default, returning `cursor: null`. Adapters override only if they support pagination.

### Cache Integration

First-page fetches go through `FeedCacheService` (stale-while-revalidate). The cursor from the fetch callback is persisted in `#firstPageCursors` so that cache hits (where the callback is not invoked) still have a valid cursor for subsequent pagination.

Subsequent pages (cursor is not `undefined`) bypass the cache entirely — the cache only stores first-page results.

### Age Filtering

Each source has a `max_age_hours` threshold. Items older than the threshold are discarded. If an entire page is stale, the source is marked exhausted (no further pagination).

Age threshold resolution priority:

1. Source-level `max_age_hours` in user's `feed.yml` scroll config
2. Hardcoded source defaults: `freshrss: 336h (2w)`, `reddit: 168h (1w)`, `headlines: 48h`, `googlenews: 48h`
3. Tier-level default: `wire: 48h`, `compass: 48h`, `library: null`, `scrapbook: null`
4. Absolute fallback: `48h`

Sources with `null` max age (library, scrapbook) accept content of any age — these are timeless sources like photos and digital magazines.

### Proactive Refill

When `markSeen()` detects fewer than `2 × batch_size` unseen items remaining, it triggers a background refill. The refill fetches the next page from every non-exhausted source in parallel, deduplicates against the existing pool, and appends fresh items.

If `getPool()` is called when the pool is empty but sources remain, it **awaits** the refill rather than returning nothing.

### Silent Recycling

When all sources are exhausted and the pool is empty, seen items are shuffled (Fisher-Yates) back into the pool and the seen-ID set is cleared. This creates an infinite scroll experience — `hasMore` never returns `false` as long as items have been seen.

The seen-items history is capped at 500 items to prevent unbounded memory growth. Recycled items are tagged with `_seen: true` so the tier assembly can deprioritize them.

---

## Stage 2: Flex Slot Allocation (FlexAllocator)

Before tier assembly selects items, `FlexAllocator` distributes the batch's total slot count across tiers (and within each tier, across sources). This is a CSS flexbox-inspired algorithm that respects grow/shrink/basis/min/max constraints.

### Two-Level Allocation

```
Level 1 (Batch → Tiers):
  FlexAllocator.distribute(batchSize, [wire, compass, scrapbook, library])
    → wire: 34, compass: 6, scrapbook: 5, library: 5

Level 2 (Tier → Sources):
  FlexAllocator.distribute(wireSlots, [feeds, social, news, video])
    → feeds: 17, social: 8, news: 6, video: 3
```

### Flex Descriptor

Each tier or source is described by a flex descriptor:

| Field | Type | Meaning |
|-------|------|---------|
| `grow` | number (0+) | Growth coefficient — share of surplus space |
| `shrink` | number (0+) | Shrink coefficient — share of deficit reduction |
| `basis` | number or `'auto'` | Initial allocation before flex adjustments |
| `min` | number | Minimum slots (absolute floor) |
| `max` | number or `Infinity` | Maximum slots (absolute cap) |
| `available` | number | Pool size — items available for this tier/source |

### Algorithm (Iterative, Max 10 Passes)

**Step 1 — Basis Resolution:**

| Input | Resolution |
|-------|-----------|
| `'auto'` | `min(available, containerSize)` |
| `0.0–1.0` (proportion) | `basis × containerSize` |
| `> 1` (absolute) | Used directly |

**Step 2 — Iterate Until Convergence:**

For each pass:

1. Identify unfrozen items (available > 0, not clamped yet)
2. Calculate free space: `delta = containerSize - frozenSum - basisSum`
3. If `delta > 0` (surplus): distribute proportionally by `grow`
4. If `delta < 0` (deficit): reduce proportionally by `shrink × basis`
5. Clamp each item to `[min, min(max, available)]`
6. Freeze any item that hit a bound
7. If nothing froze → converged; otherwise → next iteration

**Step 3 — Implicit Floor:**

Any item with `available > 0` but allocated < 1 slot is bumped to 1. This guarantees every tier/source with content gets at least one slot.

**Step 4 — Integer Rounding:**

Convert floats to integers. Remainder slots go to highest-grow items first.

### Example: Tier Allocation (batch_size=50)

```yaml
tiers:
  wire:      { flex: "1 0 auto", min: 20 }     # grow=1, no shrink, basis=auto
  compass:   { flex: "0 0 6", min: 4 }          # fixed 6 slots
  scrapbook: { flex: "0 0 5", min: 3 }          # fixed 5 slots
  library:   { flex: "0 0 5", min: 2 }          # fixed 5 slots
```

1. Fixed tiers resolve: compass=6, scrapbook=5, library=5 → sum=16
2. Wire (grow=1) absorbs remaining: 50 - 16 = **34 slots**
3. Wire clamped to min 20 → stays at 34 (above minimum)

### FlexConfigParser

Converts YAML config into normalized flex descriptors. Supports multiple formats:

**Named aliases:**

| Alias | grow | shrink | basis |
|-------|------|--------|-------|
| `filler` | 1 | 1 | 0 |
| `fixed` / `none` | 0 | 0 | auto |
| `dominant` | 2 | 0 | auto |
| `padding` | 1 | 0 | 0 |
| `auto` | 1 | 1 | auto |

**String shorthand:** `"grow shrink basis"` — e.g., `"1 0 auto"`, `"2 0 6"`

**Number shorthand:** `flex: 2` → `{ grow: 2, shrink: 1, basis: 0 }`

**Explicit keys:** Individual `grow:`, `shrink:`, `basis:`, `min:`, `max:` fields

**Legacy migration:** Old keys are still supported:

| Legacy Key | Maps To |
|-----------|---------|
| `allocation: 10` | `basis: 10/batchSize` (proportion) |
| `max_per_batch: 5` | `max: 5` |
| `min_per_batch: 1` | `min: 1` |
| `role: filler` | alias `filler` |
| `padding: true` | alias `padding` |

Explicit flex keys take precedence over legacy keys.

---

## Stage 3: Tier Assembly (TierAssemblyService)

Items from the pool are assembled into a batch using a four-tier system. Each query config declares a `tier` that determines how its items are distributed.

### Tier Definitions

| Tier | Purpose | Default Flex | Sort Strategy | Example Sources |
|------|---------|-------------|---------------|-----------------|
| **wire** | External content streams | `grow: 1, basis: auto` (fills remaining) | `timestamp_desc` | headlines, reddit, youtube, googlenews, freshrss |
| **library** | Long-form reading | `basis: 2` (fixed) | `random` | komga |
| **scrapbook** | Personal memories | `basis: 2` (fixed) | `random` | photos, journal |
| **compass** | Life dashboard | `basis: 6` (fixed) | `priority` | weather, health, fitness, plex, tasks, gratitude, entropy |

### Assembly Algorithm

#### Step 1 — Tier Config Resolution

`#resolveTierConfig()` merges user-provided tier config with hardcoded defaults. Each tier is parsed through `FlexConfigParser` to generate flex descriptors. Wire tier defaults to `grow=1, basis='auto'` (fills remaining space after non-wire tiers).

#### Step 2 — Bucketing

`#bucketByTier()` partitions all pool items by their `tier` field. Items without a tier default to wire.

#### Step 3 — Flex Slot Allocation

`FlexAllocator.distribute(effectiveLimit, tierDescriptors)` divides the total batch size across the four tiers. Each tier's descriptor includes its `available` count (items in its bucket), ensuring allocation never exceeds supply.

#### Step 4 — Wire Decay

**Formula (exponential):**

```
decayFactor = 0.5 ^ ((batchNumber - 1) / halfLife)
```

Config key: `wire_decay_half_life` (default: 2 batches)

| Batch | halfLife=2 | halfLife=5 |
|-------|-----------|-----------|
| 1 | 100% | 100% |
| 2 | 71% | 87% |
| 3 | 50% | 76% |
| 4 | 35% | 66% |
| 5 | 25% | 57% |
| 6 | 18% | 50% |
| 10 | 3% | 28% |

This creates a "news first, personal later" experience: early batches show breaking headlines and external content, while extended scrolling transitions to photos, journal entries, health data, and reading material.

**Slot redistribution after decay:**

```
decayedWire = round(baseWire × decayFactor)
freed = baseWire - decayedWire
```

Freed slots redistribute to non-wire tiers in two passes:

1. **Proportional share** — each non-wire tier gets `freed × tierSlots / totalNonWire`, capped at pool availability
2. **Overflow cascade** — if a tier can't absorb its share (pool exhausted), overflow redistributes to tiers with headroom. Iterates until all freed slots are absorbed or no capacity remains.

This guarantees no freed wire slots are wasted — they cascade to whichever tiers can use them.

**Batch tracking** lives in `FeedPoolManager.#batchCounts` (per-user Map, 1-indexed, reset on fresh page load). `FeedAssemblyService` reads the batch number and passes it to `TierAssemblyService.assemble()`.

**Configuration** in `data/users/{username}/config/feed.yml`:

```yaml
scroll:
  wire_decay_half_life: 2   # wire halves every 2 batches (default)
```

Set to `0` or omit to disable decay (wire allocation stays constant).

#### Step 5 — Within-Tier Selection

For each tier, items are selected through this pipeline:

**5a. Focus Filter** (wire only)

If `?focus=reddit:science`, filter wire items to that source/subsource. Subsource matching checks `item.meta.subreddit || item.meta.sourceId || item.meta.feedTitle`.

**5b. Tier Filters**

`#applyTierFilters()` — currently a shell for future filter strategies (read_status, staleness, recently_shown).

**5c. Tier Sort** (`#applyTierSort`)

| Strategy | Algorithm |
|----------|-----------|
| `timestamp_desc` | Sort by `item.timestamp` descending. Within the same hour, prefer items with lower selection count (reduces headline repetition). |
| `priority` | Sort by `item.priority` descending (highest first). |
| `random` | Fisher-Yates shuffle. |

**5d. Source Partitioning & Capping**

If the tier has **filler sources** (marked with `role: 'filler'` or `flex: 'filler'`):

1. Identify filler vs primary sources
2. Select primary items first, capped by per-source max
3. Guaranteed filler minimum: `sum of filler.min (or min_per_batch)`
4. Fill remaining filler slots up to their caps
5. Final order: `[guaranteedFiller, cappedPrimary, remainingFiller]`

If no filler sources: simply apply per-source caps to all items.

Source cap fields: `max` (flex format) or `max_per_batch` (legacy).

**5e. Unseen Preference**

Items tagged with `_seen: true` (from recycled pool) are deprioritized but retained as fallback:

```
[unseen items (sorted), seen items (sorted)]
```

**5f. Slot Capping**

Slice to the tier's allocated slot count from FlexAllocator.

#### Step 6 — Shortfall Redistribution

If any tier selected fewer items than allocated (pool exhausted after filters/dedup):

1. Calculate total shortfall across all tiers
2. Shrink exhausted tier allocations to actual selection count
3. Distribute shortfall to non-exhausted, non-wire tiers in order: **scrapbook → library → compass**
4. For each eligible tier:
   - Calculate headroom: `poolSize - currentSlots`
   - Take `min(headroom, remainingShortfall)`
   - **Re-select** items for that tier with expanded allocation
5. Stop when all shortfall is distributed or no tiers have capacity

This ensures batch size stays close to `effectiveLimit` even when some sources are thin.

#### Step 7 — Cross-Tier Interleaving

Non-wire items (compass, scrapbook, library) are distributed into the wire backbone at even intervals:

```
Wire:     [W1] [W2] [W3] [W4] [W5] [W6] [W7] [W8]
Non-wire: [C1] [C2] [C3] [L1] [S1]

Interval: floor(8 / (5 + 1)) = 1

Result:   [W1] [C1] [W2] [C2] [W3] [C3] [W4] [L1] [W5] [S1] [W6] [W7] [W8]
```

The interval is `max(1, floor(wireCount / (nonWireCount + 1)))`. Non-wire items are ordered: compass first, then scrapbook, then library.

#### Step 8 — Post-processing

1. **Deduplication** — remove items with duplicate IDs (keeps first occurrence)
2. **Spacing enforcement** — `SpacingEnforcer` (see Stage 4)
3. **Slice to limit** — cap to `effectiveLimit`

### Assembly Diagnostics

`TierAssemblyService` emits a `tier.assembly.batch` log event with:

```javascript
{
  batchNumber,
  wireDecayFactor,
  halfLife,
  batchSize,
  tiers: {
    wire:      { allocated: N, selected: N, sources: { reddit: N, headlines: N } },
    compass:   { allocated: N, selected: N, sources: { weather: N, health: N } },
    scrapbook: { allocated: N, selected: N, sources: { photos: N, journal: N } },
    library:   { allocated: N, selected: N, sources: { komga: N } },
  }
}
```

---

## Stage 4: Spacing Enforcement (SpacingEnforcer)

After interleaving, `SpacingEnforcer.enforce()` applies six rules in order:

| Step | Rule | Default | Effect |
|------|------|---------|--------|
| 1 | Source `max_per_batch` | — | Drop excess items from over-represented sources |
| 2 | Subsource `max_per_batch` | — | Drop excess items per subsource (e.g., per subreddit) |
| 3 | `max_consecutive` | 1 | No N+ consecutive items from the same source |
| 4 | `max_consecutive_subsource` | 2 | No N+ consecutive items from the same subsource (global) |
| 5 | Source `min_spacing` | — | Reposition items that are too close to same-source neighbors |
| 6 | Subsource `min_spacing` | — | Reposition items from the same subsource that are too close |

### Subsource Detection

Subsource key is derived from: `item.meta.subreddit || item.meta.sourceId || item.meta.outlet || item.meta.feedTitle`. This enables per-subreddit, per-feed, or per-outlet spacing.

### Rule Details

**Max Per Batch (source & subsource):** Simple counting filter — keeps only the first N items from each source/subsource, drops the rest.

**Max Consecutive:** Linear pass through the batch. If an item would create N+ consecutive same-source items, it's deferred. Deferred items are re-inserted at the nearest valid position using `#canInsertAt()`, which checks consecutive counts both before and after the insertion point. If no valid position exists, the item is appended to the end.

**Max Consecutive Subsource:** Same algorithm as max_consecutive but operates on subsource keys globally (across all sources).

**Min Spacing:** For each item, checks the gap to the last occurrence of the same source. If the gap is less than `min_spacing`, the item is deferred. Deferred items are re-inserted at the first position where no same-source items exist within `[pos - minSpacing, pos + minSpacing - 1]`.

**Subsource Min Spacing:** Same as min_spacing but checks both source AND subsource match.

---

## Stage 5: Padding, Cycling, and Finalization (FeedAssemblyService)

After tier assembly and spacing, `FeedAssemblyService` runs three fill passes:

### Padding Pass

1. If the batch is shorter than `effectiveLimit`, check for sources marked `padding: true` in the scroll config
2. Collect unused pool items from padding sources
3. Fisher-Yates shuffle the padding items
4. Append to fill remaining slots

### Cycling Pass (last resort)

If the batch is still short after padding (batch > 0, batchNumber > 1):

1. Duplicate existing batch items with ID suffix `:dup{n}`
2. Fill remaining slots with duplicates
3. Ensures the batch never falls below `effectiveLimit` items

This is a graceful degradation for sessions where sources are exhausted and padding can't fill the gap.

### Image Dimension Probe

For items with an `image` URL but missing `meta.imageWidth` / `meta.imageHeight`:

1. Parallel `probeImageDimensions()` calls with 3-second timeout per image
2. On success, stores dimensions in `item.meta.imageWidth` and `item.meta.imageHeight`
3. Enables frontend layout (masonry) to pre-calculate card heights without waiting for image load

### Mark Seen & Cache

1. **Mark seen** — `FeedPoolManager.markSeen()` records consumed item IDs and triggers proactive refill or recycling
2. **Cache** — each item is stored in an LRU cache (max 500) for deep-link resolution via `GET /api/v1/feed/scroll/item/:slug`
3. **Selection tracking** — headline items (ID starts with `headline:`) get their selection count incremented for sort-bias in future batches

### Response Shape

```javascript
{
  items,           // final batch array
  hasMore,         // feedPoolManager.hasMore()
  colors,          // extracted from scroll config tier/source colors
  feed_assembly,   // diagnostic object from tier assembly
}
```

---

## Feed Cache Service (FeedCacheService)

`FeedCacheService` implements stale-while-revalidate caching for first-page source fetches. It prevents redundant API calls while keeping data fresh.

### Per-Source TTLs

| Source | TTL | Rationale |
|--------|-----|-----------|
| `headlines` | 15 min | RSS harvest cadence |
| `freshrss` | 10 min | External RSS sync interval |
| `reddit` | 5 min | Frequent content updates |
| `youtube` | 15 min | API quota conservation |
| `googlenews` | 10 min | Topic aggregation refresh |
| `komga` | 30 min | Infrequent new issues |
| `photos` / `journal` | 30 min | Stable personal content |
| `entropy` / `tasks` / `health` / `weather` / `fitness` / `gratitude` | 5 min | Real-time dashboard data |
| `plex` / `plex-music` | 30 min | Media library scan interval |
| Default fallback | 10 min | — |

### Cache Flow

```
getItems(sourceKey, fetchFn, username)
    │
    ├─ Not hydrated? → Read from disk (YAML), validate entries
    │
    ├─ No cache entry? → await fetchAndCache() → return
    │
    ├─ Fresh hit (age < TTL)? → return cached items
    │
    └─ Stale hit (age ≥ TTL)?
         ├─ Return cached items immediately
         └─ Fire background refresh (no await)
```

### Background Refresh

- One in-flight refresh per source (tracked by `#refreshing` Set)
- If a refresh is already running for a source, the stale response serves
- On fetch error: logs warning, serves stale cache, falls back to empty array

### Disk Persistence

Cache is persisted to `current/feed/_cache` user data path:
- Disk flush is debounced at 30 seconds
- Full cache is serialized as YAML on flush
- Hydrated from disk on first access (one-time)

---

## Filter Mode (FeedFilterResolver)

When the request includes `?filter=<expression>`, `FeedFilterResolver` resolves the expression through a 4-layer chain and the entire tier assembly pipeline is bypassed. Items are returned sorted by timestamp descending — no tier interleaving, spacing enforcement, or diversity caps.

### Resolution Chain

The expression is parsed as `prefix:rest` (split on first `:`). `rest` is comma-separated subsources.

| Layer | Match Condition | Result | Example |
|-------|----------------|--------|---------|
| 1. Tier | `prefix` is `wire`, `library`, `scrapbook`, or `compass` | Filter pool by `item.tier` | `?filter=compass` |
| 2. Source type | `prefix` matches a registered adapter's `sourceType` or a built-in type | Filter pool by `item.source`, optionally by subsource | `?filter=reddit:worldnews,science` |
| 3. Query name | `prefix` matches a query config filename (sans `.yml`) | Filter pool by `item.meta.queryName` | `?filter=scripture-bom` |
| 4. Alias | `prefix` is in the alias map | Re-resolve the alias target through layers 2-3 | `?filter=photos` → `immich` |

If no layer matches, the filter is ignored and the normal assembly pipeline runs.

### Built-in Types

Three source types (`freshrss`, `headlines`, `entropy`) are handled directly by `FeedPoolManager` rather than through registered adapters. These are passed as `builtinTypes` to the resolver constructor so Layer 2 matches them correctly.

### Subsource Filtering

When the resolved expression includes subsources (e.g., `reddit:worldnews,science`), items are further filtered by matching `item.meta.subreddit` or `item.meta.sourceName` against the subsource list (case-insensitive).

### Behavior Differences from Normal Assembly

| Aspect | Normal Assembly | Filter Mode |
|--------|----------------|-------------|
| Tier interleaving | Yes (wire backbone + non-wire at intervals) | No |
| Spacing enforcement | Yes (max_consecutive, min_spacing) | No |
| Source caps (max_per_batch) | Yes | No |
| Selection tracking | Yes (headline selection counts) | No |
| Sort order | Per-tier strategy (timestamp, priority, random) | Always timestamp descending |
| Padding | Yes (fills short batches) | No |

### Frontend

`Scroll.jsx` reads `?filter=` from `useSearchParams()` and appends it to the API call. No UI controls in v1 — filter is set via URL only.

```
/feed/scroll?filter=reddit           → all Reddit items
/feed/scroll?filter=reddit:science   → Reddit, r/science only
/feed/scroll?filter=compass          → all compass-tier items
/feed/scroll?filter=scripture-bom    → items from scripture-bom.yml query
```

---

## Source Filter Mode

When the request includes `?source=reddit,komga`, the entire tier assembly pipeline is bypassed. Items are filtered to matching sources, sorted by timestamp descending, and sliced to the limit. This mode is used for focused source browsing in the frontend.

> **Note:** `?filter=` is preferred over `?source=` for new usage. `?source=` remains for backward compatibility. If both are present, `?filter=` takes precedence.

---

## Focus Mode

When the request includes `?focus=reddit:science`, the wire tier is filtered to only items matching that source and subsource. Non-wire tiers are unaffected. The `focus_mode` section of scroll config can override batch size and other parameters during focused viewing.

---

## Lifecycle of a Scroll Session

```
┌──────────────────────────────────────────────────────────────────┐
│  1. Fresh page load (no cursor)                                   │
│     → reset() clears all per-user state + batch counter           │
│     → initializePool() fetches page 1 from all sources            │
│     → Pool: ~80-200 items across 15+ sources                     │
│     → Batch 1 (decay factor=1.0): full wire + non-wire tiers     │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│  2. Scroll to sentinel (IntersectionObserver fires)              │
│     → getNextBatch() with cursor                                 │
│     → batchNumber increments → wire decay reduces wire slots     │
│     → Freed slots cascade to compass/library/scrapbook           │
│     → markSeen() → remaining < 2×batch_size → proactive refill   │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│  3. Continued scrolling (wire decays exponentially)              │
│     → Each batch has fewer wire items, more personal content     │
│     → At halfLife batches, wire is at 50%                        │
│     → Pool grows to 150-300+ items across multiple pages         │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│  4. All sources exhausted                                        │
│     → Pool drains to 0 unseen items                              │
│     → recycle() shuffles 500 seen items back into pool           │
│     → Recycled items tagged _seen, deprioritized in selection    │
│     → Scroll continues with reshuffled content (still decayed)   │
│     → hasMore stays true — infinite scroll                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Key Source Files

| File | Purpose |
|------|---------|
| `backend/src/3_applications/feed/services/FeedAssemblyService.mjs` | Orchestrator: pool → filter/tier assembly → padding → cycling → cache |
| `backend/src/3_applications/feed/services/FeedFilterResolver.mjs` | 4-layer resolution chain for `?filter=` param |
| `backend/src/3_applications/feed/services/FeedPoolManager.mjs` | Pool management: pagination, age filtering, refill, recycling |
| `backend/src/3_applications/feed/services/TierAssemblyService.mjs` | Four-tier bucketing, flex allocation, within-tier selection, interleaving |
| `backend/src/3_applications/feed/services/FlexAllocator.mjs` | CSS flexbox-inspired slot distribution algorithm |
| `backend/src/3_applications/feed/services/FlexConfigParser.mjs` | YAML flex config normalization and legacy migration |
| `backend/src/3_applications/feed/services/SpacingEnforcer.mjs` | Distribution rules: max_per_batch, max_consecutive, min_spacing |
| `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs` | User config loading, tier defaults, age threshold resolution |
| `backend/src/3_applications/feed/services/FeedCacheService.mjs` | Stale-while-revalidate cache with per-source TTLs |
| `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs` | Port interface: `fetchPage()`, `fetchItems()`, `getDetail()` |
| `backend/src/4_api/v1/routers/feed.mjs` | Express router: `/scroll`, `/detail`, `/scroll/item/:slug` |
