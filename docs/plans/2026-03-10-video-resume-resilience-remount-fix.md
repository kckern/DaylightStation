# Video Resume Position Loss via Resilience Remount — Fix Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the `__appliedStartByKey` guard so that all remount paths (softReinit AND resilience remount) clear it before the new instance loads, and fix two logging issues (seek event spam, stale seek intent).

**Architecture:** The root problem is that `__appliedStartByKey` is cleared in `softReinit` (useCommonMediaController.js) but not in the resilience remount path (Player.jsx → `forceSinglePlayerRemount`). Rather than patching every remount callsite, we fix the guard check itself in `onLoadedMetadata` to use a per-mount-instance flag, making it immune to which remount path created the instance. Two logging fixes are included to reduce noise and prevent misleading drift values.

**Tech Stack:** React hooks, HTML5 Media API, dash.js

**Audit:** `docs/_wip/audits/2026-03-10-video-resume-resilience-remount-audit.md`

---

## Task 1: Clear `__appliedStartByKey` in `forceSinglePlayerRemount` (P0)

**Why:** The resilience remount path (`Player.jsx:forceSinglePlayerRemount`) increments `remountState.nonce` which causes React to unmount/remount the SinglePlayer component with a new key. The new `useCommonMediaController` instance finds `__appliedStartByKey[assetId] = true` from the original mount and skips applying the resume position, causing playback from t=0.

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx:330-391`

**Step 1: Add `__appliedStartByKey` import awareness**

At the top of `forceSinglePlayerRemount` (line 330), after the existing destructuring, add a call to clear the guard. The `assetId` in this context is `mediaIdentity` (the Plex media key).

In `forceSinglePlayerRemount`, after line 390 (`return { guid: prev.guid, nonce: prev.nonce + 1, context: diagnostics };`), but before the `setRemountState` call's closing, add the guard clear. Actually, the cleanest place is right before `setRemountState` at line 385.

Find this block in `forceSinglePlayerRemount`:

```javascript
    setTargetTimeSeconds(normalized);
    setMediaAccess(createDefaultMediaAccess());
    setPlaybackMetrics(createDefaultPlaybackMetrics());
    setRemountState((prev) => {
```

Add the guard clear between `setPlaybackMetrics` and `setRemountState`:

```javascript
    setTargetTimeSeconds(normalized);
    setMediaAccess(createDefaultMediaAccess());
    setPlaybackMetrics(createDefaultPlaybackMetrics());

    // Clear the start-time guard so the remounted media controller re-applies
    // the resume position. Without this, the new instance sees the guard as true
    // from the original mount and starts playback at t=0.
    // See: docs/_wip/audits/2026-03-10-video-resume-resilience-remount-audit.md
    try {
      const { __appliedStartByKey } = await import('./hooks/useCommonMediaController.js');
    } catch {}
```

Wait — `__appliedStartByKey` is a static property on the `useCommonMediaController` function, which is not directly importable this way. Let me check the actual export pattern.

**Step 1 (revised): Check how useCommonMediaController is accessible from Player.jsx**

The guard is `useCommonMediaController.__appliedStartByKey[assetId]`. Since Player.jsx doesn't import `useCommonMediaController` directly (it's used inside SinglePlayer), we need a different approach.

The cleanest fix: **clear the guard inside useCommonMediaController's initialization when it detects a remount via a changed key/nonce.** The `remountDiagnostics` prop (line 821) is already passed down and changes on each remount — we can use that as a signal.

Actually, the simplest approach: **clear the guard inside `onLoadedMetadata` when recovering.** The `isRecoveringRef` flag isn't set by resilience remounts (it's only set by stall recovery). Instead, detect that we're a fresh mount for a key we've seen before and clear the guard.

**Revised approach:** Add a `remountNonce` prop to `useCommonMediaController` (already available as part of remount diagnostics). When the nonce changes, clear `__appliedStartByKey`. This is the most direct fix.

Let me re-examine how the props flow.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:1037-1044`

**Step 1: Fix the guard check to be per-mount-instance**

The current guard check at line 1037-1044:

```javascript
const hasAppliedForKey = !!useCommonMediaController.__appliedStartByKey[assetId];
const isEffectiveInitial = isInitialLoadRef.current && !isRecoveringRef.current && !hasAppliedForKey;
```

The problem: `isInitialLoadRef.current` is `true` on a fresh mount, but `hasAppliedForKey` is also `true` (persisted on the function object from the previous mount). The guard was designed to prevent double-applying on the same mount, but it blocks ALL subsequent mounts.

Replace with a mount-instance-aware check. `isInitialLoadRef.current` already tracks "has this instance loaded?", which is exactly what we need. The `hasAppliedForKey` check is redundant with `isInitialLoadRef` — the only reason it exists is to survive across HMR/fast-refresh where `isInitialLoadRef` gets reset but the component doesn't truly remount.

**The fix:** Only consult `__appliedStartByKey` when `isRecoveringRef.current` is false AND we haven't done a softReinit. Since `isInitialLoadRef` is already `true` on fresh mounts (including resilience remounts), we just need to stop blocking on `hasAppliedForKey` when this is a fresh hook instance.

The simplest correct fix: **track a per-instance mount ID and compare it to the last mount ID that set the guard.** Replace the boolean `__appliedStartByKey[assetId]` with a mount-instance ID.

```javascript
// Line 50-52: Change from boolean to mount-instance tracking
if (!useCommonMediaController.__appliedStartByKey) useCommonMediaController.__appliedStartByKey = Object.create(null);
```

Add a mount instance ref near line 78:

```javascript
const mountIdRef = useRef(Symbol('mount'));
```

Then at line 1037-1044, change:

Before:
```javascript
const hasAppliedForKey = !!useCommonMediaController.__appliedStartByKey[assetId];
const isEffectiveInitial = isInitialLoadRef.current && !isRecoveringRef.current && !hasAppliedForKey;
```

After:
```javascript
const appliedByMount = useCommonMediaController.__appliedStartByKey[assetId];
const hasAppliedThisMount = appliedByMount === mountIdRef.current;
const isEffectiveInitial = isInitialLoadRef.current && !isRecoveringRef.current && !hasAppliedThisMount;
```

And at line 1055-1057, change the guard SET:

Before:
```javascript
try { useCommonMediaController.__appliedStartByKey[assetId] = true; } catch {}
```

After:
```javascript
try { useCommonMediaController.__appliedStartByKey[assetId] = mountIdRef.current; } catch {}
```

This way:
- First mount sets `__appliedStartByKey[assetId] = Symbol('mount-A')` → blocks double-apply on mount A
- Resilience remount creates mount B with `Symbol('mount-B')` → `appliedByMount !== mountIdRef.current` → `hasAppliedThisMount = false` → start time applied
- softReinit still works: the `delete __appliedStartByKey[assetId]` at line 611 clears it entirely, so `appliedByMount` is `undefined` → `hasAppliedThisMount = false`
- HMR: React preserves refs across HMR, so `mountIdRef.current` stays the same → guard still works

**Step 2: Update the diagnostic logging**

The `playback.start-time-decision` log at line ~1082 includes `hasAppliedForKey`. Update it:

Before:
```javascript
hasAppliedForKey,
```

After:
```javascript
hasAppliedForKey: hasAppliedThisMount,
```

**Step 3: Verify no regressions**

Run: `npx playwright test tests/live/flow/player/ --reporter=line`
Expected: All existing Player contract tests pass.

**Step 4: Commit**

```
fix(player): use per-mount-instance guard for __appliedStartByKey to fix resilience remount position loss
```

---

## Task 2: Deduplicate seek event logging (P2)

**Why:** The `clearSeeking` function is registered as a listener on both `seeked` AND `playing` events (lines 1277-1278). Additionally, DASH streams can fire multiple `seeked` events in rapid succession for audio+video tracks. This produces ~30 duplicate `playback.seek` log entries per seek, creating significant log noise. The `maxPerMinute: 30` sampled limit is ineffective because all events arrive within the same millisecond.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:1257-1270`

**Step 1: Add timestamp-based deduplication to `clearSeeking`**

Add a ref to track the last logged seek time. Near line 78 (where other refs are declared), add:

```javascript
const lastSeekedLogTsRef = useRef(0);
```

Then modify `clearSeeking` (lines 1257-1270):

Before:
```javascript
const clearSeeking = () => {
  const el = getMediaEl();
  if (el) {
    mcLog().sampled('playback.seek', {
      mediaKey: assetId,
      phase: 'seeked',
      actual: el.currentTime,
      intent: lastSeekIntentRef.current,
      drift: lastSeekIntentRef.current != null ? Math.abs(el.currentTime - lastSeekIntentRef.current) : null,
      duration: el.duration
    }, { maxPerMinute: 30 });
  }
  requestAnimationFrame(() => setIsSeeking(false));
};
```

After:
```javascript
const clearSeeking = () => {
  const el = getMediaEl();
  const now = Date.now();
  if (el && now - lastSeekedLogTsRef.current > 200) {
    lastSeekedLogTsRef.current = now;
    mcLog().sampled('playback.seek', {
      mediaKey: assetId,
      phase: 'seeked',
      actual: el.currentTime,
      intent: lastSeekIntentRef.current,
      drift: lastSeekIntentRef.current != null ? Math.abs(el.currentTime - lastSeekIntentRef.current) : null,
      duration: el.duration
    }, { maxPerMinute: 30 });
  }
  requestAnimationFrame(() => setIsSeeking(false));
};
```

The 200ms debounce window collapses the burst of `seeked`+`playing` events from DASH audio+video tracks into a single log entry while still capturing distinct user seeks.

**Step 2: Commit**

```
fix(player): debounce seeked log events to prevent 30x duplicate spam
```

---

## Task 3: Clear `lastSeekIntentRef` after start-time application (P2)

**Why:** After the deferred DASH seek lands at the correct position, `lastSeekIntentRef` retains the original seek target (e.g., 6690s). As playback progresses to 6794s, 7397s, etc., every `seeked` event (from governance pause/resume, voice memo, etc.) logs a growing "drift" value (104s, 707s) that looks like a position-loss bug but is just stale state.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` — deferred DASH seek handler (~line 1129-1148) and non-DASH seek path (~line 1155-1165)

**Step 1: Clear `lastSeekIntentRef` after DASH deferred seek applies**

In the deferred DASH seek `onTimeUpdate` handler (around line 1129-1148), after the seek is applied and logged, clear the intent:

Find the end of the `onTimeUpdate` handler, after the `mcLog().info('playback.start-time-applied', ...)` call. Add:

```javascript
  // Clear seek intent after start-time is applied — prevents stale intent
  // from polluting drift calculations on subsequent pause/resume seeks
  lastSeekIntentRef.current = null;
```

**Step 2: Clear `lastSeekIntentRef` after non-DASH direct seek applies**

In the non-DASH path (around line 1155-1165), after `mediaEl.currentTime = startTime` and the `mcLog().info('playback.start-time-applied', ...)` call, add:

```javascript
  lastSeekIntentRef.current = null;
```

**Step 3: Commit**

```
fix(player): clear lastSeekIntentRef after start-time application to prevent stale drift logging
```

---

## Task 4: Update reference documentation

**Why:** The reference doc `docs/reference/fitness/video-resume-position.md` documents the recovery pipeline and the 2026-03-07 fixes. It needs to be updated with the new per-mount-instance guard approach.

**Files:**
- Modify: `docs/reference/fitness/video-resume-position.md`

**Step 1: Add section about resilience remount fix**

Add a new entry under "## Bugs Fixed" after the existing "### 1. `__appliedStartByKey` blocking remount start time (P0)" section:

```markdown
### 7. `__appliedStartByKey` blocking resilience remount start time (P0)

**Commit:** `<hash>`

The P0 fix (item 1) only cleared `__appliedStartByKey` in `softReinit`. The resilience recovery system (`useMediaResilience.js`) triggers a different remount path via `Player.jsx:forceSinglePlayerRemount` → `remountState.nonce++`. This remount didn't clear the guard, causing the same position-loss symptom.

**Fix:** Changed `__appliedStartByKey` from a boolean to a per-mount-instance Symbol. Each hook instance creates `mountIdRef = useRef(Symbol('mount'))`. The guard check compares `__appliedStartByKey[assetId] === mountIdRef.current` instead of a truthy check, so new mounts (regardless of which path created them) always get a chance to apply start time. The `softReinit` delete still works as before (clears the entry entirely).
```

**Step 2: Update the "Key Refs and State" table**

Update the `__appliedStartByKey` entry:

Before:
```markdown
| `__appliedStartByKey[assetId]` | Static guard: has start time been applied for this asset? |
```

After:
```markdown
| `__appliedStartByKey[assetId]` | Static guard: Symbol of the mount instance that applied start time (per-instance, not boolean) |
| `mountIdRef` | Per-instance Symbol that identifies this hook mount — used to scope `__appliedStartByKey` |
```

**Step 3: Commit**

```
docs: update video-resume-position reference with resilience remount fix
```

---

## Summary

| Task | Priority | Bug | Fix |
|------|----------|-----|-----|
| 1 | P0 | `__appliedStartByKey` blocks resilience remount | Per-mount-instance Symbol guard instead of boolean |
| 2 | P2 | 30x duplicate seek log events | 200ms debounce in `clearSeeking` |
| 3 | P2 | Stale `lastSeekIntentRef` causes fake drift | Clear after start-time application |
| 4 | — | Docs out of date | Update reference doc |

All code changes are in `frontend/src/modules/Player/hooks/useCommonMediaController.js` (Tasks 1-3) and `docs/reference/fitness/video-resume-position.md` (Task 4).
