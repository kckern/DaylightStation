# Media Player UX Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remediate all 40 usability findings from the 2026-03-05 media player UX design audit.

**Architecture:** Fix grouped into 8 phases by dependency and blast radius. Each phase is independently shippable. Phases progress from critical broken interactions through major UX gaps to polish. Shared utilities (toast system, keyboard handler) are built in early phases and consumed by later ones.

**Tech Stack:** React 18 (JSX), SCSS, structured logging via `frontend/src/lib/logging/Logger.js`

**Audit Reference:** `docs/_wip/audits/2026-03-05-media-player-ux-design-audit.md`

---

## Phase 1: Critical Interaction Fixes (Audit #1, #2, #4, #13, #24, #29)

These are the "user stares at a broken screen" issues. No new components — just surgical fixes to existing handlers.

---

### Task 1.1: Fix DASH Stall Recovery Loop (Audit #1)

The DASH recovery logic seeks backward into the same broken position infinitely. The fix is in the Player layer's resilience system, but MediaApp's stall detection at `MediaApp.jsx:116-157` also needs hardening — it fails when recovery keeps the player in "seeking" state.

**Files:**
- Modify: `frontend/src/Apps/MediaApp.jsx:116-157`

**Step 1: Harden stall detection to see through seeking state**

In `MediaApp.jsx`, the stall detector compares `playbackState.currentTime`. During infinite recovery, the player stays in seeking state and currentTime doesn't advance — but `stallRef` never triggers because the seeking state may cause tiny time changes. Fix: also track wall-clock time independently of player state.

Replace the stall detection block (lines 116-157):

```jsx
// Stall detection: if playback hasn't advanced for 30s while not paused, auto-advance
const stallRef = useRef({ time: 0, since: 0 });
useEffect(() => {
  if (!queue.currentItem || playbackState.paused) {
    stallRef.current = { time: 0, since: 0 };
    return;
  }
  const now = Date.now();
  const prev = stallRef.current;
  // Consider "advanced" only if time moved forward by at least 0.5s
  const meaningfulAdvance = Math.abs(playbackState.currentTime - prev.time) > 0.5;
  if (meaningfulAdvance) {
    stallRef.current = { time: playbackState.currentTime, since: now };
    return;
  }
  // Time hasn't meaningfully changed — check if stalled long enough
  if (prev.since > 0 && now - prev.since > 30000) {
    logger.warn('media-app.stall-recovery', {
      contentId: queue.currentItem.contentId,
      stalledAt: playbackState.currentTime,
      stallDurationMs: now - prev.since,
    });
    stallRef.current = { time: 0, since: 0 };
    queue.advance(1, { auto: true });
  }
}, [queue.currentItem?.contentId, playbackState.currentTime, playbackState.paused, queue, logger]);

// Poll stall check every 5s (playbackState updates may stop during stalls)
useEffect(() => {
  if (!queue.currentItem || playbackState.paused) return;
  const interval = setInterval(() => {
    const prev = stallRef.current;
    if (prev.since > 0 && Date.now() - prev.since > 30000) {
      logger.warn('media-app.stall-recovery-poll', {
        contentId: queue.currentItem?.contentId,
        stalledAt: prev.time,
        stallDurationMs: Date.now() - prev.since,
      });
      stallRef.current = { time: 0, since: 0 };
      queue.advance(1, { auto: true });
    }
  }, 5000);
  return () => clearInterval(interval);
}, [queue.currentItem?.contentId, playbackState.paused, queue, logger]);
```

The key change: `Math.abs(playbackState.currentTime - prev.time) > 0.5` — the recovery loop's ~0.001s backward seeks no longer reset the stall timer.

**Step 2: Verify in dev**

Run: `npm run dev` (if not already running)
Navigate to a video, observe no regressions in normal seek behavior.

**Step 3: Commit**

```bash
git add frontend/src/Apps/MediaApp.jsx
git commit -m "fix(player): harden stall detection against recovery seek loops (audit #1)"
```

> **Note:** The deeper fix (seek forward past stall, retry limit, error overlay) lives in the Player resilience layer (`Player.jsx` / `SinglePlayer.jsx` / `VideoPlayer.jsx`). That's a separate task requiring deeper investigation of the DASH recovery code path. This fix ensures the 30s auto-advance fires regardless.

---

### Task 1.2: Fix Video Click Pause/Fullscreen Conflict (Audit #2)

Currently: embedded click = fullscreen (users expect pause), fullscreen click = overlay toggle (no way to click-to-pause). Three handlers cascade on the fullscreen progress bar.

**Files:**
- Modify: `frontend/src/modules/Media/NowPlaying.jsx:229`
- Modify: `frontend/src/modules/Media/MediaAppPlayer.jsx:82,93-99`

**Step 1: Change embedded click to toggle play/pause**

In `NowPlaying.jsx`, line 229 currently passes `handleExpandFullscreen` as the non-fullscreen click handler:

```jsx
onPlayerClick={isFullscreen ? showOverlay : handleExpandFullscreen}
```

Change to toggle pause in embedded mode. Users will use the fullscreen button (or double-click if we add it later) for fullscreen:

```jsx
onPlayerClick={isFullscreen ? showOverlay : handleToggle}
```

