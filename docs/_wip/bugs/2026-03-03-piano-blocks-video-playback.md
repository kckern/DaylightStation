# Piano Visualizer Blocks Video Playback

**Date:** 2026-03-03
**Status:** Observed, resolved by hard refresh
**Severity:** Medium
**Component:** `frontend/src/Apps/OfficeApp.jsx`, `frontend/src/lib/OfficeApp/`

## Symptom

Video not playing on Shield TV (Linux/Chrome). Prod logs show endless `playback.overlay-summary` cycle with `mediaElementPresent: false`, `playerType: null`, `guid: null`. Transport warns `playback.transport-capability-missing: getMediaEl`.

## Root Cause (Suspected)

`OfficeApp.renderContent()` checks `showPiano` before `currentContent`. When `showPiano` is true (auto-triggered by MIDI `session_start` or `note_on` events), the PianoVisualizer renders and the Player never mounts — even if a play/queue command has been received.

```jsx
// Line 256 — piano takes priority
if (showPiano) return <PianoVisualizer ... />;
// Line 267 — player never reached
if (currentContent) { ... }
```

The resilience system keeps retrying remounts, but no `<video>` element ever appears because the Player component is never in the render tree.

## Evidence

- Backend resolved content fine: `queue.resolve` returned 155 Bluey episodes (plex:59493)
- All playback logs tagged `app: "piano"` from Shield TV client
- Resilience cycled through 3 remount attempts repeatedly with `mediaElementPresent: false`

## Resolution

Hard refresh cleared the stale `showPiano` state.

## Potential Fix

When a play/queue WS command arrives, dismiss the piano visualizer:
- Option A: In `websocketHandler.js`, call a `setShowPiano(false)` callback when content is received
- Option B: Reorder `renderContent()` so `currentContent` takes priority over `showPiano`
- Option C: Both — dismiss piano on content arrival AND give player priority in render order
