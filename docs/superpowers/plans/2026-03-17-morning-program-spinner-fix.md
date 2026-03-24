# Morning Program Spinner Fix — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the morning program spinner-of-death where audio plays but the screen shows only a loading spinner, caused by stale resilience timers firing for phantom queue entries.

**Architecture:** Four targeted guards at different layers — (1) cancel stale resilience timers when `currentMediaGuid` changes (root cause fix), (2) `handleResilienceReload` rejects recovery attempts for unresolvable media (kill-shot prevention), (3) `useMediaResilience` won't arm the startup deadline until media metadata exists, (4) `useQueueController` suppresses phantom `queue-track-changed` emissions during queue loading. Each fix is independently valuable; together they close the entire bug class via defense in depth.

**Tech Stack:** React hooks (Player.jsx, useMediaResilience.js, useQueueController.js), Vitest for unit tests.

**Bug report:** `docs/_wip/bugs/2026-03-17-morning-program-spinner-audio-plays.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/modules/Player/Player.jsx` | Modify | Cancel resilience deadline on guid change + phantom guard in `handleResilienceReload` |
| `frontend/src/modules/Player/hooks/useMediaResilience.js` | Modify | Expose `cancelDeadline()`, skip startup deadline when no media metadata |
| `frontend/src/modules/Player/hooks/useQueueController.js` | Modify | Suppress phantom queue-track-changed emissions |
| `tests/isolated/modules/Player/resiliencePhantomGuard.test.mjs` | Create | Tests for recovery guard logic (pure functions) |
| `tests/isolated/modules/Player/resilienceDeadlineGating.test.mjs` | Create | Tests for deadline gating logic |
| `tests/isolated/modules/Player/queueTrackChangedFilter.test.mjs` | Create | Tests for phantom emission suppression |

---

## Chunk 1: Cancel stale resilience timers on guid change (P0 — root cause)

This is the bug report's top recommendation and the true root cause fix. When `currentMediaGuid` changes (track transition), the resilience hook's `startupDeadlineRef` timer from the previous guid must be cancelled. Currently, the effect at Player.jsx:212-218 resets `mediaAccess` and `remountState` but does NOT signal the resilience hook to cancel its timer. The stale timer fires 15s later and destroys working playback.

The fix: `useMediaResilience` exposes a `cancelDeadline()` function. Player.jsx calls it in the guid-change effect.

### Task 1: Expose cancelDeadline from useMediaResilience

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js`
- Modify: `frontend/src/modules/Player/Player.jsx:212-218`

- [ ] **Step 1: Add cancelDeadline to useMediaResilience return value**

In `frontend/src/modules/Player/hooks/useMediaResilience.js`, add a `cancelDeadline` callback before the return statement (before line 497):

```javascript
  const cancelDeadline = useCallback(() => {
    clearTimeout(startupDeadlineRef.current);
    startupDeadlineRef.current = null;
  }, []);
```

Then add it to the return object (line ~497-501). The current return:

```javascript
  return {
    overlayProps,
    state: resilienceState,
    onStartupSignal: NOOP
  };
```

Becomes:

```javascript
  return {
    overlayProps,
    state: resilienceState,
    onStartupSignal: NOOP,
    cancelDeadline
  };
