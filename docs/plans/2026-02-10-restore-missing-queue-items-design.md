# Restore Missing Queue Items — Design

**Date:** 2026-02-10
**Problem:** 4 of 8 active morning-program items are silently dropped by the queue pipeline.

## Summary of Fixes

| Item | Input | Root Cause | Fix |
|------|-------|-----------|-----|
| 10 Min News | `query: dailynews` | QueryAdapter freshvideo dispatch fails | Delegate to FreshVideoAdapter |
| Ted Ed | `freshvideo: teded` | `freshvideo:` not a registered source prefix | New FreshVideoAdapter |
| Doctrine & Covenants | `watchlist: cfmscripture` | All items have expired `skip_after` dates | Watchlist "never empty" fallback |
| Wrap Up | `app: wrapup` | AppRegistryAdapter lacks `resolvePlayables()` | Add method returning format: 'app' item |

## Fix 1: FreshVideoAdapter

New content adapter registered as `freshvideo` in the content source registry.

**Behavior:** `resolvePlayables(localId)` →
1. Scan `media/video/news/{localId}/` for `.mp4` files
2. Sort by filename descending (filenames are dates like `20260127.mp4`)
3. Check watch state for each, return the first unwatched
4. If all watched, return the newest (never empty)

**Registration:** Bootstrap registers `freshvideo` → `FreshVideoAdapter`. Needs media base path and media progress memory.

## Fix 2: AppRegistryAdapter.resolvePlayables()

Add `resolvePlayables(localId)` to existing `AppRegistryAdapter`. Returns a single queue item:

```javascript
{
  id: `app:${localId}`,
  contentId: `app:${localId}`,
  title: appRegistry[localId]?.label || localId,
  source: 'app',
  mediaUrl: null,
  mediaType: 'app',
  format: 'app',
  duration: 0,
  resumable: false
}
```

No media, no watch state — just a passthrough. Frontend `PlayableAppShell.jsx` already handles rendering.

## Fix 3: Watchlist "never empty" fallback

In `ListAdapter`'s watchlist resolution path, after all filtering:

```
filtered = applyWatchlistFilters(items)
if (filtered.length === 0 && items.length > 0) {
  filtered = [items[0]]
}
```

Applies only to watchlist resolution. Fallback item still goes through normal content resolution.

## Fix 4: QueryAdapter freshvideo dispatch

`QueryAdapter.resolvePlayables('dailynews')` loads `queries/dailynews.yml` (`type: freshvideo`, `sources: [news/world_az, news/cnn]`).

Fix the freshvideo dispatch to call `FreshVideoAdapter.resolvePlayables(source)` for each source, then return the single newest unwatched across all sources:

```
sources.map(s => freshVideoAdapter.resolvePlayables(s))
  → flatten → sort by date desc → return [first unwatched]
```

This keeps `dailynews` as multi-source aggregation while `freshvideo: teded` is direct single-source.
