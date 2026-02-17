# Headline Selection Tracking Design

## Problem

Headlines in the feed get shown repeatedly without cycling. There's no mechanism to prefer less-shown headlines, so the same top items dominate every batch.

## Solution

Add deterministic short IDs to headlines and track how many times each is selected into a batch. Use selection count as a sort tiebreaker in `TierAssemblyService` to cycle headlines for coverage.

## Design Decisions

- **Deterministic IDs**: `shortIdFromUuid(item.link)` — same article always gets the same ID across re-harvests
- **Separate tracking file**: `current/feed/_selection_tracking.yml` — generic structure, survives headline pruning, usable by any adapter
- **Sort bias (not scoring)**: Within `timestamp_desc`, items within the same hour prefer lower selection count
- **Increment at batch assembly time**: Counts how often an item is *shown*, not clicked
- **Headlines only for now**: Filter to `headline:` prefix items; other sources will use read/unread

## Data Model

### Selection Tracking YAML

```yaml
# current/feed/_selection_tracking.yml
abc123defg:
  count: 3
  last: 2026-02-17T08:00:00Z
kLmNoPqRsT:
  count: 1
  last: 2026-02-16T12:30:00Z
```

## Changes by Layer

### Domain — `Headline.mjs`

- `id` field required in constructor
- `static create(data)` — factory, generates ID via `shortIdFromUuid(data.link)`
- `static fromJSON(data)` — reconstitution, uses stored ID
- `toJSON()` includes `id`

### Application — `ISelectionTrackingStore.mjs` (new port)

```js
export class ISelectionTrackingStore {
  async getAll(username) { throw new Error('not implemented'); }
  async incrementBatch(itemIds, username) { throw new Error('not implemented'); }
}
```

- `getAll(username)` — returns `Map<shortId, { count, last }>`
- `incrementBatch(itemIds, username)` — increments count + updates `last` for array of IDs

### Application — `TierAssemblyService.mjs`

- `assemble()` accepts optional `selectionCounts` (Map) in options
- Threaded through `#selectForTier` → `#applyTierSort`
- `timestamp_desc` sort: if two items are within 1 hour, prefer lower selection count

### Application — `FeedAssemblyService.mjs`

- Load tracking via `ISelectionTrackingStore.getAll()` before assembly
- Pass `selectionCounts` to `TierAssemblyService.assemble()`
- After assembly, `incrementBatch()` for headline-prefixed items in the returned batch

### Adapter — `YamlSelectionTrackingStore.mjs` (new)

- Implements `ISelectionTrackingStore`
- Reads/writes `current/feed/_selection_tracking.yml` via `DataService.user`

### Adapter — `RssHeadlineHarvester.mjs`

- Call `Headline.create(rawItem)` instead of `new Headline(rawItem)`

### Adapter — `YamlHeadlineCacheStore.mjs`

- Call `Headline.fromJSON(storedData)` for reconstitution
- Persist `id` field in YAML

---

# Feed Assembly Caching Redesign

## Problem

`FeedAssemblyService` caches the entire assembled list for 60 seconds (`#assembledCache`). This freezes the feed — no randomness between batches, stale cursor positioning, and cache misses cause silent restarts from index 0.

## Solution

Replace assembled-list caching with per-session seen-ID tracking. Each batch call does a fresh assembly with randomness. Source-level caching (via `FeedCacheService`) prevents redundant upstream fetches.

## Design Decisions

- **Remove `#assembledCache`**: No full-list pagination cache
- **Add `#seenIds`**: `Map<username, Set<itemId>>` — lightweight, cleared on fresh load
- **Fresh assembly every call**: `TierAssemblyService.assemble()` runs each time with full randomness
- **Cursor = continuation signal**: Value doesn't matter for positioning; presence means "append mode"
- **Two-pass assembly**: Primary pass uses normal tier rules; padding pass fills remaining slots from configured deep-well sources
- **Source-level caching unchanged**: `FeedCacheService` stale-while-revalidate stays as-is

## Config Addition

`padding: true` on deep-well sources in scroll config:

```yaml
sources:
  photos:
    max_per_batch: 4
    padding: true
  komga:
    max_per_batch: 5
    padding: true
```

## Assembly Flow

```
1. No cursor → clear #seenIds for user
2. Fetch all sources (source-level cache)
3. Remove items in #seenIds → "fresh pool"
4. PRIMARY PASS: TierAssemblyService.assemble(freshPool) → normal rules
5. If batch < batch_size:
   PADDING PASS: grab unseen items from padding: true sources, shuffle, fill slots
6. Record batch IDs in #seenIds
7. hasMore = freshPool has more unseen items than total sent
```

## Changes by Layer

### Application — `FeedAssemblyService.mjs`

- Remove `#assembledCache`, `#ASSEMBLED_TTL`
- Add `#seenIds = new Map()` — `Map<username, Set<itemId>>`
- No cursor → `#seenIds.delete(username)`
- Extract `#fetchAllSources()` from existing fan-out logic
- Two-pass: primary assembly + padding fill
- `hasMore` based on fresh pool size vs total seen

### Application — `ScrollConfigLoader.mjs`

- Add `static getPaddingSources(scrollConfig)` — returns `Set<sourceKey>` of sources with `padding: true`

### Application — `TierAssemblyService.mjs`

- No changes

### Config — `feed.yml`

- Add `padding: true` to `photos` and `komga` sources

### Frontend — `Scroll.jsx`

- No changes (existing `existingIds` dedup stays as safety net)

### Bugfix — `Scroll.jsx` IntersectionObserver

- Add `loading` to observer effect dependency array (fixes 2nd batch never loading)
