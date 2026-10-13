# Bug Report: Fitness Music Player Not Playable

**Date:** 2026-02-03
**Severity:** High
**Status:** Fixed (code verified, needs runtime test with music playlists)
**Component:** `frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx`

## Fix Applied

**Solution B implemented:** Changed `FitnessMusicPlayer` to pass `queue={{ plex: selectedPlaylistId, shuffle: true }}` to Player instead of pre-fetching and passing an array.

**Changes made:**
1. Removed `playQueueData`, `loading`, `error` states
2. Removed the useEffect that manually fetched playlist data
3. Changed Player's `queue` prop from `queue={playQueueData}` to `queue={{ plex: selectedPlaylistId, shuffle: true }}`
4. Simplified `handleProgress` to use `progressData.media` directly
5. Removed unused `DaylightAPI` import

**Runtime verification:** Requires music playlists to be configured in `plex.music_playlists`. The current test environment does not have music playlists configured.

## Summary

The fitness music player is not playing audio. The playlist loads successfully from `/api/v1/item/plex/{id}/playable,shuffle`, but the tracks don't play because the queue items have nested `play.plex` structure instead of top-level `plex` properties expected by the Player component's queue controller.

## Symptoms

- Music player loads playlist metadata (titles, artists, album art)
- Player controls appear functional
- No audio plays when tracks are selected
- Browser console may show errors related to media loading

## Root Cause Analysis

### Data Structure Mismatch

**API Returns:**
```json
{
  "items": [
    {
      "id": "plex:140604",
      "title": "Panama (Workout Mix)",
      "artist": "ESPN",
      "play": { "plex": 140604 },  // ⚠️ Nested structure
      "key": 140604,
      "duration": 214
    }
  ]
}
```

**Player Expects (after flattening):**
```json
[
  {
    "plex": 140604,  // ⚠️ Top-level property
    "title": "Panama (Workout Mix)",
    "artist": "ESPN",
    "duration": 214
  }
]
```

### Current Implementation

**FitnessMusicPlayer.jsx** (lines 193-208):
```jsx
const response = await DaylightAPI(`/api/v1/item/plex/${selectedPlaylistId}/playable,shuffle`);

if (response && response.items) {
  setPlayQueueData(response.items);  // ⚠️ Passes items directly without flattening
}
```

**FitnessMusicPlayer.jsx** (lines 634-642):
```jsx
<Player
  ref={audioPlayerRef}
  key={selectedPlaylistId}
  queue={playQueueData}  // ⚠️ Array with nested play.plex structure
  play={{ volume: musicVolumeState.volume }}
  onProgress={handleProgress}
  playerType="audio"
  plexClientSession={musicPlexSession}
/>
```

### Why It Fails

**useQueueController.js** (lines 91-105) handles queue initialization:

```javascript
if (Array.isArray(play)) {
  newQueue = play.map(item => ({ ...item, guid: guid() }));
} else if (Array.isArray(queue)) {
  newQueue = queue.map(item => ({ ...item, guid: guid() }));  // ⚠️ No flattening!
} else if ((play && typeof play === 'object') || (queue && typeof queue === 'object')) {
  const queue_assetId = play?.playlist || play?.queue || queue?.playlist || queue?.queue || queue?.media;
  if (queue_assetId) {
    const { items } = await DaylightAPI(`api/v1/item/folder/${queue_assetId}/playable${isShuffle ? ',shuffle' : ''}`);
    const flattened = await flattenQueueItems(items);
    newQueue = flattened.map(item => ({ ...item, ...item.play, ...itemOverrides, guid: guid() }));  // ✅ Flattens here
  } else if (queue?.plex || play?.plex) {
    const plexId = queue?.plex || play?.plex;
    const { items } = await DaylightAPI(`api/v1/item/plex/${plexId}/playable${isShuffle ? ',shuffle' : ''}`);
    const flattened = await flattenQueueItems(items);
    newQueue = flattened.map(item => ({ ...item, ...item.play, ...itemOverrides, guid: guid() }));  // ✅ Flattens here
  }
}
```

