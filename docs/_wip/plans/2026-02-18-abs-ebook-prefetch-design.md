# ABS Ebook Chapter Pre-fetch & Cache Design

## Problem

EPUB chapter extraction is slow — downloading the EPUB (~1-10MB), parsing the ZIP, extracting XHTML content, stripping HTML, and fetching cover dimensions all happen at request time. When filtering by `abs-ebooks`, the adapter needs to process many books, causing slow or incomplete responses.

## Solution

Pre-fetch and cache all book chapter data so the feed adapter operates entirely from disk cache. Three mechanisms ensure the cache stays warm:

1. **CLI script** — Initial population and manual rebuilds
2. **Lazy background trigger** — First feed request populates remaining books without blocking
3. **Periodic timer** — Daily check for newly added books

## Cache Location

```
media/archives/abs/chapters/{bookId}.yml
```

Moved from `data/household/common/abs/chapters/` — extracted chapter content is bulky and belongs in the media/archives tier alongside other heavy cached data (e.g., Strava archives).

### Cache Structure (unchanged)

```yaml
bookId: abc-123
title: "Atomic Habits"
author: "James Clear"
coverWidth: 400
coverHeight: 601
chapters:
  - id: 0
    title: "The Surprising Power of Atomic Habits"
    preview: "First three sentences..."
    content: "Full chapter text..."
```

## Component 1: CLI Script

**File:** `cli/prefetch-abs-ebooks.mjs`

```bash
node cli/prefetch-abs-ebooks.mjs              # pre-fetch uncached books
node cli/prefetch-abs-ebooks.mjs --force       # rebuild all cache files
node cli/prefetch-abs-ebooks.mjs --dry-run     # show what would be fetched
```

**Flow:**
1. Load feed query YAML files, find abs-ebooks queries with genre filters
2. For each query, call ABS API to list matching library items
3. Skip books that already have a cache file (unless `--force`)
4. Download EPUB, extract chapters + content, fetch cover dimensions, write cache
5. Sequential processing — one book at a time, no flooding
6. Progress logging: `[3/47] Cached "Atomic Habits" (12 chapters)`

## Component 2: Adapter Changes

### Feed selection favors cached books

Partition books into cached and uncached before selection:

```javascript
const cached = [];
const uncached = [];
for (const book of shuffled) {
  const cachePath = `archives/abs/chapters/${book.id}.yml`;
  if (this.#mediaRead(cachePath)) {
    cached.push(book);
  } else {
    uncached.push(book);
  }
}

// Try cached books first (fast), then uncached if needed
const items = this.#buildItems([...cached, ...uncached], query);

// Background-prefetch uncached books (fire and forget)
if (uncached.length > 0) {
  this.#prefetchUncached(uncached).catch(() => {});
}
```

- Cache warm: instant response, zero downloads
- Cache cold: serves from whatever is cached, populates rest silently
- Nothing cached: downloads one book synchronously (unavoidable), prefetches rest in background

### Lazy background trigger

`#prefetchUncached(books)` loops through books calling `#getChapters()` for each. Non-blocking, fire-and-forget, guarded by `#prefetching` mutex to prevent overlapping runs.

### Public `prefetchAll` method

Used by both the CLI script and the periodic timer:

```javascript
async prefetchAll(query, { force = false, onProgress } = {}) {
  // Fetch library items matching query genre filter
  // For each book: skip if cached (unless force)
  // Call #getChapters(bookId, metadata)
  // Call onProgress?.({ bookId, title, current, total })
}
```

## Component 3: Periodic Timer

Registered in `app.mjs` after adapter construction:

```javascript
if (absEbookFeedAdapter) {
  absEbookFeedAdapter.startPrefetchTimer(queryConfigs);
}
```

- First run: 60s after startup (avoid boot congestion)
- Interval: 24 hours
- Logs summary: `abs-ebooks.prefetch: 2 new books cached, 47 already cached`
- Guarded by `#prefetching` mutex — skips if already running
- Catches newly added books in ABS library

## Non-blocking Guarantees

- All prefetch work is fire-and-forget — never awaited by request handlers
- `#prefetching` mutex prevents concurrent runs
- Each EPUB download has 30s timeout; failures logged and skipped
- Sequential book processing — one download at a time
- Feed response is never cached — only book-level chapter data is cached
- Feed items assembled fresh each request from book cache (fast YAML reads + random selection)

## Files to Modify

| File | Change |
|------|--------|
| `ABSEbookFeedAdapter.mjs` | Change cache path to media dir, add `prefetchAll()`, `startPrefetchTimer()`, `#prefetchUncached()`, favor cached books in selection |
| `app.mjs` | Wire up `startPrefetchTimer(queryConfigs)` after adapter construction |
| `cli/prefetch-abs-ebooks.mjs` | **Create** — CLI script using adapter's `prefetchAll()` |
| `tests/isolated/adapter/feed/ABSEbookFeedAdapter.test.mjs` | Update cache path in mocks, add prefetch tests |

## Migration

Existing cache files in `data/household/common/abs/chapters/` should be deleted (already done). New cache writes go to `media/archives/abs/chapters/`.
