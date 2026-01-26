# Bug Report: Video Queue Stalling After Video Completion

**Date:** 2026-01-25  
**Severity:** High  
**Component:** Frontend / Video Player Queue Controller  
**Status:** Fixed  

---

## Summary

Videos in queue playback mode pause at the end and fail to automatically advance to the next video. Users must manually select the next video, causing significant playback interruptions (1-3 minute stalls).

---

## Reproduction Steps

1. Start playing a queue/playlist of videos (e.g., Plex TV show episodes)
2. Let a video play through to completion
3. Observe: Video pauses at the end (currentTime equals duration)
4. Expected: Next video in queue should automatically start
5. Actual: Player remains paused; no advancement occurs
6. User must manually navigate to and select the next video to continue

---

## Evidence from Production Logs

### Example 1: "God Calls Samuel" → Manual Advance
```
23:48:27.166Z - playback.queue-track-changed (God Calls Samuel loaded, queuePosition: 1)
23:48:29.083Z - playback.started (video starts at 221s - resume point)
23:50:46.578Z - playback.paused (video ended at 358.4s, duration: 358.4s)
[NO AUTOMATIC ADVANCE]
23:54:01.906Z - playback.intent (user manually selected next, source: "menu-selection")
23:54:02.361Z - playback.queue-track-changed (The Road to Emmaus loaded)
```
**Gap:** 3 minutes 15 seconds of manual intervention

### Example 2: "The Road to Emmaus" → Manual Advance
```
23:54:04.404Z - playback.started (video starts)
00:00:35.245Z - playback.paused (video ended at 390.78s, duration: 390.78s)
[NO AUTOMATIC ADVANCE]
00:01:54.542Z - playback.intent (user manually selected next, source: "menu-selection")
00:01:54.877Z - playback.queue-track-changed (Mary and Elizabeth loaded)
```
**Gap:** 1 minute 19 seconds of manual intervention

### Pattern
- Video completes: `playback.paused` event fires with `currentTime === duration`
- Queue advancement does NOT occur automatically
- User initiates next video manually via `playback.intent` with `source: "menu-selection"`
- Next video loads only after manual selection

---

## Root Cause Analysis

### File: `frontend/src/modules/Player/hooks/useQueueController.js`
### Function: `advance()` (lines 130-156)

**Problematic Logic:**
```javascript
const advance = useCallback((step = 1) => {
  setQueue((prevQueue) => {
    if (prevQueue.length > 1) {
      // ... advance logic for multi-item queue ...
    }
    // BUG: When prevQueue.length === 1 (last video playing),
    // this immediately calls clear() and closes the player
    clear();
    return [];
  });
}, [clear, isContinuous, originalQueue]);
```

**The Bug:**
When the video player's `ended` event fires and calls `advance()`:
- At that moment, `prevQueue` has already been mutated to only contain the currently-playing video
- `prevQueue.length === 1` (not > 1), so the condition fails
- Falls through to `clear()`, which closes the player instead of advancing

**Expected Behavior:**
- If `isContinuous` is true and `originalQueue.length > 1`, loop back to start
- Otherwise, advance to the next item in the queue
- Only call `clear()` when truly at the end (no more items to play)

---

## Technical Details

### Call Chain
1. Video ends → `mediaEl` fires `ended` event
2. `useCommonMediaController.js:799` → `onEnded()` handler calls `onEnd()`
3. `onEnd` callback = `advance` function passed from `Player.jsx:701`
4. For queues, `advance` = `useQueueController.advance`
5. `useQueueController.advance()` executes buggy logic above

### Queue State at Time of Bug
- `playQueue`: Array with 1 element (current video that just finished)
- `originalQueue`: Full playlist (e.g., 55 episodes)
- `isContinuous`: Should be `true` for TV show playlists
- `queuePosition`: Current position in original queue (e.g., position 1 out of 55)

### Why Manual Selection Works
When user manually selects next video:
- `playback.intent` is dispatched with full queue information
- Queue is re-initialized from scratch via `initQueue()` in `useQueueController`
- `playQueue` is reset to remaining items
- Video starts playing normally