**The Problem:**
- When `queue` is an **array**, line 93 just copies items with guid—no flattening
- When `queue` is an **object with plex property**, line 100-105 fetches API and flattens with `...item.play`
- FitnessMusicPlayer passes pre-fetched array, so flattening never happens
- Items retain nested `play.plex` structure
- Player can't find `plex` property to fetch media URLs

## Technical Flow

### Current (Broken) Flow
```
FitnessMusicPlayer
  → Fetches `/api/v1/item/plex/${id}/playable,shuffle`
  → Receives items with nested play.plex
  → Passes items array to Player as queue={playQueueData}
  → useQueueController receives array
  → Line 93: Just maps array without flattening
  → Items still have play.plex nested
  → Player can't resolve media URLs
  → No audio plays
```

### Expected Flow (Option A - Manual Flatten)
```
FitnessMusicPlayer
  → Fetches `/api/v1/item/plex/${id}/playable,shuffle`
  → Receives items with nested play.plex
  → Flattens: items.map(item => ({ ...item, ...item.play }))
  → Passes flattened array to Player
  → Items have plex at top level
  → Player resolves media URLs
  → Audio plays
```

### Expected Flow (Option B - Let Player Fetch)
```
FitnessMusicPlayer
  → Passes queue={{ plex: selectedPlaylistId }} to Player
  → Player fetches `/api/v1/item/plex/${id}/playable,shuffle`
  → useQueueController flattens automatically
  → Items have plex at top level
  → Player resolves media URLs
  → Audio plays
```

## Proposed Solutions

### Solution A: Flatten Items in FitnessMusicPlayer (Recommended)

**File:** `frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx`

**Change at lines 197-208:**
```jsx
if (response && response.items) {
  console.log('[Playlist] Loaded new playlist:', {
    itemCount: response.items.length,
    firstTrack: response.items[0]?.title,
    firstTrackData: response.items[0]
  });
  
  // Flatten items: merge play.plex/play.media to top level
  const flattenedItems = response.items.map(item => ({
    ...item,
    ...(item.play || {})  // Merge play.plex to top level
  }));
  
  setPlayQueueData(flattenedItems);
  
  // Set first track as current
  if (flattenedItems.length > 0) {
    console.log('[Playlist] Setting initial track:', flattenedItems[0]);
    setCurrentTrack(flattenedItems[0]);
  }
}
```

**Pros:**
- Minimal change
- Maintains current architecture (FitnessMusicPlayer fetches, Player plays)
- Keeps control over shuffle in FitnessMusicPlayer
- Can still track currentTrack state

**Cons:**
- Duplicates flattening logic (useQueueController also has it)
- FitnessMusicPlayer does both fetching AND flattening

### Solution B: Let Player Handle Everything (Simpler)

**File:** `frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx`

**Remove the useEffect that fetches playlist** (lines 177-216) and **change Player props** (lines 634-642):

```jsx
{selectedPlaylistId && (
  <div style={{ position: 'absolute', left: '-9999px' }}>
    <Player
      ref={audioPlayerRef}
      key={selectedPlaylistId}
      queue={{ plex: selectedPlaylistId, shuffle: true }}  // ✅ Let Player fetch
      play={{ volume: musicVolumeState.volume }}
      onProgress={handleProgress}
      playerType="audio"
      plexClientSession={musicPlexSession}
    />
  </div>
)}
```

**Adjust handleProgress** to get currentTrack from progressData instead of pre-fetched queue.

**Pros:**
- Simpler code
- Uses existing Player queue management
- No duplicate fetching/flattening
- Follows DRY principle

**Cons:**
- Loses direct control over shuffle (now in queue object)
- Can't display "Loading playlist..." state as easily
- currentTrack must be derived from onProgress callback, not pre-fetched

### Solution C: Hybrid Approach

Keep fetching in FitnessMusicPlayer for UI feedback, but pass playlist ID to Player:

