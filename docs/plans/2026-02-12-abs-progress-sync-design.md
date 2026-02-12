# Audiobookshelf Bidirectional Progress Sync

**Date:** 2026-02-12
**Status:** Approved

## Problem

DaylightStation plays audiobooks from Audiobookshelf (ABS) but progress tracking is one-directional. DS reads resume position from ABS on play start but never writes back. If a user listens in DS, their position is lost in ABS. If they listen in the ABS mobile app, DS doesn't pick up the change until it re-fetches the item.

## Goals

- Bidirectional sync of playhead position between DS media_memory and ABS
- Bidirectional sync of finished/completed state
- Guard against accidental position resets (browsing, seeking, sleep)
- Best-effort sync that never blocks playback

## Architecture (DDD Layers)

### Domain Layer (`2_domains/content/`)

Two pure, stateless functions added to `2_domains/content/services/`:

#### `resolveProgressConflict(local, remote)`

Determines which progress source wins when DS and ABS disagree at play start.

**Rules (evaluated in order):**

1. **Null handling** — if either is null, use the one that exists
2. **Sanity guard** — if one side reports playhead=0 but the other has playhead > 60s, reject the zero (stale/uninitialized, not a real rewind)
3. **Finished propagation** — if either side is finished (`isWatched`/`isFinished`), finished state wins. A book doesn't un-finish.
4. **Latest timestamp wins** — compare `lastPlayed` (DS) vs `lastUpdate` (ABS). More recent is authoritative.
5. **Tie-breaker** — equal or missing timestamps: use furthest playhead

**Input:**
- `local`: MediaProgress from DS media_memory (nullable)
- `remote`: `{ currentTime, isFinished, lastUpdate }` from ABS (nullable)

**Output:**
- `{ playhead, duration, isFinished, source: 'local'|'remote' }`

#### `isProgressCommittable(sessionWatchTime, lastCommittedPlayhead, newPlayhead)`

Determines whether a progress update should be trusted and persisted, or treated as browsing/seeking.

**Rules:**

- `jumpDistance = abs(newPlayhead - lastCommittedPlayhead)`
- If `jumpDistance > 5 minutes`: enter skeptical state. Require 60s of continuous listening at the new position before committing. A further large jump during the 60s window resets the timer.
- If `jumpDistance <= 5 minutes`: commit normally (chapter skips, 30s buttons)

This prevents browse-ahead, accidental seeks, and sleep-through from corrupting the real listening position.

### Application Layer (`3_applications/content/services/`)

#### `ABSProgressSyncService`

Orchestrates all sync operations. Stateful (in-memory maps for debounce and skeptical state). Injected with:

- `absClient` — AudiobookshelfClient (read/write ABS progress)
- `mediaProgressMemory` — IMediaProgressMemory (read/write DS progress)
- `resolveConflict` — domain conflict resolution function
- `isCommittable` — domain committability function

**Methods:**

##### `reconcileOnPlay(itemId, storagePath) -> MediaProgress`

Called on play start for ABS items. Read path.

1. Parallel fetch: `mediaProgressMemory.get(itemId)` + `absClient.getProgress(localId)`
2. Save **session-start bookmark** on the MediaProgress entry (current position before playback begins)
3. Run `resolveProgressConflict(local, remote)`
4. If remote won: update DS media_memory with remote values
5. If local won: buffer a debounced write-back to ABS
6. Return the winning MediaProgress for the play response

##### `onProgressUpdate(itemId, localId, progressData)`

Called on each play/log for ABS items. Write path.

1. Calculate jumpDistance from lastCommittedPlayhead
2. If `jumpDistance > 5min`:
   - Save **pre-jump bookmark** on the MediaProgress entry
   - Enter skeptical state for this item
   - Require 60s continuous listening before committing
3. Call `isProgressCommittable()`
   - Not committable: skip ABS buffer, return
   - Committable: update `lastCommittedPlayhead`
4. Add to debounce map (keyed by itemId)
5. After 30s of no new updates, fire `absClient.updateProgress(localId, { currentTime, isFinished })`

##### `flush()`

Called on graceful shutdown (SIGTERM). Immediately writes all pending debounced updates to ABS with a 5s timeout.

**In-memory state:**

- `debounceMap: Map<itemId, { timer, latestProgress }>` — pending ABS writes
- `skepticalMap: Map<itemId, { lastCommittedPlayhead, watchTimeAccumulated, enteredAt }>` — jump tracking

No persistence needed for either map. Worst case on crash: ABS is ~30s behind, fixed by next `reconcileOnPlay`.

### API Layer (`4_api/v1/routers/play.mjs`)

Minimal changes. Router stays thin.

#### GET /play/abs:* (play start)

```javascript
// For ABS items, use sync service instead of raw media_memory
const watchState = item.source === 'abs' && absSyncService
  ? await absSyncService.reconcileOnPlay(item.id, storagePath)
  : await mediaProgressMemory.get(item.id, storagePath);
res.json(toPlayResponse(item, watchState, { adapter }));
```

#### POST /play/log (progress update)

After existing `mediaProgressMemory.set()`:

```javascript
if (type === 'abs' && absSyncService) {
  absSyncService.onProgressUpdate(compoundId, localId, newState);
}
```

Fire-and-forget. Debounce is internal to the service.

#### GET /play/abs:*?bookmark=true (bookmark restore)

```javascript
// reconcileOnPlay as normal, then override with bookmark if present
if (req.query.bookmark === 'true' && watchState?.bookmark) {
  watchState.playhead = watchState.bookmark.playhead;
  // Clear consumed bookmark
}
```