```

- [ ] **Step 2: Call cancelDeadline in Player.jsx guid-change effect**

In `frontend/src/modules/Player/Player.jsx`, destructure `cancelDeadline` from the `useMediaResilience` call (line ~583):

The current destructure:
```javascript
  const { overlayProps, state: resilienceState, onStartupSignal } = useMediaResilience({
```

Becomes:
```javascript
  const { overlayProps, state: resilienceState, onStartupSignal, cancelDeadline } = useMediaResilience({
```

Then modify the guid-change effect (lines 212-218). The current code:

```javascript
  useEffect(() => {
    setResolvedMeta(null);
    setMediaAccess(createDefaultMediaAccess());
    setPlaybackMetrics(createDefaultPlaybackMetrics());
    setRemountState((prev) => (prev.guid === currentMediaGuid ? prev : { guid: currentMediaGuid || null, nonce: 0, context: null }));
    clearRemountTimer();
  }, [currentMediaGuid, clearRemountTimer]);
```

Becomes:

```javascript
  useEffect(() => {
    setResolvedMeta(null);
    setMediaAccess(createDefaultMediaAccess());
    setPlaybackMetrics(createDefaultPlaybackMetrics());
    setRemountState((prev) => (prev.guid === currentMediaGuid ? prev : { guid: currentMediaGuid || null, nonce: 0, context: null }));
    clearRemountTimer();
    cancelDeadline();
  }, [currentMediaGuid, clearRemountTimer, cancelDeadline]);
```

**Note on circular dependency:** `useMediaResilience` is called AFTER this effect in the component body (line ~583), but `cancelDeadline` is a stable `useCallback` with no deps — it captures `startupDeadlineRef` via closure which is a ref (stable across renders). React hooks execute effects AFTER render, so by the time the effect runs, `cancelDeadline` is available. This is safe.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Player/hooks/useMediaResilience.js \
       frontend/src/modules/Player/Player.jsx
git commit -m "fix(player): cancel stale resilience timers on guid change

When currentMediaGuid changes (track transition), the previous track's
startup deadline timer was left running. After 15s it would fire and
trigger recovery on a stale/phantom guid, destroying working playback.

Now useMediaResilience exposes cancelDeadline() which Player.jsx calls
in the guid-change effect alongside the existing mediaAccess/remountState
resets.

Refs: docs/_wip/bugs/2026-03-17-morning-program-spinner-audio-plays.md"
```

---

## Chunk 2: Guard handleResilienceReload against phantom entries (P0 — defense in depth)

This is the kill-shot prevention. When `handleResilienceReload` is called for a phantom entry with no playerType and no media URL, it must bail out instead of triggering a remount that destroys working playback.

### Task 1: Write failing tests for the phantom guard

**Files:**
- Create: `tests/isolated/modules/Player/resiliencePhantomGuard.test.mjs`

- [ ] **Step 1: Write the failing test**

The guard logic is a pure function we'll extract. Test it in isolation.

```javascript
// tests/isolated/modules/Player/resiliencePhantomGuard.test.mjs
import { describe, it, expect } from 'vitest';

/**
 * Tests for shouldSkipResilienceReload — the guard that prevents
 * recovery attempts on phantom/unresolvable queue entries.
 *
 * A phantom entry is one that was created before the queue API
 * responded — it has no title, no mediaType, no media URL.
 * Attempting to remount for such an entry always fails and can
 * destroy working playback in a different track.
 *
 * See: docs/_wip/bugs/2026-03-17-morning-program-spinner-audio-plays.md
 */

function shouldSkipResilienceReload({ activeSource, playerType, resolvedMeta }) {
  // No active source at all — nothing to recover
  if (!activeSource) return true;

  // If we have a resolved playerType, recovery is plausible
  if (playerType) return false;

  // Check if resolved metadata has enough info to attempt recovery
  if (resolvedMeta?.mediaType || resolvedMeta?.mediaUrl || resolvedMeta?.plex) return false;

  // Check if activeSource itself has enough info
  if (activeSource.mediaType || activeSource.mediaUrl || activeSource.media
      || activeSource.plex || activeSource.contentId) return false;

  // Phantom entry: no type, no URL, no content identifier — skip
  return true;
}

describe('shouldSkipResilienceReload', () => {
  describe('phantom entries (should skip)', () => {
    it('skips when activeSource has no identifying properties', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'O2ExbkfR8M' },
        playerType: null,
        resolvedMeta: null
      })).toBe(true);
    });

    it('skips when activeSource is null', () => {
      expect(shouldSkipResilienceReload({
        activeSource: null,
        playerType: null,
        resolvedMeta: null
      })).toBe(true);
    });

    it('skips when resolvedMeta exists but has no media info', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'phantom123' },
        playerType: null,
        resolvedMeta: { title: 'Loading...' }
      })).toBe(true);
    });
  });

  describe('real entries (should NOT skip)', () => {
    it('allows recovery when playerType is set', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc' },
        playerType: 'video',
        resolvedMeta: null
      })).toBe(false);
    });

    it('allows recovery when activeSource has mediaType', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc', mediaType: 'video' },
        playerType: null,
        resolvedMeta: null
      })).toBe(false);
    });

    it('allows recovery when activeSource has plex ID', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc', plex: '375839' },
        playerType: null,
        resolvedMeta: null
      })).toBe(false);
    });

    it('allows recovery when activeSource has contentId', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc', contentId: 'freshvideo:teded' },
        playerType: null,
        resolvedMeta: null
      })).toBe(false);
    });

    it('allows recovery when activeSource has media key', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc', media: 'sfx/intro' },
        playerType: null,
        resolvedMeta: null
      })).toBe(false);
    });

    it('allows recovery when resolvedMeta has mediaType', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc' },
        playerType: null,
        resolvedMeta: { mediaType: 'audio' }
      })).toBe(false);
    });

    it('allows recovery when resolvedMeta has mediaUrl', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc' },
        playerType: null,
        resolvedMeta: { mediaUrl: '/media/video/news/cnn/20260317.mp4' }
      })).toBe(false);
    });

    it('allows recovery when resolvedMeta has plex', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc' },
        playerType: null,
        resolvedMeta: { plex: '12345' }
      })).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/modules/Player/resiliencePhantomGuard.test.mjs`
Expected: FAIL — `shouldSkipResilienceReload is not defined` (function doesn't exist yet)

### Task 2: Implement the phantom guard

**Files:**
- Create: `frontend/src/modules/Player/lib/shouldSkipResilienceReload.js`
- Modify: `frontend/src/modules/Player/Player.jsx:505-577` (handleResilienceReload)

- [ ] **Step 3: Create the guard function**

```javascript
// frontend/src/modules/Player/lib/shouldSkipResilienceReload.js

/**
 * Determines if a resilience reload should be skipped because the
 * current activeSource is a phantom/unresolvable entry.
 *
 * Phantom entries are created during the queue loading race condition:
 * the queue controller emits a placeholder before the API response
 * arrives. These have no mediaType, no media URL, no content identifiers.
 * Attempting recovery on them always fails and can destroy working playback.
 *
 * @param {Object} params
 * @param {Object|null} params.activeSource - Current queue item
 * @param {string|null} params.playerType - Resolved player type (video/audio/etc.)
 * @param {Object|null} params.resolvedMeta - Resolved metadata from SinglePlayer
 * @returns {boolean} true if reload should be skipped
 */
export function shouldSkipResilienceReload({ activeSource, playerType, resolvedMeta }) {
  if (!activeSource) return true;
  if (playerType) return false;
  if (resolvedMeta?.mediaType || resolvedMeta?.mediaUrl || resolvedMeta?.plex) return false;
  if (activeSource.mediaType || activeSource.mediaUrl || activeSource.media
      || activeSource.plex || activeSource.contentId) return false;
  return true;
}
```

- [ ] **Step 4: Update the test import to use the real module**

Replace the inline function in the test file with:

```javascript
import { shouldSkipResilienceReload } from '../../../../frontend/src/modules/Player/lib/shouldSkipResilienceReload.js';
```

Remove the inline `function shouldSkipResilienceReload` definition.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/modules/Player/resiliencePhantomGuard.test.mjs`
Expected: All 11 tests PASS

- [ ] **Step 6: Wire the guard into handleResilienceReload**

In `frontend/src/modules/Player/Player.jsx`, add the import at the top (after existing imports):

```javascript
import { shouldSkipResilienceReload } from './lib/shouldSkipResilienceReload.js';
```

Then in `handleResilienceReload` (line ~505), add the guard as the FIRST thing inside the function body, before any other logic:

```javascript
  const handleResilienceReload = useCallback((options = {}) => {
    // Guard: skip recovery for phantom/unresolvable entries
    if (shouldSkipResilienceReload({ activeSource, playerType, resolvedMeta })) {
      playbackLog('resilience-reload-skipped-phantom', {
        guid: currentMediaGuid,
        hasActiveSource: !!activeSource,
        playerType: playerType || null,
        hasResolvedMeta: !!resolvedMeta,
        reason: options?.reason
      }, { level: 'warn' });
      return;
    }

    const {
      forceDocumentReload: forceDocReload,
      // ... rest unchanged
```

Add `activeSource` and `resolvedMeta` to the `useCallback` dependency array (line ~577). `activeSource` is already derived from `useMemo` so it's stable. `resolvedMeta` is state.

The existing dependency array:
```javascript
  }, [scheduleSinglePlayerRemount, mediaAccess, transportAdapter, playerType, isQueue, advance, clear, currentMediaGuid, resolvedWaitKey]);
```

Becomes:
```javascript
  }, [scheduleSinglePlayerRemount, mediaAccess, transportAdapter, playerType, isQueue, advance, clear, currentMediaGuid, resolvedWaitKey, activeSource, resolvedMeta]);
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Player/lib/shouldSkipResilienceReload.js \
       frontend/src/modules/Player/Player.jsx \
       tests/isolated/modules/Player/resiliencePhantomGuard.test.mjs
git commit -m "fix(player): guard resilience reload against phantom queue entries

Phantom entries created during queue loading race have no mediaType,
no media URL, and no content identifiers. Recovery attempts on them
always fail (playerType=null, mediaElementPresent=false) and destroy
working playback on the real track.

Refs: docs/_wip/bugs/2026-03-17-morning-program-spinner-audio-plays.md"
```

---

## Chunk 3: Don't arm resilience deadline until metadata exists (P1)

The startup deadline timer in `useMediaResilience` arms immediately on mount, even before the player knows what type of media it's playing. For phantom entries, `meta` has no useful properties. The timer fires after 15s and triggers a recovery that the P0 guard will now block — but it's better to never arm in the first place.

### Task 3: Write failing tests for deadline gating

**Files:**
- Create: `tests/isolated/modules/Player/resilienceDeadlineGating.test.mjs`

- [ ] **Step 1: Write the failing test**

We test the gating logic as a pure function. The resilience hook checks `meta` to decide whether to arm the deadline. We extract this as `shouldArmStartupDeadline`.

```javascript
// tests/isolated/modules/Player/resilienceDeadlineGating.test.mjs
import { describe, it, expect } from 'vitest';
import { shouldArmStartupDeadline } from '../../../../frontend/src/modules/Player/lib/shouldArmStartupDeadline.js';

/**
 * Tests for startup deadline gating.
 *
 * The resilience hook should NOT arm a 15s startup deadline when
 * it has no media metadata — there's nothing to recover to.
 * This prevents false startup-deadline-exceeded for phantom entries.
 */

describe('shouldArmStartupDeadline', () => {
  it('returns false when meta is null', () => {
    expect(shouldArmStartupDeadline({ meta: null, disabled: false })).toBe(false);
  });

  it('returns false when meta is empty object', () => {
    expect(shouldArmStartupDeadline({ meta: {}, disabled: false })).toBe(false);
  });

  it('returns false when disabled is true', () => {
    expect(shouldArmStartupDeadline({
      meta: { mediaType: 'video', mediaUrl: '/test.mp4' },
      disabled: true
    })).toBe(false);
  });

  it('returns true when meta has mediaType', () => {
    expect(shouldArmStartupDeadline({
      meta: { mediaType: 'audio' },
      disabled: false
    })).toBe(true);
  });

  it('returns true when meta has mediaUrl', () => {
    expect(shouldArmStartupDeadline({
      meta: { mediaUrl: '/media/video.mp4' },
      disabled: false
    })).toBe(true);
  });

  it('returns true when meta has plex ID', () => {
    expect(shouldArmStartupDeadline({
      meta: { plex: '375839' },
      disabled: false
    })).toBe(true);
  });

  it('returns true when meta has media key', () => {
    expect(shouldArmStartupDeadline({
      meta: { media: 'sfx/intro' },
      disabled: false
    })).toBe(true);
  });

  it('returns true when meta has contentId', () => {
    expect(shouldArmStartupDeadline({
      meta: { contentId: 'freshvideo:teded' },
      disabled: false
    })).toBe(true);
  });

  it('returns true when meta has assetId', () => {
    expect(shouldArmStartupDeadline({
      meta: { assetId: 'files:sfx/intro' },
      disabled: false
    })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/modules/Player/resilienceDeadlineGating.test.mjs`
Expected: FAIL — module not found

### Task 4: Implement the deadline gate

**Files:**
- Create: `frontend/src/modules/Player/lib/shouldArmStartupDeadline.js`
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js:216-224`

- [ ] **Step 3: Create the gating function**

```javascript
// frontend/src/modules/Player/lib/shouldArmStartupDeadline.js

/**
 * Determines whether the resilience startup deadline timer should be armed.
 *
 * The deadline should only arm when we have enough metadata to know what
 * media we're trying to play. Without metadata, the deadline will fire
 * for phantom/placeholder entries and trigger futile recovery attempts.
 *
 * @param {Object} params
 * @param {Object|null} params.meta - Media metadata from the player
 * @param {boolean} params.disabled - Whether resilience is disabled (e.g. titlecard)
 * @returns {boolean} true if the deadline timer should be armed
 */
export function shouldArmStartupDeadline({ meta, disabled }) {
  if (disabled) return false;
  if (!meta) return false;
  return !!(meta.mediaType || meta.mediaUrl || meta.plex
    || meta.media || meta.contentId || meta.assetId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/modules/Player/resilienceDeadlineGating.test.mjs`
Expected: All 9 tests PASS

- [ ] **Step 5: Wire the gate into useMediaResilience**

In `frontend/src/modules/Player/hooks/useMediaResilience.js`, add import at the top:

```javascript
import { shouldArmStartupDeadline } from '../lib/shouldArmStartupDeadline.js';
```

Then modify the startup deadline block (lines 216-224). The current code:

```javascript
    // Startup/recovering: set a deadline for initial load
    if (status === STATUS.startup || status === STATUS.recovering) {
      if (!startupDeadlineRef.current) {
        startupDeadlineRef.current = setTimeout(() => {
          triggerRecovery('startup-deadline-exceeded');
          startupDeadlineRef.current = null;
        }, hardRecoverLoadingGraceMs);
      }
    }
```

Replace with:

```javascript
    // Startup/recovering: set a deadline for initial load
    // Gate: only arm when we have media metadata (prevents phantom entry timers)
    if (status === STATUS.startup || status === STATUS.recovering) {
      if (!startupDeadlineRef.current && hasMediaMeta) {
        startupDeadlineRef.current = setTimeout(() => {
          triggerRecovery('startup-deadline-exceeded');
          startupDeadlineRef.current = null;
        }, hardRecoverLoadingGraceMs);
      }
    }
```

**Important: Use a stable boolean dep, not the `meta` object.** The `meta` parameter is `effectiveMeta` from Player.jsx, which creates a new object reference on every `singlePlayerProps` recalculation (due to the spread at Player.jsx:142). Adding `meta` directly to the dep array would cause excessive effect re-runs and timer churn.

Instead, compute a stable boolean BEFORE the effect (add this around line 128, after `startupDeadlineRef` declaration):

```javascript
  // Stable boolean for dep array — avoids re-runs from meta object reference changes
  const hasMediaMeta = shouldArmStartupDeadline({ meta, disabled });
```

Then use `hasMediaMeta` in the dep array on line 225. The current deps:

```javascript
  }, [status, playbackHealth.progressToken, userIntent, actions, triggerRecovery, hardRecoverLoadingGraceMs, playbackSessionKey, disabled]);
```

Becomes:

```javascript
  }, [status, playbackHealth.progressToken, userIntent, actions, triggerRecovery, hardRecoverLoadingGraceMs, playbackSessionKey, disabled, hasMediaMeta]);
```

This way the effect only re-runs when the boolean *result* changes (false→true when real metadata arrives), not on every `meta` object reference change.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Player/lib/shouldArmStartupDeadline.js \
       frontend/src/modules/Player/hooks/useMediaResilience.js \
       tests/isolated/modules/Player/resilienceDeadlineGating.test.mjs
git commit -m "fix(player): don't arm resilience deadline for phantom entries

The startup deadline timer (15s) now requires media metadata before
arming. Phantom entries with no mediaType/mediaUrl/contentId won't
trigger futile startup-deadline-exceeded recovery cycles.

Refs: docs/_wip/bugs/2026-03-17-morning-program-spinner-audio-plays.md"
```

---

## Chunk 4: Suppress phantom queue-track-changed emissions (P2)

The queue controller emits `queue-track-changed` for a phantom entry (guid only, no title, queueLength: 1) before the queue API response arrives. This phantom triggers Player state changes that create stale resilience monitoring. Suppressing the emission prevents the phantom from ever entering the Player pipeline.

### Task 5: Write failing tests for phantom suppression

**Files:**
- Create: `tests/isolated/modules/Player/queueTrackChangedFilter.test.mjs`

- [ ] **Step 1: Write the failing test**

The filter logic determines whether a track-changed event should be emitted.

```javascript
// tests/isolated/modules/Player/queueTrackChangedFilter.test.mjs
import { describe, it, expect } from 'vitest';

/**
 * Tests for queue-track-changed emission filtering.
 *
 * The queue controller should not emit track-changed for phantom entries
 * that appear before the queue API response arrives. These have a guid
 * but no title, no mediaType, no media URL — they're placeholders.
 *
 * See: docs/_wip/bugs/2026-03-17-morning-program-spinner-audio-plays.md
 */

function shouldEmitTrackChanged(item) {
  if (!item) return false;
  if (!item.guid) return false;
  // Must have at least a title or a content identifier
  return !!(item.title || item.mediaType || item.mediaUrl
    || item.media || item.plex || item.contentId || item.assetId);
}

describe('shouldEmitTrackChanged', () => {
  describe('phantom entries (should NOT emit)', () => {
    it('rejects entry with only guid', () => {
      expect(shouldEmitTrackChanged({ guid: 'O2ExbkfR8M' })).toBe(false);
    });

    it('rejects null', () => {
      expect(shouldEmitTrackChanged(null)).toBe(false);
    });

    it('rejects entry with guid and empty fields', () => {
      expect(shouldEmitTrackChanged({ guid: 'abc', title: '', mediaType: '' })).toBe(false);
    });
  });

  describe('real entries (should emit)', () => {
    it('allows entry with title', () => {
      expect(shouldEmitTrackChanged({ guid: 'jv2oyqLGRN', title: 'Good Morning' })).toBe(true);
    });

    it('allows entry with mediaType', () => {
      expect(shouldEmitTrackChanged({ guid: 'abc', mediaType: 'video' })).toBe(true);
    });

    it('allows entry with plex', () => {
      expect(shouldEmitTrackChanged({ guid: 'abc', plex: '375839' })).toBe(true);
    });

    it('allows entry with contentId', () => {
      expect(shouldEmitTrackChanged({ guid: 'abc', contentId: 'freshvideo:teded' })).toBe(true);
    });

    it('allows entry with media key', () => {
      expect(shouldEmitTrackChanged({ guid: 'abc', media: 'sfx/intro' })).toBe(true);
    });

    it('allows entry with assetId', () => {
      expect(shouldEmitTrackChanged({ guid: 'abc', assetId: 'files:sfx/intro' })).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify test design is correct**

Run: `npx vitest run tests/isolated/modules/Player/queueTrackChangedFilter.test.mjs`
Expected: PASS (inline function validates test design). The real "red" step happens in Step 4 when we switch to the module import.

### Task 6: Extract the filter and wire into useQueueController

**Files:**
- Create: `frontend/src/modules/Player/lib/shouldEmitTrackChanged.js`
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js:205-217`

- [ ] **Step 3: Create the filter function**

```javascript
// frontend/src/modules/Player/lib/shouldEmitTrackChanged.js

/**
 * Determines whether a queue-track-changed event should be emitted.
 *
 * Phantom entries (created before queue API response) have a guid but
 * no title, mediaType, or content identifiers. Emitting track-changed
 * for these creates stale Player state and orphan resilience timers.
 *
 * @param {Object|null} item - Queue item to check
 * @returns {boolean} true if the track-changed event should be emitted
 */
export function shouldEmitTrackChanged(item) {
  if (!item) return false;
  if (!item.guid) return false;
  return !!(item.title || item.mediaType || item.mediaUrl
    || item.media || item.plex || item.contentId || item.assetId);
}
```

- [ ] **Step 4: Update test to import from module**

Replace the inline function in `queueTrackChangedFilter.test.mjs` with:

```javascript
import { shouldEmitTrackChanged } from '../../../../frontend/src/modules/Player/lib/shouldEmitTrackChanged.js';
```

Remove the inline function definition.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/modules/Player/queueTrackChangedFilter.test.mjs`
Expected: All 9 tests PASS

- [ ] **Step 6: Wire the filter into useQueueController**

In `frontend/src/modules/Player/hooks/useQueueController.js`, add import at the top:

```javascript
import { shouldEmitTrackChanged } from '../lib/shouldEmitTrackChanged.js';
```

Modify the track-changed effect (lines 205-217). The current code:

```javascript
  useEffect(() => {
    const currentItem = playQueue[0];
    if (!currentItem) return;
    if (currentItem.guid === lastLoggedGuidRef.current) return;

    lastLoggedGuidRef.current = currentItem.guid;
    playbackLog('queue-track-changed', {
      title: currentItem.title,
      guid: currentItem.guid,
      queueLength: playQueue.length,
      queuePosition: originalQueue.findIndex(item => item.guid === currentItem.guid)
    }, { level: 'info' });
  }, [playQueue, originalQueue]);
```

Replace with:

```javascript
  useEffect(() => {
    const currentItem = playQueue[0];
    if (!currentItem) return;
    if (currentItem.guid === lastLoggedGuidRef.current) return;
    if (!shouldEmitTrackChanged(currentItem)) return;

    lastLoggedGuidRef.current = currentItem.guid;
    playbackLog('queue-track-changed', {
      title: currentItem.title,
      guid: currentItem.guid,
      queueLength: playQueue.length,
      queuePosition: originalQueue.findIndex(item => item.guid === currentItem.guid)
    }, { level: 'info' });
  }, [playQueue, originalQueue]);
```

The only change is the added line: `if (!shouldEmitTrackChanged(currentItem)) return;`

- [ ] **Step 7: Run all new tests together**

Run: `npx vitest run tests/isolated/modules/Player/resiliencePhantomGuard.test.mjs tests/isolated/modules/Player/resilienceDeadlineGating.test.mjs tests/isolated/modules/Player/queueTrackChangedFilter.test.mjs`
Expected: All tests PASS

- [ ] **Step 8: Run existing Player tests to check for regressions**

Run: `npx vitest run tests/isolated/modules/Player/`
Expected: All existing tests still PASS (useQueueController.audio, computeZoomTarget, normalizeDuration, resolveContentId)

- [ ] **Step 9: Commit**

```bash
git add frontend/src/modules/Player/lib/shouldEmitTrackChanged.js \
       frontend/src/modules/Player/hooks/useQueueController.js \
       tests/isolated/modules/Player/queueTrackChangedFilter.test.mjs
git commit -m "fix(player): suppress phantom queue-track-changed emissions

Queue entries without title, mediaType, or content identifiers are
phantom placeholders from the queue loading race. Suppressing their
track-changed events prevents stale Player state and orphan resilience
timers from being created.

Refs: docs/_wip/bugs/2026-03-17-morning-program-spinner-audio-plays.md"
```

---

## Post-Implementation

- [ ] **Run full isolated test suite**: `npx vitest run tests/isolated/`
- [ ] **Manual smoke test**: Trigger morning program on living room TV via device load API:
  ```
  GET /api/v1/device/livingroom-tv/load?queue=morning-program
  ```
  Verify: intro SFX plays, then video track loads and plays (no spinner death spiral).
- [ ] **Check logs**: After smoke test, grep for `resilience-reload-skipped-phantom` — if present, the P0 guard is working. Grep for `startup-deadline-exceeded` — should NOT appear for phantom guids.
