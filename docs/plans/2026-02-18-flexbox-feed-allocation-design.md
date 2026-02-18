# Flexbox Feed Allocation Design

## Problem

The scroll feed allocation system uses ad-hoc config properties (`allocation`, `max_per_batch`, `min_per_batch`, `role: filler`, `padding`) that have grown organically. Each new requirement (filler roles, per-feed caps, decay) adds bespoke logic. Config keys mix absolute item counts with implicit behaviors, and the source taxonomy couples config to vendor names (freshrss, immich, komga) rather than domain concepts.

## Goals

1. Replace ad-hoc allocation with a battle-tested flex layout algorithm at both nesting levels (batch → tier, tier → source)
2. Config uses proportional values — `batch_size` is the only absolute number
3. Vendor-agnostic config: sources referenced by domain content type (feeds, photos, news), with vendor aliases resolved at the adapter layer
4. `IFeedSourceAdapter` port defines canonical content types; adapters declare what they provide
5. Backward-compatible: legacy config keys (`allocation`, `max_per_batch`) parsed as flex equivalents

## Design

### 1. Config Language

Every tier and source node accepts flex properties in three forms:

**Shorthand string:**
```yaml
freshrss:
  flex: "2 0 5"    # grow shrink basis
```

**Explicit keys:**
```yaml
freshrss:
  grow: 2
  shrink: 0
  basis: 5
```

**Named aliases:**
```yaml
headlines:
  flex: filler      # → grow:1, shrink:1, basis:0
compass:
  flex: fixed       # → grow:0, shrink:0, basis:auto
photos:
  flex: padding     # → grow:1, shrink:0, basis:0
wire:
  flex: dominant    # → grow:2, shrink:0, basis:auto
```

Alias definitions:

| Alias | grow | shrink | basis |
|-------|------|--------|-------|
| `filler` | 1 | 1 | 0 |
| `fixed` | 0 | 0 | auto |
| `none` | 0 | 0 | auto |
| `dominant` | 2 | 0 | auto |
| `padding` | 1 | 0 | 0 |
| `auto` | 1 | 1 | auto |

**Precedence (highest to lowest):**
1. Explicit keys (`grow:`, `shrink:`, `basis:`) override everything
2. `flex:` shorthand parsed (string, number, or alias)
3. Legacy keys mapped: `allocation` → `basis`, `max_per_batch` → `max`, `min_per_batch` → `min`, `role: filler` → alias expansion
4. Defaults: `grow: 0, shrink: 1, basis: auto, min: 0, max: Infinity`

### 2. Proportional Values

**`batch_size` is the only absolute number in the config.** All other numeric values (`min`, `max`, `basis`) are proportions of their parent container.

**Parse rules:**
- Float 0.0–1.0 → already a proportion
- Integer > 1 → divide by parent's resolved size to get proportion
- `auto` → use actual available item count
- `0` → zero

**Implicit floor:** Any source with available items gets at least 1 slot. No explicit `min` needed for the common case.

**Examples at batch_size: 50:**
```yaml
tiers:
  wire:
    min: 20          # 20/50 = 0.4 → at least 40% of batch
  compass:
    basis: 6         # 6/50 = 0.12 → starts at 12% of batch
```

**Examples within wire (resolved to 34 slots):**
```yaml
sources:
  feeds:
    basis: 5         # 5/34 = 0.15 → starts at 15% of wire
    max: 15          # 15/34 = 0.44 → at most 44% of wire
```

Config writer uses intuitive integers. Parser normalizes to proportions. Children don't need to add up to the parent — grow/shrink handles the difference.

### 3. Flex Algorithm — FlexAllocator

One pure, stateless function that runs identically at both nesting levels:

```
FlexAllocator.distribute(containerSize, children[]) → Map<key, slots>
```

Each child is a normalized descriptor:
```js
{ key, grow, shrink, basis, min, max, available }
```

**Algorithm:**

1. **Resolve basis** for each child:
   - proportion → `basis * containerSize`
   - `auto` → `min(available, containerSize)`

