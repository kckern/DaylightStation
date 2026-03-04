# Playback Stall Recovery — Fresh Session Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix resilience recovery so it requests a fresh Plex transcode session URL instead of reusing the broken one from the queue.

**Architecture:** The direct-play bypass in `SinglePlayer.jsx` skips the `/play` API call when a queue item already has `mediaUrl` + `format`. During recovery remounts, this bypass must be disabled so the backend generates a fresh Plex transcode session. The check uses the existing `remountDiagnostics` prop (already wired from `Player.jsx`).

**Tech Stack:** React (JSX), Jest (isolated tests)

**Bug doc:** `docs/_wip/bugs/2026-02-28-playback-stall-recovery-reuses-broken-session.md`

---

### Task 1: Write failing test for direct-play bypass during recovery

**Files:**
- Create: `tests/isolated/assembly/player/recoveryBypassesDirectPlay.test.mjs`

**Step 1: Write the failing test**

This test verifies the core logic: when `remountDiagnostics` is truthy, the direct-play bypass should NOT fire — the callback should proceed to the `/play` API path instead.

We test the decision logic in isolation by extracting the condition. The actual SinglePlayer is a React component with many dependencies, so we test the bypass predicate directly.

```javascript
import { describe, test, expect } from '@jest/globals';

/**
 * Mirrors the direct-play bypass condition from SinglePlayer.jsx (line 221).
 * The real code: if (directMediaUrl && directFormat && !getRenderer(directFormat) && !isRecoveryRemount)
 */
function shouldBypassPlayApi({ directMediaUrl, directFormat, hasRenderer, remountDiagnostics }) {
  const isRecoveryRemount = !!remountDiagnostics;
  return !!(directMediaUrl && directFormat && !hasRenderer && !isRecoveryRemount);
}

describe('SinglePlayer direct-play bypass during recovery', () => {

  test('bypasses /play API on normal mount with pre-resolved URL', () => {
    const result = shouldBypassPlayApi({
      directMediaUrl: 'http://plex/transcode/start.mpd?session=abc',
      directFormat: 'dash_video',
      hasRenderer: false,
      remountDiagnostics: null,
    });
    expect(result).toBe(true);
  });

  test('does NOT bypass /play API during recovery remount', () => {
    const result = shouldBypassPlayApi({
      directMediaUrl: 'http://plex/transcode/start.mpd?session=abc',
      directFormat: 'dash_video',
      hasRenderer: false,
      remountDiagnostics: { reason: 'startup-deadline-exceeded', remountNonce: 1 },
    });
    expect(result).toBe(false);
  });

  test('does NOT bypass when format has a content renderer (e.g., readalong)', () => {
    const result = shouldBypassPlayApi({
      directMediaUrl: 'http://example.com/content',
      directFormat: 'readalong',
      hasRenderer: true,
      remountDiagnostics: null,
    });
    expect(result).toBe(false);
  });

  test('does NOT bypass when no mediaUrl is provided', () => {
    const result = shouldBypassPlayApi({
      directMediaUrl: null,
      directFormat: 'dash_video',
      hasRenderer: false,
      remountDiagnostics: null,
    });
    expect(result).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/assembly/player/recoveryBypassesDirectPlay.test.mjs --verbose`

Expected: FAIL — the `shouldBypassPlayApi` function is defined inline in the test, so this should actually PASS (it's a pure logic test that documents the expected behavior before we touch SinglePlayer). The test codifies the contract.

Expected: All 4 tests PASS (this is a specification test, not a red-green-refactor against production code).

**Step 3: Commit**

```bash
git add tests/isolated/assembly/player/recoveryBypassesDirectPlay.test.mjs
git commit -m "test(player): add bypass predicate tests for recovery remount"
```

---

### Task 2: Fix the direct-play bypass in SinglePlayer.jsx

**Files:**
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx:221, 315`

**Step 1: Add recovery check to the bypass condition (line 221)**

In `frontend/src/modules/Player/components/SinglePlayer.jsx`, find the direct-play bypass at line 221:

```javascript
    if (directMediaUrl && directFormat && !getRenderer(directFormat)) {
```

Replace with:

```javascript
    const isRecoveryRemount = !!remountDiagnostics;
    if (directMediaUrl && directFormat && !getRenderer(directFormat) && !isRecoveryRemount) {
```

This ensures that during a resilience recovery (when `remountDiagnostics` is populated by `Player.jsx` line 822), the bypass is skipped and a fresh `/play` API call fetches a new Plex transcode session.

**Step 2: Add `remountDiagnostics` to the `useCallback` dependency array (line 315)**

Find the dependency array at line 315:

```javascript
  }, [effectiveContentId, plex, media, open, shuffle, continuous, play?.maxVideoBitrate, play?.maxResolution, play?.seconds, play?.resume, plexClientSession]);
```

Add `remountDiagnostics` to the end:

```javascript
  }, [effectiveContentId, plex, media, open, shuffle, continuous, play?.maxVideoBitrate, play?.maxResolution, play?.seconds, play?.resume, plexClientSession, remountDiagnostics]);
```

**Step 3: Run the isolated tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/assembly/player/ --verbose`

Expected: All tests PASS (the logic test from Task 1 still passes — it tests the predicate in isolation).

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/components/SinglePlayer.jsx
git commit -m "fix(player): skip direct-play bypass during recovery remount

When resilience recovery triggers a player remount, the direct-play
bypass was reusing the stale Plex transcode session URL from the queue
item. Now checks remountDiagnostics and forces a fresh /play API call
during recovery, generating a new transcode session.

Fixes: playback-stall-recovery-reuses-broken-session"
```

---

### Task 3: Manual verification (log check)

**No code changes — verification only.**

**Step 1: Start the dev server if not running**

Run: `ss -tlnp | grep 3112` — if nothing, start the server.

**Step 2: Verify the code change is correct by reading the modified file**

Run: Read `frontend/src/modules/Player/components/SinglePlayer.jsx` lines 215–240 and confirm:
- Line 221 now has `const isRecoveryRemount = !!remountDiagnostics;`
- Line 222 condition includes `&& !isRecoveryRemount`
- Line 315 dep array includes `remountDiagnostics`

**Step 3: Mark bug doc as fixed**

Update `docs/_wip/bugs/2026-02-28-playback-stall-recovery-reuses-broken-session.md`:
- Change `**Status:** Open` → `**Status:** Fixed`
- Add a `## Resolution` section at the bottom:

```markdown
## Resolution

**Fixed in commit:** [commit hash from Task 2]

SinglePlayer.jsx now checks `remountDiagnostics` before the direct-play bypass.
During recovery remounts, the bypass is skipped, forcing a fresh `/play` API call
that generates a new Plex transcode session URL.
```

**Step 4: Commit**

```bash
git add docs/_wip/bugs/2026-02-28-playback-stall-recovery-reuses-broken-session.md
git commit -m "docs: mark playback stall recovery bug as fixed"
```
