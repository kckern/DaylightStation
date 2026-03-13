# Video Resume Position Loss Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the cascade of bugs in `useCommonMediaController.js` that cause video resume position loss during stall recovery, as documented in `docs/_wip/audits/2026-03-07-video-resume-position-loss-audit.md`.

**Architecture:** Five targeted fixes to the media controller's recovery pipeline, ordered by severity (P0 first). Each fix is isolated — no fix depends on another — so they can be tested independently. All changes are in one file: `useCommonMediaController.js`.

**Tech Stack:** React hooks, HTML5 Media API, dash.js (DASH streaming player)

---

## Task 1: Clear `__appliedStartByKey` on softReinit (P0)

**Why:** When `softReinit` remounts the component via `setElementKey(prev + 1)`, the new instance checks `__appliedStartByKey[assetId]` and finds it `true` from the original load. This blocks start time application, causing 2+ minutes of wrong content playback from t=0.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:513-516`

**Step 1: Add the fix**

In `softReinitRecovery`, after `setElementKey((prev) => prev + 1)` at line 513, add a line to clear the guard:

```javascript
    setElementKey((prev) => prev + 1);

    // Clear the start-time guard so the remounted instance re-applies start time
    delete useCommonMediaController.__appliedStartByKey[assetId];

    lastSeekIntentRef.current = targetTime;
```

**Step 2: Verify no regressions**

Run: `npx vitest run tests/isolated/modules/Player/ --reporter=verbose`
Expected: All existing Player tests pass.

**Step 3: Commit**

```
fix(player): clear __appliedStartByKey on softReinit to preserve resume position
```

---

## Task 2: Defer `lastSeekIntentRef` clearing until `seeked` event confirms position (P0)

**Why:** In `reloadRecovery`, `lastSeekIntentRef.current = null` is cleared immediately after `mediaEl.currentTime = target`, but for DASH streams this assignment may silently fail. If the next recovery cycle fires, there's no position safety net.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:418-428`

**Step 1: Replace immediate clear with seeked-event confirmation**

In `reloadRecovery`, replace the `loadedmetadata` handler internals (lines 418-429):

Before:
```javascript
mediaEl.addEventListener('loadedmetadata', function handleOnce() {
  mediaEl.removeEventListener('loadedmetadata', handleOnce);
  const target = Math.max(0, priorTime - (Number.isFinite(seekBackSeconds) ? seekBackSeconds : 0));
  if (DEBUG_MEDIA) console.log('[Stall Recovery] reload: loadedmetadata; seeking to target', { target, priorTime, seekBackSeconds });
  if (Number.isFinite(target)) {
    try { mediaEl.currentTime = target; } catch (_) {}
  }
  mediaEl.play().catch(() => {});
  isRecoveringRef.current = false;
  lastSeekIntentRef.current = null;
  if (DEBUG_MEDIA) console.log('[Stall Recovery] reload: complete');
}, { once: true });
```

After:
```javascript
mediaEl.addEventListener('loadedmetadata', function handleOnce() {
  mediaEl.removeEventListener('loadedmetadata', handleOnce);
  const target = Math.max(0, priorTime - (Number.isFinite(seekBackSeconds) ? seekBackSeconds : 0));
  if (DEBUG_MEDIA) console.log('[Stall Recovery] reload: loadedmetadata; seeking to target', { target, priorTime, seekBackSeconds });
  if (Number.isFinite(target)) {
    try { mediaEl.currentTime = target; } catch (_) {}
  }
  // Only clear seek intent after the seek is confirmed by the browser
  const onSeeked = () => {
    mediaEl.removeEventListener('seeked', onSeeked);
    isRecoveringRef.current = false;
    lastSeekIntentRef.current = null;
    if (DEBUG_MEDIA) console.log('[Stall Recovery] reload: seeked confirmed, recovery complete', { currentTime: mediaEl.currentTime });
  };
  mediaEl.addEventListener('seeked', onSeeked, { once: true });
  // Fallback: if seeked never fires (DASH failure), clear after 5s
  setTimeout(() => {
    mediaEl.removeEventListener('seeked', onSeeked);
    if (isRecoveringRef.current) {
      isRecoveringRef.current = false;
      // Preserve lastSeekIntentRef — don't clear if seek wasn't confirmed
      if (DEBUG_MEDIA) console.log('[Stall Recovery] reload: seeked timeout, clearing recovery flag but preserving seek intent');
    }
  }, 5000);
  mediaEl.play().catch(() => {});
}, { once: true });
```