2. **Sum bases.** Compute free space or overflow.

3. **Grow** (free space > 0): distribute proportionally by `grow`:
   ```
   child_extra = free_space * (child.grow / total_grow)
   ```

4. **Shrink** (overflow > 0): reduce proportionally by `shrink * basis`:
   ```
   child_reduction = overflow * (child.shrink * child.basis) / weighted_total
   ```

5. **Clamp** each child to `[min, max]` (resolved to items). Also clamp to `available`.

6. **Re-run** steps 2–5 with clamped children frozen if clamping changed totals (same as CSS).

7. **Round** to integers. Distribute rounding remainder to highest-grow children first.

8. **Enforce implicit floor:** any child with `available > 0` gets at least 1 slot.

**Where it runs:**
```
FeedAssemblyService.getNextBatch()
  ├── Fetch all items from all adapters
  ├── FlexAllocator.distribute(batchSize, tierDescriptors)
  │     → { wire: 34, compass: 6, scrapbook: 5, library: 5 }
  ├── For each tier:
  │     FlexAllocator.distribute(tierSlots, sourceDescriptors)
  │       → { feeds: 14, social: 10, news: 4, ... }
  ├── Select items per source (sort, filter, slice to allocation)
  └── Interleave tiers into final batch
```

FlexAllocator is stateless and testable in isolation — numbers in, numbers out. No knowledge of feeds, tiers, or sources.

### 4. Content Types & Source Resolution

#### Port-level content types

`IFeedSourceAdapter` defines canonical content types and requires adapters to declare what they provide:

```js
export const CONTENT_TYPES = Object.freeze({
  FEEDS:        'feeds',
  NEWS:         'news',
  SOCIAL:       'social',
  PHOTOS:       'photos',
  COMICS:       'comics',
  EBOOKS:       'ebooks',
  AUDIO:        'audio',
  VIDEO:        'video',
  JOURNAL:      'journal',
  BOOK_REVIEWS: 'book-reviews',
  TASKS:        'tasks',
  WEATHER:      'weather',
  HEALTH:       'health',
  FITNESS:      'fitness',
  GRATITUDE:    'gratitude',
  ENTROPY:      'entropy',
  SCRIPTURE:    'scripture',
});

export class IFeedSourceAdapter {
  get sourceType() { throw new Error('must implement'); }
  get provides() { return []; }
  // ... fetchPage, markRead, getDetail
}
```

#### Adapter declarations

| Adapter | sourceType (vendor) | provides (content types) |
|---------|-------------------|------------------------|
| FreshRSSSourceAdapter | `freshrss` | `['feeds']` |
| HeadlineFeedAdapter | `headlines` | `['news']` |
| GoogleNewsFeedAdapter | `googlenews` | `['news']` |
| RedditFeedAdapter | `reddit` | `['social']` |
| ImmichFeedAdapter | `immich` | `['photos']` |
| KomgaFeedAdapter | `komga` | `['comics']` |
| ABSEbookFeedAdapter | `abs-ebooks` | `['ebooks']` |
| PlexFeedAdapter | `plex` | `['video']` |
| YouTubeFeedAdapter | `youtube` | `['video']` |
| JournalFeedAdapter | `journal` | `['journal']` |
| GoodreadsFeedAdapter | `goodreads` | `['book-reviews']` |
| TodoistFeedAdapter | `todoist` | `['tasks']` |
| WeatherFeedAdapter | `weather` | `['weather']` |
| HealthFeedAdapter | `health` | `['health']` |
| StravaFeedAdapter | `strava` | `['fitness']` |
| GratitudeFeedAdapter | `gratitude` | `['gratitude']` |
| EntropyFeedAdapter | `entropy` | `['entropy']` |
| ReadalongFeedAdapter | `readalong` | `['scripture']` |

#### SourceResolver

Builds two maps at startup from the adapter list:

```
instanceMap:    freshrss → [FreshRSSSourceAdapter]
                immich → [ImmichFeedAdapter]
                ...

contentMap:     feeds → [FreshRSSSourceAdapter]
                news → [HeadlineFeedAdapter, GoogleNewsFeedAdapter]
                video → [PlexFeedAdapter, YouTubeFeedAdapter]
                ...
```

