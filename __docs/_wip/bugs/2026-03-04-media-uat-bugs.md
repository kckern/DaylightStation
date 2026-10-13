# MediaApp UAT Bug Report — 2026-03-04

Session logs: `media/logs/media/2026-03-04T17-53-07.jsonl`, `2026-03-04T17-58-09.jsonl`

---

## Bug 1: Items have no contentId — playback silently fails

**Reported:** Selected items don't play, no feedback.

**Log evidence:**
```
content-browser.play-now  → { title: "Star Wars: The New Jedi Order: Dark Journey" }  // no contentId!
media-queue.add-items     → { count: 1, contentIds: [null] }
```
All 3 play-now attempts logged a title but **no contentId**. The queue received items with `contentId: null`.

**Root cause:** Search API returns items with `itemId` and `id` fields, but ContentBrowser reads `item.contentId` which doesn't exist on search results. The field mapping is wrong.

```
API returns:   { itemId: "plex:653701", id: "plex:653701", contentId: null }
ContentBrowser expects: item.contentId
```

**Fix:** In `ContentBrowser.jsx` `handlePlayNow`/`handlePlayNext`/`handleAddToQueue`, use `item.itemId || item.id || item.contentId` instead of `item.contentId`. Or normalize in the search stream handler.

**Logging gap:** `content-browser.play-now` logs `item.contentId` which is null — should also log `item.itemId` and `item.id` to make field mismatch visible. Similarly, `media-player.loaded` never fires after play-now because nothing gets a valid contentId.

---

## Bug 2: No thumbnails anywhere — 0/317 results have thumbnails

**Reported:** No thumbnails in search results.

**Log evidence:**
```
content-browser.results-rendered → { count: 317, withThumbnails: 0, source: "search" }
content-browser.results-rendered → { count: 50,  withThumbnails: 0, source: "search" }
content-browser.results-rendered → { count: 17,  withThumbnails: 0, source: "search" }
```
Every single render reports `withThumbnails: 0`.

**Root cause:** Same as Bug 1 — thumbnails are rendered via `ContentDisplayUrl(item.contentId)` but `contentId` is null on all search results. The items have `itemId` instead. Also, results have a `thumbnail` field with a direct URL that is never used.

```
API returns: { thumbnail: "/api/v1/proxy/immich/assets/.../thumbnail", contentId: null }
Rendered via: ContentDisplayUrl(item.contentId)  → ContentDisplayUrl(null) → nothing
```

**Fix:** Use `item.thumbnail` directly if available, fall back to `ContentDisplayUrl(item.itemId || item.contentId)`.

**Logging gap:** Should log `item.thumbnail` presence in results-rendered to distinguish "no thumbnail URL" vs "URL exists but render failed".

---

## Bug 3: Immich photos dominate results — irrelevant results on top

**Reported:** Irrelevant results showed up on top.

**Log evidence:**
```
search.results-received → { source: "immich", newItems: 250 }   // arrives first at T+6.3s
search.results-received → { source: "plex",   newItems: 67 }    // arrives second at T+7.3s
```

250 Immich photos (filenames like `2026-03-01 11.13.30.jpg`) flood the results for "star wars". They appear to match via CLIP/smart search rather than title match. They arrive **before** Plex results and push relevant items below the fold.

**Root cause:** Two issues:
1. **No relevance sorting** — results are rendered in arrival order (streaming), so whichever source responds first goes on top
2. **Immich returns false positives** — CLIP embedding search matches semantically unrelated photos. 250 photos for "star wars" is almost certainly the search returning generic photos.
3. **No source filtering by default** — "All" filter searches all 13 sources including Immich

