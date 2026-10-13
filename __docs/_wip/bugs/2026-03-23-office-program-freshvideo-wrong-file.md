# Bug: Office Program Picks Oldest Video Instead of Latest

**Date:** 2026-03-23
**Severity:** High — morning program unusable (infinite spinner)
**Affected:** Office screen program, all `media:` prefix freshvideo sources

---

## Symptoms

1. Office morning program starts at 07:07, video loads but spinner never clears
2. Player stuck in **"Recovering…"** state for 80+ seconds
3. Video element reports `readyState=4, networkState=1, paused=true` — loaded but stuck paused
4. Selected video is `20260313.mp4` (10 days old) instead of `20260322.mp4` (latest)

## Log Evidence

### Queue resolution (07:07:24)
```
queue.resolve { source: "list", count: 11, totalDuration: 12347 }
playback.queue-track-changed { title: "20260313", queuePosition: 0, queueLength: 11 }
```

### Player stuck in recovery loop (every 1s for 80+ seconds)
```
playback.overlay-summary [005dadbb80] vis:80414ms/0ms | status:Recovering… |
  el:t=0.0 r=4 n=1 p=true | startup:idle
```
- `t=0.0` — currentTime never advances
- `r=4` — readyState HAVE_ENOUGH_DATA (video is loaded)
- `p=true` — video element is paused
- `startup:idle` — startup sequence not actively retrying

### WebSocket stale warnings (multiple clients)
```
[WebSocketService] Connection stale (no data in 45s), forcing reconnect
```

## Filesystem Evidence

The file exists at the correct path, but the queue references a wrong relative path:

```
# Queue references:
files:news/aljazeera/20260313.mp4

# Actual filesystem layout (inside container):
media/video/news/aljazeera/20260313.mp4  (52MB, Mar 13)
media/video/news/aljazeera/20260315.mp4  (7.5MB, Mar 15)
media/video/news/aljazeera/20260316.mp4  (22MB, Mar 16)
...
media/video/news/aljazeera/20260322.mp4  (59MB, Mar 22)  ← LATEST

# No top-level news directory:
media/news/  → DOES NOT EXIST
media/video/news/  → EXISTS (contains aljazeera, bbc, cnn, etc.)
```

The `resolvePath()` method tries `MEDIA_PREFIXES = ['', 'audio', 'video', 'img']` and finds the directory via the `video/` prefix fallback, so path resolution works. But the **localId** used downstream is `news/aljazeera/20260313.mp4` (without `video/`).

## Root Cause

**The freshvideo strategy is never applied** because the ID check fails.

### Config
`data/household/config/lists/programs/office-program.yml` first item:
```yaml
- volume: 100
  input: 'media: news/aljazeera'
  playbackrate: 1.5
  days: Weekdays
  label: News
```

### Resolution chain

1. **List normalizer** (`listConfigNormalizer.mjs`): `media: news/aljazeera` → `media:news/aljazeera`
2. **Content registry**: `media:` prefix matches `MediaAdapter` → `localId = "news/aljazeera"`
3. **ListAdapter._getNextPlayableFromChild** builds `canonicalId = "files:news/aljazeera"` (adapter.source = 'files')
4. **MediaAdapter.resolvePlayables("files:news/aljazeera")**:
   - Strips prefix → `id = "news/aljazeera"`
   - **Freshvideo check (line 552):**
     ```js
     const isFreshVideo = options.freshvideo || id.startsWith('video/news/');
     ```
   - `"news/aljazeera".startsWith("video/news/")` → **FALSE**
   - Freshvideo strategy **never applied**

5. Without freshvideo strategy, `resolvePlayables` returns ALL files from directory listing
6. Back in `_getNextPlayableFromChild` (line 772-792):
   - Iterates items looking for in-progress, then first unwatched
   - Items are in **alphabetical order** (from `listEntries`)
   - `20260313.mp4` is first alphabetically
   - If no progress data exists, returns `items[0]` → the OLDEST file

### The disconnect

`MediaAdapter.prefixes` (line 171-178) defines:
```js
{ prefix: 'freshvideo', idTransform: (id) => `video/news/${id}` }
```

This transform only applies when using the `freshvideo:aljazeera` prefix explicitly. The `media:news/aljazeera` prefix doesn't trigger the transform — it strips `media:` and passes `news/aljazeera` directly.

The path **resolution** works because `resolvePath()` tries `video/` as a prefix and finds the directory. But the **freshvideo detection** requires the ID to already contain `video/news/`, which it doesn't because `resolvePath` hasn't been called yet at the detection point.

### Code evidence

**MediaAdapter.mjs line 550-552:**
```js
async resolvePlayables(id, options = {}) {
    // Detect freshvideo paths (video/news/*) and apply strategy
    const isFreshVideo = options.freshvideo || id.startsWith('video/news/');
```

**MediaAdapter.mjs line 186-207 (resolvePath):**
```js
resolvePath(mediaKey) {
    // ...
    for (const prefix of MEDIA_PREFIXES) {   // ['', 'audio', 'video', 'img']
        const candidate = prefix
            ? path.join(this.mediaBasePath, prefix, normalizedKey)
            : path.join(this.mediaBasePath, normalizedKey);
        if (fileExists(candidate) || dirExists(candidate)) {
            return { path: candidate, prefix };  // prefix = 'video' for news paths
        }
    }
```

The `prefix` from resolution is `'video'` and `localId` starts with `'news/'`, but this information is never used for freshvideo detection.

## Secondary Issue: Video Stuck Paused

Even after selecting the wrong file, the video loads (`readyState=4`) but is **paused** and the recovery mechanism enters an idle state. The player overlay shows `startup:idle` meaning the startup sequence gave up. This may be a separate bug in the playback recovery logic where a paused video with sufficient data should trigger a `.play()` call.

## Proposed Fix

In `MediaAdapter.resolvePlayables`, check the resolved path prefix in addition to the ID prefix:

```js
async resolvePlayables(id, options = {}) {
    const localId = id.replace(/^(files|media|local|file|fs):/, '');
    const resolved = this.resolvePath(localId);

    // Detect freshvideo: explicit option, ID prefix, or resolved under video/news/
    const isFreshVideo = options.freshvideo
        || localId.startsWith('video/news/')
        || (resolved?.prefix === 'video' && localId.startsWith('news/'));
    // ...
```

This ensures that `media:news/aljazeera` correctly triggers freshvideo selection when it resolves under the `video/` media prefix.

## Impact

- All `media: news/*` items in program lists fail to use freshvideo strategy
- Users get the oldest (alphabetically first) file instead of the latest unwatched
- The office morning program has been playing stale 10-day-old news every day