**Step 2: Verify no regressions**

Run: `npx vitest run tests/isolated/modules/Player/ --reporter=verbose`
Expected: All existing Player tests pass.

**Step 3: Commit**

```
fix(player): defer seek intent clearing until seeked event confirms position
```

---

## Task 3: Make nudge recovery buffer-aware (P1)

**Why:** Nudging backward by 0.001s when the buffer is empty at that position creates a death loop (6+ cycles observed). The nudge should check if there's buffered data nearby before attempting.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:380-393`

**Step 1: Add buffer check to nudge**

Replace the nudge implementation:

Before:
```javascript
const nudgeRecovery = useCallback((_options = {}) => {
  const mediaEl = getMediaEl();
  if (!mediaEl) return false;

  try {
    const t = mediaEl.currentTime;
    mediaEl.pause();
    mediaEl.currentTime = Math.max(0, t - 0.001);
    mediaEl.play().catch(() => {});
    return true;
  } catch (_) {
    return false;
  }
}, [getMediaEl]);
```

After:
```javascript
const nudgeRecovery = useCallback((_options = {}) => {
  const mediaEl = getMediaEl();
  if (!mediaEl) return false;

  try {
    const t = mediaEl.currentTime;
    const buffered = mediaEl.buffered;

    // Check if current position is within any buffered range
    let inBuffer = false;
    for (let i = 0; i < buffered.length; i++) {
      if (t >= buffered.start(i) && t <= buffered.end(i)) {
        inBuffer = true;
        break;
      }
    }

    // If not in a buffered range, nudge won't help — signal failure so
    // the pipeline escalates to seekback/reload instead of looping
    if (!inBuffer && buffered.length > 0) {
      if (DEBUG_MEDIA) console.log('[Stall Recovery] nudge: currentTime not in any buffered range, skipping', { t, ranges: buffered.length });
      return false;
    }

    mediaEl.pause();
    mediaEl.currentTime = Math.max(0, t - 0.001);
    mediaEl.play().catch(() => {});
    return true;
  } catch (_) {
    return false;
  }
}, [getMediaEl]);
```

**Step 2: Verify no regressions**

Run: `npx vitest run tests/isolated/modules/Player/ --reporter=verbose`
Expected: All existing Player tests pass.

**Step 3: Commit**

```
fix(player): skip nudge recovery when currentTime is outside buffered ranges
```

---

## Task 4: Make reload recovery DASH-aware (P1)

**Why:** `removeAttribute('src') + load()` destroys the DASH SourceBuffer and manifest state. For DASH streams, the reload should use the DASH player's own reset API instead of raw DOM manipulation.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:396-443`

**Step 1: Add DASH-aware reload path**

Add a DASH detection check at the top of `reloadRecovery`. If the container has a DASH player, use `dashjsPlayer.reset()` + `dashjsPlayer.initialize()` (or `attachSource()`) instead of DOM src manipulation.

Replace the reload implementation:

Before:
```javascript
const reloadRecovery = useCallback((options = {}) => {
  const mediaEl = getMediaEl();
  if (!mediaEl) {
    return false;
  }

  const seekBackSeconds = Number.isFinite(options.seekBackSeconds) ? options.seekBackSeconds : seekBackOnReload;
  const priorTime = lastSeekIntentRef.current !== null ? lastSeekIntentRef.current : (mediaEl.currentTime || 0);
  const src = mediaEl.getAttribute('src');

  isRecoveringRef.current = true;
  if (DEBUG_MEDIA) console.log('[Stall Recovery] reload: begin', { priorTime, intent: lastSeekIntentRef.current, seekBackSeconds, hasSrc: !!src });

  try {
    mediaEl.pause();
    mediaEl.removeAttribute('src');
    mediaEl.load();

    setTimeout(() => {
```

