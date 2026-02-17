# Feed Assembly Process

How scroll batches are assembled from raw source data to rendered cards — covering the full pipeline from API request through pool management, tier assembly, spacing enforcement, and response.

---

## Overview

When a user scrolls the feed, a `GET /api/v1/feed/scroll` request triggers a multi-stage pipeline that produces a batch of mixed-content items. The pipeline is split across four services, each with a single responsibility:

| Service | Responsibility |
|---------|---------------|
| `FeedAssemblyService` | Orchestrator — coordinates the pipeline, owns the LRU item cache |
| `FeedPoolManager` | Item pool — fetches from sources with pagination, age filtering, recycling |
| `TierAssemblyService` | Batch composition — four-tier bucketing, selection, interleaving |
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
        └─ Return unseen items
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
        ├─ Bucket by tier (wire/library/scrapbook/compass)
        ├─ Within-tier: filter → sort → cap
        ├─ Cross-tier: interleave non-wire into wire backbone
        ├─ Deduplicate
        └─ SpacingEnforcer.enforce()
                │
                ▼
     Padding pass (fill short batches from padding sources)
                │
                ▼
     FeedPoolManager.markSeen() → triggers proactive refill or recycle
                │
                ▼
     Cache items in LRU (for deep-link resolution)
                │
                ▼
     Return { items, hasMore, colors }
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

All state is session-scoped — it resets when the user does a fresh page load (no cursor in the request).

### Pool Initialization

On first request, all query configs are dispatched in parallel via `Promise.allSettled`:

```
Query configs (YAML files)
    │
    ├── reddit.yml    → RedditFeedAdapter.fetchPage()     → { items, cursor: "t3_abc" }
    ├── news.yml      → FreshRSS built-in handler          → { items, cursor: "cont123" }
    ├── headlines.yml  → Headlines built-in handler         → { items, cursor: "30" }
    ├── photos.yml    → ImmichFeedAdapter.fetchPage()      → { items, cursor: null }
    ├── weather.yml   → WeatherFeedAdapter.fetchPage()     → { items, cursor: null }
    └── ...
```

Each result is age-filtered and its cursor is recorded. Sources returning `cursor: null` are marked as exhausted.

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

The seen-items history is capped at 500 items to prevent unbounded memory growth.

---

## Stage 2: Tier Assembly (TierAssemblyService)

Items from the pool are assembled into a batch using a four-tier system. Each query config declares a `tier` that determines how its items are distributed.

### Tier Definitions

| Tier | Purpose | Default Allocation | Sort Strategy | Example Sources |
|------|---------|--------------------|---------------|-----------------|
| **wire** | External content streams | Fills remaining slots | `timestamp_desc` | headlines, reddit, youtube, googlenews, freshrss |
| **library** | Long-form reading | 2 per batch | `random` | komga |
| **scrapbook** | Personal memories | 2 per batch | `random` | photos, journal |
| **compass** | Life dashboard | 6 per batch | `priority` | weather, health, fitness, plex, tasks, gratitude, entropy |

### Assembly Algorithm

**Level 1 — Bucketing:** Partition all pool items by their `tier` field.

**Level 2 — Within-tier selection** (per tier):

1. **Focus filter** (wire only) — if `?focus=reddit:science`, filter wire to that source/subsource
2. **Tier filters** — apply configured filter strategies (read_status, staleness, etc.)
3. **Tier sort** — apply the tier's sort strategy:
   - `timestamp_desc`: newest first, with selection-count tiebreaking within the same hour
   - `priority`: highest `priority` value first
   - `random`: Fisher-Yates shuffle
4. **Source caps** — enforce per-source `max_per_batch` limits
5. **Allocation cap** — non-wire tiers are capped to their allocation count

**Level 3 — Interleaving:**

Non-wire items (compass, scrapbook, library) are distributed into the wire backbone at even intervals:

```
Wire:     [W1] [W2] [W3] [W4] [W5] [W6] [W7] [W8]
Non-wire: [C1] [C2] [C3] [L1] [S1]

Result:   [W1] [W2] [C1] [W3] [W4] [C2] [W5] [W6] [C3] [W7] [L1] [W8] [S1]
```

The interval is `floor(wireCount / (nonWireCount + 1))`.

**Level 4 — Post-processing:**

1. **Deduplication** — remove items with duplicate IDs
2. **Spacing enforcement** — `SpacingEnforcer` (see Stage 3)
3. **Slice to limit** — cap to `effectiveLimit`

### Default Batch Composition (batch_size=15, batch 1)

| Tier | Slots | Sources |
|------|-------|---------|
| compass | 6 | weather, health, fitness, plex, tasks, gratitude |
| library | 2 | komga |
| scrapbook | 2 | photos, journal |
| wire | 5 (remaining) | reddit, headlines, youtube, etc. |

### Wire Decay

Wire tier allocation decays linearly to 0 over a configurable number of batches (`wire_decay_batches`, default: 10). As wire slots are freed, they are redistributed **proportionally** to non-wire tiers based on their base allocations.

**Formula:**

```
decayFactor = clamp(1 - (batchNumber - 1) / wire_decay_batches, 0, 1)
decayedWire = round(baseWire × decayFactor)
freed = baseWire - decayedWire

compassBonus  = round(freed × compassAlloc / totalNonWire)
libraryBonus  = round(freed × libraryAlloc / totalNonWire)
scrapbookBonus = freed - compassBonus - libraryBonus   // remainder avoids rounding drift
```