```jsx
// Keep existing useEffect for loading UI state
useEffect(() => {
  const loadPlaylistMeta = async () => {
    const response = await DaylightAPI(`/api/v1/item/plex/${selectedPlaylistId}/playable,shuffle`);
    if (response?.items) {
      // Don't set playQueueData, just use for currentTrack display
      setCurrentTrack(response.items[0]);
    }
  };
  if (selectedPlaylistId) {
    loadPlaylistMeta();
  }
}, [selectedPlaylistId]);

// Let Player handle actual queue
<Player
  queue={{ plex: selectedPlaylistId, shuffle: true }}
  ...
/>
```

## Verification

### Test Endpoint
```bash
curl http://localhost:3111/api/v1/item/plex/672596/playable,shuffle
```

**Should return:**
```json
{
  "items": [
    {
      "play": { "plex": 140604 },  // Check for nested structure
      ...
    }
  ]
}
```

### Test Media URL Resolution
```bash
curl http://localhost:3111/api/v1/play/plex/mpd/140604
```

**Should return:**
```
Found. Redirecting to /api/v1/proxy/plex/library/parts/.../file.mp3?X-Plex-Client-Identifier=...
```

This confirms the backend endpoints work—the issue is purely frontend data structure.

### Manual Browser Test
1. Open fitness session
2. Open browser DevTools → Console
3. Enable music player
4. Check for console logs from lines 195-208
5. Inspect `playQueueData` state in React DevTools
6. Verify items have `plex` at **top level**, not nested in `play.plex`

### Success Criteria
- [ ] Music player loads playlist
- [ ] First track starts playing automatically
- [ ] Album art displays correctly
- [ ] Track title/artist show correctly
- [ ] Next track button advances queue
- [ ] Audio is audible through speakers
- [ ] Console shows no media loading errors

## Related Code

### flattenQueueItems Function
**File:** `frontend/src/modules/Player/lib/api.js` (lines 10-33)

```javascript
export async function flattenQueueItems(items, level = 1) {
  const flattened = [];

  for (const item of items) {
    if (item.queue) {
      // Recursively fetch nested playlists
      const shuffle = !!item.queue.shuffle || item.shuffle || false;
      if (item.queue.playlist || item.queue.queue) {
        const queueKey = item.queue.playlist ?? item.queue.queue;
        const { items: nestedItems } = await DaylightAPI(`api/v1/item/folder/${queueKey}/playable${shuffle ? ',shuffle' : ''}`);
        const nestedFlattened = await flattenQueueItems(nestedItems, level + 1);
        flattened.push(...nestedFlattened);
      } else if (item.queue.plex) {
        const { items: plexItems } = await DaylightAPI(`api/v1/item/plex/${item.queue.plex}/playable${shuffle ? ',shuffle' : ''}`);
        const nestedFlattened = await flattenQueueItems(plexItems, level + 1);
        flattened.push(...nestedFlattened);
      }
    } else if (item.play) {
      flattened.push(item);  // ⚠️ Still has nested play property
    } else {
      flattened.push(item);
    }
  }

  return flattened.filter(item => item?.active !== false);
}
```

**Note:** This function recursively handles nested queues but doesn't flatten `item.play` itself—that happens in useQueueController at line 104.

## Implementation Priority

**Recommended: Solution A** (Flatten in FitnessMusicPlayer)
- **Priority:** High (blocks music playback entirely)
- **Estimated Effort:** 15-30 minutes
- **Risk:** Low (isolated change, easy to test)

**Alternative:** Solution B could be explored later as refactoring to simplify architecture.

## Notes

- The MusicPlayerWidget.jsx shown by user is NOT the actual player—it's a standalone widget component not currently used by fitness
- The actual player is `frontend/src/modules/Player/Player.jsx` wrapped by FitnessMusicPlayer
- Media URL resolution works fine (`/api/v1/play/plex/mpd/{id}` returns correct redirect)
- Issue is purely a data structure transformation problem in the queue setup