---

## Proposed Fix

Modify the `advance()` function to handle the single-item-remaining case:

```javascript
const advance = useCallback((step = 1) => {
  setQueue((prevQueue) => {
    if (prevQueue.length > 1) {
      // ... existing advance logic ...
    } else if (prevQueue.length === 1 && isContinuous && originalQueue.length > 1) {
      // When last item finishes in continuous mode, loop back to start
      return [...originalQueue];
    }
    // Only clear if we're truly at the end (not continuous or empty queue)
    clear();
    return [];
  });
}, [clear, isContinuous, originalQueue]);
```

**Logic:**
1. If multiple items in queue → advance normally (existing logic)
2. If single item AND continuous mode AND original queue has multiple items → reset to full queue
3. Otherwise → clear player (end of playlist)

---

## Testing Recommendations

### Test Case 1: Non-Continuous Queue
1. Play a queue of 3 videos with `continuous: false`
2. Verify videos advance automatically
3. After 3rd video, verify player closes properly

### Test Case 2: Continuous Queue
1. Play a queue of 3 videos with `continuous: true`
2. Verify videos advance automatically
3. After 3rd video, verify it loops back to 1st video

### Test Case 3: Single Video in Queue
1. Play a queue with only 1 video
2. After video ends, verify appropriate behavior based on `continuous` flag

### Test Case 4: Plex TV Show Episodes
1. Play a TV show season (multiple episodes)
2. Let episodes play through completely
3. Verify each episode advances to the next without stalling

---

## Impact Assessment

**User Experience:**
- Current: Major disruption, requires manual intervention every 6-10 minutes
- After Fix: Seamless continuous playback

**Affected Users:**
- All users playing video queues/playlists
- Particularly impacts TV show binge-watching
- Affects both Plex and local content playlists

**Workaround:**
Users must manually select next video after each completion

---

## Additional Notes

### Related Code Locations
- **Queue controller:** `frontend/src/modules/Player/hooks/useQueueController.js`
- **Media controller:** `frontend/src/modules/Player/hooks/useCommonMediaController.js`
- **Video player:** `frontend/src/modules/Player/components/VideoPlayer.jsx`
- **Player wrapper:** `frontend/src/modules/Player/Player.jsx`

### Continuous Mode Detection
The `isContinuous` flag is set from:
```javascript
const [isContinuous] = useState(!!queue?.continuous || !!play?.continuous || false);
```

Verify that playlists from Plex/TV shows are setting this flag appropriately.

---

## Verification

After fix is implemented, check production logs for:
1. `playback.paused` events followed immediately by `playback.queue-track-changed`
2. Elimination of `playback.intent` with `source: "menu-selection"` between videos
3. Reduction in time gap between video end and next video start (should be < 5 seconds)

**Expected Log Pattern After Fix:**
```
playback.paused (video ended)
playback.queue-track-changed (next video queued automatically)
playback.video-ready (next video ready)
playback.started (next video playing)
```

---

## Resolution

**Status:** Fixed
**Date:** 2026-01-25

### Changes Made

1. Modified `advance()` function in `useQueueController.js` to handle `playQueue.length === 1` case:
   - For continuous mode with multi-item original queue: resets to full original queue
   - Otherwise: clears player (expected end-of-playlist behavior)

2. Added diagnostic logging (`playbackLog('queue-advance', ...)`) to track queue state transitions

### Verification

**Test 1: Continuous Queue (TV Show)**
- [ ] Episodes advance automatically without stalling
- [ ] Console shows `queue-advance` with `action: 'rotate'`
- [ ] At end of queue, shows `action: 'reset-continuous'`

**Test 2: Non-Continuous Queue**
- [ ] Videos advance automatically
- [ ] Console shows `queue-advance` with `action: 'slice'`
- [ ] At end of playlist, shows `action: 'clear'` and player closes

**Production Log Verification:**
After deployment, check for:
1. `playback.paused` followed immediately by `queue-advance` (not manual `playback.intent`)
2. Elimination of long gaps (> 5 seconds) between videos