After:
```javascript
const reloadRecovery = useCallback((options = {}) => {
  const mediaEl = getMediaEl();
  if (!mediaEl) {
    return false;
  }

  const seekBackSeconds = Number.isFinite(options.seekBackSeconds) ? options.seekBackSeconds : seekBackOnReload;
  const priorTime = lastSeekIntentRef.current !== null ? lastSeekIntentRef.current : (mediaEl.currentTime || 0);
  const src = mediaEl.getAttribute('src');
  const hostEl = containerRef.current;
  const dashPlayer = hostEl?.dashjsPlayer;

  isRecoveringRef.current = true;
  if (DEBUG_MEDIA) console.log('[Stall Recovery] reload: begin', { priorTime, intent: lastSeekIntentRef.current, seekBackSeconds, hasSrc: !!src, hasDash: !!dashPlayer });

  // DASH-aware reload: use the DASH player's own API to avoid destroying SourceBuffer state
  if (dashPlayer && typeof dashPlayer.reset === 'function' && typeof dashPlayer.attachSource === 'function') {
    const streamSrc = hostEl.getAttribute('src') || src;
    try {
      mediaEl.pause();
      dashPlayer.reset();
      dashPlayer.initialize(mediaEl, streamSrc, true);
      const target = Math.max(0, priorTime - (Number.isFinite(seekBackSeconds) ? seekBackSeconds : 0));
      mediaEl.addEventListener('loadedmetadata', function handleOnce() {
        mediaEl.removeEventListener('loadedmetadata', handleOnce);
        if (Number.isFinite(target)) {
          try {
            if (dashPlayer.seek) {
              dashPlayer.seek(target);
            } else {
              mediaEl.currentTime = target;
            }
          } catch (_) {}
        }
        const onSeeked = () => {
          mediaEl.removeEventListener('seeked', onSeeked);
          isRecoveringRef.current = false;
          lastSeekIntentRef.current = null;
        };
        mediaEl.addEventListener('seeked', onSeeked, { once: true });
        setTimeout(() => {
          mediaEl.removeEventListener('seeked', onSeeked);
          if (isRecoveringRef.current) isRecoveringRef.current = false;
        }, 5000);
        mediaEl.play().catch(() => {});
      }, { once: true });
      return true;
    } catch (err) {
      if (DEBUG_MEDIA) console.log('[Stall Recovery] reload: DASH reload failed, falling back to DOM reload', err);
      // Fall through to DOM-based reload below
    }
  }

  // Non-DASH (or DASH fallback): DOM-based src removal + reattach
  try {
    mediaEl.pause();
    mediaEl.removeAttribute('src');
    mediaEl.load();

    setTimeout(() => {
```

**Step 2: Verify no regressions**

Run: `npx vitest run tests/isolated/modules/Player/ --reporter=verbose`
Expected: All existing Player tests pass.

**Step 3: Commit**

```
fix(player): use dash.js API for reload recovery instead of DOM src manipulation
```

---

## Task 5: Add position watchdog after recovery (P2)