**Resolution order:**
1. Try as vendor alias (instanceMap) → direct match
2. Try as content type (contentMap) → all adapters providing that type
3. Not found → warn and skip

When a content type matches multiple adapters (e.g., `news` → headlines + googlenews), their items pool together under that config node's flex allocation.

Config is vendor-agnostic:
```yaml
sources:
  feeds: { flex: dominant, max: 15 }
  news: { flex: filler, max: 10 }      # headlines + googlenews pooled
  social: { flex: "1 0 auto", max: 11 }
```

Vendor aliases still work for specificity:
```yaml
sources:
  headlines: { flex: filler, max: 10 }
  googlenews: { flex: "0 0 auto", max: 3 }
```

### 5. Complete Config Example

```yaml
batch_size: 50

tiers:
  wire:
    flex: "1 0 auto"
    min: 20
    sources:
      feeds:
        flex: dominant
        max: 15
      social:
        flex: "1 0 auto"
        max: 11
      news:
        flex: filler
        max: 10
      video:
        flex: none
        max: 7

  compass:
    flex: "0 0 6"
    min: 4
    sources:
      entropy: { flex: "0 0 auto" }
      tasks: { flex: "0 0 auto" }
      weather: { flex: none }
      health: { flex: none }
      fitness: { flex: none }
      gratitude: { flex: none }
      scripture: { flex: none }

  scrapbook:
    flex: "0 0 5"
    min: 3
    sources:
      photos: { flex: "1 0 auto" }
      journal: { flex: none }
      book-reviews: { flex: none }

  library:
    flex: "0 0 5"
    min: 2
    sources:
      comics: { flex: "1 0 auto" }
      ebooks: { flex: none }
      audio: { flex: none }
```

### 6. Files Changed

| File | Change |
|------|--------|
| `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs` | Add `CONTENT_TYPES` enum, `provides` getter with empty default |
| `backend/src/1_adapters/feed/sources/*.mjs` (all 18 adapters) | Add `get provides()` returning content type array |
| `backend/src/3_applications/feed/services/FlexAllocator.mjs` | **New** — pure flex distribution algorithm |
| `backend/src/3_applications/feed/services/SourceResolver.mjs` | **New** — instance + content type resolution |
| `backend/src/3_applications/feed/services/FlexConfigParser.mjs` | **New** — parse flex shorthand, aliases, legacy keys, normalize proportions |
| `backend/src/3_applications/feed/services/TierAssemblyService.mjs` | Replace allocation/cap logic with FlexAllocator calls |
| `backend/src/app.mjs` | Wire SourceResolver into feed bootstrap |
| `data/users/kckern/config/feed.yml` | Migrate scroll config to flex format |
| `tests/isolated/application/feed/FlexAllocator.test.mjs` | **New** — unit tests for flex algorithm |
| `tests/isolated/application/feed/FlexConfigParser.test.mjs` | **New** — parse tests for all input forms |
| `tests/isolated/application/feed/SourceResolver.test.mjs` | **New** — resolution tests |
| `tests/isolated/application/feed/FeedAssemblyService.test.mjs` | Update to use new config format |

### 7. What Doesn't Change

- FeedPoolManager — still fetches from adapters, receives richer pool
- FeedAssemblyService API — `getNextBatch()` signature unchanged
- Frontend — no changes; receives same item shape
- SpacingEnforcer — runs after flex allocation, same as today
- Individual adapter fetch logic — unchanged
- FreshRSS two-pass fetch / per-feed cap — unchanged (operates within adapter)

### 8. Migration

Legacy config keys are parsed as flex equivalents:
- `allocation: 6` → `basis: 6`
- `max_per_batch: 11` → `max: 11`
- `min_per_batch: 3` → `min: 3`
- `role: filler` → `flex: filler`
- `padding: true` → `flex: padding`

Old configs continue to work. New flex keys take precedence when both are present.