**Example progression** (batch_size=15, wire_decay_batches=5):

| Batch | Decay Factor | Wire | Compass | Library | Scrapbook |
|-------|-------------|------|---------|---------|-----------|
| 1 | 1.00 | 5 | 6 | 2 | 2 |
| 2 | 0.80 | 4 | 7 | 2 | 2 |
| 3 | 0.60 | 3 | 7 | 2 | 3 |
| 4 | 0.40 | 2 | 8 | 2 | 3 |
| 5 | 0.20 | 1 | 8 | 3 | 3 |
| 6+ | 0.00 | 0 | 9 | 3 | 3 |

This creates a "news first, personal later" experience: early batches show breaking headlines and external content, while extended scrolling transitions to photos, journal entries, health data, and reading material.

**Batch tracking** lives in `FeedPoolManager.#batchCounts` (per-user Map, 1-indexed, reset on fresh page load). `FeedAssemblyService` reads the batch number and passes it to `TierAssemblyService.assemble()`.

**Configuration** in `data/users/{username}/config/feed.yml`:

```yaml
scroll:
  wire_decay_batches: 10   # wire reaches 0 after 10 batches (default)
```

Set to `0` to disable decay (wire allocation stays constant).

---

## Stage 3: Spacing Enforcement (SpacingEnforcer)

After interleaving, `SpacingEnforcer.enforce()` applies five rules in order:

| Step | Rule | Effect |
|------|------|--------|
| 1 | Source `max_per_batch` | Drop excess items from over-represented sources |
| 2 | Subsource `max_per_batch` | Drop excess items per subsource (e.g., per subreddit) |
| 3 | `max_consecutive` | No N+ consecutive items from the same source (default: 1) |
| 4 | Source `min_spacing` | Reposition items that are too close to same-source neighbors |
| 5 | Subsource `min_spacing` | Reposition items from the same subsource that are too close |

Items that violate spacing rules are deferred and re-inserted at the nearest valid position. If no valid position exists, they are appended to the end.

Subsource detection currently uses `item.meta.subreddit` — only Reddit items have subsource-level spacing.

---

## Stage 4: Padding and Finalization (FeedAssemblyService)

After tier assembly and spacing, `FeedAssemblyService` runs a padding pass:

1. If the batch is shorter than `effectiveLimit`, check for sources marked `padding: true` in the scroll config
2. Collect unused pool items from padding sources, shuffle them
3. Append padding items to fill remaining slots

Finally:

1. **Mark seen** — `FeedPoolManager.markSeen()` records consumed items and triggers proactive refill or recycling
2. **Cache** — each item is stored in an LRU cache (max 500) for deep-link resolution via `GET /api/v1/feed/scroll/item/:slug`
3. **Selection tracking** — headline items get their selection count incremented for sort-bias in future batches

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
| 4. Alias | `prefix` is in the alias map | Re-resolve the alias target through layers 2–3 | `?filter=photos` → `immich` |

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
│     → Pool: ~80-100 items across 15+ sources                     │
│     → Batch 1 (wire decay factor=1.0): 5 wire + 10 non-wire     │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│  2. Scroll to sentinel (IntersectionObserver fires)              │
│     → getNextBatch() with cursor                                 │
│     → batchNumber increments → wire decay reduces wire slots     │
│     → Freed slots go proportionally to compass/library/scrapbook │
│     → markSeen() → remaining < 2×batch_size → proactive refill   │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│  3. Continued scrolling (wire decays toward 0)                   │
│     → Each batch has fewer wire items, more personal content     │
│     → After wire_decay_batches, wire=0 and feed is all personal  │
│     → Pool grows to 150-200+ items across multiple pages         │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│  4. All sources exhausted                                        │
│     → Pool drains to 0 unseen items                              │
│     → recycle() shuffles 500 seen items back into pool           │
│     → Scroll continues with reshuffled content (still decayed)   │
│     → hasMore stays true — infinite scroll                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Key Source Files

| File | Purpose |
|------|---------|
| `backend/src/3_applications/feed/services/FeedAssemblyService.mjs` | Orchestrator: pool → filter/tier assembly → padding → cache |
| `backend/src/3_applications/feed/services/FeedFilterResolver.mjs` | 4-layer resolution chain for `?filter=` param |
| `backend/src/3_applications/feed/services/FeedPoolManager.mjs` | Pool management: pagination, age filtering, refill, recycling |
| `backend/src/3_applications/feed/services/TierAssemblyService.mjs` | Four-tier bucketing, within-tier selection, cross-tier interleaving |
| `backend/src/3_applications/feed/services/SpacingEnforcer.mjs` | Distribution rules: max_per_batch, max_consecutive, min_spacing |
| `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs` | User config loading, tier defaults, age threshold resolution |
| `backend/src/3_applications/feed/services/FeedCacheService.mjs` | Stale-while-revalidate cache for first-page fetches |
| `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs` | Port interface: `fetchPage()`, `fetchItems()`, `getDetail()` |
| `backend/src/4_api/v1/routers/feed.mjs` | Express router: `/scroll`, `/detail`, `/scroll/item/:slug` |