### Adapter Layer (`1_adapters/`)

No changes needed. `AudiobookshelfClient.updateProgress()` already exists (line 130-142 of AudiobookshelfClient.mjs). The YAML persistence layer already handles MediaProgress entities.

### Service Injection (`app.mjs`)

`ABSProgressSyncService` is constructed in `app.mjs` alongside existing `audiobookshelfConfig` setup. Passed into `createPlayRouter()`. If ABS isn't configured, the service is null and all sync code is skipped via null checks.

## Bookmark System

A lightweight safety net for position recovery.

### When bookmarks are created

1. **Session-start bookmark** — saved by `reconcileOnPlay` every time an ABS item starts playing. Captures the position before playback begins. Reason: `"session-start"`.
2. **Pre-jump bookmark** — saved by `onProgressUpdate` when a large jump (>5min) is detected. Captures the committed position before the jump. Reason: `"pre-jump"`.

### Storage

One bookmark per item, most recent wins. Stored on the MediaProgress YAML entry:

```yaml
abs:7e7da933:
  playhead: 13500
  duration: 19766
  percent: 68
  lastPlayed: "2026-02-12T..."
  watchTime: 4500
  bookmark:
    playhead: 5400
    reason: "session-start"
    createdAt: "2026-02-12T..."
```

### Retrieval

`GET /play/abs:item-id?bookmark=true` returns the play response with resume_position set to the bookmark's playhead instead of the current playhead. The bookmark is cleared after use.

### Expiry

Bookmarks older than 7 days are ignored and cleaned up on next write.

## Finished State Sync

### DS to ABS

Piggybacks on the debounced write-back. When `percent >= 90`, the write includes `isFinished: true`. No extra mechanism needed.

### ABS to DS

Handled by `reconcileOnPlay`. Conflict rule #3: if ABS reports `isFinished: true`, finished state propagates to DS media_memory.

### Re-listening

If both DS and ABS agree an item is finished, and the frontend sends playhead=0, the sanity guard allows it — the user deliberately restarted a completed book.

## Error Handling

### ABS unreachable

- **On play start**: Log warning, use DS media_memory only. Don't block playback.
- **On write-back**: Log error. Buffered progress stays in debounce map for one retry on next cycle. If retry fails, drop it. Next `reconcileOnPlay` catches drift.

### Race conditions

- **Multiple tabs**: Last write wins via debounce map. User can only truly listen in one tab.
- **ABS app + DS simultaneously**: Next `reconcileOnPlay` resolves via latest-timestamp. Session-start bookmark preserves fallback.
- **Rapid play/pause**: Debounce absorbs. Only stable state after 30s gets written.

### Graceful shutdown

`flush()` called on SIGTERM. Writes pending updates with 5s timeout. If ABS unreachable at shutdown, data is safe in DS media_memory.

## Data Flow Summary

### Play Start (Read)

```
GET /play/abs:item-id
  -> absSyncService.reconcileOnPlay()
    -> Parallel: mediaProgressMemory.get() + absClient.getProgress()
    -> Save session-start bookmark
    -> resolveProgressConflict(local, remote)
    -> Winner updates the losing side (debounced for ABS)
    -> Return winning MediaProgress
  -> toPlayResponse() with resume_position
```

### During Playback (Write)

```
POST /play/log { type: 'abs', seconds, percent, watched_duration }
  -> mediaProgressMemory.set() (existing, unchanged)
  -> absSyncService.onProgressUpdate()
    -> jumpDistance > 5min? Save pre-jump bookmark, enter skeptical state
    -> isProgressCommittable()?
       No  -> skip ABS buffer
       Yes -> update lastCommittedPlayhead, add to debounce map
    -> Debounce timer (30s) -> absClient.updateProgress()
```

### Bookmark Restore

```
GET /play/abs:item-id?bookmark=true
  -> reconcileOnPlay() as normal
  -> Override resume_position with bookmark.playhead
  -> Clear bookmark
```

### Shutdown

```
SIGTERM -> absSyncService.flush()
  -> For each debounce entry: cancel timer, write to ABS immediately
  -> 5s timeout, exit
```

## Files to Create/Modify

### New files

| File | Layer | Purpose |
|------|-------|---------|
| `backend/src/2_domains/content/services/resolveProgressConflict.mjs` | Domain | Conflict resolution policy |
| `backend/src/2_domains/content/services/isProgressCommittable.mjs` | Domain | Jump skepticism / anti-browse guard |
| `backend/src/3_applications/content/services/ABSProgressSyncService.mjs` | Application | Sync orchestration, debounce, bookmarks |

### Modified files

| File | Change |
|------|--------|
| `backend/src/4_api/v1/routers/play.mjs` | Call sync service on ABS play start + progress log |
| `backend/src/app.mjs` | Construct and inject ABSProgressSyncService |
| `backend/src/2_domains/content/entities/MediaProgress.mjs` | Add optional `bookmark` field |
| `backend/src/1_adapters/persistence/yaml/mediaProgressSchema.mjs` | Add `bookmark` to canonical schema |
| `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs` | Handle bookmark field in read/write |

### No changes needed

| File | Reason |
|------|--------|
| `AudiobookshelfClient.mjs` | `updateProgress()` already exists |
| `AudiobookshelfAdapter.mjs` | Already reads progress from ABS |
| `AudiobookshelfProxyAdapter.mjs` | Streaming proxy unchanged |
