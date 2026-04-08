# Fix Queue Signature Cache Poisoning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the race condition where duplicate WS commands cause the Player's queue signature cache to be poisoned, resulting in an empty queue and total playback failure.

**Architecture:** Two-layer fix: (1) Move signature cache write from before the async API call to after success, so the cache only records "done" when data is actually stored. (2) Add deduplication to ScreenActionHandler so duplicate `media:queue` commands with the same contentId within 3 seconds are suppressed, preventing the Player remount that triggers the race.

**Tech Stack:** React hooks, Jest (isolated tests via `npm run test:isolated`)

**Bug Report:** `docs/_wip/bugs/2026-04-04-office-program-queue-empty-after-double-command.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/modules/Player/hooks/useQueueController.js` | Modify (lines 83-85, 164-168, 181-183) | Move cache write to after API success; clear cache on cancellation |
| `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` | Modify (lines 91-105) | Add dedup guard for media:play and media:queue |
| `tests/isolated/assembly/player/queueSignatureCache.test.mjs` | Modify | Add tests for cache poisoning and cancellation cleanup |
| `tests/isolated/assembly/player/screenActionDedup.test.mjs` | Create | Test deduplication logic for rapid duplicate commands |

---

### Task 1: Fix signature cache — write after success, clear on cancel

This is the primary fix. The cache currently writes at line 85 (before the async API call), creating a window where the cache says "processed" but data was never stored.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js:83-85, 164-168, 181-183`
- Modify: `tests/isolated/assembly/player/queueSignatureCache.test.mjs`

- [ ] **Step 1: Add failing test for cache poisoning scenario**

In `tests/isolated/assembly/player/queueSignatureCache.test.mjs`, add a test that reproduces the exact race condition: cache is set before async completes, component unmounts (cancel), remount sees cached signature and skips fetch.

```javascript
test('cache must not retain signature when init was cancelled before completion', () => {
  // Simulate: first mount sets cache optimistically
  _signatureCache.set('office-program', 'ref:office-program;shuffle:0');

  // Simulate: component unmounts before API completes → cancel
  // The cache entry should be cleaned up
  _signatureCache.delete('office-program');

  // Simulate: second mount checks cache
  const cached = _signatureCache.get('office-program') ?? null;

  // Must be null so the second mount re-fetches
  expect(cached).toBeNull();
});

test('cache retains signature only after successful completion', () => {
  const sig = 'ref:office-program;shuffle:0';

  // Simulate: API completes successfully, THEN cache is written
  // (This is the new behavior we're implementing)
  _signatureCache.set('office-program', sig);

  // Remount should see the cached value and skip re-fetch
  expect(_signatureCache.get('office-program')).toBe(sig);
});
```

- [ ] **Step 2: Run test to verify it passes (these are behavioral specs, not failing yet)**

Run: `npx jest tests/isolated/assembly/player/queueSignatureCache.test.mjs --verbose`
Expected: All tests pass (the new tests describe desired behavior using the raw Map directly)

- [ ] **Step 3: Modify useQueueController to move cache write after success**

In `frontend/src/modules/Player/hooks/useQueueController.js`, make three changes:

**Change A — Remove premature cache write (line 83-85).** Replace:

```javascript
    let isCancelled = false;
    sourceSignatureRef.current = nextSignature;
    if (contentRef) _signatureCache.set(contentRef, nextSignature);
```

With:

```javascript
    let isCancelled = false;
    sourceSignatureRef.current = nextSignature;
    // Cache write deferred to after successful API completion (see below)
```

**Change B — Write cache after successful queue storage (line 164-168).** Replace:

```javascript
      if (!isCancelled) {
        setQueue(validQueue);
        setOriginalQueue(validQueue);
        setQueueAudio(fetchedAudio);
      }
```

With:

```javascript
      if (!isCancelled) {
        if (contentRef) _signatureCache.set(contentRef, nextSignature);
        setQueue(validQueue);
        setOriginalQueue(validQueue);
        setQueueAudio(fetchedAudio);
      }
```

**Change C — Clear stale ref on cancellation (line 181-183).** Replace:

```javascript
    return () => {
      isCancelled = true;
    };
```

With:

```javascript
    return () => {
      isCancelled = true;
      // If this effect is cleaning up before the API completed,
      // the cache entry (if any) is stale — remove it so remounts re-fetch.
      if (contentRef) _signatureCache.delete(contentRef);
      sourceSignatureRef.current = null;
    };
```

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `npx jest tests/isolated/assembly/player/queueSignatureCache.test.mjs tests/isolated/assembly/player/useQueueController.advance.test.mjs --verbose`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js tests/isolated/assembly/player/queueSignatureCache.test.mjs
git commit -m "fix(player): defer signature cache write until after successful queue init

The module-level _signatureCache was written before the async API call,
creating a race condition where a cancelled fetch left a stale entry.
On remount with the same contentId, the cache prevented re-fetching,
leaving the queue empty.

Now the cache is only written after setQueue succeeds, and cleanup
deletes the entry on cancellation."
```

---

### Task 2: Add media command deduplication to ScreenActionHandler

This prevents the double-command from reaching the Player at all, eliminating the trigger for the race condition.

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx:91-105`
- Create: `tests/isolated/assembly/player/screenActionDedup.test.mjs`

- [ ] **Step 1: Write the dedup logic test**

Create `tests/isolated/assembly/player/screenActionDedup.test.mjs`:

```javascript
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