**Why:** No code validates that a recovery seek actually landed at the right position. The jump to 9533s (2h38m instead of ~80min) went undetected. A watchdog that fires after recovery confirms the position is in range.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` — add watchdog near recovery completion

**Step 1: Add watchdog function**

Add a helper near the recovery methods (after line ~540, after `handleTerminalFailure`):

```javascript
// Position watchdog: verify recovery landed at the expected position
const verifyRecoveryPosition = useCallback((expectedTime, toleranceSeconds = 30) => {
  const checkDelay = 2000; // check 2s after recovery
  setTimeout(() => {
    const mediaEl = getMediaEl();
    if (!mediaEl || !Number.isFinite(expectedTime) || expectedTime <= 0) return;
    const actual = mediaEl.currentTime;
    const drift = Math.abs(actual - expectedTime);
    if (drift > toleranceSeconds) {
      if (DEBUG_MEDIA) console.log('[Stall Recovery] position watchdog: drift detected, correcting', { expected: expectedTime, actual, drift });
      try {
        if (containerRef.current?.api?.seek) {
          containerRef.current.api.seek(expectedTime);
        } else {
          mediaEl.currentTime = expectedTime;
        }
      } catch (_) {}
    } else {
      if (DEBUG_MEDIA) console.log('[Stall Recovery] position watchdog: position OK', { expected: expectedTime, actual, drift });
    }
  }, checkDelay);
}, [getMediaEl]);
```

**Step 2: Wire watchdog into reload and softReinit recovery completion**

In `reloadRecovery`'s `onSeeked` handler (from Task 2), add after clearing recovery flags:

```javascript
const onSeeked = () => {
  mediaEl.removeEventListener('seeked', onSeeked);
  isRecoveringRef.current = false;
  lastSeekIntentRef.current = null;
  verifyRecoveryPosition(target);
  // ...
};
```

In the `onLoadedMetadata` handler's snapshot cleanup block (line ~1011-1016), add:

```javascript
if (snapshot) {
  recoverySnapshotRef.current = null;
  stallStateRef.current.pendingSoftReinit = false;
  isRecoveringRef.current = false;
  lastSeekIntentRef.current = null;
  verifyRecoveryPosition(snapshot.targetTime);
}
```

**Step 3: Verify no regressions**

Run: `npx vitest run tests/isolated/modules/Player/ --reporter=verbose`
Expected: All existing Player tests pass.

**Step 4: Commit**

```
feat(player): add position watchdog to detect and correct recovery drift
```

---

## Task 6: Treat `duration=null` as critical escalation signal (P2)

**Why:** When `duration` becomes `null`/`NaN`, the media source is broken. Continuing with nudge/seekback strategies wastes time. The stall detector should escalate immediately to softReinit.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` — in the stall detection / `attemptRecovery` logic

**Step 1: Add duration check in the hard timer**

Find the hard timer callback in the stall detection flow (around lines 695-720, inside `scheduleStallDetection`). Before calling `attemptRecovery()`, check if duration is lost:

After the existing `if (!s.isStalled)` early return in the hard timer, add:

```javascript
// If duration is lost, skip to softReinit immediately — nudge/seekback can't help
const mediaEl = getMediaEl();
if (mediaEl && !Number.isFinite(mediaEl.duration)) {
  if (DEBUG_MEDIA) console.log('[Stall Recovery] duration lost, escalating to softReinit');
  attemptRecovery({ strategyName: 'softReinit', manual: false });
  return;
}
```

**Step 2: Verify no regressions**

Run: `npx vitest run tests/isolated/modules/Player/ --reporter=verbose`
Expected: All existing Player tests pass.

**Step 3: Commit**

```
fix(player): escalate to softReinit immediately when duration is lost
```

---

## Summary

| Task | Priority | Bug | One-line fix description |
|------|----------|-----|--------------------------|
| 1 | P0 | `__appliedStartByKey` blocks remount start time | Delete guard on softReinit |
| 2 | P0 | Seek intent cleared before confirmation | Wait for `seeked` event |
| 3 | P1 | Nudge death loop on empty buffer | Check `buffered` ranges first |
| 4 | P1 | Reload destroys DASH state | Use `dashjsPlayer` API |
| 5 | P2 | No position verification after recovery | Add 2s watchdog check |
| 6 | P2 | `duration=null` not escalated | Skip to softReinit on lost duration |

All changes are in `frontend/src/modules/Player/hooks/useCommonMediaController.js`.
