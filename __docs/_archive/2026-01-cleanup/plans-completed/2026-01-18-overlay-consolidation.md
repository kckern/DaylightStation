# Overlay Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate two loading overlay systems into one, removing duplicate rendering and conflicting visibility logic.

**Architecture:** Extract diagnostic utilities from LoadingOverlay.jsx to a shared module, enhance PlayerOverlayLoading with pause icon and debug diagnostics, remove LoadingOverlay from VideoPlayer, delete the obsolete component.

**Tech Stack:** React, PropTypes

---

## Task 1: Extract Diagnostic Utilities

**Files:**
- Create: `frontend/src/modules/Player/lib/mediaDiagnostics.js`
- Reference: `frontend/src/modules/Player/components/LoadingOverlay.jsx:23-149`

**Step 1: Create the mediaDiagnostics.js file**

Extract `serializeRanges`, `computeBufferDiagnostics`, `readPlaybackQuality`, and `buildMediaDiagnostics` from LoadingOverlay.jsx.

```javascript
/**
 * Media element diagnostic utilities for debug overlay.
 * Extracted from LoadingOverlay.jsx during overlay consolidation.
 */

const EMPTY_MEDIA_DIAGNOSTICS = Object.freeze({
  hasElement: false,
  currentTime: null,
  readyState: null,
  networkState: null,
  paused: null,
  playbackRate: null,
  buffered: [],
  bufferAheadSeconds: null,
  bufferBehindSeconds: null,
  nextBufferStartSeconds: null,
  bufferGapSeconds: null,
  droppedFrames: null,
  totalFrames: null
});

const serializeRanges = (ranges) => {
  if (!ranges || typeof ranges.length !== 'number') {
    return [];
  }
  const out = [];
  for (let index = 0; index < ranges.length; index += 1) {
    try {
      const start = ranges.start(index);
      const end = ranges.end(index);
      out.push({
        start: Number.isFinite(start) ? Number(start.toFixed(3)) : start,
        end: Number.isFinite(end) ? Number(end.toFixed(3)) : end
      });
    } catch (_) {
      // ignore bad range
    }
  }
  return out;
};

export const computeBufferDiagnostics = (mediaEl) => {
  if (!mediaEl) {
    return {
      buffered: [],
      bufferAheadSeconds: null,
      bufferBehindSeconds: null,
      nextBufferStartSeconds: null,
      bufferGapSeconds: null
    };
  }
  const buffered = serializeRanges(mediaEl.buffered);
  const currentTime = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : null;
  if (!buffered.length || !Number.isFinite(currentTime)) {
    return {
      buffered,
      bufferAheadSeconds: null,
      bufferBehindSeconds: null,
      nextBufferStartSeconds: null,
      bufferGapSeconds: null
    };
  }
  let bufferAheadSeconds = null;
  let bufferBehindSeconds = null;
  let nextBufferStartSeconds = null;
  for (let index = 0; index < buffered.length; index += 1) {
    const range = buffered[index];
    if (currentTime >= range.start && currentTime <= range.end) {
      bufferAheadSeconds = Number((range.end - currentTime).toFixed(3));
      bufferBehindSeconds = Number((currentTime - range.start).toFixed(3));
      if (index + 1 < buffered.length) {
        nextBufferStartSeconds = buffered[index + 1].start;
      }
      break;
    }
    if (currentTime < range.start) {
      nextBufferStartSeconds = range.start;
      break;
    }
  }
  const bufferGapSeconds = Number.isFinite(nextBufferStartSeconds)
    ? Number((nextBufferStartSeconds - currentTime).toFixed(3))
    : null;
  return {
    buffered,
    bufferAheadSeconds,
    bufferBehindSeconds,
    nextBufferStartSeconds,
    bufferGapSeconds
  };
};

export const readPlaybackQuality = (mediaEl) => {
  if (!mediaEl) {
    return {
      droppedFrames: null,
      totalFrames: null
    };
  }
  try {
    if (typeof mediaEl.getVideoPlaybackQuality === 'function') {
      const sample = mediaEl.getVideoPlaybackQuality();
      return {
        droppedFrames: Number.isFinite(sample?.droppedVideoFrames)
          ? sample.droppedVideoFrames
          : (Number.isFinite(sample?.droppedFrames) ? sample.droppedFrames : null),
        totalFrames: Number.isFinite(sample?.totalVideoFrames)
          ? sample.totalVideoFrames
          : (Number.isFinite(sample?.totalFrames) ? sample.totalFrames : null)
      };
    }
  } catch (_) {
    // ignore playback quality errors
  }
  const dropped = Number.isFinite(mediaEl?.webkitDroppedFrameCount)
    ? mediaEl.webkitDroppedFrameCount
    : null;
  const decoded = Number.isFinite(mediaEl?.webkitDecodedFrameCount)
    ? mediaEl.webkitDecodedFrameCount
    : null;
  return {
    droppedFrames: dropped,
    totalFrames: decoded
  };
};

export const buildMediaDiagnostics = (mediaEl) => {
  if (!mediaEl) {
    return EMPTY_MEDIA_DIAGNOSTICS;
  }
  const buffer = computeBufferDiagnostics(mediaEl);
  const quality = readPlaybackQuality(mediaEl);
  return {
    hasElement: true,
    currentTime: Number.isFinite(mediaEl.currentTime) ? Number(mediaEl.currentTime.toFixed(1)) : null,
    readyState: typeof mediaEl.readyState === 'number' ? mediaEl.readyState : null,
    networkState: typeof mediaEl.networkState === 'number' ? mediaEl.networkState : null,
    paused: typeof mediaEl.paused === 'boolean' ? mediaEl.paused : null,
    playbackRate: Number.isFinite(mediaEl.playbackRate) ? Number(mediaEl.playbackRate.toFixed(3)) : null,
    buffered: buffer.buffered,
    bufferAheadSeconds: buffer.bufferAheadSeconds,
    bufferBehindSeconds: buffer.bufferBehindSeconds,
    nextBufferStartSeconds: buffer.nextBufferStartSeconds,
    bufferGapSeconds: buffer.bufferGapSeconds,
    droppedFrames: quality.droppedFrames,
    totalFrames: quality.totalFrames
  };
};

export { EMPTY_MEDIA_DIAGNOSTICS };
```

