# Last Queue Track Loops Instead of Stopping

**Date:** 2026-03-31
**Severity:** Medium — audio keeps playing indefinitely after queue finishes
**Status:** Open

## Symptom

When a queued album finishes playing all tracks, the last track loops forever instead of the Player dismissing. Logs show `playback.seek` with `source: "programmatic"` seeking to position 0 every ~3 minutes (the track's duration).

## Evidence

```
playback.queue-track-changed: "I Know Jesus Lives", queueLength: 1, queuePosition: 14
playback.started: plex:595092, duration: 175.84s
// Then every ~3 min:
playback.seek: plex:595092, phase: "seeking", intent: 0, source: "programmatic"
playback.seek: plex:595092, phase: "seeked", actual: 0
```

Track count check showed each track played exactly once — the album played correctly through all 16 tracks. Only the final track looped.

## Code Path

1. `ContentScroller.jsx:249` — `handleEnded()` calls `onAdvance()`
2. `Player.jsx:780` — `advance` dispatches to queue `advance` (isQueue stays true)
3. `useQueueController.js:186` — `advance()` with `prevQueue.length === 1`:
   - Line 226: if `isContinuous && originalQueue.length > 1` → resets to full queue (loops album)
   - Line 243: else → calls `clear()` (dismisses player)
4. Something is either: (a) keeping `isContinuous` true unexpectedly, or (b) `clear()` fires but something restarts playback

## Investigation Needed

- [ ] Add logging in `advance()` when `prevQueue.length === 1` to capture `isContinuous`, `originalQueue.length`
- [ ] Check if `isContinuous` is being set from queue metadata or barcode options
- [ ] Check if there's a track progress "sweep" function that was supposed to run after queue completion — user mentioned this existed
- [ ] Check if `clear()` fires but a WS message re-triggers playback (the barcode scan was received by the screen and might re-fire)
- [ ] Check if `singleAdvance` (line 697) is being called instead of queue `advance` after queue drains

## Related

- `frontend/src/modules/Player/hooks/useQueueController.js:186-246` — advance logic
- `frontend/src/modules/Player/Player.jsx:696-710` — singleAdvance with continuous restart
- `frontend/src/modules/Player/renderers/ContentScroller.jsx:249-263` — handleEnded
