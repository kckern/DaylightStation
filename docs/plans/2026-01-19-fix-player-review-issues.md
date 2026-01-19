# Fix Player Code Review Issues

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Address the 3 important issues and cleanup found in the 2026-01-19 code review audit.

**Architecture:** Direct fixes to existing files - typo correction, DRY refactoring, and file deletion.

**Tech Stack:** React, JavaScript, Playwright

---

## Task 1: Fix Typo in VideoPlayer.jsx

**Files:**
- Modify: `frontend/src/modules/Player/components/VideoPlayer.jsx:216`

**Step 1: Fix the typo**

Change `seasonc` to `season` on line 216:

```javascript
// Before (line 214-220):
const heading = !!show && !!season && !!title
  ? `${show} - ${season}: ${title}`
  : !!show && !!seasonc
  ? `${show} - ${season}`
  : !!show
  ? show
  : title;

// After:
const heading = !!show && !!season && !!title
  ? `${show} - ${season}: ${title}`
  : !!show && !!season
  ? `${show} - ${season}`
  : !!show
  ? show
  : title;
```

**Step 2: Verify the fix**

Run: `grep -n "seasonc" frontend/src/modules/Player/components/VideoPlayer.jsx`
Expected: No output (no matches)

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/components/VideoPlayer.jsx
git commit -m "fix(player): correct typo 'seasonc' to 'season' in VideoPlayer heading"
```

---

## Task 2: Remove Duplicate Diagnostic Utilities from useMediaTransportAdapter.js

**Files:**
- Modify: `frontend/src/modules/Player/hooks/transport/useMediaTransportAdapter.js:1-96`

**Step 1: Add import for shared diagnostics module**

Add import at line 2:

```javascript
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { playbackLog } from '../../lib/playbackLogger.js';
import { buildMediaDiagnostics } from '../../lib/mediaDiagnostics.js';
```

**Step 2: Delete duplicate `serializeTimeRanges` function**

Delete lines 4-20 (the `serializeTimeRanges` function).

**Step 3: Delete duplicate `readPlaybackQuality` function**

Delete lines 22-46 (the `readPlaybackQuality` function).

**Step 4: Replace `fallbackDiagnosticsFromMediaEl` with wrapper**

Replace the entire `fallbackDiagnosticsFromMediaEl` function (lines 48-96) with:

```javascript
const fallbackDiagnosticsFromMediaEl = (mediaEl) => {
  if (!mediaEl) return null;
  const diag = buildMediaDiagnostics(mediaEl);
  return {
    currentTime: diag.currentTime,
    readyState: diag.readyState,
    networkState: diag.networkState,
    playbackRate: diag.playbackRate,
    paused: diag.paused,
    buffered: diag.buffered,
    bufferAheadSeconds: diag.bufferAheadSeconds,
    bufferBehindSeconds: diag.bufferBehindSeconds,
    nextBufferStartSeconds: diag.nextBufferStartSeconds,
    bufferGapSeconds: diag.bufferGapSeconds,
    quality: {
      droppedFrames: diag.droppedFrames,
      totalFrames: diag.totalFrames
    }
  };
};
```

**Step 5: Verify no duplicate functions remain**

Run: `grep -n "serializeTimeRanges\|readPlaybackQuality" frontend/src/modules/Player/hooks/transport/useMediaTransportAdapter.js`
Expected: No output (functions should be removed)

**Step 6: Verify import works**

Run: `npm run build 2>&1 | head -20`
Expected: No import errors

**Step 7: Commit**

```bash
git add frontend/src/modules/Player/hooks/transport/useMediaTransportAdapter.js
git commit -m "refactor(player): DRY - use shared mediaDiagnostics in transport adapter"
```

---

## Task 3: Strengthen Contract Tests

**Files:**
- Modify: `tests/runtime/player/player-contracts.runtime.test.mjs`

**Step 1: Replace passive tests with assertive tests**

Replace the entire file content:

```javascript
import { test, expect } from '@playwright/test';

test.describe('Player Contract Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Enable test hooks before navigation
    await page.addInitScript(() => {
      window.__TEST_CAPTURE_METRICS__ = true;
    });
  });

  test('VideoPlayer reports playback metrics to parent', async ({ page }) => {
    // Navigate to TV app (has video player)
    await page.goto('/tv');
    await page.waitForLoadState('networkidle');

    // Wait for potential metrics capture
    await page.waitForTimeout(3000);

    // Check if metrics were captured
    const metrics = await page.evaluate(() => window.__TEST_LAST_METRICS__);

    if (metrics) {
      // Verify metrics shape - these assertions are real contracts
      expect(metrics).toHaveProperty('seconds');
      expect(metrics).toHaveProperty('isPaused');
      expect(typeof metrics.seconds).toBe('number');
      expect(typeof metrics.isPaused).toBe('boolean');
    } else {
      // Skip test when no player is active - this is expected without video playback
      test.skip(true, 'No active player - metrics not captured without video playback');
    }
  });

  test('Parent can access media element via test hook', async ({ page }) => {
    await page.goto('/tv');
    await page.waitForLoadState('networkidle');

    // Wait for media access to be registered
    await page.waitForTimeout(3000);

    // Check if media access was registered
    const hasMediaAccess = await page.evaluate(() => {
      const access = window.__TEST_MEDIA_ACCESS__;
      if (!access || typeof access.getMediaEl !== 'function') {
        return { hasAccess: false };
      }
      const el = access.getMediaEl();
      return {
        hasAccess: true,
        hasElement: !!el,
        tagName: el?.tagName || null
      };
    });

    if (hasMediaAccess.hasAccess && hasMediaAccess.hasElement) {
      // Verify element is a media element - this is the real contract
      expect(['VIDEO', 'AUDIO', 'DASH-VIDEO']).toContain(hasMediaAccess.tagName);
    } else {
      // Skip test when no player is mounted - this is expected on TV landing
      test.skip(true, 'No active player - media access not registered without player mount');
    }
  });
});
```

**Step 2: Verify tests use skip instead of false pass**

Run: `grep -n "expect(true).toBe(true)" tests/runtime/player/player-contracts.runtime.test.mjs`
Expected: No output (no fake passes)

**Step 3: Commit**

```bash
git add tests/runtime/player/player-contracts.runtime.test.mjs
git commit -m "test(player): use test.skip instead of false-pass in contract tests"
```

---

## Task 4: Delete Backup File

**Files:**
- Delete: `frontend/src/modules/Player/Player.jsx.backup`

**Step 1: Delete the backup file**

```bash
rm frontend/src/modules/Player/Player.jsx.backup
```

**Step 2: Verify deletion**

Run: `ls frontend/src/modules/Player/Player.jsx.backup 2>&1`
Expected: "No such file or directory"

**Step 3: Commit**

```bash
git add -A frontend/src/modules/Player/Player.jsx.backup
git commit -m "chore: delete obsolete Player.jsx.backup"
```

---

## Task 5: Final Verification

**Step 1: Run the build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 2: Verify all typos fixed**

Run: `grep -rn "seasonc" frontend/src/`
Expected: No output

**Step 3: Verify no duplicate diagnostics**

Run: `grep -l "serializeTimeRanges" frontend/src/modules/Player/`
Expected: Only `lib/mediaDiagnostics.js` (or no output if named differently)

---

## Summary

| Task | Issue | Fix |
|------|-------|-----|
| 1 | Typo `seasonc` | Change to `season` |
| 2 | Duplicate utilities | Import from shared module |
| 3 | Tests always pass | Use `test.skip` for no-player cases |
| 4 | Backup file lingers | Delete it |
| 5 | Final verification | Build + grep checks |