**Step 2: Verify build**

Run: `cd frontend && npm run build 2>&1 | tail -5`

Expected: Build completes successfully

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/lib/mediaDiagnostics.js
git commit -m "feat(player): extract media diagnostic utilities"
```

---

## Task 2: Enhance PlayerOverlayLoading with Pause Icon

**Files:**
- Modify: `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx`

**Step 1: Add pause icon import**

At line 3, add:

```javascript
import pause from '../../../assets/icons/pause.svg';
```

**Step 2: Add showPauseIcon prop**

Update the component props (around line 9-30) to include:

```javascript
export function PlayerOverlayLoading({
  // ... existing props ...
  showPauseIcon = false,  // NEW
  // ... rest of props ...
}) {
```

**Step 3: Update icon logic**

Around line 250-251, change from always showing spinner to conditional:

```javascript
// Before:
<img
  src={spinner}
  alt=""

// After:
<img
  src={showPauseIcon ? pause : spinner}
  alt=""
```

**Step 4: Update CSS class for pause state**

Around line 233, update the className:

```javascript
// Before:
className="loading-overlay loading"

// After:
className={`loading-overlay ${showPauseIcon ? 'paused' : 'loading'}`}
```

**Step 5: Add PropType**

In the PropTypes section (around line 268-303), add:

```javascript
showPauseIcon: PropTypes.bool,
```

**Step 6: Verify build**

Run: `cd frontend && npm run build 2>&1 | tail -5`

Expected: Build completes successfully

**Step 7: Commit**

```bash
git add frontend/src/modules/Player/components/PlayerOverlayLoading.jsx
git commit -m "feat(player): add pause icon support to PlayerOverlayLoading"
```

---

## Task 3: Add Debug Diagnostics to PlayerOverlayLoading

**Files:**
- Modify: `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx`

**Step 1: Import diagnostic utilities**

At the top of the file, add:

```javascript
import { buildMediaDiagnostics, EMPTY_MEDIA_DIAGNOSTICS } from '../lib/mediaDiagnostics.js';
```

**Step 2: Add debug props**

Add to the destructured props:

```javascript
showDebugDiagnostics = false,
getMediaEl,
```

**Step 3: Add debug diagnostics logic**

After the `normalizedMediaDetails` useMemo (around line 95-112), add:

```javascript
// Debug-only detailed diagnostics (buffer, dropped frames)
const debugEnabled = showDebugDiagnostics ||
  (typeof window !== 'undefined' && window.PLAYER_DEBUG_OVERLAY);

const [detailedDiagnostics, setDetailedDiagnostics] = useState(EMPTY_MEDIA_DIAGNOSTICS);

useEffect(() => {
  if (!debugEnabled || typeof getMediaEl !== 'function' || !isVisible) {
    return () => {};
  }

  const readDiagnostics = () => {
    try {
      const el = getMediaEl();
      if (el) {
        setDetailedDiagnostics(buildMediaDiagnostics(el));
      }
    } catch (_) {
      // ignore diagnostic errors
    }
  };

  readDiagnostics();
  const intervalId = setInterval(readDiagnostics, 1000);
  return () => clearInterval(intervalId);
}, [debugEnabled, getMediaEl, isVisible]);
```

**Step 4: Add useState import if not present**

Ensure `useState` is in the React import:

```javascript
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

**Step 5: Update debug strip to show detailed diagnostics when enabled**

Find the debug summary section and update to show buffer info when debug enabled:

```javascript
const bufferSummary = debugEnabled && detailedDiagnostics.hasElement
  ? `buf:ahead=${detailedDiagnostics.bufferAheadSeconds ?? 'n/a'}s gap=${detailedDiagnostics.bufferGapSeconds ?? 'n/a'}s dropped=${detailedDiagnostics.droppedFrames ?? 'n/a'}`
  : null;
```

**Step 6: Add PropTypes**

```javascript
showDebugDiagnostics: PropTypes.bool,
getMediaEl: PropTypes.func,
```

**Step 7: Verify build**

Run: `cd frontend && npm run build 2>&1 | tail -5`

Expected: Build completes successfully

**Step 8: Commit**

```bash
git add frontend/src/modules/Player/components/PlayerOverlayLoading.jsx
git commit -m "feat(player): add debug-only diagnostics to PlayerOverlayLoading"
```

---

## Task 4: Remove LoadingOverlay from VideoPlayer

**Files:**
- Modify: `frontend/src/modules/Player/components/VideoPlayer.jsx`

**Step 1: Remove LoadingOverlay import**

Find and delete the import (around line 6-10):

```javascript
// DELETE this line:
import { LoadingOverlay } from './LoadingOverlay.jsx';
```

**Step 2: Remove LoadingOverlay render**

Find and delete lines 226-249 (the LoadingOverlay render block):

```javascript
// DELETE this entire block:
{((seconds === 0 && isPaused) || isStalled || isSeeking || isAdapting) && (
  <LoadingOverlay
    seconds={seconds}
    isPaused={isPaused}
    fetchVideoInfo={fetchVideoInfo}
    stalled={isStalled}
    initialStart={media.seconds || 0}
    plexId={plexIdValue}
    message={isAdapting ? adaptMessage : undefined}
    debugContext={{
      scope: 'video',
      mediaType: media?.media_type,
      title,
      show,
      season,
      url: media_url,
      media_key: media?.media_key || media?.key || media?.plex,
      isDash,
      shader,
      stallState
    }}
    getMediaEl={getMediaEl}
  />
)}
```

**Step 3: Verify build**

Run: `cd frontend && npm run build 2>&1 | tail -5`

Expected: Build completes successfully

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/components/VideoPlayer.jsx
git commit -m "refactor(player): remove duplicate LoadingOverlay from VideoPlayer"
```

---

## Task 5: Delete LoadingOverlay.jsx

**Files:**
- Delete: `frontend/src/modules/Player/components/LoadingOverlay.jsx`

**Step 1: Verify no other imports**

Run: `grep -r "LoadingOverlay" frontend/src --include="*.jsx" --include="*.js" | grep -v "PlayerOverlayLoading"`

Expected: No results (no other files import LoadingOverlay)

**Step 2: Delete the file**

```bash
rm frontend/src/modules/Player/components/LoadingOverlay.jsx
```

**Step 3: Verify build**

Run: `cd frontend && npm run build 2>&1 | tail -5`

Expected: Build completes successfully

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor(player): delete obsolete LoadingOverlay component"
```

---

## Task 6: Run Verification Tests

**Step 1: Run video playback test**

Run: `npx playwright test tests/runtime/player/video-playback.runtime.test.mjs --reporter=list`

Expected: 2 tests pass

**Step 2: Run simple video playback test**

Run: `npx playwright test tests/runtime/fitness-multiuser/simple-video-playback.runtime.test.mjs --reporter=list`

Expected: 3 tests pass

**Step 3: Final build verification**

Run: `cd frontend && npm run build`

Expected: Build completes with no errors

---

## Summary

After completing all tasks:

1. **Single overlay component** - PlayerOverlayLoading handles all overlay needs
2. **Diagnostic utilities extracted** - Available for debug mode
3. **Pause icon support** - Shows pause icon when user-paused
4. **Debug diagnostics** - Buffer/frame info available via prop or window flag
5. **~400 lines removed** - LoadingOverlay.jsx deleted