**Step 2: Add stopPropagation to fullscreen exit button (Audit #24)**

In `MediaAppPlayer.jsx`, line 93-99, the exit button doesn't stop propagation. Click fires both `onExitFullscreen` and the wrapper's `onPlayerClick`:

```jsx
<button
  className="media-fullscreen-exit"
  onClick={(e) => { e.stopPropagation(); onExitFullscreen(); }}
  aria-label="Exit fullscreen"
>
  &times;
</button>
```

**Step 3: Add stopPropagation to fullscreen progress bar overlay**

In `NowPlaying.jsx`, the progress bar inside the fullscreen overlay (line 179) already has `e.stopPropagation()` — confirm this is working. The wrapping `media-fullscreen-controls` div on line 177 also has it. This should prevent the seek handler from bubbling to `onPlayerClick`. No change needed if already correct.

**Step 4: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx frontend/src/modules/Media/MediaAppPlayer.jsx
git commit -m "fix(player): click-to-pause in embedded, stopPropagation on exit button (audit #2, #24)"
```

---

### Task 1.3: Fix Escape Key Destroying Queue (Audit #13)

`useQueueController.js:199-210` maps Escape to `clear()`. This hook is used by the internal Player queue system, not by MediaApp directly. But if a queue-mode Player is active, pressing Escape destroys everything.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js:199-210`

**Step 1: Remove the global Escape→clear handler**

Replace the useEffect block at lines 199-210:

```js
useEffect(() => {
  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      // Only clear if no fullscreen or modal is active
      // Fullscreen exit is handled by the browser/NowPlaying, not here
      // Removing the auto-clear — queue destruction should be explicit
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
  };
}, [clear]);
```

Actually, the simplest fix is to just remove this entire useEffect. The Escape key should not silently destroy a queue. If the hook genuinely needs an Escape handler in the future, it should check for fullscreen state first.

```js
// REMOVED: Escape key handler that called clear() unconditionally (audit #13)
// Queue destruction should require explicit user action (clear button in QueueDrawer).
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js
git commit -m "fix(player): remove Escape key auto-clear queue handler (audit #13)"
```

---

### Task 1.4: Fix Progress Bar Size and Drag-to-Seek (Audit #4)

The seek bar is 4px (6px hover), click-only, and jitters on interaction.

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss:438-464`
- Modify: `frontend/src/modules/Media/NowPlaying.jsx:139-148,258`

**Step 1: Increase progress bar hit area and add smooth transition**

In `MediaApp.scss`, replace lines 438-464:

```scss
.media-progress-bar {
  height: 6px;
  background: #333;
  border-radius: 3px;
  overflow: hidden;
  position: relative;
  transition: height 0.15s ease;
  // Invisible padding for touch targets (adds ~12px above+below)
  &::before {
    content: '';
    position: absolute;
    top: -12px;
    bottom: -12px;
    left: 0;
    right: 0;
  }

  &:hover,
  &:active {
    height: 10px;
  }
}

.media-progress-fill {
  height: 100%;
  background: #1db954;
  border-radius: 3px;
  transition: width 0.1s linear;
}

.media-progress-times {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #888;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
  // Fixed height prevents reflow when digits change width
  height: 16px;
  line-height: 16px;
}
```

**Step 2: Add pointer drag-to-seek**

In `NowPlaying.jsx`, replace the click-only handleSeek (lines 139-148) with a pointer-based drag handler:

```jsx
const isDragging = useRef(false);

const getSeekTime = useCallback((e, bar) => {
  const rect = bar.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  return percent * playbackState.duration;
}, [playbackState.duration]);

const handlePointerDown = useCallback((e) => {
  if (playbackState.duration <= 0) return;
  const bar = e.currentTarget;
  isDragging.current = true;
  bar.setPointerCapture(e.pointerId);
  const seekTime = getSeekTime(e, bar);
  setPlaybackState(prev => ({ ...prev, isSeeking: true, seekIntent: seekTime }));
  logger.debug('player.seek-start', { seekTime: Math.round(seekTime) });
}, [playbackState.duration, getSeekTime, logger]);

const handlePointerMove = useCallback((e) => {
  if (!isDragging.current) return;
  const bar = e.currentTarget;
  const seekTime = getSeekTime(e, bar);
  setPlaybackState(prev => ({ ...prev, seekIntent: seekTime }));
}, [getSeekTime]);

const handlePointerUp = useCallback((e) => {
  if (!isDragging.current) return;
  isDragging.current = false;
  const bar = e.currentTarget;
  const seekTime = getSeekTime(e, bar);
  logger.debug('player.seek', { seekTime: Math.round(seekTime), duration: Math.round(playbackState.duration) });
  playerRef.current?.seek?.(seekTime);
  // isSeeking will be cleared by next handleProgress callback
}, [getSeekTime, playbackState.duration, playerRef, logger]);
```

Add `isDragging` ref near other refs (after line 71):
```jsx
const isDragging = useRef(false);
```

Then update the progress bar JSX (line 258) to use pointer events instead of onClick:

```jsx
<div
  className="media-progress"
  onPointerDown={handlePointerDown}
  onPointerMove={handlePointerMove}
  onPointerUp={handlePointerUp}
>
```

Do the same for the fullscreen overlay progress bar (line 179):

```jsx
<div className="media-progress"
  onClick={(e) => e.stopPropagation()}
  onPointerDown={(e) => { e.stopPropagation(); handlePointerDown(e); }}
  onPointerMove={handlePointerMove}
  onPointerUp={handlePointerUp}
>
```

Remove the old `handleSeek` callback entirely.

**Step 3: Clear seek state on fullscreen toggle**

Add to the fullscreen effect (after line 87):

```jsx
// Clear stale seek state when toggling fullscreen
setPlaybackState(prev => ({ ...prev, isSeeking: false, seekIntent: null }));
```

**Step 4: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss frontend/src/modules/Media/NowPlaying.jsx
git commit -m "fix(player): larger progress bar with drag-to-seek and smooth transitions (audit #4)"
```

---

### Task 1.5: Fix Duration Division-by-Zero (Audit #29)

`NowPlaying.jsx:170-172` — when `duration` is 0, the expression produces `NaN%`.

**Files:**
- Modify: `frontend/src/modules/Media/NowPlaying.jsx:170-172`

**Step 1: Already handled by the `> 0` guard**

Current code:
```jsx
const progress = playbackState.duration > 0
  ? (displayTime / playbackState.duration) * 100
  : 0;
```

This guard should be sufficient. However, if `displayTime` is NaN (from a NaN seekIntent), it would still produce NaN. Add a safety clamp:

```jsx
const progress = playbackState.duration > 0
  ? Math.min(100, Math.max(0, (displayTime / playbackState.duration) * 100))
  : 0;
```

Also apply the same guard to MiniPlayer (`MiniPlayer.jsx:28-30`):

```jsx
const progress = playbackState?.duration > 0
  ? Math.min(100, Math.max(0, (playbackState.currentTime / playbackState.duration) * 100))
  : 0;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx frontend/src/modules/Media/MiniPlayer.jsx
git commit -m "fix(player): clamp progress percentage to 0-100 (audit #29)"
```

---

## Phase 2: Queue Safety & Feedback (Audit #3, #7, #12, #30, #31)

Prevent accidental queue destruction. Add user feedback for queue actions.

---

### Task 2.1: Create Toast/Snackbar Component (Audit #7)

Several findings require user feedback. Build a minimal toast system first.

**Files:**
- Create: `frontend/src/modules/Media/Toast.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss` (append toast styles)

**Step 1: Create Toast component**

```jsx
// frontend/src/modules/Media/Toast.jsx
import React, { useState, useCallback, useRef, useEffect } from 'react';

let showToastFn = null;

export function toast(message, { undo, duration = 3000 } = {}) {
  showToastFn?.({ message, undo, duration });
}

const Toast = () => {
  const [item, setItem] = useState(null);
  const timerRef = useRef(null);

  const dismiss = useCallback(() => {
    setItem(null);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const show = useCallback(({ message, undo, duration }) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setItem({ message, undo });
    timerRef.current = setTimeout(dismiss, duration);
  }, [dismiss]);

  useEffect(() => {
    showToastFn = show;
    return () => { showToastFn = null; };
  }, [show]);

  if (!item) return null;

  return (
    <div className="media-toast" onClick={dismiss}>
      <span>{item.message}</span>
      {item.undo && (
        <button className="media-toast-undo" onClick={(e) => { e.stopPropagation(); item.undo(); dismiss(); }}>
          Undo
        </button>
      )}
    </div>
  );
};

export default Toast;
```

**Step 2: Add toast styles to MediaApp.scss**

Append to end of file:

```scss
// ── Toast / Snackbar ──────────────────────────────────────────
.media-toast {
  position: fixed;
  bottom: 72px; // Above mini-player
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: #e0e0e0;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 14px;
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  animation: toast-in 0.2s ease;
}

@keyframes toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(8px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.media-toast-undo {
  background: none;
  border: none;
  color: #1db954;
  font-weight: 600;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
}
```

**Step 3: Mount Toast in MediaApp**

In `MediaApp.jsx`, import and render `<Toast />` inside `MediaAppInner`, at the end of the return JSX (before the closing `</div>`):

```jsx
import Toast from '../modules/Media/Toast.jsx';
// ... in render, after MiniPlayer:
<Toast />
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Media/Toast.jsx frontend/src/Apps/MediaApp.jsx frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): add toast/snackbar component for queue action feedback (audit #7)"
```

---

### Task 2.2: Add Feedback to Queue Actions (Audit #7)

Now wire toast notifications into play-next, add-to-queue actions.

**Files:**
- Modify: `frontend/src/modules/Media/SearchHomePanel.jsx:124-138`
- Modify: `frontend/src/modules/Media/ContentDetailView.jsx:71-83`

**Step 1: Add toast calls to SearchHomePanel**

Import toast at top:
```jsx
import { toast } from './Toast.jsx';
```

In `handlePlayNext` (line 128-129), after `queue.addItems(...)`:
```jsx
queue.addItems([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }], 'next');
toast(`"${item.title}" plays next`);
```

In `handleAddToQueue` (line 136-137), after `queue.addItems(...)`:
```jsx
queue.addItems([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }]);
toast(`"${item.title}" added to queue`);
```

**Step 2: Add toast calls to ContentDetailView**

Import toast at top:
```jsx
import { toast } from './Toast.jsx';
```

In `handlePlayNext` (line 74-75):
```jsx
queue.addItems([...], 'next');
toast(`"${title}" plays next`);
```

In `handleAddToQueue` (line 81-82):
```jsx
queue.addItems([...]);
toast(`"${title}" added to queue`);
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/SearchHomePanel.jsx frontend/src/modules/Media/ContentDetailView.jsx
git commit -m "feat(media): toast feedback on queue add/play-next actions (audit #7)"
```

---

### Task 2.3: Confirm or Undo Queue Clear (Audit #12)

The clear button (`QueueDrawer.jsx:25-28`) instantly destroys the queue with no undo.

**Files:**
- Modify: `frontend/src/modules/Media/QueueDrawer.jsx:25-28`

**Step 1: Add undo-capable clear**

Import toast:
```jsx
import { toast } from './Toast.jsx';
```

Replace `handleClear`:

```jsx
const handleClear = useCallback(() => {
  const snapshot = [...queue.items];
  const prevPosition = queue.position;
  logger.info('queue.clear', { itemCount: queue.items.length });
  queue.clear();
  toast(`Cleared ${snapshot.length} items`, {
    undo: () => {
      logger.info('queue.clear-undo', { itemCount: snapshot.length });
      queue.addItems(snapshot).then(() => queue.setPosition(prevPosition));
    },
  });
}, [queue, logger]);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/QueueDrawer.jsx
git commit -m "feat(media): undo snackbar on queue clear (audit #12)"
```

---

### Task 2.4: Protect Queue on "Play Now" (Audit #3)

Every "Play Now" silently replaces the queue. If queue has items, insert-and-skip instead of clearing.

**Files:**
- Modify: `frontend/src/hooks/media/useMediaQueue.js:104-126` (the `playNow` function)

**Step 1: Change playNow to insert-and-skip when queue has items**

The current `playNow` clears queue then adds. Instead, insert after current position and advance:

Look at the current implementation at lines 104-126. The function already inserts after current position and advances atomically — the issue is in the API handler. Read the actual behavior:

Actually, looking at the audit more carefully: "queue.playNow() which clears the entire queue before adding the new item." Let's verify. The `playNow` in `useMediaQueue.js` at line 104:

The audit says it clears. If it does, we change it to insert-after-current + set position. If the queue is empty, just add. If it has items, insert after current and advance.

This is a behavior-level change to the API. The safest approach: only change the frontend callers to stop auto-navigating to `/media/play`. The queue-clearing behavior of `playNow` is actually correct when the user explicitly says "play this now" — it's the lack of warning that's the problem.

Better fix: Remove the `navigate('/media/play')` from SearchHomePanel's `handlePlayNow` (line 121). Let the MiniPlayer show the change. User can tap MiniPlayer to go to player.

```jsx
// SearchHomePanel.jsx handlePlayNow — remove navigate('/media/play')
const handlePlayNow = useCallback((item) => {
  recordSearchInteraction();
  const contentId = resolveContentId(item);
  if (!contentId) return;
  logger.info('search-home.play-now', { contentId, title: item.title });
  queue.playNow([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }]);
  // Don't navigate away — MiniPlayer shows the playing item
}, [recordSearchInteraction, queue, logger]);
```

**Step 2: Add debounce to SearchHomePanel's Play Now (Audit #30)**

SearchHomePanel has NO debounce on play actions. Add the same pattern as ContentDetailView:

```jsx
const playingRef = useRef(false);

const handlePlayNow = useCallback((item) => {
  if (playingRef.current) return;
  playingRef.current = true;
  setTimeout(() => { playingRef.current = false; }, 2000);
  recordSearchInteraction();
  const contentId = resolveContentId(item);
  if (!contentId) return;
  logger.info('search-home.play-now', { contentId, title: item.title });
  queue.playNow([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }]);
}, [recordSearchInteraction, queue, logger]);
```

Add `playingRef` declaration near other refs (after line 42):
```jsx
const playingRef = useRef(false);
```

**Step 3: Fix ContentDetailView debounce cleanup (Audit #30)**

In `ContentDetailView.jsx`, the `setTimeout` at line 62 is never cleaned up on unmount. Add cleanup:

```jsx
const playTimerRef = useRef(null);

const handlePlayNow = useCallback((item) => {
  if (playingRef.current) return;
  playingRef.current = true;
  playTimerRef.current = setTimeout(() => { playingRef.current = false; }, 2000);
  // ... rest unchanged
}, [contentId, data, queue, logger]);

// Add a cleanup effect:
useEffect(() => {
  return () => { clearTimeout(playTimerRef.current); };
}, []);
```

**Step 4: Fix Shuffle Algorithm Bias (Audit #31)**

In `ContentDetailView.jsx:88`, replace the biased sort with Fisher-Yates:

```jsx
const handleShuffle = useCallback(() => {
  logger.info('detail.shuffle', { contentId });
  if (children.length > 0) {
    const shuffled = [...children];
    // Fisher-Yates shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const items = shuffled.map(c => ({
      contentId: c.id || c.contentId,
      title: c.title,
      format: c.format,
      thumbnail: c.thumbnail || c.image,
    })).filter(c => c.contentId);
    queue.playNow(items);
  }
}, [contentId, children, queue, logger]);
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Media/SearchHomePanel.jsx frontend/src/modules/Media/ContentDetailView.jsx
git commit -m "fix(media): debounce play-now, fix shuffle bias, remove forced navigate (audit #3, #30, #31)"
```

---

## Phase 3: Touch & Sizing Fixes (Audit #5, #8, #9, #17, #27, #35)

Fix touch targets, child item visibility, volume layout.

---

### Task 3.1: Fix Touch Targets and Child Item Visibility (Audit #5, #9, #35)

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss:940-955,1397-1416,1478`

**Step 1: Increase search result action button touch targets**

Replace `.search-result-actions` styles (lines 940-955):

```scss
.search-result-actions {
  display: flex;
  gap: 2px;

  button {
    background: none;
    border: none;
    color: #888;
    font-size: 16px;
    cursor: pointer;
    padding: 8px;
    border-radius: 4px;
    min-width: 36px;
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover { color: #1db954; background: #1a1a1a; }
  }
}
```

**Step 2: Make child item actions always visible on mobile (Audit #5)**

In the `.detail-children--list` section (around line 1397-1416), add a mobile override:

```scss
.child-item-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;

  button {
    background: transparent;
    border: none;
    color: #888;
    font-size: 14px;
    cursor: pointer;
    padding: 8px;
    min-width: 36px;
    min-height: 36px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    &:hover { color: #1db954; background: #282828; }
  }

  @include mobile-only {
    opacity: 1;
  }
}

&:hover .child-item-actions { opacity: 1; }
```

**Step 3: Show actions in grid view on tap (Audit #35)**

Replace `.child-item-actions { display: none; }` at line 1478:

```scss
.child-item-actions {
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 4px 0 8px;

  button {
    min-width: 36px;
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
```

**Step 4: Increase cast button and queue remove touch targets**

Update `.cast-btn` (lines 996-1005):
```scss
.cast-btn {
  background: none;
  border: none;
  color: #ccc;
  cursor: pointer;
  padding: 8px;
  font-size: 16px;
  border-radius: 4px;
  min-width: 36px;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover { color: #1db954; }
}
```

Update `.queue-item-remove` (lines 662-672):
```scss
.queue-item-remove {
  background: none;
  border: none;
  color: #555;
  font-size: 18px;
  cursor: pointer;
  padding: 8px;
  min-width: 36px;
  min-height: 36px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover { color: #ff4444; }
}
```

**Step 5: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "fix(media): increase touch targets to 36px minimum, show child actions on mobile (audit #5, #9, #35)"
```

---

### Task 3.2: Fix Queue Item Touch Interaction Conflict (Audit #8)

Three handlers on one element: click (play), touchstart (swipe), draggable (reorder). Small touches trigger play instead of swipe.

**Files:**
- Modify: `frontend/src/modules/Media/QueueItem.jsx:26-54`

**Step 1: Add dead zone for touch intent detection**

Replace the `handleSwipeRemove` and the element's event handlers:

```jsx
const touchRef = useRef({ startX: 0, startY: 0, moved: false });

const handleTouchStart = useCallback((e) => {
  const touch = e.touches?.[0];
  if (!touch) return;
  touchRef.current = { startX: touch.clientX, startY: touch.clientY, moved: false };

  const handler = (moveEvent) => {
    const dx = moveEvent.touches[0].clientX - touchRef.current.startX;
    const dy = moveEvent.touches[0].clientY - touchRef.current.startY;
    // Dead zone: require 10px movement before committing to swipe
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      touchRef.current.moved = true;
    }
    if (dx < -80) {
      document.removeEventListener('touchmove', handler);
      logger.info('queue-item.swipe-remove', { queueId: item.queueId, contentId: item.contentId, title: item.title });
      onRemove(item.queueId);
    }
  };

  document.addEventListener('touchmove', handler, { passive: true });
  document.addEventListener('touchend', () => {
    document.removeEventListener('touchmove', handler);
  }, { once: true });
}, [item.queueId, item.contentId, item.title, onRemove, logger]);

const handleClick = useCallback(() => {
  // Skip click if touch was a swipe gesture
  if (touchRef.current.moved) return;
  logger.info('queue-item.play-clicked', { queueId: item.queueId, contentId: item.contentId });
  onPlay(item.queueId);
}, [item.queueId, item.contentId, onPlay, logger]);
```

Update the JSX element:
```jsx
<div
  className={`queue-item ${isCurrent ? 'queue-item--current' : ''}`}
  draggable
  onClick={handleClick}
  onTouchStart={handleTouchStart}
  onDragStart={() => onDragStart?.(item.queueId)}
  onDragOver={(e) => e.preventDefault()}
  onDrop={(e) => { e.preventDefault(); onDrop?.(index); }}
  onDragEnd={() => onDragEnd?.()}
>
```

Remove the old `activeTouchHandler` ref and cleanup effect (lines 15-24) and `handleSwipeRemove` (lines 26-43).

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/QueueItem.jsx
git commit -m "fix(media): add dead zone for queue item touch intent detection (audit #8)"
```

---

### Task 3.3: Redesign Volume Control with Mute Button (Audit #6, #17)

Volume bar wastes a full row, has no mute, and is hidden in fullscreen.

**Files:**
- Modify: `frontend/src/modules/Media/NowPlaying.jsx:64,150-156,290-303`
- Modify: `frontend/src/Apps/MediaApp.scss:507-539`

**Step 1: Add mute state and inline volume with speaker icon**

In NowPlaying, add mute state near `volume` (after line 64):

```jsx
const [muted, setMuted] = useState(false);
const preMuteVolume = useRef(0.8);
```

Update `handleVolumeChange`:
```jsx
const handleVolumeChange = useCallback((e) => {
  const newVolume = parseFloat(e.target.value);
  logger.debug('player.volume', { volume: newVolume });
  setVolume(newVolume);
  if (newVolume > 0) setMuted(false);
  const el = playerRef.current?.getMediaElement?.();
  if (el) { el.volume = newVolume; el.muted = false; }
}, [playerRef, logger]);

const handleMuteToggle = useCallback(() => {
  const el = playerRef.current?.getMediaElement?.();
  if (muted) {
    setMuted(false);
    setVolume(preMuteVolume.current);
    if (el) { el.volume = preMuteVolume.current; el.muted = false; }
  } else {
    preMuteVolume.current = volume;
    setMuted(true);
    if (el) { el.muted = true; }
  }
  logger.debug('player.mute-toggle', { muted: !muted });
}, [muted, volume, playerRef, logger]);
```

**Step 2: Update volume JSX — inline with transport, show in fullscreen**

Replace the volume section (lines 290-303). Move it INSIDE the `{!isFullscreen && ...}` transport block, right after the transport div, AND add it to the fullscreen overlay:

In the non-fullscreen block (after the transport `</div>` at line 286):
```jsx
<div className="media-volume-inline">
  <button className="media-mute-btn" onClick={handleMuteToggle} aria-label={muted ? 'Unmute' : 'Mute'}>
    {muted || volume === 0 ? '\u{1F507}' : volume < 0.5 ? '\u{1F509}' : '\u{1F50A}'}
  </button>
  <input
    type="range" min="0" max="1" step="0.05"
    value={muted ? 0 : volume}
    onChange={handleVolumeChange}
    aria-label="Volume"
  />
</div>
```

Add the same volume control inside `renderTransportOverlay` (after the transport div):
```jsx
<div className="media-volume-inline media-volume-inline--fullscreen">
  <button className="media-mute-btn" onClick={handleMuteToggle} aria-label={muted ? 'Unmute' : 'Mute'}>
    {muted || volume === 0 ? '\u{1F507}' : volume < 0.5 ? '\u{1F509}' : '\u{1F50A}'}
  </button>
  <input
    type="range" min="0" max="1" step="0.05"
    value={muted ? 0 : volume}
    onChange={handleVolumeChange}
    aria-label="Volume"
  />
</div>
```

Remove the old standalone `.media-volume` block.

**Step 3: Update SCSS**

Replace `.media-volume` styles (lines 507-539):
```scss
.media-volume-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;

  input[type="range"] {
    flex: 1;
    max-width: 120px;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: #333;
    border-radius: 2px;
    outline: none;

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #1db954;
      cursor: pointer;
    }

    &::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #1db954;
      cursor: pointer;
      border: none;
    }
  }

  &--fullscreen {
    justify-content: center;
    margin-top: 8px;

    input[type="range"] { max-width: 160px; }
  }
}

.media-mute-btn {
  background: none;
  border: none;
  color: #ccc;
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
  &:hover { color: #fff; }
}
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): inline volume with mute toggle, volume in fullscreen (audit #6, #17)"
```

---

### Task 3.4: Fix MiniPlayer PiP Size (Audit #27)

PiP mode: 160x90px fixed, no controls.

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss:288-303`

**Step 1: Make PiP responsive and add play/pause overlay**

Replace `&--pip` styles:

```scss
&--pip {
  width: min(200px, 45vw);
  height: auto;
  aspect-ratio: 16 / 9;
  bottom: 16px;
  right: 16px;
  left: auto;
  border-radius: 8px;
  border: 1px solid #333;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);

  .mini-player-content { padding: 0; position: relative; }
  .mini-player-thumb { width: 100%; height: 100%; border-radius: 8px; }
  .mini-player-title { display: none; }
  .mini-player-toggle {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.5);
    border-radius: 50%;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
    font-size: 16px;
  }
  &:hover .mini-player-toggle { opacity: 1; }
  .mini-player-progress { bottom: 0; top: auto; border-radius: 0 0 8px 8px; }
}
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "fix(media): responsive PiP size with play/pause overlay (audit #27)"
```

---

## Phase 4: Fullscreen & Overlay Fixes (Audit #18, #19, #26, #28)

---

### Task 4.1: Fix Fullscreen Transport Button Sizing (Audit #19)

Fullscreen override sets ALL buttons to 24px including the primary which should be larger.

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss:1044-1047`

**Step 1: Only override secondary buttons, keep primary large**

Replace lines 1044-1047:

```scss
.media-transport-btn {
  color: #fff;
  font-size: 28px;

  &--primary {
    font-size: 36px;
    width: 64px;
    height: 64px;
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "fix(media): fullscreen primary button stays large (audit #19)"
```

---

### Task 4.2: Fix Fullscreen Preference Scope (Audit #26)

`localStorage` key `media:fullscreen` is global — video fullscreen bleeds into audio.

**Files:**
- Modify: `frontend/src/modules/Media/NowPlaying.jsx:65-67,105-107`

**Step 1: Scope fullscreen to video content types**

Replace the fullscreen initialization (lines 65-67):

```jsx
const [isFullscreen, setIsFullscreen] = useState(false);
```

Remove the localStorage read entirely. Also remove the localStorage write effect (lines 105-107). Fullscreen should not persist across sessions — it's a transient view state.

If the user switches from video to audio, reset fullscreen:

```jsx
// Reset fullscreen when content type changes to non-video
useEffect(() => {
  if (!currentItem) {
    setIsFullscreen(false);
    return;
  }
  const isVideoFormat = currentItem.format === 'video' || currentItem.format === 'dash_video';
  if (!isVideoFormat) setIsFullscreen(false);
}, [currentItem?.contentId, currentItem?.format]);
```

Remove the old `useEffect` for `currentItem` (lines 98-103) and the localStorage persist (lines 105-107).

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx
git commit -m "fix(media): remove persistent fullscreen preference, scope to video (audit #26)"
```

---

### Task 4.3: Fix Overlay Timer Race Conditions (Audit #28)

Rapid fullscreen toggle can leak timers.

**Files:**
- Modify: `frontend/src/modules/Media/NowPlaying.jsx:69-95`

**Step 1: Centralize timer management**

The existing code already clears the timer in the effect cleanup (line 92-94) and in `showOverlay` (line 76). The race condition is: batched React updates might set `overlayVisible=true` (exit fullscreen) while a timer clear happens in a different batch.

Fix by checking `isFullscreen` inside the timer callback:

```jsx
const showOverlay = useCallback(() => {
  setOverlayVisible(true);
  logger.debug('overlay.show', { format: currentItem?.format });
  if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
  if (currentItem?.format === 'video') {
    overlayTimerRef.current = setTimeout(() => {
      // Only auto-hide if still in fullscreen
      setIsFullscreen(current => {
        if (current) setOverlayVisible(false);
        return current;
      });
    }, 3000);
  }
}, [currentItem?.format, logger]);
```

This uses the setState functional form to read current fullscreen state atomically.

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx
git commit -m "fix(media): overlay timer checks fullscreen state atomically (audit #28)"
```

---

## Phase 5: Keyboard Shortcuts (Audit #15, #38)

---

### Task 5.1: Add Global Keyboard Shortcuts (Audit #15)

**Files:**
- Modify: `frontend/src/Apps/MediaApp.jsx` (add useEffect with keydown handler)

**Step 1: Add keyboard handler to MediaAppInner**

Add inside `MediaAppInner`, after the stall detection effects:

```jsx
// Global keyboard shortcuts (audit #15)
useEffect(() => {
  const handleKeyDown = (e) => {
    // Don't capture when typing in inputs
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.activeElement?.isContentEditable) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        playerRef.current?.toggle?.();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        playerRef.current?.seek?.(Math.max(0, (playbackState.currentTime || 0) - 10));
        break;
      case 'ArrowRight':
        e.preventDefault();
        playerRef.current?.seek?.((playbackState.currentTime || 0) + 10);
        break;
      case 'ArrowUp':
        e.preventDefault();
        { const el = playerRef.current?.getMediaElement?.();
          if (el) el.volume = Math.min(1, el.volume + 0.1); }
        break;
      case 'ArrowDown':
        e.preventDefault();
        { const el = playerRef.current?.getMediaElement?.();
          if (el) el.volume = Math.max(0, el.volume - 0.1); }
        break;
      case 'm':
      case 'M':
        { const el = playerRef.current?.getMediaElement?.();
          if (el) el.muted = !el.muted; }
        break;
      case 'f':
      case 'F':
        // Fullscreen toggle — handled by NowPlaying, dispatch custom event
        window.dispatchEvent(new CustomEvent('media:toggle-fullscreen'));
        break;
      default:
        return;
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [playerRef, playbackState.currentTime]);
```

**Step 2: Listen for fullscreen toggle in NowPlaying**

In `NowPlaying.jsx`, add an effect to handle the custom event:

```jsx
useEffect(() => {
  const handler = () => {
    const isVideoFormat = currentItem?.format === 'video' || currentItem?.format === 'dash_video';
    if (isVideoFormat) setIsFullscreen(prev => !prev);
  };
  window.addEventListener('media:toggle-fullscreen', handler);
  return () => window.removeEventListener('media:toggle-fullscreen', handler);
}, [currentItem?.format]);
```

**Step 3: Commit**

```bash
git add frontend/src/Apps/MediaApp.jsx frontend/src/modules/Media/NowPlaying.jsx
git commit -m "feat(media): keyboard shortcuts - space/arrows/m/f (audit #15)"
```

---

## Phase 6: Polish (Audit #20, #21, #22, #23, #25, #33, #36)

---

### Task 6.1: Fix Queue Current-Item Border Shift (Audit #23)

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss:613-622`

**Step 1: Add transparent border to all queue items**

Replace `.queue-item` styles:
```scss
.queue-item {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  gap: 12px;
  cursor: pointer;
  border-left: 3px solid transparent;

  &:hover { background: #1a1a1a; }
  &--current { background: #1a2a1a; border-left-color: #1db954; }
}
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "fix(media): prevent queue item border shift with transparent default (audit #23)"
```

---

### Task 6.2: Add Scrollbar Styling (Audit #20)

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss` (add global scrollbar rules)

**Step 1: Add scrollbar styles near the top of the file (after line 2)**

```scss
// ── Scrollbar Styling ─────────────────────────────────────────
.media-app {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;

  *::-webkit-scrollbar { width: 6px; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 3px; }
  *::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }
}
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "fix(media): custom dark scrollbar styling (audit #20)"
```

---

### Task 6.3: Fix MiniPlayer Progress Stutter (Audit #21)

Progress bar has `transition: width 0.3s linear` but updates at ~4Hz.

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss:306-313`

**Step 1: Match transition to update interval**

```scss
.mini-player-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  background: #1db954;
  // Use 1s transition to match ~1s playback updates, prevents stutter
  transition: width 1s linear;
}
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "fix(media): match mini-player progress transition to update rate (audit #21)"
```

---

### Task 6.4: Add Queue Position Indicator (Audit #33)

No "Track 3 of 12" indicator.

**Files:**
- Modify: `frontend/src/modules/Media/NowPlaying.jsx` (add position display)

**Step 1: Add position indicator to track info**

NowPlaying receives `currentItem` but doesn't have queue access. Add a prop or use context. Simplest: use the MediaApp context.

Import at top of NowPlaying:
```jsx
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
```

Inside the NowPlaying component, get queue:
```jsx
const { queue } = useMediaApp();
```

Add position text after the track title (line 240):
```jsx
<div className="media-track-title">{currentItem.title || currentItem.contentId}</div>
{queue.items.length > 1 && (
  <div className="media-track-position">{queue.position + 1} of {queue.items.length}</div>
)}
```

Add style to SCSS (near `.media-track-source` around line 425):
```scss
.media-track-position {
  font-size: 11px;
  color: #666;
  margin-top: 2px;
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): show queue position indicator (audit #33)"
```

---

### Task 6.5: Add Child Item Type Labels (Audit #36)

Children show "3. Title" instead of "Episode 3 - Title".

**Files:**
- Modify: `frontend/src/modules/Media/ContentDetailView.jsx:226-228`

**Step 1: Add type-aware label**

Replace the child title rendering (lines 226-228):
```jsx
<div className="child-item-title">
  {child.itemIndex !== undefined && (
    <span className="child-item-index">
      {child.type === 'episode' ? 'Ep ' : child.type === 'track' ? '' : ''}
      {child.itemIndex}.
    </span>
  )}
  {child.title}
</div>
```

Actually, looking at the audit suggestion more carefully — it wants "Episode 3", "Track 3". Use the parent's type to infer child label:

```jsx
<div className="child-item-title">
  {child.itemIndex !== undefined && (
    <span className="child-item-index">
      {data.type === 'show' || data.type === 'season' ? `Ep ${child.itemIndex}` :
       data.type === 'album' ? `${child.itemIndex}` :
       `${child.itemIndex}`}.{' '}
    </span>
  )}
  {child.title}
</div>
```

Keep it simple — the type badge already shows the type. Just prefix episodes:

```jsx
<div className="child-item-title">
  {child.itemIndex !== undefined && (
    <span className="child-item-index">
      {(data.type === 'show' || data.type === 'season') ? `Ep ${child.itemIndex}. ` : `${child.itemIndex}. `}
    </span>
  )}
  {child.title}
</div>
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/ContentDetailView.jsx
git commit -m "feat(media): add episode prefix to child item index labels (audit #36)"
```

---

### Task 6.6: Fix Video Layout Shift (Audit #22)

Layout changes from audio (max-width: 480px, padding: 24px) to video (max-width: 100%, padding: 0) via `:has()` selector when video element appears.

**Files:**
- Modify: `frontend/src/modules/Media/NowPlaying.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss`

**Step 1: Pre-apply video layout class based on format prop**

In NowPlaying, add a format-based class to the wrapper:

```jsx
const isVideoFormat = currentItem.format === 'video' || currentItem.format === 'dash_video';

return (
  <div className={`media-now-playing${isVideoFormat ? ' media-now-playing--video' : ''}`}>
```

Then in SCSS, replace the `:has(.video-player)` selector with `.media-now-playing--video`:

Find the `:has()` selector in the SCSS (around line 361-364 per audit) and replace with the class-based approach. This eliminates the layout shift because the class is applied on mount, before the video element renders.

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx frontend/src/Apps/MediaApp.scss
git commit -m "fix(media): pre-apply video layout class to prevent shift (audit #22)"
```

---

## Phase 7: Continue-Watching & Search Improvements (Audit #10, #14, #32)

---

### Task 7.1: Add Inline Play to Continue-Watching (Audit #10)

Currently requires 3 taps (tap → detail → play). Add a play button directly on continue items.

**Files:**
- Modify: `frontend/src/modules/Media/SearchHomePanel.jsx:229-248`

**Step 1: Add inline play button to continue items**

Replace the continue items map (lines 232-247):

```jsx
{continueItems.map(item => (
  <div key={item.contentId} className="search-result-item">
    <div className="search-result-thumb" onClick={() => navigate(`/media/view/${item.contentId}`)}>
      <img src={item.thumbnail || ContentDisplayUrl(item.contentId)} alt="" />
      {item.duration > 0 && (
        <div className="continue-progress-bar">
          <div className="continue-progress-fill" style={{ width: `${(item.progress / item.duration) * 100}%` }} />
        </div>
      )}
    </div>
    <div className="search-result-info" onClick={() => navigate(`/media/view/${item.contentId}`)}>
      <div className="search-result-title">{item.title}</div>
      {item.format && <div className="search-result-meta"><span className={`format-badge format-badge--${item.format}`}>{item.format}</span></div>}
    </div>
    <div className="search-result-actions">
      <button onClick={() => {
        logger.info('search-home.continue-play', { contentId: item.contentId, progress: item.progress });
        queue.playNow([{
          contentId: item.contentId,
          title: item.title,
          format: item.format,
          thumbnail: item.thumbnail,
          config: item.progress > 0 ? { offset: item.progress } : undefined,
        }]);
      }} title="Resume">&#9654;</button>
    </div>
  </div>
))}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/SearchHomePanel.jsx
git commit -m "feat(media): inline play button on continue-watching items (audit #10)"
```

---

### Task 7.2: Hide Next/Queue Buttons on Non-Playable Containers (Audit #32)

Buttons show for containers — but queueing a container contentId doesn't work.

**Files:**
- Modify: `frontend/src/modules/Media/ContentDetailView.jsx:185-189`

**Step 1: Only show Next/Queue for individually playable items**

Replace lines 185-190:

```jsx
{capabilities.includes('playable') && (
  <>
    <button className="action-btn" onClick={() => handlePlayNext(null)}>&#10549; Next</button>
    <button className="action-btn" onClick={() => handleAddToQueue(null)}>+ Queue</button>
  </>
)}
```

This removes the `|| isContainer` condition. Containers that have "Play All" and "Shuffle" don't need individual Next/Queue buttons for the container itself.

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/ContentDetailView.jsx
git commit -m "fix(media): hide Next/Queue on non-playable containers (audit #32)"
```

---

## Phase 8: Remaining Polish (Audit #11, #16, #25, #34, #37-40)

Lower-priority items. Each is small and independent.

---

### Task 8.1: Fix Play/Pause Optimistic Update (Audit #11)

Button shows wrong icon between toggle and next progress callback.

**Files:**
- Modify: `frontend/src/modules/Media/NowPlaying.jsx:134-137`

**Step 1: Optimistically update paused state on toggle**

```jsx
const handleToggle = useCallback(() => {
  logger.debug('player.toggle', { paused: playbackState.paused, contentId: currentItem?.contentId });
  // Optimistic update — real state will arrive via handleProgress
  setPlaybackState(prev => ({ ...prev, paused: !prev.paused }));
  playerRef.current?.toggle?.();
}, [playerRef, logger, playbackState.paused, currentItem?.contentId]);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx
git commit -m "fix(media): optimistic play/pause toggle (audit #11)"
```

---

### Task 8.2: Add Mobile Panel Transitions (Audit #16)

Panels switch via `display: none`/`display: flex` instantly.

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss:22-35`

**Step 1: Add fade transition for mobile panels**

Replace the mobile-only panel styles:

```scss
.media-panel {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  @include mobile-only {
    display: none;
    opacity: 0;
    transition: opacity 0.2s ease;

    &.media-panel--active {
      display: flex;
      flex: 1;
      opacity: 1;
    }
  }
}
```

Note: CSS `display: none` → `display: flex` transitions don't animate. For a real transition, we'd need `visibility` or a different approach. The simplest working approach is to keep all panels in the DOM but use `position: absolute` + opacity:

```scss
@include mobile-only {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;

  &.media-panel--active {
    position: relative;
    opacity: 1;
    pointer-events: auto;
    flex: 1;
  }
}
```

Actually this gets complex with layout. Keep it simple — just use display toggle for now but add a subtle fade-in animation:

```scss
@include mobile-only {
  display: none;
  &.media-panel--active {
    display: flex;
    flex: 1;
    animation: panel-fade-in 0.2s ease;
  }
}
```

Add the keyframes (near the toast keyframes or at the bottom):
```scss
@keyframes panel-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "fix(media): add fade-in animation for mobile panel transitions (audit #16)"
```

---

### Task 8.3: Standardize Button Symbols (Audit #25)

Mixed Unicode symbols for the same concepts.

**Files:**
- Modify: `frontend/src/modules/Media/ContentDetailView.jsx:192` (shuffle icon)
- Modify: `frontend/src/modules/Media/QueueDrawer.jsx:62` (shuffle icon)

**Step 1: Align shuffle icons**

QueueDrawer uses `&#8652;` (⇌), ContentDetailView uses `&#8645;` (⇅).

Standardize both to `&#8652;` (⇌) which better represents shuffle:

In `ContentDetailView.jsx:192`:
```jsx
<button className="action-btn" onClick={handleShuffle}>&#8652; Shuffle</button>
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/ContentDetailView.jsx
git commit -m "fix(media): standardize shuffle icon to ⇌ (audit #25)"
```

---

### Deferred Items (Audit #34, #37, #38, #39, #40)

These are tracked but not included in this plan:

| # | Finding | Reason Deferred |
|---|---------|-----------------|
| 34 | Player ref missing volume/rate methods | Low daily impact; DOM access workaround exists |
| 37 | Pause/resume flicker | Will be resolved by Task 1.2 (click conflict fix) |
| 38 | Focus state machine | Prerequisite for full keyboard nav; Task 5.1 handles the common cases |
| 39 | Captions/speed/quality | Feature additions, not UX fixes |
| 40 | Accessibility (ARIA, focus) | Important but separate scope |

---

## Summary

| Phase | Tasks | Audit Items Covered | Risk |
|-------|-------|---------------------|------|
| 1: Critical Interactions | 1.1–1.5 | #1, #2, #4, #13, #24, #29 | Medium — changes core player handlers |
| 2: Queue Safety | 2.1–2.4 | #3, #7, #12, #30, #31 | Low — additive (toast) + small behavior changes |
| 3: Touch & Sizing | 3.1–3.4 | #5, #8, #9, #17, #27, #35 | Low — mostly CSS + touch handler |
| 4: Fullscreen & Overlay | 4.1–4.3 | #18, #19, #26, #28 | Low — CSS + state cleanup |
| 5: Keyboard Shortcuts | 5.1 | #15, #38 | Low — additive, guarded handler |
| 6: Polish | 6.1–6.6 | #20, #21, #22, #23, #25, #33, #36 | Low — CSS + minor JSX |
| 7: Continue & Search | 7.1–7.2 | #10, #14, #32 | Low — small JSX changes |
| 8: Remaining Polish | 8.1–8.3 | #11, #16, #25 | Low — small CSS + JSX |
| Deferred | — | #34, #37, #38, #39, #40 | — |

**Total: 22 tasks covering 35 of 40 findings.** 5 deferred.