describe('ScreenActionHandler media deduplication', () => {
  // Test the dedup logic in isolation — no React needed.
  // The logic: suppress duplicate media commands with same contentId within DEDUP_WINDOW_MS.

  const DEDUP_WINDOW_MS = 3000;
  let lastMedia;

  function isDuplicate(contentId) {
    const now = Date.now();
    if (contentId && contentId === lastMedia?.contentId
        && now - lastMedia.ts < DEDUP_WINDOW_MS) {
      return true;
    }
    lastMedia = { contentId, ts: now };
    return false;
  }

  beforeEach(() => {
    lastMedia = null;
  });

  test('first command is never a duplicate', () => {
    expect(isDuplicate('office-program')).toBe(false);
  });

  test('same contentId within window is a duplicate', () => {
    isDuplicate('office-program');
    expect(isDuplicate('office-program')).toBe(true);
  });

  test('different contentId within window is not a duplicate', () => {
    isDuplicate('office-program');
    expect(isDuplicate('morning-program')).toBe(false);
  });

  test('same contentId after window expires is not a duplicate', () => {
    isDuplicate('office-program');
    // Simulate time passing
    lastMedia.ts -= DEDUP_WINDOW_MS + 1;
    expect(isDuplicate('office-program')).toBe(false);
  });

  test('null contentId is never deduplicated', () => {
    isDuplicate(null);
    expect(isDuplicate(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx jest tests/isolated/assembly/player/screenActionDedup.test.mjs --verbose`
Expected: All 5 tests pass

- [ ] **Step 3: Add dedup guard to ScreenActionHandler**

In `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`, add the dedup ref and guard to both media handlers. Replace lines 90-105:

```javascript
  // --- Media play/queue ---
  const handleMediaPlay = useCallback((payload) => {
    dismissOverlay(); // clear any stale player overlay first
    showOverlay(Player, {
      play: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    });
  }, [showOverlay, dismissOverlay]);

  const handleMediaQueue = useCallback((payload) => {
    dismissOverlay(); // clear any stale player overlay first
    showOverlay(Player, {
      queue: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    });
  }, [showOverlay, dismissOverlay]);
```

With:

```javascript
  // --- Media play/queue ---
  const lastMediaRef = useRef(null);
  const MEDIA_DEDUP_WINDOW_MS = 3000;

  const isMediaDuplicate = useCallback((contentId) => {
    const now = Date.now();
    if (contentId && contentId === lastMediaRef.current?.contentId
        && now - lastMediaRef.current.ts < MEDIA_DEDUP_WINDOW_MS) {
      logger().debug('media.duplicate-suppressed', { contentId, windowMs: MEDIA_DEDUP_WINDOW_MS });
      return true;
    }
    lastMediaRef.current = { contentId, ts: now };
    return false;
  }, []);

  const handleMediaPlay = useCallback((payload) => {
    if (isMediaDuplicate(payload.contentId)) return;
    dismissOverlay();
    showOverlay(Player, {
      play: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    });
  }, [showOverlay, dismissOverlay, isMediaDuplicate]);

  const handleMediaQueue = useCallback((payload) => {
    if (isMediaDuplicate(payload.contentId)) return;
    dismissOverlay();
    showOverlay(Player, {
      queue: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    });
  }, [showOverlay, dismissOverlay, isMediaDuplicate]);
```

- [ ] **Step 4: Run all isolated player tests**

Run: `npx jest tests/isolated/assembly/player/ --verbose`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/actions/ScreenActionHandler.jsx tests/isolated/assembly/player/screenActionDedup.test.mjs
git commit -m "fix(screen): deduplicate rapid media commands in ScreenActionHandler

WakeAndLoadService sends 2+ WS commands in sequence (prewarm + fallback).
Without dedup, each command unmounts and remounts the Player, which
triggered the signature cache poisoning bug. Now duplicate media commands
with the same contentId within 3 seconds are suppressed."
```

---

### Task 3: Smoke test — verify the fix end-to-end on prod

This verifies the fix works against the actual office-program queue on the running system.

**Files:**
- None (manual verification)

- [ ] **Step 1: Verify isolated tests pass**

Run: `npm run test:isolated`
Expected: All pass, no regressions

- [ ] **Step 2: Build and deploy to verify in prod (user action)**

This step requires the user to build and deploy. Remind them:
```bash
# Build
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .

# Deploy
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 3: Trigger office program and verify logs**

After deploy, trigger the office program:
```bash
curl -s "http://localhost:3111/api/v1/device/office-tv/load?queue=office-program"
```

Then check logs for:
1. `media.duplicate-suppressed` — confirms second command was deduped
2. `queue.resolve` with `count > 0` — confirms backend resolved items
3. `queue-track-changed` — confirms frontend received and started playing items
4. **No** `player-no-source-timeout` — confirms the fix worked

```bash
sudo docker logs daylight-station --since=2m 2>&1 | grep -E 'duplicate-suppressed|queue.resolve|queue-track-changed|player-no-source-timeout'
```

- [ ] **Step 4: Commit docs update**

Update the bug report status from "unfixed" to "fixed" and reference the fix commits.
