# FreshRSS Read/Unread Prioritization Design

## Problem

The FreshRSS source adapter (`FreshRSSSourceAdapter`) passes `excludeRead: true` by default, so the Scroll wire tier and Reader component never show read items. When all items are read, the RSS well runs dry — no content appears.

Additionally, the `IFeedSourceAdapter` interface has no `markRead` method. The dismiss flow in the feed router hardcodes a `freshrss:` prefix check to route mark-read calls, bypassing the adapter layer.

## Goals

1. Wire tier always has RSS content — unread items first, read items backfill
2. Read items use different selection rules (shuffled for variety)
3. Configurable limits from `feed.yml`
4. Standard `markRead` interface on all source adapters
5. Dismiss flow routes through adapter interface, not hardcoded prefix checks

## Design

### 1. `IFeedSourceAdapter.markRead()` — new interface method

**File:** `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs`

Add optional method with no-op default:

```js
async markRead(itemIds, username) { /* no-op */ }
```

All source adapters inherit the no-op. Only adapters with read-state tracking (FreshRSS) override it.

### 2. `FreshRSSSourceAdapter` changes

**File:** `backend/src/1_adapters/feed/sources/FreshRSSSourceAdapter.mjs`

#### `markRead(itemIds, username)`

- Strips `freshrss:` prefix from each ID
- Delegates to `this.#freshRSSAdapter.markRead(strippedIds, username)`

#### `fetchPage()` — two-pass fetch

Replace the single unread-only fetch with:

1. **Pass 1 (unread):** `getItems(streamId, username, { excludeRead: true, count: unreadPerSource })`
2. **Pass 2 (all):** Only if unread count < `totalLimit`. Calls `getItems(streamId, username, { excludeRead: false, count: totalLimit })`. Dedupes against pass 1.
3. **Merge:** Unread items first (chronological). Read items appended (shuffled). Each item tagged with `meta.isRead: true/false`.
4. **Return:** Combined items up to `totalLimit`, with continuation from the unread fetch.

Constructor receives `configService` to read limits from `feed.yml`.

### 3. Feed config — `reader` section

**File:** `data/users/{username}/config/feed.yml`

```yaml
reader:
  unread_per_source: 20
  total_limit: 100
```

Both the Reader endpoint and Scroll wire tier use these limits via `FreshRSSSourceAdapter`.

### 4. Feed router `/scroll/dismiss` — adapter-driven routing

**File:** `backend/src/4_api/v1/routers/feed.mjs`

Replace the hardcoded `freshrss:` prefix check (lines 183-206) with:

1. Split each item ID on first `:` to extract source type
2. Look up the matching source adapter by `sourceType`
3. Call `adapter.markRead([localIds], username)`
4. Non-RSS items continue to `dismissedItemsStore` as before

The router receives the source adapter map (already available via `feedAssemblyService` or passed directly).

### 5. Reader endpoint — prioritized mode

**File:** `backend/src/4_api/v1/routers/feed.mjs`

The `/reader/items` endpoint gains an optional `prioritized=true` query param. When set, calls the two-pass fetch logic. Default behavior (`excludeRead` filter) remains for backward compatibility.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs` | Add `markRead()` with no-op default |
| `backend/src/1_adapters/feed/sources/FreshRSSSourceAdapter.mjs` | Implement `markRead()`, two-pass `fetchPage()` |
| `backend/src/4_api/v1/routers/feed.mjs` | Adapter-driven dismiss routing, `prioritized` param on `/reader/items` |
| `data/users/kckern/config/feed.yml` | Add `reader:` section with limits |
| `backend/src/0_system/bootstrap.mjs` | Pass `configService` to `FreshRSSSourceAdapter` constructor |

## What Doesn't Change

- `FreshRSSFeedAdapter` (low-level GReader wrapper) — untouched
- `FeedPoolManager` / `FeedAssemblyService` — receive richer pool, no logic changes
- Frontend — no changes; dismiss flow already triggers from `Scroll.jsx` on detail open
- `scroll.tiers.wire.sources.freshrss.max_per_batch: 11` — still caps RSS items per batch

## Data Flow

```
Scroll.jsx (detail open)
  → queueDismiss(itemId)
  → POST /scroll/dismiss { itemIds }
  → feed router splits "freshrss:12345" → source="freshrss", localId="12345"
  → FreshRSSSourceAdapter.markRead(["12345"], username)
  → FreshRSSFeedAdapter.markRead(["12345"], username)
  → FreshRSS GReader API POST /edit-tag { a=read, i=12345 }
```

```
FeedPoolManager.getPool()
  → FreshRSSSourceAdapter.fetchPage(query, username)
  → Pass 1: getItems(excludeRead=true, count=20)  → unread items
  → Pass 2: getItems(excludeRead=false, count=100) → all items
  → Merge: unread (chronological) + read (shuffled), tagged with meta.isRead
  → Pool receives mixed items, unread prioritized
```
