# Feed Item Dismiss / Mark-Read Design

**Date:** 2026-02-17
**Status:** Approved

## Summary

Add the ability to dismiss feed items from the Scroll view so they don't reappear in future loads. FreshRSS items are marked read via the existing GReader API. All other wire sources (reddit, headline, googlenews) persist dismissed IDs in a YAML file with 30-day auto-expiry.

## API

### `POST /api/v1/feed/scroll/dismiss`

```
Body: { itemIds: ["freshrss:123", "reddit:abc", "headline:src:link"] }
Response: { dismissed: 3 }
```

Routes each ID by source prefix:
- `freshrss:*` → strips prefix, calls `FreshRSSFeedAdapter.markRead([localIds])`
- All others → `DismissedItemsDatastore.add([ids])`

Fire-and-forget from the frontend — no loading state needed.

## Backend

### DismissedItemsDatastore

**File:** `backend/src/1_adapters/feed/DismissedItemsDatastore.mjs`
**Data:** `data/household/shared/feed/dismissed.yml`

```yaml
# itemId: unix_timestamp_seconds
reddit:abc123: 1739800000
headline:src:link: 1739800000
googlenews:h4sh: 1739800000
```

- `load()` — reads YAML, prunes entries older than 30 days, returns `Set<string>` of IDs
- `add(itemIds)` — appends new entries with `Math.floor(Date.now() / 1000)`, writes back
- Prune-on-load keeps the file bounded

### FeedPoolManager Integration

- `getPool()` loads the dismissed set once per session (cached after first load)
- Filters out items whose `id` is in the dismissed set
- FreshRSS items already excluded via `excludeRead: true` — skip YAML check

### TierAssemblyService

No changes. The existing `#applyTierFilters()` no-op shell stays as-is. Filtering happens upstream in the pool manager.

## Frontend

### FeedCard Dismiss Button

**Two placements based on card content:**

1. **Cards with hero image** — `X` button overlaid at top-right of image area. Semi-transparent dark circle (matches play button overlay style). Always visible (works on mobile).

2. **Text-only cards** — dismiss button in a footer row below body content. Small `X` with "Dismiss" label, right-aligned, muted color.

**New prop:** `onDismiss(item)` passed from Scroll.jsx.

### Swipe-to-Dismiss (Mobile)

- Touch tracking on card wrapper
- Left swipe past ~100px threshold triggers dismiss
- Card translates with finger during drag
- Past threshold: slides off-screen left, then collapses height to zero
- Below threshold: springs back to original position

### Desktop X Button

- Click triggers same slide-left + height-collapse animation
- Same API call as swipe

### Animation

Use **Web Animations API** (`element.animate()`) for slide-out and height collapse — immune to CSS `!important` overrides (safe in TV app context).

### Detail View Auto-Read

- Opening detail view fires `POST /api/v1/feed/scroll/dismiss` in the background
- Card stays in current scroll session (user can scroll back) but won't appear in future loads
- Triggered on detail open, not close

### Batch Optimization

- Detail-view next/prev navigation queues dismissed IDs
- 500ms debounce batches queued IDs into a single API call

### Scroll.jsx State Management

- Dismissed item removed from `items` state after slide-out animation completes
- No re-fetch needed — local removal only
- If visible list gets short, existing infinite-scroll pagination fills in naturally

## Scope

- **Wire tier only** for now (freshrss, reddit, headline, googlenews)
- Single "dismissed" status — no distinction between "read" and "not interested"
- 30-day auto-expiry on YAML-persisted dismissals
- FreshRSS uses upstream `markRead()` (no expiry needed — FreshRSS manages its own state)