**Fix:** Either exclude Immich from MediaApp search (it's not playable media), or add relevance sorting after results complete, or default to a media-only filter.

**Logging gap:** Should log `results-rendered` with source breakdown (e.g., `{ immich: 250, plex: 67 }`) not just total count.

---

## Bug 4: Hymns tab shows nothing / wrong results

**Reported:** Hymns tab loaded the movies.

**Log evidence (session 2):**
```
17:59:46  search.started     → filterParams: "source=singalong"
17:59:47  search.completed   → query: "star wars"    // 0 results (no hymn called "star wars")
17:59:48  search.started     → filterParams: null     // ← immediately fires All again!
17:59:50  results-received   → source: immich, 250 items
17:59:50  results-received   → source: plex, 67 items
```

The Hymns filter correctly sends `source=singalong`, returns 0 results (expected — no hymn matches "star wars"). But then the search immediately re-fires with `filterParams: null` (the "All" filter), showing movies/photos instead of hymns.

**Root cause:** The `useStreamingSearch` hook is created with `filterParams` as a dependency. When the user clicks a filter chip, `setActiveFilter` and `search(searchText)` fire. But `filterParams` is derived from `filters[activeFilter]`, and the `useStreamingSearch` hook's `extraQueryString` may not have updated yet due to React batching. The `search()` call uses the stale `extraQueryString` from the previous render.

Looking at the code: filter chips call `search(searchText)` synchronously after `setActiveFilter(i)`, but `filterParams` (derived from `filters[activeFilter]`) hasn't re-rendered yet. So `search()` uses the old `extraQueryString`.

**Fix:** Don't call `search()` directly from the filter click. Instead, use a `useEffect` that watches `activeFilter` and re-triggers search when it changes.

**Logging gap:** Should log `content-browser.filter-changed` with old/new filter and the actual params sent, to make the stale-params race visible.

---

## Bug 5: Unresponsiveness / jank during search

**Reported:** UI feels unresponsive, janky.

**Log evidence:**
```
17:58:12.803  search.started         → "star wars" (final keystroke)
17:58:19.133  search.results-received → immich: 250 items   // 6.3 seconds later!
17:58:19.176  results-rendered        → 250 items            // 43ms to render 250 items
17:58:20.125  search.results-received → plex: 67 more        // +1s
17:58:20.154  results-rendered        → 317 items total
17:58:29.215  search.completed        → 16.4 seconds total!
```

**Multiple causes:**
1. **No debounce** — 8 SSE connections opened in 900ms (one per keystroke). Each opens a connection to 13 sources. Server is doing 104 searches.
2. **6.3s to first result** — even after debouncing, Immich search is slow
3. **250 DOM nodes rendered at once** — 250 items with thumbnails in a single React render
4. **No loading indicator in logs** — can't confirm if spinner was shown, but user reports none
5. **16.4s total search time** — `search.completed` at T+16.4s while SSE stays open waiting for all 13 sources

**Fix priorities:**
1. Add debounce (300ms) to search input
2. Add visible spinner/loading state during search
3. Paginate or virtualize results (don't render 250+ items at once)
4. Consider excluding slow/irrelevant sources from default search

**Logging gap:** No DOM rendering performance data. Should add `logger.sampled('content-browser.render-time', { itemCount, renderMs })` to track how long renders take. No way to confirm spinner visibility from logs — need a `content-browser.loading-state` event.

---

## Bug 6: No visual feedback during search

**Reported:** No spinner or visual feedback while searching.

**Log evidence:** The `isSearching` state is set in the hook, but there's no log of the loading indicator actually rendering. Looking at the component:

```jsx
{(isSearching || browseLoading) && <div className="search-loading">Searching...</div>}
```

This text-only "Searching..." div exists but:
1. It disappears as soon as the first `results` event arrives (React re-render replaces it)
2. With 250 results arriving at once, the loading state may flash for <43ms
3. No dedicated spinner component — just a text div

**Logging gap:** Add `content-browser.loading-state-changed` event tracking `{ isSearching, browseLoading }` transitions to confirm whether the loading indicator is actually visible.

---

## Bug 7: MiniPlayer mount/unmount churn

**Reported:** Part of perceived jank.

**Log evidence (session 1):**
```
17:53:33.324  content-browser.play-now    → "Star Wars: Dark Journey"
17:53:33.328  mini-player.mounted
17:53:33.522  media-queue.set-position    → position 2
17:53:33.525  mini-player.unmounted       // 197ms later
17:53:35.600  content-browser.play-now    → "Star Wars: Rey's Story"
17:53:35.605  mini-player.mounted
17:53:35.778  media-queue.set-position    → position 3
17:53:35.780  mini-player.unmounted       // 175ms later
```

Each play-now triggers: addItems → MiniPlayer mounts → setPosition → MiniPlayer unmounts. The mount/unmount cycle completes in ~175-197ms. This happens because `handlePlayNow` adds an item then immediately sets position, which changes `queue.currentItem`, which toggles `hasMiniplayer`.

**Root cause:** `handlePlayNow` does `addItems('next').then(() => setPosition(nextPosition))`. Between add and setPosition, currentItem briefly exists (MiniPlayer mounts), then setPosition changes it (MiniPlayer unmounts because currentItem changes to the wrong index momentarily).

**Fix:** Combine addItems + setPosition into a single queue API call, or suppress MiniPlayer rendering during queue transitions.

**Logging gap:** Adequate — the mount/unmount timestamps clearly show the churn.

---

## Summary

| # | Bug | Severity | Log Evidence | Logging Gap |
|---|-----|----------|--------------|-------------|
| 1 | Items have no contentId — play silently fails | **Critical** | `contentIds: [null]` in queue | Log `itemId`/`id` alongside `contentId` |
| 2 | No thumbnails anywhere | **High** | `withThumbnails: 0` on every render | Log `thumbnail` URL presence |
| 3 | Immich photos flood results | **High** | 250 Immich, 67 Plex | Log source breakdown per render |
| 4 | Hymns tab shows wrong results | **High** | Filter race: singalong→null→immich | Log `filter-changed` with actual params |
| 5 | Jank / unresponsiveness | **High** | 6.3s to first result, no debounce | Log render timing, DOM node count |
| 6 | No search loading indicator | **Medium** | No loading-state event exists | Log loading state transitions |
| 7 | MiniPlayer mount/unmount churn | **Low** | 175ms mount-unmount cycles | Adequate |
